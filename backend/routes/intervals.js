// Integración con intervals.icu — alternativa a Strava sin límite de atletas.
// Cada usuario pega su API key personal (intervals.icu → Settings → Developer Settings);
// la API usa Basic auth con usuario literal "API_KEY" y la key como contraseña.
// Ojo: intervals.icu NO expone por API las actividades que le llegan desde Strava
// (restricción de Strava); el usuario debe conectar Garmin/Wahoo/Zwift... directamente.
const express = require('express');
const supabase = require('../db');
const { requireAuth } = require('../middleware/auth');
const { recalculatePMC } = require('../services/pmc');
const { recalculateCP } = require('../services/criticalPower');
const { calcHRTSS } = require('../utils/training');
const { getLatestRestingHR, stravaToAppType } = require('./providers');
const { stepsToIntervalsText } = require('../services/intervalsWorkout');
const router = express.Router();

const ICU_BASE = 'https://intervals.icu/api/v1';
const SOURCE = 'Intervals.icu';
const DAY = 24 * 60 * 60 * 1000;
const IMPORTED_TYPES = ['cycling', 'strength', 'running', 'walking'];
const MAX_PLANNED_WORKOUTS = 7;

function icuFetch(apiKey, path, { method = 'GET', body } = {}) {
  return fetch(`${ICU_BASE}${path}`, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64'),
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// Mismo cálculo de TSS/IF que Strava y Garmin (con el FTP de VeloMind, no el de
// intervals.icu) para que el PMC sea coherente aunque se mezclen fuentes.
function mapIcuActivity(a, uid, ftp, user, restingHR = null) {
  const type = stravaToAppType(a.type);
  const isCycling = type === 'cycling';
  const duration = Math.round(Number(a.moving_time || a.elapsed_time || 0));
  const np = isCycling ? Math.round(Number(a.icu_weighted_avg_watts || a.weighted_average_watts || 0)) : 0;
  const avgPower = isCycling ? Math.round(Number(a.icu_average_watts || a.average_watts || 0)) : 0;
  const avgHr = Math.round(Number(a.average_heartrate || 0));

  let tss = 0, ifValue = 0, finalNp = np;
  if (np > 0 && duration > 0 && ftp > 0) {
    ifValue = Math.round((np / ftp) * 100) / 100;
    tss = Math.round((duration * np * ifValue) / (ftp * 3600) * 100);
  } else if (avgHr > 0 && duration > 0) {
    const lthr = user?.lthr || (user?.max_hr ? Math.round(user.max_hr * 0.88) : 160);
    ({ tss, ifValue } = calcHRTSS(duration, avgHr, lthr, restingHR));
    finalNp = Math.round(ifValue * ftp);
  } else if (duration > 0) {
    ifValue = type === 'strength' ? 0.55 : type === 'running' ? 0.70 : type === 'walking' ? 0.45 : 0.65;
    tss = Math.round((duration * ifValue * ifValue) / 3600 * 100);
    finalNp = Math.round(ifValue * ftp);
  }

  return {
    id: `icu_${a.id}`,
    user_id: uid,
    name: String(a.name || 'Actividad intervals.icu').substring(0, 250),
    type,
    date: String(a.start_date_local || a.start_date).substring(0, 10),
    duration,
    distance: Math.round(Number(a.distance) || 0),
    elevation: Math.round(Number(a.total_elevation_gain) || 0),
    avg_speed: Math.round(Number(a.average_speed || 0) * 36) / 10,
    avg_power: Math.min(avgPower, 2500),
    max_power: Math.min(Math.round(Number(a.max_watts || a.icu_pm_p_max || 0)), 3500),
    np: Math.min(finalNp || 0, 2500),
    avg_hr: Math.min(avgHr, 250),
    max_hr: Math.min(Math.round(Number(a.max_heartrate || 0)), 250),
    avg_cadence: Math.round(Number(a.average_cadence || 0)),
    calories: Math.round(Number(a.calories || 0)),
    tss: Math.round(Number(tss) || 0),
    if_value: Number(ifValue) || 0,
    source: SOURCE,
  };
}

// La misma salida puede estar ya en VeloMind por Strava o subida a mano: se considera
// duplicada si cae el mismo día con una duración parecida (±5 % o ±5 min).
function isDuplicate(row, existing) {
  return existing.some((e) => String(e.date).slice(0, 10) === row.date &&
    Math.abs((Number(e.duration) || 0) - row.duration) <= Math.max(300, row.duration * 0.05));
}

router.post('/connect', requireAuth, async (req, res) => {
  const apiKey = String(req.body?.api_key || '').trim();
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(apiKey)) {
    return res.status(400).json({ error: 'La API key no tiene un formato válido. Cópiala de intervals.icu → Settings → Developer Settings.' });
  }
  try {
    // Athlete "0" = el dueño de la API key
    const r = await icuFetch(apiKey, '/athlete/0');
    if (r.status === 401 || r.status === 403) return res.status(400).json({ error: 'intervals.icu ha rechazado la API key. Revisa que esté bien copiada.' });
    if (!r.ok) return res.status(502).json({ error: `intervals.icu no responde (HTTP ${r.status}). Inténtalo en unos minutos.` });
    const athlete = await r.json();
    if (!athlete?.id) return res.status(502).json({ error: 'Respuesta inesperada de intervals.icu.' });

    const { error } = await supabase.from('users')
      .update({ intervals_api_key: apiKey, intervals_athlete_id: String(athlete.id) })
      .eq('id', req.user.id);
    if (error) throw error;
    res.json({ connected: true, athlete: athlete.name || null });
  } catch (e) {
    console.error('[intervals/connect]', e.message);
    res.status(500).json({ error: 'Error al conectar con intervals.icu. Inténtalo de nuevo.' });
  }
});

router.post('/sync', requireAuth, async (req, res) => {
  const uid = req.user.id;
  try {
    const { data: user, error: userErr } = await supabase.from('users').select('*').eq('id', uid).single();
    if (userErr) throw userErr;
    if (!user?.intervals_api_key) return res.status(400).json({ error: 'intervals.icu no conectado' });

    // Incremental si se pasa `since` (unix seg), si no, el último año completo
    const since = Number(req.body?.since);
    const oldestTs = Number.isFinite(since) && since > 0 ? since * 1000 : Date.now() - 365 * DAY;
    const oldest = new Date(oldestTs).toISOString().slice(0, 10);
    const newest = new Date(Date.now() + DAY).toISOString().slice(0, 10);

    const athleteId = encodeURIComponent(user.intervals_athlete_id || '0');
    const r = await icuFetch(user.intervals_api_key, `/athlete/${athleteId}/activities?oldest=${oldest}&newest=${newest}`);
    // 424 y no 401: el frontend cierra la sesión de VeloMind ante cualquier 401
    if (r.status === 401 || r.status === 403) {
      return res.status(424).json({ error: 'intervals.icu ha rechazado la API key. Ve a Integraciones y vuelve a conectarlo.', code: 'ICU_KEY_REJECTED' });
    }
    if (r.status === 429) return res.status(429).json({ error: 'Límite de peticiones a intervals.icu alcanzado. Inténtalo en unos minutos.' });
    if (!r.ok) return res.status(502).json({ error: `intervals.icu devolvió un error (HTTP ${r.status}).` });
    const acts = await r.json();
    const list = Array.isArray(acts) ? acts : [];

    // Las que vienen de Strava llegan vacías por la API (restricción de Strava): se descartan
    const fromStrava = list.filter((a) => String(a.source || '').toUpperCase() === 'STRAVA').length;
    const ftp = Math.max(1, user.ftp || 200);
    const restingHR = await getLatestRestingHR(uid);

    const { data: existing } = await supabase.from('activities')
      .select('date, duration, source').eq('user_id', uid).gte('date', oldest).neq('source', SOURCE);

    let duplicates = 0;
    const rows = [];
    for (const a of list) {
      if (!a?.id || !(a.start_date_local || a.start_date)) continue;
      if (String(a.source || '').toUpperCase() === 'STRAVA') continue;
      const row = mapIcuActivity(a, uid, ftp, user, restingHR);
      if (!IMPORTED_TYPES.includes(row.type) || row.duration <= 0) continue;
      if (isDuplicate(row, existing || [])) { duplicates++; continue; }
      rows.push(row);
    }

    let failed = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const { error } = await supabase.from('activities').upsert(chunk, { onConflict: 'id' });
      if (error) {
        console.error('[intervals/sync] upsert:', error.message);
        failed += chunk.length;
      }
    }

    setImmediate(async () => {
      try { await recalculatePMC(uid); } catch (err) { console.error('[intervals/sync] PMC:', err.message); }
      try { await recalculateCP(uid); } catch (err) { console.error('[intervals/sync] CP:', err.message); }
    });

    res.json({
      message: 'Sync OK',
      downloaded: list.length,
      synced: rows.length - failed,
      failed,
      duplicates,
      skipped_strava: fromStrava,
    });
  } catch (e) {
    console.error('[intervals/sync]', e.message);
    res.status(500).json({ error: 'Error interno al sincronizar con intervals.icu' });
  }
});

