// Avisos a usuarios (email + push) desde el panel de admin, y baja pública de los avisos.
// El envío corre en segundo plano y deja el resultado en la tabla `broadcasts`.
const express = require('express');
const crypto = require('crypto');
const mailer = require('../services/mailer');
const webpush = require('web-push');
const supabase = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { buildOverview } = require('./admin');


const FRONTEND_URL = process.env.FRONTEND_URL || 'https://velomind-liard.vercel.app';
const BACKEND_URL = process.env.BACKEND_URL || 'https://velomind-backend.onrender.com';
const FROM = mailer.DEFAULT_FROM;
const CHANNELS = ['email', 'push'];
const EXTRA_SEGMENTS = {
  all:         'Todos los usuarios',
  no_provider: 'Sin ninguna fuente de entrenos conectada',
  no_strava:   'Sin Strava conectado',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'ciclista';
const personalize = (text, user) => String(text).replace(/\{nombre\}/gi, firstName(user.name));

// Enlace de baja firmado: no necesita sesión ni guardar tokens en BD
const unsubToken = (uid) => crypto.createHmac('sha256', process.env.JWT_SECRET).update(`unsub:${uid}`).digest('hex').slice(0, 32);
const unsubUrl = (uid) => `${BACKEND_URL}/api/broadcast/unsubscribe?u=${encodeURIComponent(uid)}&t=${unsubToken(uid)}`;

// Solo páginas propias de la app (evita usar los avisos para mandar a enlaces externos por error)
function validCtaPath(p) {
  return !p || /^[a-z0-9-]+\.html(\?[\w=&-]*)?$/.test(p);
}

function emailHtml({ subject, body, ctaLabel, ctaPath }, user) {
  const paragraphs = personalize(body, user).split(/\n{2,}/)
    .map((p) => `<p style="color:#cbd5e1;line-height:1.6;margin:0 0 16px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const cta = ctaLabel && ctaPath
    ? `<a href="${esc(`${FRONTEND_URL}/${ctaPath}`)}" style="display:inline-block;background:#9ED62B;color:#111;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;margin-top:8px">${esc(ctaLabel)}</a>`
    : '';
  return `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#0a0b0f;color:#f0f2f5;border-radius:16px;overflow:hidden">
      <div style="padding:32px 40px 24px;border-bottom:1px solid rgba(255,255,255,0.06)">
        <div style="font-size:26px;font-weight:800">🚴 VeloMind</div>
      </div>
      <div style="padding:32px 40px">
        <h2 style="margin:0 0 16px;font-size:21px;font-weight:700">${esc(personalize(subject, user))}</h2>
        ${paragraphs}
        ${cta}
      </div>
      <div style="padding:18px 40px;background:rgba(255,255,255,0.02);border-top:1px solid rgba(255,255,255,0.06)">
        <p style="color:#6b7280;font-size:12px;margin:0;line-height:1.5">
          Recibes este aviso porque tienes cuenta en VeloMind.
          <a href="${esc(unsubUrl(user.id))}" style="color:#9ca3af">No quiero recibir más avisos</a>.
        </p>
      </div>
    </div>`;
}

async function sendEmail(msg, user) {
  await mailer.send({
    from: FROM,
    to: user.email,
    subject: personalize(msg.subject, user),
    html: emailHtml(msg, user),
    headers: { 'List-Unsubscribe': `<${unsubUrl(user.id)}>` },
  });
}

const pushReady = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
function ensureVapid() {
  if (!pushReady()) return false;
  webpush.setVapidDetails(`mailto:${process.env.VAPID_EMAIL || 'info@velomind.org'}`, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  return true;
}

async function sendPush(msg, user, sub) {
  const body = personalize(msg.body, user).replace(/\s+/g, ' ').trim();
  await webpush.sendNotification(
    { endpoint: sub.subscription.endpoint, keys: sub.subscription.keys, expirationTime: sub.subscription.expirationTime ?? null },
    JSON.stringify({
      title: personalize(msg.subject, user),
      body: body.length > 140 ? body.slice(0, 137) + '…' : body,
      tag: 'broadcast',
      url: `./${msg.ctaPath || 'dashboard.html'}`,
    })
  );
}

// web-push solo dice "Received unexpected response code": traducimos el código HTTP del
// servicio de push del navegador a algo accionable.
// 404/410: la suscripción ya no existe (notificaciones desactivadas, app desinstalada...).
// 401/403: las claves VAPID del servidor no son las que se usaron al activar las notificaciones.
const isDeadSubscription = (e) => e.statusCode === 404 || e.statusCode === 410;
function pushErrorText(e) {
  if (isDeadSubscription(e)) return 'tu suscripción a notificaciones ha caducado: vuelve a activarlas en Notificaciones';
  if (e.statusCode === 401 || e.statusCode === 403) {
    return 'las claves VAPID del servidor no coinciden con las de tu suscripción: desactiva y vuelve a activar las notificaciones';
  }
  return `error ${e.statusCode || ''} ${String(e.body || e.message).slice(0, 120)}`.trim();
}

async function pushSubsFor(userIds) {
  if (!userIds.length) return new Map();
  const { data } = await supabase.from('push_subscriptions').select('user_id, subscription')
    .in('user_id', userIds.map(String)).eq('active', true);
  return new Map((data || []).map((s) => [String(s.user_id), s]));
}

// Destinatarios de un segmento (sin demos, admins ni quien se dio de baja)
async function resolveRecipients(viewer, segment) {
  const overview = await buildOverview(viewer);
  const isSegment = overview.segments.some((s) => s.key === segment);
  if (!isSegment && !EXTRA_SEGMENTS[segment]) throw Object.assign(new Error('Segmento no válido'), { status: 400 });

  const { data: optedOut, error } = await supabase.from('users').select('id').eq('broadcast_opt_out', true);
  if (error) throw Object.assign(new Error('Falta ejecutar migrations/add_broadcasts.sql en Supabase'), { status: 409 });
  const out = new Set((optedOut || []).map((u) => String(u.id)));

  return overview.users.filter((u) => {
    if (out.has(String(u.id))) return false;
    if (segment === 'all') return true;
    if (segment === 'no_provider') return !u.providers.length;
    if (segment === 'no_strava') return !u.providers.includes('Strava');
    return u.segment === segment;
  });
}

function parseMessage(body) {
  const msg = {
    subject: String(body?.subject || '').trim().slice(0, 120),
    body: String(body?.body || '').trim().slice(0, 4000),
    ctaLabel: String(body?.cta_label || '').trim().slice(0, 40) || null,
    ctaPath: String(body?.cta_path || '').trim() || null,
    channels: (Array.isArray(body?.channels) ? body.channels : []).filter((c) => CHANNELS.includes(c)),
  };
  if (!msg.subject || !msg.body) return { error: 'Faltan el asunto o el mensaje' };
  if (!msg.channels.length) return { error: 'Elige al menos un canal (email o push)' };
  if (msg.channels.includes('email') && !mailer.isConfigured()) return { error: 'El email no está configurado en el servidor (falta BREVO_API_KEY)' };
  if (msg.channels.includes('push') && !pushReady()) return { error: 'Las push no están configuradas en el servidor (faltan las claves VAPID)' };
  if (!validCtaPath(msg.ctaPath)) return { error: 'El enlace del botón debe ser una página de la app, p. ej. integrations.html' };
  return { msg };
}

// ── Admin ───────────────────────────────────────────────────
const adminRouter = express.Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/segments', async (req, res) => {
  try {
    const overview = await buildOverview(req.user);
    const subs = await pushSubsFor(overview.users.map((u) => u.id));
    const count = (pred) => {
      const list = overview.users.filter(pred);
      return { users: list.length, push: list.filter((u) => subs.has(String(u.id))).length };
    };
    res.json({
      emailReady: mailer.isConfigured(),
      pushReady: pushReady(),
      segments: [
        { key: 'all', label: EXTRA_SEGMENTS.all, ...count(() => true) },
        { key: 'no_provider', label: EXTRA_SEGMENTS.no_provider, ...count((u) => !u.providers.length) },
        { key: 'no_strava', label: EXTRA_SEGMENTS.no_strava, ...count((u) => !u.providers.includes('Strava')) },
        ...overview.segments.map((s) => ({ key: s.key, label: `${s.label} — ${s.desc}`, ...count((u) => u.segment === s.key) })),
      ],
    });
  } catch (e) {
    console.error('[broadcast/segments]', e.message);
    res.status(500).json({ error: e.message });
  }
});

adminRouter.post('/preview', async (req, res) => {
  try {
    const recipients = await resolveRecipients(req.user, req.body?.segment);
    const subs = await pushSubsFor(recipients.map((u) => u.id));
    res.json({
      recipients: recipients.length,
      email: recipients.length,
      push: recipients.filter((u) => subs.has(String(u.id))).length,
      sample: recipients.slice(0, 8).map((u) => ({ name: u.name, email: u.email })),
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Prueba: solo al admin que la pide, por los canales elegidos
adminRouter.post('/test', async (req, res) => {
  const { msg, error } = parseMessage(req.body);
  if (error) return res.status(400).json({ error });
  const me = { id: req.user.id, name: req.user.name, email: req.user.email };
  const result = {};
  if (msg.channels.includes('email')) {
    try { await sendEmail(msg, me); result.email = 'enviado'; } catch (e) {
      const detail = e.response?.body?.errors?.[0]?.message || e.message;
      result.email = /credits|quota|limit/i.test(detail) ? 'el proveedor de email no tiene envíos disponibles: ningún email de la app (tampoco verificación ni contraseña) se está enviando' : 'error: ' + detail;
    }
  }
  if (msg.channels.includes('push')) {
    const sub = (await pushSubsFor([me.id])).get(String(me.id));
    if (!ensureVapid()) result.push = 'push no configurado en el servidor';
    else if (!sub) result.push = 'no tienes notificaciones activadas en este dispositivo';
    else {
      try { await sendPush(msg, me, sub); result.push = 'enviada'; } catch (e) {
        result.push = pushErrorText(e);
        if (isDeadSubscription(e)) await supabase.from('push_subscriptions').update({ active: false }).eq('user_id', String(me.id));
      }
    }
  }
  res.json(result);
});

adminRouter.post('/send', async (req, res) => {
  const { msg, error } = parseMessage(req.body);
  if (error) return res.status(400).json({ error });
  const segment = String(req.body?.segment || '');
  try {
    const { data: running } = await supabase.from('broadcasts').select('id').eq('status', 'sending').limit(1);
    if (running?.length) return res.status(409).json({ error: 'Ya hay un aviso enviándose. Espera a que termine.' });

    const recipients = await resolveRecipients(req.user, segment);
    if (!recipients.length) return res.status(400).json({ error: 'Ese grupo no tiene destinatarios' });

    const { data: row, error: insErr } = await supabase.from('broadcasts').insert({
      subject: msg.subject, body: msg.body, cta_label: msg.ctaLabel, cta_path: msg.ctaPath,
      channels: msg.channels, segment, recipients: recipients.length, created_by: req.user.id,
    }).select('id').single();
    if (insErr) throw insErr;

    res.status(202).json({ id: row.id, recipients: recipients.length });
    setImmediate(() => runBroadcast(row.id, msg, recipients).catch((e) => console.error('[broadcast]', e.message)));
  } catch (e) {
    console.error('[broadcast/send]', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

async function runBroadcast(id, msg, recipients) {
  const stats = { email_sent: 0, email_failed: 0, push_sent: 0, push_failed: 0 };
  let stopError = null;

  if (msg.channels.includes('email')) {
    for (const u of recipients) {
      try {
        await sendEmail(msg, u);
        stats.email_sent++;
      } catch (e) {
        stats.email_failed++;
        const detail = e.response?.body?.errors?.[0]?.message || e.message;
        // Cupo diario de SendGrid agotado: no tiene sentido seguir intentándolo
        if (e.code === 429 || /credits|limit|quota/i.test(detail)) {
          stopError = `Email: ${detail}. Se enviaron ${stats.email_sent}; el resto no.`;
          stats.email_failed += recipients.length - stats.email_sent - stats.email_failed;
          break;
        }
      }
    }
  }

  if (msg.channels.includes('push') && ensureVapid()) {
    const subs = await pushSubsFor(recipients.map((u) => u.id));
    for (const u of recipients) {
      const sub = subs.get(String(u.id));
      if (!sub) continue;
      try {
        await sendPush(msg, u, sub);
        stats.push_sent++;
      } catch (e) {
        stats.push_failed++;
        if (isDeadSubscription(e)) await supabase.from('push_subscriptions').update({ active: false }).eq('user_id', String(u.id));
      }
    }
  }

  const failed = stats.email_failed + stats.push_failed;
  const sent = stats.email_sent + stats.push_sent;
  await supabase.from('broadcasts').update({
    ...stats,
    status: !sent && failed ? 'error' : failed ? 'partial' : 'done',
    error: stopError,
    finished_at: new Date().toISOString(),
  }).eq('id', id);
  console.log(`[broadcast] #${id} terminado:`, JSON.stringify(stats));
}

adminRouter.get('/history', async (req, res) => {
  const { data, error } = await supabase.from('broadcasts')
    .select('id, subject, channels, segment, recipients, email_sent, email_failed, push_sent, push_failed, status, error, created_at, finished_at')
    .order('created_at', { ascending: false }).limit(20);
  if (error) return res.json({ history: [], migrationMissing: true });
  res.json({ history: data || [] });
});

// ── Público: baja de los avisos ─────────────────────────────
const publicRouter = express.Router();

publicRouter.get('/unsubscribe', async (req, res) => {
  const uid = String(req.query.u || '');
  const t = String(req.query.t || '');
  const page = (title, text) => res.type('html').send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VeloMind</title></head>
    <body style="font-family:Arial,sans-serif;background:#0a0b0f;color:#f0f2f5;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px">
    <div style="max-width:420px;text-align:center"><div style="font-size:26px;font-weight:800;margin-bottom:16px">🚴 VeloMind</div>
    <h2 style="font-size:20px">${title}</h2><p style="color:#9ca3af;line-height:1.6">${text}</p></div></body></html>`);

  const expected = unsubToken(uid);
  if (!uid || t.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(expected))) {
    return page('Enlace no válido', 'Este enlace de baja no es correcto. Si quieres dejar de recibir avisos, responde a cualquiera de nuestros emails.');
  }
  const { error } = await supabase.from('users').update({ broadcast_opt_out: true }).eq('id', uid);
  if (error) return page('Algo ha fallado', 'No hemos podido procesar la baja. Inténtalo de nuevo en unos minutos.');
  page('Listo, no recibirás más avisos', 'Seguirás recibiendo solo los emails imprescindibles de tu cuenta (verificación, cambio de contraseña).');
});

module.exports = { adminRouter, publicRouter, unsubToken, parseMessage };
