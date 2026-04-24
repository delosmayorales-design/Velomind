const express = require('express');
const supabase = require('../db');
const { requireAuth } = require('../middleware/auth');
const { recalculatePMC } = require('../services/pmc');

const router  = express.Router();

// ─── Zone time helpers ────────────────────────────────────────────────────────

function calcNPFromStream(watts) {
  if (!watts || watts.length < 30) return null;
  let sum4 = 0, count = 0;
  for (let i = 29; i < watts.length; i++) {
    let avg = 0;
    for (let j = 0; j < 30; j++) avg += (watts[i - j] || 0);
    avg /= 30;
    sum4 += Math.pow(avg, 4);
    count++;
  }
  return count ? Math.round(Math.pow(sum4 / count, 0.25)) : null;
}

function calcZoneTimesFromStream(watts, timeData, ftp) {
  const zt = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0, z7: 0 };
  for (let i = 0; i < watts.length; i++) {
    const dt = i === 0 ? 1 : Math.max(1, timeData[i] - timeData[i - 1]);
    const r  = (watts[i] || 0) / ftp;
    const k  = r < 0.55 ? 'z1' : r < 0.75 ? 'z2' : r < 0.90 ? 'z3'
             : r < 1.05 ? 'z4' : r < 1.20 ? 'z5' : r < 1.50 ? 'z6' : 'z7';
    zt[k] += dt;
  }
  return zt;
}

// Calcula la curva de potencia real (MMP) usando medias móviles
function calcBestEffortsFromStream(watts) {
  const windows = [5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600];
  const results = {};
  const n = watts.length;
  
  const prefixSum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefixSum[i + 1] = prefixSum[i] + (watts[i] || 0);

  for (const w of windows) {
    let maxAvg = 0;
    if (n >= w) {
      for (let i = 0; i <= n - w; i++) {
        const avg = (prefixSum[i + w] - prefixSum[i]) / w;
        if (avg > maxAvg) maxAvg = avg;
      }
    }
    if (maxAvg > 0) results[w] = Math.round(maxAvg);
  }
  return results;
}

async function fetchActivityStreams(stravaId, token) {
  try {
    const r = await fetch(
      `https://www.strava.com/api/v3/activities/${stravaId}/streams?keys=watts,time&key_by_type=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!r.ok) return null;
    const data = await r.json();
    const watts = data?.watts?.data;
    if (!watts || !watts.length) return null;
    const time = data?.time?.data || watts.map((_, i) => i);
    return { watts, time };
  } catch {
    return null;
  }
}

// Detecta si la columna zone_times existe en Supabase (una sola vez por proceso)
let hasZoneTimesCol = null;

async function checkZoneTimesCol(supabase) {
  if (hasZoneTimesCol !== null) return hasZoneTimesCol;
  const { error } = await supabase.from('activities').select('zone_times').limit(1);
  hasZoneTimesCol = !error;
  if (!hasZoneTimesCol) {
    console.log('[Zones] ⚠  Columna zone_times no existe. Ejecuta en Supabase SQL Editor:');
    console.log('[Zones]    ALTER TABLE activities ADD COLUMN IF NOT EXISTS zone_times jsonb;');
  }
  return hasZoneTimesCol;
}

// ─────────────────────────────────────────────────────────────────────────────

const STRAVA_ID     = process.env.STRAVA_CLIENT_ID;
const STRAVA_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_RDR = process.env.STRAVA_REDIRECT_URI || 'https://velomind-backend.onrender.com/api/providers/strava/callback';

const GARMIN_KEY    = process.env.GARMIN_CONSUMER_KEY;
const GARMIN_SECRET = process.env.GARMIN_CONSUMER_SECRET;


// 💾 SAVE TOKEN (Manual)
router.post('/strava/save-token', requireAuth, async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ error: 'access_token requerido' });

  try {
    // Verificar validez del token directamente con Strava
    const r = await fetch('https://www.strava.com/api/v3/athlete', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    
    if (!r.ok) {
      return res.status(400).json({ error: 'El token de Strava no es válido o ha expirado.' });
    }
    
    const athlete = await r.json();

    // Guardar en Supabase el token y el ID del atleta
    const { error } = await supabase.from('users').update({
      strava_token: access_token,
      strava_athlete_id: String(athlete.id),
    }).eq('id', req.user.id);

    if (error) throw error;

    res.json({ message: '✅ Token guardado correctamente', athlete: { name: `${athlete.firstname} ${athlete.lastname}` } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// � CONNECT
router.get('/strava/connect', requireAuth, (req, res) => {
  if (!STRAVA_ID || STRAVA_ID === 'YOUR_STRAVA_CLIENT_ID')
    return res.status(501).json({ error: 'Strava no configurado en .env' });

  const state = Buffer.from(JSON.stringify({ userId: req.user.id, ts: Date.now() })).toString('base64');

  res.json({
    url: `https://www.strava.com/oauth/authorize?client_id=${STRAVA_ID}&redirect_uri=${encodeURIComponent(STRAVA_RDR)}&response_type=code&scope=read,activity:read_all,read_all,profile:read_all&approval_prompt=force&state=${state}`
  });
});


