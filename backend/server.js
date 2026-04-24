require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = (process.env.CORS_ORIGINS ||
  'http://localhost:8085,http://127.0.0.1:8085,http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000,http://127.0.0.1:3000'
).split(',');

app.use(cors({
  origin: (origin, cb) => (!origin || allowedOrigins.includes(origin) ? cb(null,true) : cb(new Error('CORS bloqueado'))),
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

// Stripe webhook necesita raw body — registrar ANTES de express.json()
const payments = require('./routes/payments');
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), payments.handleWebhook);

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

// Servir frontend estático
app.use('/app', express.static(path.join(__dirname, '../cyclocoach')));

// Health check — ahora con Supabase
app.get('/api/health', async (req, res) => {
  try {
    const supabase = require('./db');
    const { count: uCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { count: aCount } = await supabase.from('activities').select('*', { count: 'exact', head: true });
    res.json({
      status: 'ok', version: '2.0.0',
      env: process.env.NODE_ENV || 'development',
      users:      uCount || 0,
      activities: aCount || 0,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.use('/api/auth',       require('./routes/auth'));
app.use('/api/activities', require('./routes/activities'));
app.use('/api/analytics',  require('./routes/analytics'));
app.use('/api/providers',  require('./routes/providers'));
app.use('/api/body',       require('./routes/body'));
app.use('/api/coach',      require('./routes/coach'));
app.use('/api/garage',     require('./routes/garage'));
app.use('/api/plans',      require('./routes/plans'));
app.use('/api/payments',   payments);

app.use((req, res) => res.status(404).json({ error: `No encontrado: ${req.method} ${req.path}` }));
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ── Arrancar servidor (Supabase no necesita initDB) ──────────
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log('');
    console.log('🚴 VeloMind Backend v2.0');
    console.log(`🚀 http://localhost:${PORT}`);
    console.log(`🌍 ${process.env.NODE_ENV || 'development'}`);
    console.log(`📡 CORS: ${allowedOrigins.join(', ')}`);
    console.log('');
    console.log('Endpoints:');
    console.log('  POST /api/auth/register   - Registro');
    console.log('  POST /api/auth/login      - Login');
    console.log('  POST /api/auth/demo       - Demo login');
    console.log('  GET  /api/auth/verify     - Verificar JWT');
    console.log('  PUT  /api/auth/profile    - Actualizar perfil');
    console.log('  GET  /api/activities      - Listar actividades');
    console.log('  POST /api/activities      - Guardar actividad');
    console.log('  POST /api/activities/batch- Sync batch');
    console.log('  GET  /api/analytics/pmc  - PMC CTL/ATL/TSB');
    console.log('  GET  /api/analytics/summary - Estadísticas');
    console.log('  POST /api/providers/strava/sync - Sync Strava');
    console.log('  POST /api/body/weight     - Registro peso');
    console.log('  POST /api/coach/biomechanics - Ajuste por fotos');
    console.log('  POST /api/coach/ai-analysis  - Coach IA (Claude)');
    console.log('');
  });
}

module.exports = app;
