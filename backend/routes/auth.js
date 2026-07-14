const express = require('express');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const multer  = require('multer');
const sgMail = require('@sendgrid/mail');
const supabase = require('../db'); // Ahora db es el cliente de Supabase
const { requireAuth, signToken } = require('../middleware/auth');
const { recalculatePMC } = require('../services/pmc');
const router  = express.Router();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Envía el email de verificación y crea el token — se usa desde /register y /resend-verification.
async function sendVerificationEmail(user) {
  await supabase.from('email_verification_tokens').delete().eq('user_id', user.id);

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

  await supabase.from('email_verification_tokens').insert({
    user_id: user.id,
    token,
    expires_at: expiresAt.toISOString(),
  });

  const backendUrl = process.env.BACKEND_URL || 'https://velomind-backend.onrender.com';
  const verifyUrl = `${backendUrl}/api/auth/verify-email?token=${token}`;

  await sgMail.send({
    from: { name: 'VeloMind', email: process.env.SENDGRID_FROM_EMAIL || 'info@velomind.org' },
    to: user.email,
    subject: 'Confirma tu email — VeloMind',
    html: `
      <div style="font-family:'DM Sans',Arial,sans-serif;max-width:520px;margin:0 auto;background:#0a0b0f;color:#f0f2f5;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#1a1d26,#0a0b0f);padding:40px 40px 32px;border-bottom:1px solid rgba(255,255,255,0.06)">
          <div style="font-size:28px;font-weight:800;font-family:'Space Grotesk',Arial,sans-serif">
            🚴 VeloMind
          </div>
        </div>
        <div style="padding:40px">
          <h2 style="margin:0 0 12px;font-size:22px;font-weight:700">Hola, ${user.name || 'ciclista'}</h2>
          <p style="color:#9ca3af;line-height:1.6;margin:0 0 28px">
            Confirma tu email para activar tu cuenta de VeloMind. El enlace es válido por
            <strong style="color:#f0f2f5">24 horas</strong>.
          </p>
          <a href="${verifyUrl}" style="display:inline-block;background:#9ED62B;color:#111;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;font-family:'Space Grotesk',Arial,sans-serif">
            Confirmar email
          </a>
          <p style="color:#6b7280;font-size:13px;margin:28px 0 0;line-height:1.5">
            Si no creaste esta cuenta, podés ignorar este correo.
          </p>
        </div>
        <div style="padding:20px 40px;background:rgba(255,255,255,0.02);border-top:1px solid rgba(255,255,255,0.06)">
          <p style="color:#4b5563;font-size:12px;margin:0">
            VeloMind — Tu entrenador de ciclismo con IA
          </p>
        </div>
      </div>
    `,
  });
}