// Si una salida llegó primero por intervals.icu y después Strava importa la misma, se queda
// la de Strava (trae bici, mapa, best efforts y potencia estimada) y se borra la copia icu_,
// que si no contaría dos veces en el PMC. Mira todas las guardadas, no solo las del último
// sync, para limpiar también duplicados de antes.
async function removeIcuDuplicatesOfStrava(uid) {
  const { data: icu } = await supabase.from('activities')
    .select('id, date, duration').eq('user_id', uid).eq('source', SOURCE);
  if (!icu?.length) return 0;
  const dates = [...new Set(icu.map((a) => String(a.date).slice(0, 10)))];
  const { data: strava } = await supabase.from('activities')
    .select('date, duration').eq('user_id', uid).eq('source', 'Strava').in('date', dates);
  const ids = icu
    .filter((a) => isDuplicate({ date: String(a.date).slice(0, 10), duration: Number(a.duration) || 0 }, strava || []))
    .map((a) => a.id);
  if (ids.length) {
    const { error } = await supabase.from('activities').delete().eq('user_id', uid).in('id', ids);
    if (error) throw error;
  }
  return ids.length;
}

// Telemetría de una actividad con la misma forma que fetchStravaStreams ({ time: [...], watts: [...] })
// para que el panel de detalle y el W'bal no distingan la fuente. intervals.icu devuelve
// [{ type, data, data2 }] y el GPS viene partido: latitudes en data, longitudes en data2.
const STREAM_TYPES = 'time,watts,heartrate,velocity_smooth,altitude,cadence,grade_smooth,latlng';
async function fetchIcuStreams(apiKey, activityId) {
  const r = await icuFetch(apiKey, `/activity/${encodeURIComponent(activityId)}/streams?types=${STREAM_TYPES}`);
  if (!r.ok) {
    const err = new Error(`intervals.icu streams HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const raw = await r.json();
  const streams = {};
  for (const s of Array.isArray(raw) ? raw : []) {
    if (!s?.type || !Array.isArray(s.data)) continue;
    streams[s.type] = s.type === 'latlng' && Array.isArray(s.data2)
      ? s.data.map((lat, i) => [lat, s.data2[i]])
      : s.data;
  }
  return streams;
}

// :activityId es el id de VeloMind (icu_i123) o el de intervals.icu (i123)
router.get('/streams/:activityId', requireAuth, async (req, res) => {
  const activityId = String(req.params.activityId).replace(/^icu_/, '');
  if (!/^[A-Za-z0-9]{1,40}$/.test(activityId)) return res.status(400).json({ error: 'activityId inválido' });
  try {
    const { data: user } = await supabase.from('users').select('intervals_api_key').eq('id', req.user.id).single();
    if (!user?.intervals_api_key) return res.status(400).json({ error: 'intervals.icu no conectado' });
    res.json(await fetchIcuStreams(user.intervals_api_key, activityId));
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: 'Actividad no encontrada en intervals.icu' });
    if (e.status === 401 || e.status === 403) return res.status(424).json({ error: 'intervals.icu ha rechazado la API key. Ve a Integraciones y vuelve a conectarlo.', code: 'ICU_KEY_REJECTED' });
    console.error('[intervals/streams]', e.message);
    res.status(500).json({ error: 'Error del servidor. Inténtalo de nuevo.' });
  }
});

// Crea o actualiza entrenos en el calendario de intervals.icu, que los pasa a Garmin.
// El external_id es por día: reenviar una sesión adaptada la sustituye sin duplicarla.
router.post('/planned-workouts', requireAuth, async (req, res) => {
  const incoming = Array.isArray(req.body?.workouts) ? req.body.workouts : [];
  if (!incoming.length || incoming.length > MAX_PLANNED_WORKOUTS) {
    return res.status(400).json({ error: 'No hay sesiones válidas para enviar.' });
  }

  const events = [];
  for (const workout of incoming) {
    const date = String(workout?.date || '');
    const description = stepsToIntervalsText(workout?.steps);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !description) {
      return res.status(400).json({ error: 'La sesión no tiene fecha o pasos válidos.' });
    }
    events.push({
      category: 'WORKOUT',
      type: 'Ride',
      start_date_local: `${date}T00:00:00`,
      name: String(workout.name || 'Entrenamiento VeloMind').slice(0, 60),
      description,
      external_id: `velomind-${date}`,
    });
  }

  try {
    const { data: user, error } = await supabase.from('users')
      .select('intervals_api_key, intervals_athlete_id')
      .eq('id', req.user.id).single();
    if (error) throw error;
    if (!user?.intervals_api_key) return res.status(400).json({ error: 'Conecta intervals.icu en Integraciones para enviar entrenos a Garmin.' });

    const athleteId = encodeURIComponent(user.intervals_athlete_id || '0');
    const r = await icuFetch(user.intervals_api_key, `/athlete/${athleteId}/events/bulk?upsert=true`, { method: 'POST', body: events });
    if (r.status === 401 || r.status === 403) {
      return res.status(424).json({ error: 'intervals.icu ha rechazado la API key. Ve a Integraciones y vuelve a conectarlo.', code: 'ICU_KEY_REJECTED' });
    }
    if (r.status === 429) return res.status(429).json({ error: 'Límite de peticiones a intervals.icu alcanzado. Inténtalo en unos minutos.' });
    if (!r.ok) return res.status(502).json({ error: `intervals.icu devolvió un error (HTTP ${r.status}).` });
    res.json({ sent: events.length });
  } catch (e) {
    console.error('[intervals/planned-workouts]', e.message);
    res.status(500).json({ error: 'Error al enviar el entreno. Inténtalo de nuevo.' });
  }
});

router.delete('/disconnect', requireAuth, async (req, res) => {
  try {
    await supabase.from('users').update({ intervals_api_key: null, intervals_athlete_id: null }).eq('id', req.user.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[intervals/disconnect]', e.message);
    res.status(500).json({ error: 'Error del servidor. Inténtalo de nuevo.' });
  }
});

module.exports = router;
module.exports.mapIcuActivity = mapIcuActivity;
module.exports.isDuplicate = isDuplicate;
module.exports.fetchIcuStreams = fetchIcuStreams;
module.exports.removeIcuDuplicatesOfStrava = removeIcuDuplicatesOfStrava;