/**
 * 🔁 CALLBACK (Intercambio de código por Token)
 * Soporta GET (redirección directa) y POST (llamada desde el frontend)
 */
async function handleStravaExchange(req, res) {
  const { code, state, scope } = (req.method === 'POST' ? req.body : req.query);

  if (!code) return res.status(400).json({ error: 'code requerido' });

  let userId;
  if (req.user) {
    userId = req.user.id;
  } else if (state) {
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
    userId = decoded.userId;
  } catch (e) {
      userId = null;
    }
  }

  if (!userId) {
    return res.status(401).json({ error: 'Sesión no identificada. Por favor, logueate de nuevo.' });
  }

  try {
    const r = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: STRAVA_ID,
        client_secret: STRAVA_SECRET,
        code,
        grant_type: 'authorization_code'
      }),
    });

    const d = await r.json();

    if (!r.ok) {
      console.error('[Strava] Error en intercambio de token:', d);
      return res.status(400).json({ error: 'Strava rechazó el código de autorización.', detail: d });
    }

    console.log(`[Strava] Token obtenido para usuario ${userId}. Scopes: ${scope || 'no proporcionados'}`);
    console.log('[Strava] Guardando token. access_token:', d.access_token ? '✓' : '✗');
    console.log('[Strava] Guardando token. refresh_token:', d.refresh_token ? '✓' : '✗');
    console.log('[Strava] Guardando token. expires_at:', d.expires_at);

    await supabase.from('users').update({
      strava_token: d.access_token,
      strava_refresh: d.refresh_token,
      strava_expires_at: d.expires_at,
      strava_athlete_id: String(d.athlete?.id || ''),
    }).eq('id', userId);

    if (req.method === 'POST') {
      res.json({ message: '✅ Strava conectado correctamente', athlete: d.athlete });
    } else {
      // Redirigir al frontend tras el intercambio GET exitoso
    const frontendUrl = process.env.FRONTEND_URL || 'https://velomind-liard.vercel.app';
      res.redirect(`${frontendUrl}/cyclocoach/integrations.html?strava=connected`);
    }

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

router.get('/strava/callback', handleStravaExchange);
router.post('/strava/callback', requireAuth, handleStravaExchange);

// 🔵 GARMIN CONNECT (OAuth 1.0a)

router.get('/garmin/connect', requireAuth, async (req, res) => {
  if (!GARMIN_KEY || GARMIN_KEY === 'YOUR_GARMIN_KEY') {
    return res.status(501).json({ error: 'Garmin no configurado en .env' });
  }
  // Nota: OAuth 1.0a requiere firma de peticiones. 
  // Aquí deberías usar una librería como 'oauth' para obtener el request_token.
  res.status(501).json({ 
    message: 'El flujo OAuth 1.0a requiere la librería "oauth" y firma de cabeceras.',
    info: 'Garmin enviará un oauth_token y oauth_verifier al callback configurado.'
  });
});