// Registro
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
    if (!EMAIL_RE.test(email.trim())) return res.status(400).json({ error: 'Formato de email inválido' });
    if (password.length < 6)  return res.status(400).json({ error: 'Contraseña mínimo 6 caracteres' });

    const emailNorm = email.trim().toLowerCase();
    const { data: existing } = await supabase.from('users').select('id').eq('email', emailNorm).maybeSingle();
    if (existing)
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email' });

    const hash = await bcrypt.hash(password, 10);
    const { data: user, error } = await supabase.from('users').insert({
      email: emailNorm,
      password: hash,
      name: name?.trim() || emailNorm.split('@')[0],
      email_verified: false,
    }).select('*').single();

    if (error) throw error;

    // No bloqueamos el alta por un email que no llegue a enviarse — el usuario
    // puede pedir que se lo reenvíen desde /resend-verification.
    sendVerificationEmail(user).catch(e => console.error('[auth/register] error enviando verificación:', e.message));

    res.status(201).json({ message: '✅ Cuenta creada', token: signToken(user), user: safeUser(user) });
  } catch (e) {
    console.error('[auth/register]', e.message);
    res.status(500).json({ error: 'Error al crear la cuenta. Inténtalo de nuevo.' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
    const { data: user } = await supabase.from('users').select('*').eq('email', email.trim().toLowerCase()).maybeSingle();
    if (!user || !(await bcrypt.compare(password, user.password || '')))
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    if (user.email_verified === false) {
      return res.status(403).json({
        error: 'Confirma tu email antes de iniciar sesión. Revisa tu bandeja de entrada.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }
    res.json({ message: '✅ Sesión iniciada', token: signToken(user), user: safeUser(user) });
  } catch (e) {
    console.error('[auth/login]', e.message);
    res.status(500).json({ error: 'Error al iniciar sesión. Inténtalo de nuevo.' });
  }
});

// Confirmar email desde el enlace del correo (GET porque se abre directo desde el navegador)
router.get('/verify-email', async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://velomind-liard.vercel.app';
  const { token } = req.query;
  if (!token) return res.redirect(`${frontendUrl}/verify-email.html?status=missing`);

  try {
    const { data: vt } = await supabase
      .from('email_verification_tokens')
      .select('*')
      .eq('token', token)
      .eq('used', false)
      .maybeSingle();

    if (!vt) return res.redirect(`${frontendUrl}/verify-email.html?status=invalid`);
    if (new Date(vt.expires_at) < new Date()) {
      return res.redirect(`${frontendUrl}/verify-email.html?status=expired`);
    }

    await supabase.from('users').update({ email_verified: true }).eq('id', vt.user_id);
    await supabase.from('email_verification_tokens').update({ used: true }).eq('id', vt.id);

    res.redirect(`${frontendUrl}/verify-email.html?status=ok`);
  } catch (e) {
    console.error('[auth/verify-email]', e.message);
    res.redirect(`${frontendUrl}/verify-email.html?status=error`);
  }
});

// Reenviar el email de verificación
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requerido' });

    const emailNorm = email.trim().toLowerCase();
    const { data: user } = await supabase.from('users').select('*').eq('email', emailNorm).maybeSingle();

    // Misma respuesta exista o no la cuenta, o ya esté verificada, para no filtrar info.
    const ok = { message: 'Si la cuenta existe y no está verificada, te reenviamos el email.' };
    if (!user || user.email_verified !== false) return res.json(ok);

    await sendVerificationEmail(user);
    res.json(ok);
  } catch (e) {
    console.error('[auth/resend-verification]', e.message);
    res.status(500).json({ error: 'Error al reenviar el email. Inténtalo de nuevo.' });
  }
});

// Demo
router.post('/demo', async (req, res) => {
  try {
    // Crear un usuario demo ÚNICO por sesión para que no se mezclen datos (como bicis) entre probadores
    const email = `demo_${Date.now()}@cyclocoach.local`;
    const hash = await bcrypt.hash('demo123', 10);
    const { data: user } = await supabase.from('users').insert({
      email, password: hash, name: 'Demo Ciclista',
      ftp: 235, weight: 72, age: 32, height: 175,
      experience: 'intermedio', goal: 'resistencia', weekly_hours: 8
    }).select().single();

    res.json({ message: '✅ Demo iniciado', token: signToken(user), user: safeUser(user) });
  } catch (e) {
    console.error('[auth/demo]', e.message);
    res.status(500).json({ error: 'Error en demo: ' + e.message });
  }
});

// Verificar token
router.get('/verify', requireAuth, async (req, res) => {
  const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
  res.json({ valid: true, user: safeUser(user) });
});

// Diagnóstico de admin — abre esta URL en el navegador para verificar tu rol
router.get('/whoami', requireAuth, (req, res) => {
  res.json({
    email:        req.user.email,
    isAdmin:      req.user.isAdmin,
    adminEmail:   ADMIN_EMAIL ? `${ADMIN_EMAIL.slice(0,3)}***` : '(no configurado)',
    match:        req.user.isAdmin ? '✅ Eres admin' : '❌ No eres admin',
  });
});

// Perfil GET
router.get('/profile', requireAuth, async (req, res) => {
  const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
  res.json(safeUser(user));
});

