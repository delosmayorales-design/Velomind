const express = require('express');
const supabase = require('../db');
const { requireAuth } = require('../middleware/auth');
const { recalculatePMC } = require('../services/pmc');

const router  = express.Router();

// ─── CONFIG ─────────────────────────────────────────────

const STRAVA_ID     = process.env.STRAVA_CLIENT_ID;
const STRAVA_SECRET = process.env.STRAVA_CLIENT_SECRET;
const GARMIN_ID     = process.env.GARMIN_CLIENT_ID;
const GARMIN_SECRET = process.env.GARMIN_CLIENT_SECRET;

// ✅ REDIRECT CORRECTO (NUNCA localhost)
const STRAVA_RDR = process.env.STRAVA_REDIRECT_URI 
  || 'https://velomind-backend.onrender.com/api/providers/strava/callback';
const GARMIN_RDR = process.env.GARMIN_REDIRECT_URI
  || 'https://velomind-backend.onrender.com/api/providers/garmin/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://velomind-liard.vercel.app';
const GARMIN_AUTH_URL = 'https://connect.garmin.com/oauth2Confirm';
const GARMIN_TOKEN_URL = 'https://connectapi.garmin.com/di-oauth2-service/oauth/token';
const GARMIN_API_BASE = process.env.GARMIN_API_BASE || 'https://apis.garmin.com/wellness-api/rest';

