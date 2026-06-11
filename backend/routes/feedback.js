const express  = require('express');
const webpush  = require('web-push');
const sgMail   = require('@sendgrid/mail');
const supabase = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth);

if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || 'info@velomind.org'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// GET /api/feedback — obtiene todos los comentarios públicos
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('feedback')
      .select('id, user_id, user_name, message, rating, created_at, reply, reply_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ feedback: data, isAdmin: req.user.isAdmin });
  } catch (e) {
    console.error('[feedback/GET]', e.message);
    res.status(500).json({ error: 'Error al obtener feedback' });
  }
});

// POST /api/feedback — crea un nuevo comentario
router.post('/', async (req, res) => {
  try {
    const { message, rating } = req.body;
    if (!message || message.trim().length < 5)
      return res.status(400).json({ error: 'El comentario debe tener al menos 5 caracteres' });
    if (message.trim().length > 1000)
      return res.status(400).json({ error: 'El comentario no puede superar 1000 caracteres' });
    if (rating !== undefined && (rating < 1 || rating > 5))
      return res.status(400).json({ error: 'La valoración debe ser entre 1 y 5' });

    const { data, error } = await supabase.from('feedback').insert({
      user_id: req.user.id,
      user_name: req.user.name,
      message: message.trim(),
      rating: rating || null
    }).select().single();

    if (error) throw error;
    res.status(201).json({ feedback: data });
  } catch (e) {
    console.error('[feedback/POST]', e.message);
    res.status(500).json({ error: 'Error al guardar el comentario' });
  }
});

// PATCH /api/feedback/:id/reply — solo admin; guarda respuesta como Equipo VeloMind
router.patch('/:id/reply', async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Solo el equipo VeloMind puede responder' });

  const { reply } = req.body;
  if (!reply || reply.trim().length < 1)
    return res.status(400).json({ error: 'La respuesta no puede estar vacía' });
  if (reply.trim().length > 1000)
    return res.status(400).json({ error: 'La respuesta no puede superar 1000 caracteres' });

  try {
    const { data, error } = await supabase
      .from('feedback')
      .update({ reply: reply.trim(), reply_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;

    // Notificar al usuario en background (no bloquea la respuesta)
    setImmediate(() => _notifyReply(data).catch(e => console.error('[feedback/notify]', e.message)));

    res.json({ feedback: data });
  } catch (e) {
    console.error('[feedback/PATCH reply]', e.message);
    res.status(500).json({ error: 'Error al guardar la respuesta' });
  }
});

async function _notifyReply(feedback) {
  const uid = feedback.user_id;
  if (!uid) return;

  // Obtener email del usuario
  const { data: userRow } = await supabase
    .from('users').select('email, name').eq('id', uid).single();

  // Push notification
  if (process.env.VAPID_PUBLIC_KEY) {
    const { data: sub } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', String(uid))
      .eq('active', true)
      .maybeSingle();

    if (sub?.subscription?.endpoint) {
      const realSub = {
        endpoint: sub.subscription.endpoint,
        keys: sub.subscription.keys,
        expirationTime: sub.subscription.expirationTime ?? null,
      };
      await webpush.sendNotification(realSub, JSON.stringify({
        title: '💬 El Equipo VeloMind respondió tu comentario',
        body:  feedback.reply.length > 100 ? feedback.reply.slice(0, 97) + '...' : feedback.reply,
        tag:   `feedback-reply-${feedback.id}`,
        url:   './feedback.html',
      })).catch(e => {
        if (e.statusCode === 410) {
          supabase.from('push_subscriptions').update({ active: false }).eq('user_id', String(uid)).catch(() => {});
        } else {
          console.error('[feedback/push]', e.message);
        }
      });
    }
  }

  // Email
  if (process.env.SENDGRID_API_KEY && userRow?.email) {
    await sgMail.send({
      from: { name: 'VeloMind', email: process.env.SENDGRID_FROM_EMAIL || 'info@velomind.org' },
      to: userRow.email,
      subject: '💬 El Equipo VeloMind respondió tu comentario',
      html: `
        <div style="font-family:'DM Sans',Arial,sans-serif;max-width:520px;margin:0 auto;background:#0a0b0f;color:#f0f2f5;border-radius:16px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#1a1d26,#0a0b0f);padding:40px 40px 32px;border-bottom:1px solid rgba(255,255,255,0.06)">
            <div style="font-size:28px;font-weight:800;font-family:'Space Grotesk',Arial,sans-serif">🚴 VeloMind</div>
          </div>
          <div style="padding:40px">
            <h2 style="margin:0 0 12px;font-size:20px;font-weight:700">Hola, ${userRow.name || 'ciclista'} 👋</h2>
            <p style="color:#9ca3af;line-height:1.6;margin:0 0 20px">
              El equipo VeloMind ha respondido a tu comentario:
            </p>
            <div style="background:#1a1d26;border-left:3px solid #555;padding:12px 16px;border-radius:6px;color:#9ca3af;font-size:14px;margin-bottom:20px;line-height:1.6">
              ${feedback.message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}
            </div>
            <div style="background:#1a1d26;border-left:3px solid #9ed62b;padding:12px 16px;border-radius:6px;font-size:14px;line-height:1.6">
              <div style="font-size:11px;font-weight:700;color:#9ed62b;letter-spacing:.6px;text-transform:uppercase;margin-bottom:6px">Equipo VeloMind</div>
              ${feedback.reply.replace(/</g,'&lt;').replace(/>/g,'&gt;')}
            </div>
            <div style="margin-top:28px">
              <a href="https://www.velomind.org/feedback.html" style="display:inline-block;background:#9ED62B;color:#111;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:14px">
                Ver en VeloMind
              </a>
            </div>
          </div>
          <div style="padding:20px 40px;background:rgba(255,255,255,0.02);border-top:1px solid rgba(255,255,255,0.06)">
            <p style="color:#4b5563;font-size:12px;margin:0">VeloMind — Tu entrenador de ciclismo con IA</p>
          </div>
        </div>
      `,
    }).catch(e => console.error('[feedback/email]', e.message));
  }
}

// DELETE /api/feedback/:id — admin elimina cualquier mensaje; usuario elimina el suyo
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const isAdmin = req.user.isAdmin;

    const { data: existing, error: fetchErr } = await supabase
      .from('feedback')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (fetchErr || !existing)
      return res.status(404).json({ error: 'Comentario no encontrado' });

    if (!isAdmin && existing.user_id !== req.user.id)
      return res.status(403).json({ error: 'No tienes permiso para eliminar este comentario' });

    const { error } = await supabase.from('feedback').delete().eq('id', id);
    if (error) throw error;
    res.json({ message: 'Comentario eliminado' });
  } catch (e) {
    console.error('[feedback/DELETE]', e.message);
    res.status(500).json({ error: 'Error al eliminar el comentario' });
  }
});

module.exports = router;
