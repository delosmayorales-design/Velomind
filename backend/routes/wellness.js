const express  = require('express');
const supabase  = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /api/wellness/today — datos de hoy (o ayer si aún no hay de hoy)
router.get('/today', requireAuth, async (req, res) => {
  const uid   = req.user.id;
  const today = new Date().toISOString().substring(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().substring(0, 10);
  const { data } = await supabase
    .from('wellness_log')
    .select('*')
    .eq('user_id', uid)
    .in('date', [today, yesterday])
    .order('date', { ascending: false });
  if (!data?.length) return res.json(null);
  // Merge por fecha (puede haber garmin + fitbit)
  const byDate = {};
  for (const row of data) {
    if (!byDate[row.date]) byDate[row.date] = {};
    for (const k of Object.keys(row)) {
      if (row[k] !== null && !['id','user_id','created_at'].includes(k))
        byDate[row.date][k] = row[k];
    }
  }
  res.json(byDate[today] || byDate[yesterday] || null);
});

// GET /api/wellness/week — últimos 7 días
router.get('/week', requireAuth, async (req, res) => {
  const uid   = req.user.id;
  const start = new Date(Date.now() - 7 * 86400000).toISOString().substring(0, 10);
  const { data } = await supabase
    .from('wellness_log')
    .select('*')
    .eq('user_id', uid)
    .gte('date', start)
    .order('date', { ascending: false });
  if (!data?.length) return res.json([]);
  const byDate = {};
  for (const row of data) {
    if (!byDate[row.date]) byDate[row.date] = {};
    for (const k of Object.keys(row)) {
      if (row[k] !== null && !['id','user_id','created_at'].includes(k))
        byDate[row.date][k] = row[k];
    }
  }
  res.json(Object.values(byDate));
});

module.exports = router;
