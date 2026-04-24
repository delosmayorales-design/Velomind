const express = require('express');
const supabase = require('../db'); // Ahora db es el cliente de Supabase
const { requireAuth } = require('../middleware/auth');
const { getPMC, getCurrentMetrics, recalculatePMC } = require('../services/pmc');
const router = express.Router();
router.use(requireAuth);

// PMC
router.get('/pmc', async (req, res) => {
  const days = parseInt(req.query.days) || 90;
  const { count } = await supabase.from('pmc').select('*', { count: 'exact', head: true }).eq('user_id', req.user.id);
  if (!count) await recalculatePMC(req.user.id, 180);
  res.json({ pmc: await getPMC(req.user.id, days), current: await getCurrentMetrics(req.user.id) });
});

// Resumen
router.get('/summary', async (req, res) => {
  const uid = req.user.id;
  const { data: user } = await supabase.from('users').select('ftp').eq('id', uid).single();
  const ftp = user?.ftp || 200;

  const { data: acts } = await supabase.from('activities').select('*').eq('user_id', uid).order('date', { ascending: true });
  
  if (!acts || acts.length === 0) {
    return res.json({ total: { acts:0, hours:0, km:0, elevation:0, tss:0 }, week_tss: 0, month: { km:0, hours:0 }, current: await getCurrentMetrics(uid), ftp });
  }

  const total = {
    acts: acts.length,
    hours: Math.round(acts.reduce((s, a) => s + (a.duration || 0), 0) / 3600 * 10) / 10,
    km: Math.round(acts.reduce((s, a) => s + (a.distance || 0), 0) / 1000 * 10) / 10,
    elevation: Math.round(acts.reduce((s, a) => s + (a.elevation || 0), 0)),
    tss: Math.round(acts.reduce((s, a) => s + (a.tss || 0), 0)),
    avg_power: Math.round(acts.reduce((s, a) => s + (a.avg_power || 0), 0) / (acts.filter(a => a.avg_power > 0).length || 1)),
    best_np: Math.max(...acts.map(a => a.np || 0)),
    best_tss: Math.max(...acts.map(a => a.tss || 0)),
    first_date: acts[0].date,
    last_date: acts[acts.length - 1].date
  };

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const weekStartStr = weekStart.toISOString().split('T')[0];

  const week_tss = Math.round(acts.filter(a => a.date >= weekStartStr).reduce((s, a) => s + (a.tss || 0), 0));
  const monthActs = acts.filter(a => a.date >= monthStart);
  const month = {
    km: Math.round(monthActs.reduce((s, a) => s + (a.distance || 0), 0) / 1000 * 10) / 10,
    hours: Math.round(monthActs.reduce((s, a) => s + (a.duration || 0), 0) / 3600 * 10) / 10
  };

  res.json({ total, week_tss, month, current: await getCurrentMetrics(uid), ftp });
});

// Zones
router.get('/zones', async (req, res) => {
  const uid = req.user.id;
  const { data: user } = await supabase.from('users').select('ftp').eq('id', uid).single();
  const ftp = user?.ftp || 200;

  const { data: acts } = await supabase
    .from('activities')
    .select('avg_power, duration, zone_times')
    .eq('user_id', uid)
    .gt('avg_power', 0);

  const ZONES = [
    { id:1, name:'Z1', min:0,    max:0.55, color:'#6B7280' },
    { id:2, name:'Z2', min:0.55, max:0.75, color:'#3B82F6' },
    { id:3, name:'Z3', min:0.75, max:0.90, color:'#10B981' },
    { id:4, name:'Z4', min:0.90, max:1.05, color:'#F59E0B' },
    { id:5, name:'Z5', min:1.05, max:1.20, color:'#EF4444' },
    { id:6, name:'Z6', min:1.20, max:1.50, color:'#8B5CF6' },
    { id:7, name:'Z7', min:1.50, max:999,  color:'#EC4899' },
  ].map(z => ({ ...z, duration_min: 0, count: 0 }));

  let realCount = 0, estimCount = 0;

  for (const a of (acts || [])) {
    if (a.zone_times) {
      // Datos reales de streams de Strava
      const zt = typeof a.zone_times === 'string' ? JSON.parse(a.zone_times) : a.zone_times;
      for (let i = 1; i <= 7; i++) {
        const z = ZONES.find(z => z.id === i);
        if (z) z.duration_min += Math.round((zt[`z${i}`] || 0) / 60);
      }
      realCount++;
    } else {
      // Fallback: clasificar por avg_power (sin NP inflado)
      const r = a.avg_power / ftp;
      const z = ZONES.find(z => r >= z.min && r < z.max);
      if (z) { z.duration_min += Math.round(a.duration / 60); z.count++; }
      estimCount++;
    }
  }

  const total = ZONES.reduce((s, z) => s + z.duration_min, 0);
  res.json({
    zones: ZONES.map(z => ({ ...z, pct: total ? Math.round(z.duration_min / total * 100) : 0 })),
    total_minutes: total,
    ftp,
    real_count: realCount,
    estimated_count: estimCount,
  });
});

