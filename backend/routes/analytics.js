const express = require('express');
const supabase = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getPMC, getCurrentMetrics, recalculatePMC } = require('../services/pmc');
const { ZONES: COGGAN_ZONES, getTSBStatus } = require('../utils/training');
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

  const ZONES = COGGAN_ZONES.map(z => ({ ...z, duration_min: 0, count: 0 }));

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
// Usa el mejor NP/avg_power de salidas >= 20 min y aplica el factor estándar:
//   20-40 min × 0.95  |  40-60 min × 0.97  |  60-90 min × 1.00  |  >90 min × 1.03
router.get('/ftp-estimate', async (req, res) => {
  const uid = req.user.id;
  const { data: userRow } = await supabase.from('users').select('ftp, weight').eq('id', uid).single();
  const currentFTP = userRow?.ftp || null;
  const weight = parseFloat(userRow?.weight) || 0;
  const ftpCap = weight > 0 ? Math.round(weight * 6.5) : 550;

  const { data: acts } = await supabase.from('activities')
    .select('avg_power, np, duration, date, name, strava_id, best_efforts')
    .eq('user_id', uid).gt('avg_power', 0).gte('duration', 1200)
    .lte('avg_power', 2500) // ignorar spikes de sensor
    .order('duration', { ascending: true });

  // Método 1: mejor segmento rodante de 20 min a través de TODAS las actividades
  // (igual que la curva de potencia — fuente de verdad consistente con Strava)
  let estimatedFTP = null, best20min = null, method = null, bestLabel = null, source = null;
  const allActs = acts || [];
  const best20Source = allActs.reduce((best, a) => {
    const be = Number(a.best_efforts?.[1200] || 0);
    return be > (best ? Number(best.best_efforts?.[1200] || 0) : 0) ? a : best;
  }, null);
  if (best20Source) {
    const rolling20 = Number(best20Source.best_efforts[1200]);
    if (rolling20 > 0) {
      const est = Math.min(Math.round(rolling20 * 0.95), ftpCap);
      estimatedFTP = est;
      best20min    = rolling20;
      method       = 'best_rolling_20min';
      bestLabel    = 'segmento 20 min';
      source       = best20Source;
    }
  }

  // Método 2: mejor NP/avg_power por ventana de duración (fallback sin best_efforts)
  const WINDOWS = [
    { min: 1200, max: 2400, factor: 0.95, label: '20-40 min' },
    { min: 2400, max: 3600, factor: 0.97, label: '40-60 min' },
    { min: 3600, max: 5400, factor: 1.00, label: '60-90 min' },
    { min: 5400, max: 99999, factor: 1.03, label: '>90 min'   },
  ];
  for (const w of WINDOWS) {
    const bucket = allActs.filter(a => a.duration >= w.min && a.duration < w.max);
    if (!bucket.length) continue;
    bucket.sort((a, b) => (b.np || b.avg_power) - (a.np || a.avg_power));
    const top = bucket[0];
    const power = top.np || top.avg_power;
    const est = Math.min(Math.round(power * w.factor), ftpCap);
    if (!estimatedFTP || est > estimatedFTP) {
      estimatedFTP = est;
      best20min    = power;
      method       = `best_${w.label}`;
      bestLabel    = w.label;
      source       = top;
    }
  }

  res.json({ current_ftp: currentFTP, estimated_ftp: estimatedFTP, best_20min_power: best20min,
    method, window_label: bestLabel,
    source_name: source?.name || null, source_date: source?.date || null,
    source_duration_min: source ? Math.round(source.duration / 60) : null,
    source_strava_id: source?.strava_id || null });
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

// ── Decoupling aeróbico (HR drift) ───────────────────────────────
// El decoupling mide la relación potencia/FC a lo largo del tiempo.
// Un factor de eficiencia (EF = NP/avgHR) que decrece indica fatiga acumulada.
// Se analiza sobre sesiones Z2 para eliminar el efecto de la intensidad.
router.get('/decoupling', async (req, res) => {
  const uid = req.user.id;
  const { data: user } = await supabase.from('users').select('ftp').eq('id', uid).single();
  const ftp = user?.ftp || 200;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  // Solo actividades con potencia Y frecuencia cardíaca registradas
  const { data: acts } = await supabase.from('activities')
    .select('date, np, avg_power, avg_hr, duration, tss, name')
    .eq('user_id', uid)
    .gte('date', cutoff.toISOString().split('T')[0])
    .gt('avg_hr', 0)
    .order('date', { ascending: true });

  if (!acts || acts.length < 3) {
    return res.json({ status: 'insuficiente', message: 'Se necesitan al menos 3 actividades con HR y potencia para calcular el decoupling.', data: [] });
  }

  // Filtrar sesiones en rango Z2 (56-75% FTP) para análisis de eficiencia aeróbica
  // y sesiones con duración > 30 min para que la muestra sea válida
  const z2Acts = acts.filter(a => {
    const power = a.np || a.avg_power;
    if (!power || !a.avg_hr || a.duration < 1800) return false;
    const pct = power / ftp;
    return pct >= 0.50 && pct <= 0.82; // incluir Z1-Z3 para tener suficientes datos
  });

  if (z2Acts.length < 3) {
    return res.json({
      status: 'pocos_datos_z2',
      message: 'Pocas sesiones en Z2 con datos de HR y potencia. Sincroniza más actividades para un análisis preciso.',
      data: [],
      all_acts_analyzed: acts.length,
    });
  }

  // Calcular efficiency factor (EF) para cada sesión: NP o avg_power / avgHR
  // Un EF más alto = más potencia por latido = mejor eficiencia aeróbica
  const efData = z2Acts.map(a => ({
    date:     a.date,
    name:     a.name || 'Sesión sin nombre',
    ef:       Math.round(((a.np || a.avg_power) / a.avg_hr) * 100) / 100,
    power:    Math.round(a.np || a.avg_power),
    hr:       Math.round(a.avg_hr),
    pctFTP:   Math.round((a.np || a.avg_power) / ftp * 100),
    duration: Math.round(a.duration / 60),
    tss:      a.tss || 0,
  }));

  // Tendencia: comparar EF primeras 3 sesiones vs últimas 3 sesiones
  const efValues = efData.map(d => d.ef);
  const avgEFEarly = efValues.slice(0, Math.ceil(efValues.length / 2))
    .reduce((s, v) => s + v, 0) / Math.ceil(efValues.length / 2);
  const avgEFRecent = efValues.slice(-Math.ceil(efValues.length / 2))
    .reduce((s, v) => s + v, 0) / Math.ceil(efValues.length / 2);

  const efTrend = avgEFEarly > 0
    ? Math.round((avgEFRecent - avgEFEarly) / avgEFEarly * 100)
    : 0;

  // Calcular decoupling como variación porcentual del EF
  // Un decoupling negativo (EF bajando) es la señal de alarma
  let status, message, recommendation;
  const currentEF = efData[efData.length - 1]?.ef || 0;

  if (efTrend > 5) {
    status = 'mejorando';
    message = `Tu eficiencia aeróbica mejoró un +${efTrend}% en las últimas ${z2Acts.length} sesiones comparables.`;
    recommendation = 'Excelente progreso. Puedes empezar a añadir más sesiones de calidad (umbral, VO₂Max) sobre esta base aeróbica.';
  } else if (efTrend >= -5) {
    status = 'estable';
    message = `Tu eficiencia aeróbica está estable (variación: ${efTrend > 0 ? '+' : ''}${efTrend}%).`;
    recommendation = 'Consistencia mantenida. Continúa con el plan actual.';
  } else if (efTrend >= -15) {
    status = 'atencion';
    message = `Tu eficiencia aeróbica bajó un ${efTrend}% en las últimas sesiones. Posible señal de fatiga acumulada.`;
    recommendation = 'Considera reducir la carga esta semana y priorizar el sueño. Monitorea la variación antes de añadir más intensidad.';
  } else {
    status = 'alerta';
    message = `Caída significativa del ${efTrend}% en la eficiencia aeróbica. Señal de sobrecarga o fatiga crónica.`;
    recommendation = 'Semana de recuperación recomendada. Revisa también tus datos de sueño y estrés. Evita sesiones de alta intensidad hasta que la tendencia se estabilice.';
  }

  res.json({
    status,
    message,
    recommendation,
    ef_trend_pct: efTrend,
    ef_current: currentEF,
    ef_early_avg: Math.round(avgEFEarly * 100) / 100,
    ef_recent_avg: Math.round(avgEFRecent * 100) / 100,
    sessions_analyzed: z2Acts.length,
    data: efData,
  });
});

// ── Proyección PMC a 28 días ──────────────────────────────────────────────────
// Recibe el TSS planificado semanal (o lo estima del plan actual) y proyecta
// CTL, ATL y TSB día a día durante las próximas 4 semanas.
router.get('/projection', async (req, res) => {
  const uid = req.user.id;
  const weeklyTSS = parseFloat(req.query.weekly_tss) || null;

  const current = await getCurrentMetrics(uid);
  if (!current) return res.json({ projection: [] });

  let ctl = current.ctl || 0;
  let atl = current.atl || 0;

  // Si no viene weekly_tss, usar la media de las últimas 4 semanas
  let dailyTSS = weeklyTSS ? weeklyTSS / 7 : null;
  if (!dailyTSS) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 28);
    const { data: recent } = await supabase
      .from('activities').select('tss').eq('user_id', uid)
      .gte('date', cutoff.toISOString().split('T')[0]);
    const totalTSS = (recent || []).reduce((s, a) => s + (a.tss || 0), 0);
    dailyTSS = totalTSS / 28;
  }

  const projection = [];
  for (let d = 1; d <= 28; d++) {
    ctl = ctl + (dailyTSS - ctl) / 42;
    atl = atl + (dailyTSS - atl) / 7;
    const tsb = ctl - atl;
    const date = new Date();
    date.setDate(date.getDate() + d);
    const status = getTSBStatus(tsb);
    projection.push({
      date: date.toISOString().split('T')[0],
      day: d,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
      status: status.label,
      advice: status.advice,
    });
  }

  res.json({ projection, daily_tss_assumed: Math.round(dailyTSS * 10) / 10 });
});

module.exports = router;