router.post('/garmin/sync', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();

  if (!user || !user.garmin_token) {
    return res.status(400).json({ error: 'Garmin no conectado.' });
  }

  try {
    // Garmin normalmente no permite "pull" de actividades antiguas fácilmente como Strava.
    // El método preferido de Garmin es "Push" (webhooks).
    // No obstante, si tienes acceso al Backfill API, podrías pedir los últimos días.
    res.json({ message: 'Sincronización iniciada', synced: 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ❌ DISCONNECT GARMIN
router.post('/garmin/disconnect', requireAuth, async (req, res) => {
  try {
    await supabase.from('users').update({
      garmin_token: null,
      garmin_secret: null, // OAuth 1.0a guarda ambos
    }).eq('id', req.user.id);
    res.json({ message: '✅ Garmin desconectado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ❌ DISCONNECT
router.post('/strava/disconnect', requireAuth, async (req, res) => {
  try {
    await supabase.from('users').update({
      strava_token: null,
      strava_refresh: null,
      strava_expires_at: null,
      strava_athlete_id: null,
    }).eq('id', req.user.id);
    res.json({ message: '✅ Strava desconectado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 🔍 DIAGNÓSTICO — muestra las últimas 10 actividades crudas de Strava sin filtrar
router.get('/strava/debug-activities', requireAuth, async (req, res) => {
  const { data: user } = await supabase.from('users').select('strava_token,strava_refresh').eq('id', req.user.id).single();
  if (!user?.strava_token) return res.status(400).json({ error: 'Strava no conectado' });

  const r = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=10&page=1', {
    headers: { Authorization: `Bearer ${user.strava_token}` }
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    return res.status(r.status).json({ error: 'Token inválido o expirado', detail: e });
  }
  const acts = await r.json();
  res.json(acts.map(a => ({
    id: a.id,
    name: a.name,
    date: a.start_date_local?.substring(0, 10),
    type: a.type,
    sport_type: a.sport_type,
    manual: a.manual,
    avg_watts: a.average_watts,
    distance_km: a.distance ? (a.distance / 1000).toFixed(1) : null,
  })));
});

// 🔄 SYNC
router.post('/strava/sync', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();

  if (!user || !user.strava_token) {
    return res.status(400).json({ error: 'Strava no conectado. Ve a Integraciones primero.' });
  }

  let token = user.strava_token;
  const ftp = user.ftp || 200;

  // 1. Refresh token si está disponible; si no, usar access token directo
  console.log('[Strava] Refresh token guardado:', user.strava_refresh ? '✓' : '✗ NULL (token manual)');

  if (user.strava_refresh) {
    const re = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: STRAVA_ID, client_secret: STRAVA_SECRET,
        refresh_token: user.strava_refresh, grant_type: 'refresh_token'
      }),
    });
    const d = await re.json();
    if (re.ok && d.access_token) {
      token = d.access_token;
      await supabase.from('users').update({
        strava_token: d.access_token,
        strava_refresh: d.refresh_token,
        strava_expires_at: d.expires_at
      }).eq('id', uid);
      console.log('[Strava] Token refrescado OK');
    } else {
      console.log('[Strava] Refresh falló, intentando con token existente');
    }
  } else {
    console.log('[Strava] Usando access token manual (sin refresh). Puede expirar en breve.');
  }

  try {
    // Optimización: Obtener la fecha de la última actividad para importar solo las nuevas
    let afterParam = '';
    const { data: latestAct } = await supabase.from('activities')
      .select('date')
      .eq('user_id', uid)
      .eq('source', 'Strava')
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestAct && latestAct.date) {
      // Solapamos 7 días hacia atrás por seguridad (por si han editado nombres en Strava recientemente)
      const afterEpoch = Math.floor(new Date(latestAct.date).getTime() / 1000) - (7 * 86400);
      afterParam = `&after=${afterEpoch}`;
      console.log('[Strava] Sincronización inteligente desde:', new Date(afterEpoch * 1000).toISOString().substring(0, 10));
    }

    let acts = [];
    for (let page = 1; page <= 10; page++) {
      const r = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${page}${afterParam}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) {
        const errData = await r.json().catch(() => ({}));
        console.error('[StravaSync] Error API:', r.status, errData);
        if (r.status === 401) {
          return res.status(401).json({ error: 'La sesión de Strava ha expirado. Por favor, desconecta y vuelve a conectar.' });
        }
        return res.status(400).json({ error: 'Error al obtener actividades de Strava' });
      }
      const page_acts = await r.json();
      acts = acts.concat(page_acts);
      if (page_acts.length < 200) break; // última página
    }
    console.log('[Strava] Total actividades:', acts.length);
    
    // Mostrar tipos de actividades
    const types = [...new Set(acts.map(a => a.type))];
    console.log('[Strava] Tipos de actividad:', types);
    
    // Filtrar solo actividades de ciclismo
    const CYCLING_TYPES = ['ride', 'virtualride', 'ebikeride', 'gravelride', 'mountainbikeride', 'handcycle'];
    const cyclingActs = acts.filter(a => {
      const t = (a.type || a.sport_type || '').toLowerCase();
      return CYCLING_TYPES.some(ct => t.includes(ct));
    });
    const filteredTypes = [...new Set(acts.filter(a => {
      const t = (a.type || a.sport_type || '').toLowerCase();
      return !CYCLING_TYPES.some(ct => t.includes(ct));
    }).map(a => a.type || a.sport_type))];
    console.log('[Strava] Cycling encontradas:', cyclingActs.length, '| Descartadas (otros deportes):', filteredTypes);

    let saved = 0;
    let updated = 0;
    let streamsFetched = 0;

    // Comprobar si la columna zone_times existe y qué actividades ya la tienen
    const colExists = await checkZoneTimesCol(supabase);
    let alreadyHasZones = new Set();
    if (colExists) {
      const { data: existing, error: checkErr } = await supabase
        .from('activities')
        .select('id, zone_times, best_efforts')
        .eq('user_id', uid);
        
      if (!checkErr) {
        // Requiere AMBAS columnas para considerarse "completo" y saltarse los streams
        alreadyHasZones = new Set((existing || [])
          .filter(r => r.zone_times !== null && r.best_efforts !== null)
          .map(r => r.id));
      } else {
        const { data: existingZones } = await supabase
          .from('activities').select('id').eq('user_id', uid).not('zone_times', 'is', null);
        alreadyHasZones = new Set((existingZones || []).map(r => r.id));
      }
    }

    for (const a of cyclingActs) {
      console.log('[Strava] Procesando:', a.name, a.type || a.sport_type, a.start_date_local || a.start_date);
      const date = a.start_date_local ? a.start_date_local.substring(0, 10) : a.start_date.substring(0, 10);
      const id = `strava_${a.id}`;
      const dur = a.moving_time || a.elapsed_time;
      const dist = a.distance || 0;

      // Calcular métricas de carga (TSS/IF)
      console.log('[Strava] Raw data - avg_watts:', a.average_watts, 'avg_hr:', a.average_heartrate, 'max_hr:', a.max_heartrate);
      const avgPower = a.average_watts || 0;
      let np, ifv, tss, vi;
      if (avgPower > 0) {
        np  = Math.round(avgPower * 1.05); // estimación inicial; se sobreescribe con NP real si hay streams
        ifv = ftp ? Math.round((np / ftp) * 100) / 100 : 0;
        tss = ftp && dur ? Math.round((dur / 3600) * ifv * ifv * 100) : 0;
      } else {
        const avgHR = a.average_heartrate || 0;
        const maxHR = a.max_heartrate || 185;
        if (avgHR > 0 && ftp) {
          const lthr = maxHR * 0.88;
          ifv = Math.min(Math.round((avgHR / lthr) * 100) / 100, 1.15);
          np  = Math.round(ftp * ifv);
          tss = Math.round((dur / 3600) * ifv * ifv * 100);
        } else {
          ifv = 0.65;
          np  = Math.round(ftp * 0.65);
          tss = ftp && dur ? Math.round((dur / 3600) * ifv * ifv * 100) : 0;
        }
      }

      // ── Streams de Strava: NP real + distribución de zonas ──────────────────
      let zone_times = undefined;
      let best_efforts = undefined;
      const needsStreams = colExists && avgPower > 0 && !alreadyHasZones.has(id) && streamsFetched < 250;

      if (needsStreams) {
        const streams = await fetchActivityStreams(a.id, token);
        if (streams) {
          const realNP = calcNPFromStream(streams.watts);
          if (realNP && ftp) {
            np  = realNP;
            ifv = Math.round((realNP / ftp) * 100) / 100;
            tss = Math.round((dur / 3600) * ifv * ifv * 100);
          }
          zone_times = calcZoneTimesFromStream(streams.watts, streams.time, ftp);
          best_efforts = calcBestEffortsFromStream(streams.watts);
          streamsFetched++;
          // Delay suave para no saturar la rate limit de Strava (100ms → ~10/s → 600/min)
          await new Promise(r => setTimeout(r, 100));
        }
        console.log('[Strava] Streams:', a.name, zone_times ? '✓' : 'sin datos de potencia');
      }

      vi = avgPower > 0 && np ? Math.round((np / avgPower) * 100) / 100 : null;
      console.log('[Strava] Activity:', a.name, 'np:', np, 'vi:', vi, 'tss:', tss);

      const activityData = {
        id,
        user_id:    uid,
        name:       a.name,
        date,
        source:     'Strava',
        type:       'cycling',
        duration:   dur  || 0,
        distance:   dist || 0,
        elevation:  Math.round(a.total_elevation_gain || 0),
        avg_speed:  Math.round((a.average_speed || 0) * 3.6 * 10) / 10,
        avg_power:  Math.round(avgPower || 0),
        max_power:  Math.round(a.max_watts  || 0),
        np:         Math.round(np),
        tss:        Math.round(tss || 0),
        if_value:   Math.round((ifv || 0) * 100) / 100,
        vi:         vi,
        avg_hr:     Math.round(a.average_heartrate || 0),
        max_hr:     Math.round(a.max_heartrate     || 0),
        avg_cadence:Math.round(a.average_cadence   || 0),
        calories:   Math.round(a.calories          || 0),
        strava_id:  String(a.id),
        gear_id:    a.gear_id || null,
      };

      // Solo incluir zone_times si se calcularon en este sync (preserva valor previo si no)
      if (zone_times !== undefined) activityData.zone_times = zone_times;
      if (best_efforts !== undefined) activityData.best_efforts = best_efforts;

      // Upsert: inserta o actualiza (preserva zone_times existentes si no están en este objeto)
      const { error: insErr } = await supabase
        .from('activities')
        .upsert(activityData, { onConflict: 'id', ignoreDuplicates: false })
        .select('id');

      if (insErr) {
        console.log('[Strava] Error upsert:', a.name, insErr.message);
        // Si falla por columna inexistente, reintenta sin zone_times
        if (insErr.message?.includes('zone_times') || insErr.message?.includes('best_efforts')) {
          hasZoneTimesCol = false;
          delete activityData.zone_times;
          delete activityData.best_efforts;
          await supabase.from('activities').upsert(activityData, { onConflict: 'id', ignoreDuplicates: false });
        }
      } else {
        console.log('[Strava] Upsert OK:', a.name);
        saved++;
      }
    }

    // 2. Recalcular km de componentes desde la tabla de actividades (idempotente)
    const HOUR_BASED = new Set(['fork', 'shock']);
    const gearIds = [...new Set(cyclingActs.map(a => a.gear_id).filter(Boolean))];

    for (const gearId of gearIds) {
      const { data: bike } = await supabase.from('bikes').select('id, type')
        .eq('user_id', uid).eq('strava_gear_id', String(gearId)).maybeSingle();
      if (!bike) continue;
      const isMTB = ['mtb_full', 'mtb_hardtail'].includes(bike.type);

      // Sumar km y horas de TODAS las actividades de esta bici en BD
      const { data: acts_sum } = await supabase.from('activities')
        .select('distance, duration')
        .eq('user_id', uid)
        .eq('gear_id', gearId);

      const totalKm    = (acts_sum || []).reduce((s, a) => s + (a.distance || 0), 0) / 1000;
      const totalHours = (acts_sum || []).reduce((s, a) => s + (a.duration  || 0), 0) / 3600;

      // Actualizar odómetro de la bici
      await supabase.from('bikes').update({ total_km: Math.round(totalKm * 10) / 10 }).eq('id', bike.id);

      // Actualizar componentes usando km_installed como odómetro al instalar (inmutable)
      // km_remaining = vida_original - (totalKm - odómetro_al_instalar)
      const KM_LIFE = { chain:3000, cassette:9000, chainring:15000, jockey_wheels:15000,
                        brakes_pad:3000, brake_rotor:10000, tire_front:5000, tire_rear:4000 };
      const HR_LIFE = { fork:200, shock:100 };

      const { data: comps } = await supabase.from('bike_components')
        .select('id, component_type, km_installed, km_remaining, hours_installed, hours_remaining')
        .eq('bike_id', bike.id).eq('is_active', true);

      for (const c of comps || []) {
        const isHourBased = HOUR_BASED.has(c.component_type);
        if (isHourBased && isMTB) {
          const odometer_h   = c.hours_installed || 0;
          const lifespan_h   = HR_LIFE[c.component_type] || 100;
          const hours_used   = Math.max(0, totalHours - odometer_h);
          await supabase.from('bike_components').update({
            hours_remaining: Math.max(0, Math.round((lifespan_h - hours_used) * 10) / 10),
          }).eq('id', c.id);
        } else if (!isHourBased) {
          const odometer_at_install = c.km_installed || 0;
          const lifespan_km         = KM_LIFE[c.component_type] || 3000;
          const km_used             = Math.max(0, totalKm - odometer_at_install);
          await supabase.from('bike_components').update({
            km_remaining: Math.max(0, Math.round((lifespan_km - km_used) * 10) / 10),
          }).eq('id', c.id);
          // km_installed NO se toca: es el odómetro fijo en el momento de instalación
        }
      }
      console.log(`[Garage] Bici ${gearId}: ${Math.round(totalKm)} km / ${Math.round(totalHours)}h calculados desde actividades`);
    }

    // Recalcular PMC CTL/ATL/TSB al terminar
    setImmediate(() => recalculatePMC(uid));

    const zonesMsg = streamsFetched > 0
      ? ` · ${streamsFetched} con distribución de zonas real`
      : colExists ? '' : ' · Añade columna zone_times en Supabase para zonas reales';

    res.json({
      message: `✅ ${saved} actividades procesadas (${cyclingActs.length} de ciclismo)${zonesMsg}`,
      synced: saved,
      total_strava: acts.length,
      total_cycling: cyclingActs.length,
      streams_fetched: streamsFetched,
      filtered_types: filteredTypes
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;