const express = require('express');
const bcrypt  = require('bcryptjs');
const multer  = require('multer');
const supabase = require('../db'); // Ahora db es el cliente de Supabase
const { requireAuth, signToken } = require('../middleware/auth');
const router  = express.Router();

const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Registro
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
    if (password.length < 6)  return res.status(400).json({ error: 'Contraseña mínimo 6 caracteres' });

    const emailNorm = email.trim().toLowerCase();
    const { data: existing } = await supabase.from('users').select('id').eq('email', emailNorm).maybeSingle();
    if (existing)
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email' });

    const hash = await bcrypt.hash(password, 10);
    const { data: user, error } = await supabase.from('users').insert({
      email: emailNorm,
      password: hash,
      name: name?.trim() || emailNorm.split('@')[0]
    }).select('*').single();

    if (error) throw error;
    res.status(201).json({ message: '✅ Cuenta creada', token: signToken(user), user: safeUser(user) });
  } catch (e) {
    console.error('[auth/register]', e.message);
    res.status(500).json({ error: 'Error al registrar: ' + e.message });
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
    res.json({ message: '✅ Sesión iniciada', token: signToken(user), user: safeUser(user) });
  } catch (e) {
    console.error('[auth/login]', e.message);
    res.status(500).json({ error: 'Error en login: ' + e.message });
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
                   'experience','goal','weekly_hours','days_per_week','event_date'];
  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin datos para actualizar' });
  
  updates.updated_at = new Date().toISOString();

  const { error } = await supabase.from('users').update(updates).eq('id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });

  const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
  res.json({ message: 'Perfil actualizado', user: safeUser(user) });
});

function safeUser(u) {
  if (!u) return null;
  const { password, strava_token, strava_refresh, garmin_token, ...safe } = u;
  return safe;
}

module.exports = router;