// Avatar upload
router.post('/avatar', requireAuth, avatarUpload.single('avatar'), async (req, res) => {
  const uid = req.user.id;
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo de imagen' });

  const ext  = req.file.mimetype === 'image/png' ? 'png' : 'jpg';
  const path = `${uid}/profile.${ext}`;

  // Crear bucket si no existe (silencia error si ya existe)
  await supabase.storage.createBucket('avatars', { public: true }).catch(() => {});

  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });

  if (upErr) return res.status(500).json({ error: 'Error subiendo imagen: ' + upErr.message });

  const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
  const avatarUrl = urlData.publicUrl + '?t=' + Date.now(); // cache-bust

  await supabase.from('users').update({ avatar_url: avatarUrl }).eq('id', uid);

  const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
  res.json({ avatar_url: avatarUrl, user: safeUser(user) });
});

// Perfil PUT
router.put('/profile', requireAuth, async (req, res) => {
  const allowed = ['name','age','sex','weight','height','ftp','max_hr','lthr',
                   'experience','goal','weekly_hours','days_per_week','event_date','initial_ctl','target_events','gym_days','running_days','walking_days','other_days'];
  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin datos para actualizar' });

  // Validaciones de rango
  if (updates.ftp !== undefined) {
    const ftp = Number(updates.ftp);
    if (!Number.isFinite(ftp) || ftp < 50 || ftp > 600)
      return res.status(400).json({ error: 'FTP debe estar entre 50 y 600 W' });
    updates.ftp = ftp;
  }
  if (updates.weight !== undefined) {
    const w = Number(updates.weight);
    if (!Number.isFinite(w) || w < 30 || w > 200)
      return res.status(400).json({ error: 'Peso debe estar entre 30 y 200 kg' });
    updates.weight = w;
  }
  if (updates.max_hr !== undefined) {
    const hr = Number(updates.max_hr);
    if (!Number.isFinite(hr) || hr < 100 || hr > 250)
      return res.status(400).json({ error: 'FC máxima debe estar entre 100 y 250 bpm' });
    updates.max_hr = hr;
  }

  updates.updated_at = new Date().toISOString();

  const { error } = await supabase.from('users').update(updates).eq('id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });

  // Si cambió el CTL inicial, recalcular PMC en background para que el cambio se vea al instante
  if (updates.initial_ctl !== undefined) {
    setImmediate(async () => {
      try { await recalculatePMC(req.user.id); } catch {}
    });
  }

  const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
  res.json({ message: 'Perfil actualizado', user: safeUser(user) });
});

// Solicitar recuperación de contraseña
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requerido' });

    const emailNorm = email.trim().toLowerCase();
    const { data: user } = await supabase.from('users').select('id, name').eq('email', emailNorm).maybeSingle();

    // Siempre responder igual para no revelar si el email existe
    const ok = { message: 'Si el email está registrado, recibirás un correo con el enlace de recuperación.' };
    if (!user) return res.json(ok);

    // Borrar tokens anteriores del mismo usuario
    await supabase.from('password_reset_tokens').delete().eq('user_id', user.id);

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    const { error: insertErr } = await supabase.from('password_reset_tokens').insert({
      user_id: user.id,
      token,
      expires_at: expiresAt.toISOString()
    });
    if (insertErr) throw insertErr;

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8085';
    const resetUrl = `${frontendUrl}/reset-password.html?token=${token}`;

    await sgMail.send({
      from: { name: 'VeloMind', email: process.env.SENDGRID_FROM_EMAIL || 'info@velomind.org' },
      to: emailNorm,
      subject: 'Recupera tu contraseña — VeloMind',
      html: `
        <div style="font-family:'DM Sans',Arial,sans-serif;max-width:520px;margin:0 auto;background:#0a0b0f;color:#f0f2f5;border-radius:16px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#1a1d26,#0a0b0f);padding:40px 40px 32px;border-bottom:1px solid rgba(255,255,255,0.06)">
            <div style="font-size:28px;font-weight:800;font-family:'Space Grotesk',Arial,sans-serif">
              🚴 VeloMind
            </div>
          </div>
          <div style="padding:40px">
            <h2 style="margin:0 0 12px;font-size:22px;font-weight:700">Hola, ${user.name || 'ciclista'}</h2>
            <p style="color:#9ca3af;line-height:1.6;margin:0 0 28px">
              Recibimos una solicitud para restablecer la contraseña de tu cuenta.
              El enlace es válido por <strong style="color:#f0f2f5">1 hora</strong>.
            </p>
            <a href="${resetUrl}" style="display:inline-block;background:#9ED62B;color:#111;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;font-family:'Space Grotesk',Arial,sans-serif">
              Restablecer contraseña
            </a>
            <p style="color:#6b7280;font-size:13px;margin:28px 0 0;line-height:1.5">
              Si no solicitaste este cambio, podés ignorar este correo. Tu contraseña no cambiará.
            </p>
          </div>
          <div style="padding:20px 40px;background:rgba(255,255,255,0.02);border-top:1px solid rgba(255,255,255,0.06)">
            <p style="color:#4b5563;font-size:12px;margin:0">
              VeloMind — Tu entrenador de ciclismo con IA
            </p>
          </div>
        </div>
      `
    });

    res.json(ok);
  } catch (e) {
    const detail = e.response?.body || e.message;
    console.error('[auth/forgot-password]', JSON.stringify(detail));
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
});