// Récords
router.get('/records', async (req, res) => {
  const uid = req.user.id;
  const { data: user } = await supabase.from('users').select('ftp, weight').eq('id', uid).single();
  const ftp = user?.ftp || 200;
  const weight = user?.weight || 70;

  const getBest = async (col) => {
    const { data } = await supabase.from('activities').select(`${col}, date, name`).eq('user_id', uid).order(col, { ascending: false }).limit(1).maybeSingle();
    return data ? { v: data[col], date: data.date, name: data.name } : null;
  };

  const [max_power, max_np, max_tss, max_distance, max_duration, max_elevation] = await Promise.all([
    getBest('max_power'), getBest('np'), getBest('tss'), getBest('distance'), getBest('duration'), getBest('elevation')
  ]);

  res.json({ max_power, max_np, max_tss, max_distance, max_duration, max_elevation, ftp, wkg: weight > 0 ? Math.round(ftp / weight * 100) / 100 : null, weight });
});

// FTP estimate
router.get('/ftp-estimate', async (req, res) => {
  const uid = req.user.id;
  const { data: userRow } = await supabase.from('users').select('ftp').eq('id', uid).single();
  const currentFTP = userRow?.ftp || null;

  const [{ data: short }, { data: anyLong }] = await Promise.all([
    supabase.from('activities')
      .select('avg_power, np, duration, date, name, strava_id')
      .eq('user_id', uid).gt('avg_power', 0)
      .gte('duration', 1080).lte('duration', 1500)
      .order('avg_power', { ascending: false }).limit(3),
    supabase.from('activities')
      .select('avg_power, np, duration, date, name, strava_id')
      .eq('user_id', uid).gt('np', 0).gte('duration', 1200)
      .order('np', { ascending: false }).limit(3)
  ]);

  let estimatedFTP = null, best20min = null, method = null, source = null;
  if (short && short.length && short[0].avg_power > 0) {
    source = short[0]; best20min = source.avg_power;
    estimatedFTP = Math.round(source.avg_power * 0.95); method = 'best_20min';
  } else if (anyLong && anyLong.length && anyLong[0].np > 0) {
    source = anyLong[0]; estimatedFTP = Math.round(source.np * 0.95); method = 'np_best';
  }

  res.json({ current_ftp: currentFTP, estimated_ftp: estimatedFTP, best_20min_power: best20min, method,
    source_name: source?.name || null, source_date: source?.date || null,
    source_duration_min: source ? Math.round(source.duration / 60) : null,
    source_strava_id: source?.strava_id || null,
    candidates: { short: short?.length || 0, any: anyLong?.length || 0 } });
});

// Weekly (últimas 12 semanas)
router.get('/weekly', async (req, res) => {
  const uid = req.user.id;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 84);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const { data: acts } = await supabase.from('activities')
    .select('date, duration, distance, tss, avg_power')
    .eq('user_id', uid).gte('date', cutoffStr)
    .order('date', { ascending: true });

  const weekMap = {};
  for (const a of (acts || [])) {
    const d = new Date(a.date);
    const dow = d.getDay() || 7;
    const thu = new Date(d);
    thu.setDate(d.getDate() + 4 - dow);
    const yearStart = new Date(thu.getFullYear(), 0, 1);
    const wn = Math.ceil(((thu - yearStart) / 86400000 + 1) / 7);
    const wk = thu.getFullYear() + '-W' + String(wn).padStart(2, '0');
    if (!weekMap[wk]) weekMap[wk] = { week: wk, week_start: a.date, activities: 0, hours: 0, km: 0, tss: 0, powers: [] };
    weekMap[wk].activities++;
    weekMap[wk].hours += (a.duration || 0) / 3600;
    weekMap[wk].km += (a.distance || 0) / 1000;
    weekMap[wk].tss += (a.tss || 0);
    if (a.avg_power > 0) weekMap[wk].powers.push(a.avg_power);
  }

  const weeks = Object.values(weekMap).map(w => ({
    week: w.week, week_start: w.week_start, activities: w.activities,
    hours: Math.round(w.hours * 10) / 10,
    km: Math.round(w.km * 10) / 10,
    tss: Math.round(w.tss),
    avg_power: w.powers.length ? Math.round(w.powers.reduce((s,p) => s+p, 0) / w.powers.length) : 0
  })).sort((a, b) => a.week.localeCompare(b.week));

  res.json({ weeks });
});

module.exports = router;