function base64Url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sha256Base64Url(input) {
  return require('crypto').createHash('sha256').update(input).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomPkceVerifier() {
  return require('crypto').randomBytes(48).toString('base64url');
}

function encodeState(payload) {
  const body = base64Url(JSON.stringify(payload));
  const sig = require('crypto')
    .createHmac('sha256', process.env.JWT_SECRET || 'velomind-dev-secret')
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

function decodeState(state) {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  const expected = require('crypto')
    .createHmac('sha256', process.env.JWT_SECRET || 'velomind-dev-secret')
    .update(body)
    .digest('base64url');
  if (sig !== expected) return null;
  return JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
}

// ─── CONNECT ────────────────────────────────────────────

router.get('/strava/connect', requireAuth, (req, res) => {
  if (!STRAVA_ID) {
    return res.status(500).json({ error: 'Strava no configurado' });
  }

  const state = Buffer.from(JSON.stringify({
    userId: req.user.id,
    ts: Date.now()
  })).toString('base64');

  const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_ID}&redirect_uri=${encodeURIComponent(STRAVA_RDR)}&response_type=code&scope=read,activity:read_all,profile:read_all&approval_prompt=force&state=${state}`;

  res.json({ url });
});

// ─── CALLBACK ───────────────────────────────────────────

async function handleStravaExchange(req, res) {
  const { code, state } = req.method === 'POST' ? req.body : req.query;

  if (!code) return res.status(400).json({ error: 'code requerido' });

  let userId;

  if (req.user) {
    userId = req.user.id;
  } else if (state) {
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
      userId = decoded.userId;
    } catch {
      userId = null;
    }
  }

  if (!userId) {
    return res.status(401).json({ error: 'Usuario no identificado' });
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
      return res.status(400).json({ error: 'Error con Strava', detail: d });
    }

    await supabase.from('users').update({
      strava_token: d.access_token,
      strava_refresh: d.refresh_token,
      strava_expires_at: d.expires_at,
      strava_athlete_id: String(d.athlete?.id || ''),
    }).eq('id', userId);

    // ✅ REDIRECT FINAL CORRECTO (SIN /cyclocoach)
    if (req.method === 'POST') {
      res.json({ message: 'Strava conectado', athlete: d.athlete });
    } else {
      const frontendUrl = process.env.FRONTEND_URL 
        || 'https://velomind-liard.vercel.app';

      res.redirect(`${frontendUrl}/integrations.html?strava=connected`);
    }

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

router.get('/strava/callback', handleStravaExchange);
router.post('/strava/callback', requireAuth, handleStravaExchange);

// ─── SYNC ───────────────────────────────────────────────

router.post('/strava/sync', requireAuth, async (req, res) => {
  const uid = req.user.id;
  
  console.log('\n[POST /strava/sync] 🔄 INICIANDO SYNC');
  console.log('👉 UID del usuario que sincroniza:', uid);

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', uid)
    .single();

  if (!user?.strava_token) {
    return res.status(400).json({ error: 'Strava no conectado' });
  }

  let token = user.strava_token;

  // Refrescar token si ha expirado (Strava requiere renovar cada 6 horas)
  const isExpired = !user.strava_expires_at || (Date.now() / 1000 > user.strava_expires_at - 300);
  if (user.strava_refresh && isExpired) {
    try {
      const re = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: STRAVA_ID,
          client_secret: STRAVA_SECRET,
          grant_type: 'refresh_token',
          refresh_token: user.strava_refresh
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
      } else {
        return res.status(401).json({ error: 'La sesión de Strava caducó. Ve a Integraciones y vuelve a conectarlo.' });
      }
    } catch(e) {
      console.error('[Strava Sync] Error refrescando token:', e.message);
    }
  }

  try {
    let page = 1;
    let acts = [];
    let hasMore = true;

    // Si se pasa `since` (auto-sync incremental) usarlo; si no, ventana de 1 año completa
    const sinceParam = req.body?.since;
    const isIncremental = sinceParam && Number.isFinite(Number(sinceParam));
    const oneYearAgo = Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60);
    const after = isIncremental ? Math.floor(Number(sinceParam)) : oneYearAgo;
    const MAX_PAGES = isIncremental ? 3 : 50; // Incremental: máx 3 páginas (suficiente para salidas recientes)

    const afterDate = new Date(after * 1000).toISOString().substring(0, 10);
    console.log(`[Strava Sync] ${isIncremental ? '⚡ Incremental' : '🔄 Completo'} — actividades desde: ${afterDate}`);

    // Paginación hasta que no haya más resultados
    while (hasMore && page <= MAX_PAGES) {
      const r = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=200&page=${page}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (r.status === 401) {
        return res.status(401).json({ error: 'Token de Strava expirado o inválido. Ve a Integraciones y vuelve a conectarlo.' });
      }
      if (r.status === 429) {
        console.warn('[Strava Sync] ⚠️ Rate limit de Strava alcanzado (HTTP 429).');
        if (page === 1) return res.status(429).json({ error: 'Límite de peticiones a Strava alcanzado. Intenta de nuevo en 15 minutos.' });
        break; // Si ya descargamos páginas anteriores, paramos y guardamos lo que tenemos
      }
      if (!r.ok) {
        console.error(`[Strava Sync] Error HTTP ${r.status}:`, await r.text().catch(() => ''));
        if (page === 1) return res.status(400).json({ error: 'Error al obtener actividades de Strava' });
        break;
      }

      const pageActs = await r.json();

      if (!Array.isArray(pageActs) || pageActs.length === 0) {
        hasMore = false;
        break;
      }

      acts = acts.concat(pageActs);
      console.log(`[Strava Sync] Página ${page} completada: ${pageActs.length} actividades. Total acumulado: ${acts.length}`);

      if (pageActs.length < 200) {
        hasMore = false; // No hay más actividades
      } else {
        page++;
        // Pequeña pausa entre páginas para no saturar el rate limit de Strava (100 req/15 min)
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    if (page > MAX_PAGES) {
      console.warn(`[Strava Sync] ⚠️ Se alcanzó el límite de ${MAX_PAGES} páginas. Procesando las ${acts.length} actividades descargadas.`);
    }

    const ftp = Math.max(1, user.ftp || 200);

    // OBTENER DETALLE para actividades con potenciómetro pero sin NP en el resumen.
    // Strava a veces omite `weighted_average_watts` en la lista.
    // Limitamos a 15 peticiones de detalle para no agotar el rate limit (100 req / 15 min).
    let detailRequests = 0;
    const DETAIL_REQUEST_LIMIT = 15;

    // acts está ordenado de más antiguo a más reciente, pero para obtener detalle
    // priorizamos las más nuevas, que son las que el usuario mira primero.
    const actsToDetail = [...acts].reverse();

    for (const act of actsToDetail) {
      if (detailRequests >= DETAIL_REQUEST_LIMIT) break;

      // Condición: tiene potenciómetro, pero el NP no vino en el resumen de la lista.
      const needsDetail = act.device_watts && !act.weighted_average_watts;
      
      if (needsDetail) {
        try {
          const detRes = await fetch(`https://www.strava.com/api/v3/activities/${act.id}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (detRes.ok) {
            const detail = await detRes.json();
            Object.assign(act, detail); // Fusiona los datos completos
            detailRequests++;
            console.log(`[Strava Sync] ✨ Detalle obtenido para act ${act.id} (faltaba NP)`);
          }
        } catch (e) {
          console.error(`[Strava Sync] Error obteniendo detalle para ${act.id}:`, e.message);
        }
      }
    }

    // Mapear los gear_id de Strava (texto) a los id locales (UUID) para evitar errores en BD
    const { data: userBikes } = await supabase.from('bikes').select('id, strava_gear_id').eq('user_id', uid);
    const bikeMap = {};
    if (userBikes) {
      userBikes.forEach(b => {
        if (b.strava_gear_id) bikeMap[b.strava_gear_id] = b.id;
      });
    }

    // Ordenar todas las actividades de más antigua a más reciente (orden cronológico)
    acts.sort((a, b) => new Date(a.start_date_local || a.start_date) - new Date(b.start_date_local || b.start_date));

    const rowsToInsert = [];

    // LOG: tipos de actividad recibidos de Strava
    const typeCount = acts.reduce((acc, a) => {
      const t = a.sport_type || a.type || 'unknown';
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {});
    console.log(`[Strava Sync] ── Tipos de actividad recibidos de Strava (${acts.length} total):`, JSON.stringify(typeCount));

    for (const a of acts) {
      // 1. Filtrar primero: SOLO salidas ciclistas (Ride, VirtualRide, EBikeRide, GravelRide, MountainBikeRide)
      const typeStr = a.sport_type || a.type || '';
      const nameLower = (a.name || '').toLowerCase();

      const validCyclingTypes = ['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide', 'GravelRide'];
      let isRide = validCyclingTypes.includes(typeStr);

      // Detección opcional por nombre si Strava lo catalogó diferente (ej: Workout con "mtb" en el título)
      if (!isRide && (nameLower.includes('mtb') || nameLower.includes('gravel') || nameLower.includes('ciclismo'))) {
        isRide = true;
      }

      if (!isRide) {
        console.log(`[Strava Sync] ⚠️ DESCARTADA: "${a.name}" → tipo="${typeStr}" (no es ciclismo)`);
        continue;
      }
      
      const type = 'cycling';

      // Calcular TSS e Intensity Factor (IF) basándonos en la potencia normalizada
      const np = a.weighted_average_watts || 0;
      const duration = a.moving_time || a.elapsed_time || 0;
      let tss = 0, ifValue = 0;
      let finalNp = np;
      let finalAvgPower = a.average_watts || 0;
      
      if (np && duration && ftp > 0) {
        ifValue = Math.round((np / ftp) * 100) / 100;
        tss = Math.round((duration * np * ifValue) / (ftp * 3600) * 100);
      } else if (a.average_heartrate > 0 && duration > 0) {
        // Fallback hrTSS si no hay potenciómetro pero sí pulso
        const lthr = user.lthr || (user.max_hr ? Math.round(user.max_hr * 0.88) : 160);
        const hrIF = a.average_heartrate / lthr;
        ifValue = Math.round(hrIF * 100) / 100;
        tss = Math.round((duration * a.average_heartrate * hrIF) / (lthr * 3600) * 100);
        finalNp = Math.round(ifValue * ftp);
      } else if (duration > 0) {
        // Fallback básico: asume rodaje aeróbico si no hay pulso ni potencia
        ifValue = 0.65;
        tss = Math.round((duration * 0.65 * 0.65) / 3600 * 100);
        finalNp = Math.round(ifValue * ftp);
      }

      // Traducir el código de bici de Strava a nuestro UUID
      const localGearId = (a.gear_id && bikeMap[a.gear_id]) ? bikeMap[a.gear_id] : null;

rowsToInsert.push({
        id: `strava_${a.id}`,
        user_id: uid,
        name: String(a.name || 'Actividad Strava').substring(0, 250),
        type: String(type),
        date: String(a.start_date_local || a.start_date || new Date().toISOString()).substring(0, 10),
        duration:    Math.round(Number(duration) || 0),
        distance:    Math.round(Number(a.distance) || 0),
        elevation:   Math.round(Number(a.total_elevation_gain) || 0),
        avg_speed:   Math.round(Number(a.average_speed ? (a.average_speed * 3.6) : 0) * 10) / 10,
        avg_power:   Math.min(Math.round(Number(finalAvgPower) || 0), 2500),
        max_power:   Math.min(Math.round(Number(a.max_watts) || 0), 3500),
        np:          Math.min(Math.round(Number(finalNp) || 0), 2500),
        avg_hr:      Math.min(Math.round(Number(a.average_heartrate) || 0), 250),
        max_hr:      Math.min(Math.round(Number(a.max_heartrate) || 0), 250),
        avg_cadence: Math.round(Number(a.average_cadence) || 0),
        calories:    Math.round(Number(a.calories) || Number(a.kilojoules) || 0),
        tss:         Math.round(Number(tss) || 0),
        if_value:    Number(ifValue) || 0,
        strava_id: a.id ? String(a.id) : null,
        gear_id: localGearId,
        source: 'Strava'
      });
    }
    
    console.log(`[Strava Sync] ── Total Strava: ${acts.length} | Ciclistas filtradas: ${rowsToInsert.length} | user_id: ${uid}`);
    if (rowsToInsert.length > 0) {
      console.log('[Strava Sync] Primera fila a insertar:', JSON.stringify(rowsToInsert[0]).substring(0, 300));
      console.log('[Strava Sync] Última fila a insertar:', JSON.stringify(rowsToInsert[rowsToInsert.length - 1]).substring(0, 300));
    }

    // Guardar en base de datos en bloques de 100 para no bloquear la API
    let fallos = 0;
    for (let i = 0; i < rowsToInsert.length; i += 100) {
      const chunk = rowsToInsert.slice(i, i + 100);
      const { data: upsertData, error } = await supabase.from('activities').upsert(chunk, { onConflict: 'id' });
      if (error) {
        console.error(`[Strava Sync] ❌ Chunk[${i}-${i+chunk.length}] FALLÓ: code=${error.code} msg=${error.message} details=${error.details} hint=${error.hint}`);
        for (const row of chunk) {
          const { error: rowErr } = await supabase.from('activities').upsert(row, { onConflict: 'id' });
          if (rowErr) {
            console.error(`[Strava Sync] ❌ Fila rechazada (${row.id}): code=${rowErr.code} msg=${rowErr.message}`);
            fallos++;
          } else {
            console.log(`[Strava Sync] ✅ Fila OK en reintento: ${row.id}`);
          }
        }
      } else {
        console.log(`[Strava Sync] ✅ Chunk[${i}-${i+chunk.length}] guardado OK`);
      }
    }

    // Eliminar del DB actividades de Strava más antiguas que la ventana de 1 año
    const oneYearAgoDate = new Date(oneYearAgo * 1000).toISOString().substring(0, 10);
    const { error: delErr } = await supabase
      .from('activities')
      .delete()
      .eq('user_id', uid)
      .eq('source', 'Strava')
      .lt('date', oneYearAgoDate);
    if (delErr) console.warn('[Strava Sync] Error al limpiar actividades antiguas:', delErr.message);

    // Actualizar odómetro de cada bici con actividades sincronizadas
    // Se recalcula desde TODAS las actividades (idempotente: seguro en re-sync)
    const bikeIdsToUpdate = [...new Set(rowsToInsert.filter(r => r.gear_id).map(r => r.gear_id))];
    for (const bikeId of bikeIdsToUpdate) {
      try {
        const { data: bikeActs } = await supabase
          .from('activities')
          .select('distance, duration')
          .eq('user_id', uid)
          .eq('gear_id', bikeId);

        const totalDistM = (bikeActs || []).reduce((s, a) => s + (Number(a.distance) || 0), 0);
        const totalDurS  = (bikeActs || []).reduce((s, a) => s + (Number(a.duration) || 0), 0);
        const newKm  = Math.round(totalDistM / 1000 * 10) / 10;
        const newHrs = Math.round(totalDurS / 3600 * 10) / 10;

        const { data: bikeRow } = await supabase.from('bikes').select('total_km').eq('id', bikeId).single();
        const oldKm  = bikeRow?.total_km || 0;
        const deltaKm = Math.max(0, newKm - oldKm);

        await supabase.from('bikes').update({ total_km: newKm, total_hours: newHrs }).eq('id', bikeId);
        console.log(`[Strava Sync] 🚴 Odómetro bici ${bikeId}: ${oldKm}km → ${newKm}km (Δ${deltaKm.toFixed(1)}km)`);

        if (deltaKm > 0.01) {
          const { data: comps } = await supabase.from('bike_components')
            .select('id, km_remaining').eq('bike_id', bikeId).eq('is_active', true);
          for (const c of comps || []) {
            await supabase.from('bike_components').update({
              km_remaining: Math.max(0, (c.km_remaining || 0) - deltaKm),
            }).eq('id', c.id);
          }
        }
      } catch (err) {
        console.warn(`[Strava Sync] Error actualizando odómetro bici ${bikeId}:`, err.message);
      }
    }

    // Blindaje contra cuelgues del servidor en procesos asíncronos
    setImmediate(async () => {
      try {
        await recalculatePMC(uid);
      } catch (err) {
        console.error('⚠️ [Strava Sync] Error recalculando PMC en background:', err.message);
      }
      // Actualizar odómetro de todas las bicis desde Strava /gear/{id}
      // (fuente autoritativa: incluye km previos a VeloMind y actividades sin gear_id local)
      try {
        await syncBikeOdometersFromStrava(uid, token);
      } catch (err) {
        console.warn('⚠️ [Strava Sync] Error actualizando odómetros desde Strava:', err.message);
      }
    });

    const savedCount = rowsToInsert.length - fallos;
    console.log(`✅ SYNC COMPLETADO. Descargadas de Strava: ${acts.length} | Ciclistas filtradas: ${rowsToInsert.length} | Guardadas/actualizadas en BD: ${savedCount} | Fallos: ${fallos}`);
    res.json({
      message: 'Sync OK',
      downloaded: acts.length,
      cycling_filtered: rowsToInsert.length,
      synced: savedCount,
      saved: savedCount,
      failed: fallos
    });

  } catch (e) {
    console.error('\n❌ [Strava Sync] ERROR FATAL:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── STREAMS ────────────────────────────────────────────

router.get('/strava/streams/:activityId', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { activityId } = req.params;

  if (!activityId || !/^\d+$/.test(activityId)) {
    return res.status(400).json({ error: 'activityId inválido' });
  }

  const { data: user } = await supabase
    .from('users')
    .select('strava_token, strava_refresh, strava_expires_at')
    .eq('id', uid)
    .single();

  if (!user?.strava_token) {
    return res.status(400).json({ error: 'Strava no conectado' });
  }

  let token = user.strava_token;
  const isExpired = !user.strava_expires_at || (Date.now() / 1000 > user.strava_expires_at - 300);
  if (user.strava_refresh && isExpired) {
    try {
      const re = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: STRAVA_ID, client_secret: STRAVA_SECRET,
          grant_type: 'refresh_token', refresh_token: user.strava_refresh
        }),
      });
      const d = await re.json();
      if (re.ok && d.access_token) {
        token = d.access_token;
        await supabase.from('users').update({
          strava_token: d.access_token, strava_refresh: d.refresh_token,
          strava_expires_at: d.expires_at
        }).eq('id', uid);
      }
    } catch (e) {
      console.warn('[Streams] Error refrescando token Strava:', e.message);
    }
  }

  try {
    const keys = 'time,watts,heartrate,velocity_smooth,altitude,cadence,grade_smooth';
    const r = await fetch(
      `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=${keys}&key_by_type=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (r.status === 404) return res.status(404).json({ error: 'Actividad no encontrada en Strava' });
    if (r.status === 429) return res.status(429).json({ error: 'Límite de Strava alcanzado. Inténtalo en unos minutos.' });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(r.status).json({ error: err.message || 'Error al obtener streams de Strava' });
    }

    const raw = await r.json();

    // Extraer solo el array data de cada stream
    const streams = {};
    for (const [key, stream] of Object.entries(raw)) {
      if (stream?.data) streams[key] = stream.data;
    }

    res.json(streams);
  } catch (e) {
    console.error('[Streams] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── STATUS ─────────────────────────────────────────────

// ─── GARMIN CONNECT (OAuth2 PKCE + Activity API) ─────────────

router.get('/garmin/connect', requireAuth, (req, res) => {
  if (!GARMIN_ID || !GARMIN_SECRET) {
    return res.status(501).json({
      error: 'Garmin no configurado',
      detail: 'Necesitas credenciales aprobadas del Garmin Connect Developer Program.'
    });
  }

  const codeVerifier = randomPkceVerifier();
  const codeChallenge = sha256Base64Url(codeVerifier);
  const state = encodeState({ userId: req.user.id, verifier: codeVerifier, ts: Date.now() });
  const params = new URLSearchParams({
    client_id: GARMIN_ID,
    response_type: 'code',
    state,
    redirect_uri: GARMIN_RDR,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });

  res.json({ url: `${GARMIN_AUTH_URL}?${params.toString()}` });
});

async function exchangeGarminToken(params) {
  const body = new URLSearchParams({ client_id: GARMIN_ID, client_secret: GARMIN_SECRET, ...params });
  const r = await fetch(GARMIN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error_description || data.error || `Garmin token HTTP ${r.status}`);
  return data;
}

async function getGarminUserId(accessToken) {
  const r = await fetch(`${GARMIN_API_BASE}/user/id`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) return null;
  const data = await r.json().catch(() => ({}));
  return data.userId || null;
}

async function handleGarminCallback(req, res) {
  const { code, state, error } = req.method === 'POST' ? req.body : req.query;
  if (error) return res.redirect(`${FRONTEND_URL}/integrations.html?garmin=error&reason=${encodeURIComponent(error)}`);
  if (!code || !state) return res.status(400).json({ error: 'code y state requeridos' });

  const decoded = decodeState(state);
  if (!decoded?.userId || !decoded?.verifier) return res.status(400).json({ error: 'state Garmin invalido' });
  if (Date.now() - Number(decoded.ts || 0) > 15 * 60 * 1000) return res.status(400).json({ error: 'state Garmin caducado' });

  try {
    const token = await exchangeGarminToken({
      grant_type: 'authorization_code',
      code,
      code_verifier: decoded.verifier,
      redirect_uri: GARMIN_RDR
    });
    const expiresAt = Math.floor(Date.now() / 1000) + Number(token.expires_in || 86400);
    const refreshExpiresAt = token.refresh_token_expires_in
      ? Math.floor(Date.now() / 1000) + Number(token.refresh_token_expires_in)
      : null;
    const garminUserId = await getGarminUserId(token.access_token);
    const { error: dbError } = await supabase.from('users').update({
      garmin_token: token.access_token,
      garmin_refresh: token.refresh_token,
      garmin_expires_at: expiresAt,
      garmin_refresh_expires_at: refreshExpiresAt,
      garmin_user_id: garminUserId
    }).eq('id', decoded.userId);
    if (dbError) throw dbError;

    if (req.method === 'POST') return res.json({ message: 'Garmin conectado', userId: garminUserId });
    res.redirect(`${FRONTEND_URL}/integrations.html?garmin=connected`);
  } catch (e) {
    if (req.method === 'POST') return res.status(500).json({ error: e.message });
    res.redirect(`${FRONTEND_URL}/integrations.html?garmin=error&reason=${encodeURIComponent(e.message)}`);
  }
}

router.get('/garmin/callback', handleGarminCallback);
router.post('/garmin/callback', requireAuth, handleGarminCallback);

async function refreshGarminIfNeeded(user) {
  let token = user.garmin_token;
  const expiresAt = Number(user.garmin_expires_at || 0);
  if (expiresAt && Date.now() / 1000 <= expiresAt - 600) return token;
  if (!user.garmin_refresh) throw new Error('Garmin necesita reconexion: falta refresh token.');
  const data = await exchangeGarminToken({ grant_type: 'refresh_token', refresh_token: user.garmin_refresh });
  token = data.access_token;
  await supabase.from('users').update({
    garmin_token: data.access_token,
    garmin_refresh: data.refresh_token,
    garmin_expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 86400),
    garmin_refresh_expires_at: data.refresh_token_expires_in
      ? Math.floor(Date.now() / 1000) + Number(data.refresh_token_expires_in)
      : user.garmin_refresh_expires_at
  }).eq('id', user.id);
  return token;
}

function isGarminCycling(a) {
  const type = String(a.activityType || a.activityTypeName || a.activityName || '').toLowerCase();
  return ['cycling', 'biking', 'road_biking', 'mountain_biking', 'indoor_cycling', 'e_biking', 'gravel_cycling']
    .some(t => type.includes(t.replace(/_/g, '')) || type.includes(t));
}

function mapGarminActivity(a, uid, ftp) {
  const id = a.summaryId || a.activityId || a.startTimeInSeconds || a.startTimeOffsetInSeconds;
  const startSec = Number(a.startTimeInSeconds || a.startTimeOffsetInSeconds || 0);
  const duration = Math.round(Number(a.durationInSeconds || a.activeTimeInSeconds || a.elapsedDurationInSeconds || 0));
  const avgPower = Math.round(Number(a.averagePowerInWatts || a.avgPower || 0));
  const np = (a.normalizedPowerInWatts || a.normPower)
    ? Math.round(Number(a.normalizedPowerInWatts || a.normPower))
    : null;
  let ifValue = 0, tss = 0;
  if (np > 0 && duration > 0 && ftp > 0) {
    ifValue = Math.round((np / ftp) * 100) / 100;
    tss = Math.round((duration * np * ifValue) / (ftp * 3600) * 100);
  }
  return {
    id: `garmin_${id}`,
    user_id: uid,
    name: String(a.activityName || a.activityType || 'Actividad Garmin').substring(0, 250),
    type: 'cycling',
    date: startSec ? new Date(startSec * 1000).toISOString().substring(0, 10) : new Date().toISOString().substring(0, 10),
    duration,
    distance: Math.round(Number(a.distanceInMeters || a.distance || 0)),
    elevation: Math.round(Number(a.elevationGainInMeters || a.totalElevationGainInMeters || 0)),
    avg_speed: Math.round(Number(a.averageSpeedInMetersPerSecond || 0) * 36) / 10,
    max_speed: Math.round(Number(a.maxSpeedInMetersPerSecond || 0) * 36) / 10,
    avg_power: Math.min(avgPower, 2500),
    max_power: Math.min(Math.round(Number(a.maxPowerInWatts || 0)), 3500),
    np: np != null ? Math.min(np, 2500) : null,
    avg_hr: Math.min(Math.round(Number(a.averageHeartRateInBeatsPerMinute || a.averageHR || 0)), 250),
    max_hr: Math.min(Math.round(Number(a.maxHeartRateInBeatsPerMinute || a.maxHR || 0)), 250),
    avg_cadence: Math.round(Number(a.averageBikeCadenceInRoundsPerMinute || a.averageCadence || 0)),
    calories: Math.round(Number(a.activeKilocalories || a.calories || 0)),
    tss,
    if_value: ifValue,
    garmin_id: id ? String(id) : null,
    source: 'Garmin'
  };
}

router.post('/garmin/sync', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { data: user, error: userError } = await supabase.from('users').select('*').eq('id', uid).single();
  if (userError) return res.status(500).json({ error: userError.message });
  if (!user?.garmin_token) return res.status(400).json({ error: 'Garmin no conectado' });
  try {
    const token = await refreshGarminIfNeeded(user);
    const nowSec = Math.floor(Date.now() / 1000);
    const start = Math.floor(Number(req.body?.since || (nowSec - 30 * 86400)));
    const params = new URLSearchParams({
      uploadStartTimeInSeconds: String(start),
      uploadEndTimeInSeconds: String(nowSec)
    });
    const r = await fetch(`${GARMIN_API_BASE}/activities?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const raw = await r.text();
    if (r.status === 404 || r.status === 403) {
      return res.status(501).json({
        error: 'Activity API no disponible para esta app Garmin.',
        detail: 'Activa Activity API en el Developer Portal o solicita acceso/backfill a Garmin.'
      });
    }
    if (!r.ok) throw new Error(`Garmin activities HTTP ${r.status}: ${raw.substring(0, 200)}`);
    const acts = raw ? JSON.parse(raw) : [];
    const ftp = Math.max(1, user.ftp || 200);
    const rows = (Array.isArray(acts) ? acts : []).filter(isGarminCycling).map(a => mapGarminActivity(a, uid, ftp)).filter(a => a.garmin_id);
    let failed = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const { error } = await supabase.from('activities').upsert(chunk, { onConflict: 'id' });
      if (error) failed += chunk.length;
    }
    setImmediate(async () => {
      try { await recalculatePMC(uid); } catch (err) { console.error('[Garmin Sync] PMC:', err.message); }
    });
    res.json({ message: 'Garmin Sync OK', downloaded: Array.isArray(acts) ? acts.length : 0, cycling_filtered: rows.length, synced: rows.length - failed, failed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GARMIN WORKOUT PUSH ─────────────────────────────────────────────────────
// Uploads a TCX workout file to Garmin Connect so the device syncs it.
// Requires the user to have their Garmin account connected (OAuth).
// Falls back gracefully: on API-level errors the response includes a hint so
// the frontend can offer a manual download instead.
router.post('/garmin/push-workout', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { workoutName, tcxContent } = req.body || {};
  if (!workoutName || !tcxContent) {
    return res.status(400).json({ error: 'workoutName y tcxContent son requeridos' });
  }

  const { data: user, error: userErr } = await supabase.from('users').select('*').eq('id', uid).single();
  if (userErr || !user) return res.status(500).json({ error: 'Error al obtener usuario' });
  if (!user.garmin_token) {
    return res.status(400).json({ error: 'Garmin no conectado. Ve a Integraciones y conecta tu cuenta.' });
  }

  try {
    const token = await refreshGarminIfNeeded(user);
    const filename = workoutName.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 60) + '.tcx';

    const formData = new FormData();
    formData.append('file', new Blob([tcxContent], { type: 'application/octet-stream' }), filename);

    const uploadRes = await fetch('https://connectapi.garmin.com/upload-service/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'NK': 'NT'
      },
      body: formData
    });

    const rawText = await uploadRes.text();
    let uploadData;
    try { uploadData = JSON.parse(rawText); } catch { uploadData = { raw: rawText.slice(0, 300) }; }

    if (!uploadRes.ok) {
      return res.status(uploadRes.status).json({
        error: `Garmin upload HTTP ${uploadRes.status}`,
        detail: uploadData,
        hint: 'Descarga el archivo TCX e impórtalo manualmente en Garmin Connect > Entrenamientos.'
      });
    }

    res.json({ ok: true, message: 'Workout enviado a Garmin Connect. Sincroniza tu reloj para verlo.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GARMIN STRUCTURED WORKOUT PUSH (workout-service JSON API) ───────────────
// Crea un workout estructurado directamente en Garmin Connect vía la misma API
// que usan Intervals.icu / TrainingPeaks. El dispositivo lo recibe en la próxima
// sincronización Bluetooth/WiFi sin necesidad de copiar archivos por USB.
router.post('/garmin/push-structured-workout', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { name, steps } = req.body || {};
  if (!name || !Array.isArray(steps) || !steps.length) {
    return res.status(400).json({ error: 'name y steps son requeridos' });
  }

  const { data: user, error: userErr } = await supabase.from('users').select('*').eq('id', uid).single();
  if (userErr || !user) return res.status(500).json({ error: 'Error al obtener usuario' });
  if (!user.garmin_token) {
    return res.status(400).json({ error: 'no_garmin', message: 'Garmin no conectado. Ve a Integraciones.' });
  }

  // Convierte nuestro formato de pasos al JSON de Garmin Connect workout-service
  function toGarminWorkout(workoutName, rawSteps) {
    const stepTypeMap = {
      2: { stepTypeId: 1, stepTypeKey: 'warmup' },
      3: { stepTypeId: 2, stepTypeKey: 'cooldown' },
      1: { stepTypeId: 4, stepTypeKey: 'recovery' },
      0: { stepTypeId: 3, stepTypeKey: 'interval' },
    };
    const workoutSteps = rawSteps.map((s, i) => {
      const intensity = typeof s.intensity === 'number' ? s.intensity : 0;
      const stepType  = stepTypeMap[intensity] || stepTypeMap[0];
      const hasPow    = (s.lo > 0 || s.hi > 0);
      return {
        type:           'ExecutableStepDTO',
        stepOrder:      i + 1,
        stepType,
        endCondition:   s.open
          ? { conditionTypeId: 1, conditionTypeKey: 'lap.button' }
          : { conditionTypeId: 2, conditionTypeKey: 'time' },
        endConditionValue: s.open ? null : (s.sec || 0),
        targetType:     hasPow
          ? { workoutTargetTypeId: 2, workoutTargetTypeKey: 'power.zone' }
          : { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' },
        targetValueOne:  hasPow ? (s.lo || null) : null,
        targetValueTwo:  hasPow ? (s.hi || null) : null,
        zoneNumber:      null,
      };
    });
    return {
      sportType:    { sportTypeId: 2, sportTypeKey: 'cycling' },
      workoutName:  workoutName.slice(0, 100),
      description:  'Generado por VeloMind',
      workoutSegments: [{
        segmentOrder: 1,
        sportType:    { sportTypeId: 2, sportTypeKey: 'cycling' },
        workoutSteps,
      }],
    };
  }

  try {
    const token   = await refreshGarminIfNeeded(user);
    const payload = toGarminWorkout(name, steps);

    const gcRes = await fetch('https://connectapi.garmin.com/workout-service/workout', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
        'NK':            'NT',
      },
      body: JSON.stringify(payload),
    });

    const rawText = await gcRes.text();
    let gcData;
    try { gcData = JSON.parse(rawText); } catch { gcData = { raw: rawText.slice(0, 300) }; }

    if (!gcRes.ok) {
      return res.status(gcRes.status).json({
        error:  `Garmin workout-service HTTP ${gcRes.status}`,
        detail: gcData,
      });
    }

    res.json({ ok: true, workoutId: gcData?.workoutId || null,
      message: 'Workout creado en Garmin Connect. Sincroniza tu reloj para verlo en Entrenamientos.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/garmin/disconnect', requireAuth, async (req, res) => {
  try {
    const { data: user } = await supabase.from('users').select('garmin_token').eq('id', req.user.id).single();
    if (user?.garmin_token) {
      await fetch(`${GARMIN_API_BASE}/user/registration`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${user.garmin_token}` }
      }).catch(() => {});
    }
    await supabase.from('users').update({
      garmin_token: null,
      garmin_refresh: null,
      garmin_expires_at: null,
      garmin_refresh_expires_at: null,
      garmin_user_id: null
    }).eq('id', req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GARMIN WELLNESS SYNC ────────────────────────────────────────
router.post('/garmin/wellness-sync', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
  if (!user?.garmin_token) return res.status(400).json({ error: 'Garmin no conectado' });
  try {
    const token = await refreshGarminIfNeeded(user);
    const nowSec = Math.floor(Date.now() / 1000);
    const start = nowSec - 7 * 86400;
    const params = new URLSearchParams({
      uploadStartTimeInSeconds: String(start),
      uploadEndTimeInSeconds: String(nowSec)
    });
    const headers = { Authorization: `Bearer ${token}` };
    const [sleepRes, dailiesRes, hrvRes] = await Promise.all([
      fetch(`${GARMIN_API_BASE}/sleeps?${params}`, { headers }),
      fetch(`${GARMIN_API_BASE}/dailies?${params}`, { headers }),
      fetch(`${GARMIN_API_BASE}/hrv?${params}`, { headers })
    ]);
    const [sleepData, dailiesData, hrvData] = await Promise.all([
      sleepRes.ok ? sleepRes.json().catch(() => ({})) : {},
      dailiesRes.ok ? dailiesRes.json().catch(() => ({})) : {},
      hrvRes.ok ? hrvRes.json().catch(() => ({})) : {}
    ]);
    const byDate = {};
    for (const s of (sleepData.sleeps || [])) {
      if (!s.calendarDate) continue;
      const d = byDate[s.calendarDate] = byDate[s.calendarDate] || {};
      d.sleep_seconds = s.sleepTimeSeconds || null;
      d.sleep_score = s.overallSleepScore || null;
      d.deep_sleep_seconds = s.deepSleepDurationInSeconds || null;
      d.rem_sleep_seconds = s.remSleepInSeconds || null;
      d.spo2_avg = s.averageSpO2Value || null;
    }
    for (const d of (dailiesData.dailies || [])) {
      if (!d.calendarDate) continue;
      const r = byDate[d.calendarDate] = byDate[d.calendarDate] || {};
      r.resting_hr = d.restingHeartRateInBeatsPerMinute || null;
      r.stress_avg = d.averageStressLevel || null;
      r.body_battery_high = d.bodyBatteryHighestValue || null;
      r.body_battery_low = d.bodyBatteryLowestValue || null;
    }
    for (const h of (hrvData.hrv || [])) {
      if (!h.calendarDate) continue;
      const r = byDate[h.calendarDate] = byDate[h.calendarDate] || {};
      r.hrv_weekly_avg = h.weeklyAvg || null;
      r.hrv_last_night = h.lastNight || null;
    }
    const rows = Object.entries(byDate).map(([date, d]) => ({ user_id: uid, date, source: 'garmin', ...d }));
    if (rows.length) await supabase.from('wellness_log').upsert(rows, { onConflict: 'user_id,date,source' });
    res.json({ message: 'Wellness sync OK', days: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GOOGLE FIT (migración Fitbit → Google Health API) ───────────
const GFIT_ID     = process.env.GOOGLE_FIT_CLIENT_ID;
const GFIT_SECRET = process.env.GOOGLE_FIT_CLIENT_SECRET;
const GFIT_RDR    = process.env.GOOGLE_FIT_REDIRECT_URI || 'https://velomind-backend.onrender.com/api/providers/fitbit/callback';
const GFIT_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GFIT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GFIT_API_BASE  = 'https://www.googleapis.com/fitness/v1';

router.get('/fitbit/connect', requireAuth, (req, res) => {
  if (!GFIT_ID) return res.status(501).json({ error: 'Google Fit no configurado. Añade GOOGLE_FIT_CLIENT_ID y GOOGLE_FIT_CLIENT_SECRET en las variables de entorno del backend.' });
  const state = encodeState({ userId: req.user.id });
  const params = new URLSearchParams({
    client_id: GFIT_ID, response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/fitness.sleep.read',
      'https://www.googleapis.com/auth/fitness.heart_rate.read',
      'https://www.googleapis.com/auth/fitness.body.read'
    ].join(' '),
    redirect_uri: GFIT_RDR, state, access_type: 'offline', prompt: 'consent'
  });
  res.json({ url: `${GFIT_AUTH_URL}?${params}` });
});

router.get('/fitbit/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`${FRONTEND_URL}/integrations.html?fitbit=error&reason=${encodeURIComponent(error)}`);
  try {
    const decoded = decodeState(state);
    if (!decoded?.userId) return res.redirect(`${FRONTEND_URL}/integrations.html?fitbit=error&reason=invalid_state`);
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: GFIT_RDR,
      client_id: GFIT_ID, client_secret: GFIT_SECRET
    });
    const tokenRes = await fetch(GFIT_TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(token.error_description || token.error || 'Google Fit token error');
    await supabase.from('users').update({
      fitbit_token: token.access_token, fitbit_refresh: token.refresh_token,
      fitbit_expires_at: Math.floor(Date.now() / 1000) + Number(token.expires_in || 3600),
      fitbit_user_id: 'google'
    }).eq('id', decoded.userId);
    res.redirect(`${FRONTEND_URL}/integrations.html?fitbit=connected`);
  } catch (e) {
    res.redirect(`${FRONTEND_URL}/integrations.html?fitbit=error&reason=${encodeURIComponent(e.message)}`);
  }
});

async function refreshFitbitIfNeeded(user) {
  let token = user.fitbit_token;
  const expiresAt = Number(user.fitbit_expires_at || 0);
  if (expiresAt && Date.now() / 1000 <= expiresAt - 600) return token;
  if (!user.fitbit_refresh) throw new Error('Google Fit necesita reconexión: falta refresh token.');
  const body = new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: user.fitbit_refresh,
    client_id: GFIT_ID, client_secret: GFIT_SECRET
  });
  const r = await fetch(GFIT_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  const data = await r.json();
  token = data.access_token;
  await supabase.from('users').update({
    fitbit_token: data.access_token,
    fitbit_refresh: data.refresh_token || user.fitbit_refresh,
    fitbit_expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600)
  }).eq('id', user.id);
  return token;
}

router.post('/fitbit/wellness-sync', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
  if (!user?.fitbit_token) return res.status(400).json({ error: 'Google Fit no conectado' });
  try {
    const token = await refreshFitbitIfNeeded(user);
    const endMs = Date.now();
    const startMs = endMs - 7 * 86400000;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const [sleepRes, hrRes] = await Promise.all([
      fetch(`${GFIT_API_BASE}/users/me/dataset:aggregate`, {
        method: 'POST', headers,
        body: JSON.stringify({
          aggregateBy: [{ dataTypeName: 'com.google.sleep.segment' }],
          bucketByTime: { durationMillis: 86400000 },
          startTimeMillis: startMs, endTimeMillis: endMs
        })
      }),
      fetch(`${GFIT_API_BASE}/users/me/dataset:aggregate`, {
        method: 'POST', headers,
        body: JSON.stringify({
          aggregateBy: [{ dataTypeName: 'com.google.heart_rate.summary' }],
          bucketByTime: { durationMillis: 86400000 },
          startTimeMillis: startMs, endTimeMillis: endMs
        })
      })
    ]);
    const [sleepData, hrData] = await Promise.all([
      sleepRes.ok ? sleepRes.json().catch(() => ({})) : {},
      hrRes.ok ? hrRes.json().catch(() => ({})) : {}
    ]);

    // Sleep: stages 2=general 3=light 4=deep 5=REM
    const sleepByDate = {};
    for (const bucket of (sleepData.bucket || [])) {
      const date = new Date(parseInt(bucket.startTimeMillis)).toISOString().substring(0, 10);
      let totalMs = 0, deepMs = 0, remMs = 0;
      for (const ds of (bucket.dataset || [])) {
        for (const pt of (ds.point || [])) {
          const stage = pt.value?.[0]?.intVal;
          const dur = parseInt(pt.endTimeNanos) / 1e6 - parseInt(pt.startTimeNanos) / 1e6;
          if ([2,3,4,5].includes(stage)) totalMs += dur;
          if (stage === 4) deepMs += dur;
          if (stage === 5) remMs += dur;
        }
      }
      if (totalMs > 0) sleepByDate[date] = {
        sleep_seconds: Math.round(totalMs / 1000),
        deep_sleep_seconds: Math.round(deepMs / 1000),
        rem_sleep_seconds: Math.round(remMs / 1000)
      };
    }

    // HR: value[0]=min (proxy resting HR)
    const hrByDate = {};
    for (const bucket of (hrData.bucket || [])) {
      const date = new Date(parseInt(bucket.startTimeMillis)).toISOString().substring(0, 10);
      for (const ds of (bucket.dataset || [])) {
        for (const pt of (ds.point || [])) {
          const minHr = pt.value?.[0]?.fpVal;
          if (minHr && minHr > 30) hrByDate[date] = Math.round(minHr);
        }
      }
    }

    const rows = [];
    for (const date of new Set([...Object.keys(sleepByDate), ...Object.keys(hrByDate)])) {
      rows.push({ user_id: uid, date, source: 'fitbit', ...(sleepByDate[date] || {}), resting_hr: hrByDate[date] || null });
    }
    if (rows.length) await supabase.from('wellness_log').upsert(rows, { onConflict: 'user_id,date,source' });
    res.json({ message: 'Google Fit wellness sync OK', days: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/fitbit/disconnect', requireAuth, async (req, res) => {
  try {
    await supabase.from('users').update({
      fitbit_token: null, fitbit_refresh: null, fitbit_expires_at: null, fitbit_user_id: null
    }).eq('id', req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/status', requireAuth, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('strava_token, garmin_token, fitbit_token')
      .eq('id', req.user.id)
      .single();

    res.json({
      strava: { connected: !!user?.strava_token, configured: !!STRAVA_ID },
      garmin: { connected: !!user?.garmin_token, configured: !!GARMIN_ID },
      fitbit: { connected: !!user?.fitbit_token, configured: !!GFIT_ID }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/strava/debug-activities', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const { data: user } = await supabase
      .from('users')
      .select('strava_token')
      .eq('id', uid)
      .single();

    if (!user?.strava_token) {
      return res.status(400).json({ error: 'Strava no conectado' });
    }

    const r = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=10', {
      headers: { Authorization: `Bearer ${user.strava_token}` }
    });

    if (!r.ok) {
      return res.status(400).json({ error: 'Error al consultar Strava (HTTP ' + r.status + ')' });
    }

    const rawActs = await r.json();
    const formatted = rawActs.map(a => ({
      name: a.name,
      date: String(a.start_date_local || a.start_date).substring(0, 10),
      type: a.type,
      sport_type: a.sport_type,
      manual: a.manual,
      distance_km: Math.round((a.distance || 0) / 100) / 10
    }));

    res.json(formatted);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Actualiza total_km de todas las bicis con strava_gear_id usando /gear/{id} ─
// Se llama en background tras cada sync. Fuente autoritativa: incluye km históricos
// anteriores a VeloMind y actividades que no tienen gear_id local por haber sido
// sincronizadas antes de importar las bicis.
async function syncBikeOdometersFromStrava(uid, token) {
  const { data: bikes } = await supabase
    .from('bikes')
    .select('id, strava_gear_id, total_km')
    .eq('user_id', uid)
    .not('strava_gear_id', 'is', null);

  for (const bike of bikes || []) {
    try {
      const r = await fetch(`https://www.strava.com/api/v3/gear/${bike.strava_gear_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        console.warn(`[OdómetroSync] Strava /gear/${bike.strava_gear_id} → HTTP ${r.status}`);
        continue;
      }
      const gear   = await r.json();
      const newKm  = Math.round((gear.distance || 0) / 1000);
      const oldKm  = bike.total_km || 0;
      const deltaKm = Math.max(0, newKm - oldKm);

      await supabase.from('bikes').update({ total_km: newKm }).eq('id', bike.id);
      console.log(`[OdómetroSync] 🚴 ${gear.name || bike.strava_gear_id}: ${oldKm} → ${newKm} km`);

      if (deltaKm > 0.5) {
        const { data: comps } = await supabase
          .from('bike_components')
          .select('id, km_remaining')
          .eq('bike_id', bike.id)
          .eq('is_active', true);
        for (const c of comps || []) {
          await supabase.from('bike_components').update({
            km_remaining: Math.max(0, (c.km_remaining || 0) - deltaKm),
          }).eq('id', c.id);
        }
      }
    } catch (e) {
      console.warn(`[OdómetroSync] Error con gear ${bike.strava_gear_id}:`, e.message);
    }
  }
}

module.exports = router;