// Confirmar nueva contraseña con token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token y contraseña requeridos' });
    if (password.length < 6) return res.status(400).json({ error: 'Contraseña mínimo 6 caracteres' });

    const { data: resetToken } = await supabase
      .from('password_reset_tokens')
      .select('*')
      .eq('token', token)
      .eq('used', false)
      .maybeSingle();

    if (!resetToken) return res.status(400).json({ error: 'Enlace inválido o ya utilizado.' });
    if (new Date(resetToken.expires_at) < new Date()) {
      return res.status(400).json({ error: 'El enlace expiró. Solicitá uno nuevo.' });
    }

    const hash = await bcrypt.hash(password, 10);
    await supabase.from('users').update({ password: hash, updated_at: new Date().toISOString() }).eq('id', resetToken.user_id);
    await supabase.from('password_reset_tokens').update({ used: true }).eq('id', resetToken.id);

    res.json({ message: 'Contraseña actualizada correctamente. Ya podés iniciar sesión.' });
  } catch (e) {
    console.error('[auth/reset-password]', e.message);
    res.status(500).json({ error: 'Error al restablecer la contraseña' });
  }
});

// Eliminar cuenta y todos los datos del usuario
router.delete('/account', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    // Borrar datos en orden (dependencias primero)
    await supabase.from('push_subscriptions').delete().eq('user_id', uid);
    await supabase.from('password_reset_tokens').delete().eq('user_id', uid);
    await supabase.from('pmc').delete().eq('user_id', uid);
    await supabase.from('activities').delete().eq('user_id', uid);
    await supabase.from('weight_log').delete().eq('user_id', uid);
    // Componentes e historial ligados a las bicis del usuario
    const { data: bikes } = await supabase.from('bikes').select('id').eq('user_id', uid);
    if (bikes?.length) {
      const bikeIds = bikes.map(b => b.id);
      await supabase.from('component_history').delete().in('bike_id', bikeIds);
      await supabase.from('bike_components').delete().in('bike_id', bikeIds);
    }
    await supabase.from('bikes').delete().eq('user_id', uid);
    // Finalmente el usuario
    await supabase.from('users').delete().eq('id', uid);
    res.json({ message: 'Cuenta eliminada correctamente' });
  } catch (e) {
    console.error('[auth/delete-account]', e.message);
    res.status(500).json({ error: 'Error al eliminar la cuenta' });
  }
});

function safeUser(u) {
  if (!u) return null;
  const { password, strava_token, strava_refresh, garmin_token, garmin_refresh,
          fitbit_token, fitbit_refresh, ...safe } = u;
  safe.isAdmin = !!(ADMIN_EMAIL && u.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase());
  return safe;
}

module.exports = router;