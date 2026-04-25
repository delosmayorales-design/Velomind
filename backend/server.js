require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────
// ✅ CORS (ABIERTO PARA QUE FUNCIONE YA)
// ─────────────────────────────────────────
app.use(cors({
  origin: true,
  credentials: true,
}));

// ─────────────────────────────────────────
// Stripe webhook (ANTES de express.json)
// ─────────────────────────────────────────
const payments = require('./routes/payments');
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), payments.handleWebhook);

// ─────────────────────────────────────────
// Body parsers
// ─────────────────────────────────────────
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────
// Servir frontend estático (opcional)
// ─────────────────────────────────────────
app.use('/app', express.static(path.join(__dirname, '../cyclocoach')));

// ─────────────────────────────────────────
// Health check
// ─────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const supabase = require('./db');

    const { count: uCount } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    const { count: aCount } = await supabase
      .from('activities')
      .select('*', { count: 'exact', head: true });

    res.json({
      status: 'ok',
      version: '2.0.0',
      env: process.env.NODE_ENV || 'development',
      users: uCount || 0,
      activities: aCount || 0,
      ts: new Date().toISOString(),
    });

  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ─────────────────────────────────────────
// ✅ RUTAS (BIEN)
// ─────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));

// Rutas públicas de activities (sin auth)
const activitiesRoutes = require('./routes/activities');
app.use('/api/activities/public', activitiesRoutes.publicRouter);

// Rutas protegidas de activities
app.use('/api/activities', activitiesRoutes.router);
app.use('/api/analytics',  require('./routes/analytics'));
app.use('/api/providers',  require('./routes/providers'));
app.use('/api/body',       require('./routes/body'));
app.use('/api/coach',      require('./routes/coach'));
app.use('/api/garage',     require('./routes/garage'));
app.use('/api/plans',      require('./routes/plans'));
app.use('/api/payments',   payments);

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