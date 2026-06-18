require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const supabase = require('./db');
const PORT = process.env.PORT || 3000;

const _DEPLOY = {
  deployedAt: new Date().toISOString(),
  buildId: process.env.VERCEL_GIT_COMMIT_SHA ||
           process.env.RENDER_GIT_COMMIT ||
           `deploy-${Date.now()}`,
};

// ─────────────────────────────────────────
// CORS — restringido a orígenes conocidos
// ─────────────────────────────────────────
const _envOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : [];

// Orígenes de la app siempre permitidos (Vercel + dominios propios)
const _builtinOrigins = [
  'https://velomind-liard.vercel.app',
];

const _allowedOrigins = _envOrigins.length > 0
  ? [...new Set([..._envOrigins, ..._builtinOrigins])]
  : null; // null = abierto en dev (sin env var)

app.use(cors({
  origin: (origin, cb) => {
    // Peticiones sin origen (Postman, curl, server-to-server) se permiten en dev
    if (!origin) return cb(null, process.env.NODE_ENV !== 'production');
    if (!_allowedOrigins) return cb(null, true); // dev sin env var: abierto
    // Permitir cualquier subdominio de Vercel del proyecto velomind
    if (/^https:\/\/velomind[^.]*\.vercel\.app$/.test(origin)) return cb(null, true);
    if (_allowedOrigins.includes(origin)) return cb(null, true);
    console.warn('[CORS] Origen bloqueado:', origin);
    cb(new Error(`Origen no permitido: ${origin}`));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.options('*', cors());

// ─────────────────────────────────────────
// Rate limiting en memoria (sin dependencias)
// ─────────────────────────────────────────
const _rlStore = new Map();
setInterval(() => {
  const now = Date.now();
  _rlStore.forEach((hits, key) => { if (!hits.length || now - hits[hits.length-1] > 3600000) _rlStore.delete(key); });
}, 5 * 60 * 1000);

function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = (req.ip || 'x') + req.path;
    const now = Date.now();
    const hits = (_rlStore.get(key) || []).filter(t => now - t < windowMs);
    if (hits.length >= max) {
      return res.status(429).json({ error: 'Demasiadas peticiones. Intenta de nuevo en unos minutos.', code: 'RATE_LIMIT' });
    }
    hits.push(now);
    _rlStore.set(key, hits);
    next();
  };
}

// Body parser (necesario para POST con JSON)
app.use(express.json({ limit: '5mb' }));

// ─────────────────────────────────────────
// ✅ RUTAS
// ─────────────────────────────────────────
// Rate limits en rutas sensibles
app.post('/api/auth/login',    rateLimit(10, 15 * 60 * 1000)); // 10 intentos / 15 min
app.post('/api/auth/register', rateLimit(5,  60 * 60 * 1000)); // 5 registros / hora
app.post('/api/auth/demo',     rateLimit(3,  60 * 60 * 1000)); // 3 demos / hora
app.post('/api/auth/forgot-password', rateLimit(5, 60 * 60 * 1000));

app.use('/api/auth',       require('./routes/auth'));
app.use('/api/activities', require('./routes/activities'));
app.use('/api/analytics',  require('./routes/analytics'));
app.use('/api/providers',  require('./routes/providers'));
app.use('/api/body',       require('./routes/body'));
app.use('/api/coach',      require('./routes/coach'));
app.use('/api/garage',     require('./routes/garage'));
app.use('/api/plans',      require('./routes/plans'));
app.use('/api/payments',   require('./routes/payments'));
app.use('/api/routes',      require('./routes/routes'));
app.use('/api/group-rides', require('./routes/groupRides'));
app.use('/api/push',        require('./routes/push'));
app.use('/api/wellness',   require('./routes/wellness'));
app.use('/api/feedback',   require('./routes/feedback'));

// ─────────────────────────────────────────
// HEALTH (usado por el keepalive y monitoreo externo)
// ─────────────────────────────────────────
app.get('/api/health',  (req, res) => res.json({ status: 'ok' }));
app.get('/api/version', (req, res) => res.json(_DEPLOY));

// ─────────────────────────────────────────
// 404
// ─────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: `No encontrado: ${req.method} ${req.path}`
  });
});

// ─────────────────────────────────────────
// Error handler
// ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ ERROR:', err.message);
  res.status(500).json({ error: err.message });
});

// ─────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────
// Push reminders scheduler
if (process.env.NODE_ENV !== 'test') require('./services/pushScheduler').start();
// Demo user cleanup (diario 3:00 AM)
if (process.env.NODE_ENV !== 'test') require('./services/demoCleanup').start();

// Keepalive: evita que Render free tier duerma el servidor
if (process.env.NODE_ENV === 'production') {
  const SELF = process.env.RENDER_EXTERNAL_URL || 'https://velomind-backend.onrender.com';
  setInterval(() => {
    fetch(`${SELF}/api/health`).catch(() => {});
  }, 14 * 60 * 1000); // cada 14 minutos
}

if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log('');
    console.log('🚴 VeloMind Backend v2.0');
    console.log(`🚀 http://localhost:${PORT}`);
    console.log(`🌍 ${process.env.NODE_ENV || 'development'}`);
    console.log('');

    console.log('Endpoints:');
    console.log('  POST /api/auth/register');
    console.log('  POST /api/auth/login');
    console.log('  POST /api/auth/demo');
    console.log('  GET  /api/auth/verify');
    console.log('  PUT  /api/auth/profile');

    console.log('  GET  /api/activities');
    console.log('  POST /api/activities');
    console.log('  POST /api/activities/batch');

    console.log('  GET  /api/analytics/pmc');
    console.log('  GET  /api/analytics/summary');

    console.log('  POST /api/providers/strava/sync');
    console.log('  POST /api/body/weight');
    console.log('  POST /api/coach/biomechanics');
    console.log('  POST /api/coach/ai-analysis');

    console.log('');
  });
}

module.exports = app;