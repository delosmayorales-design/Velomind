require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const supabase = require('./db');
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────
// ✅ CORS (ABIERTO PARA QUE FUNCIONE YA)
// ─────────────────────────────────────────
app.use(cors({
  origin: true,
  credentials: true,
}));

// ─────────────────────────────────────────
// ✅ RUTAS PÚBLICAS (SIN AUTH) - direct in server.js
// ─────────────────────────────────────────
app.get('/api/debug/all-activities', async (req, res) => {
  try {
    const { data: acts } = await supabase.from('activities').select('id, user_id, name, date').limit(20);
    res.json({ activities: acts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
// ✅ RUTAS (BIEN)
// ─────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/activities', require('./routes/activities').router);
app.use('/api/analytics',  require('./routes/analytics'));
app.use('/api/providers',  require('./routes/providers'));
app.use('/api/body',       require('./routes/body'));
app.use('/api/coach',      require('./routes/coach'));
app.use('/api/garage',     require('./routes/garage'));
app.use('/api/plans',      require('./routes/plans'));
app.use('/api/payments',   require('./routes/payments'));

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