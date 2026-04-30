const express = require('express');
const supabase = require('../db');
const { requireAuth } = require('../middleware/auth');
const { recalculatePMC } = require('../services/pmc');

const router  = express.Router();

// ─── CONFIG ─────────────────────────────────────────────

const STRAVA_ID     = process.env.STRAVA_CLIENT_ID;
const STRAVA_SECRET = process.env.STRAVA_CLIENT_SECRET;

// ✅ REDIRECT CORRECTO (NUNCA localhost)
const STRAVA_RDR = process.env.STRAVA_REDIRECT_URI 
  || 'https://velomind-backend.onrender.com/api/providers/strava/callback';

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
      const np = a.weighted_average_watts || a.average_watts || 0;
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

// ─── STATUS ─────────────────────────────────────────────

router.get('/status', requireAuth, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('strava_token')
      .eq('id', req.user.id)
      .single();

    res.json({
      strava: { connected: !!user?.strava_token, configured: !!STRAVA_ID },
      garmin: { connected: false, configured: false }
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

module.exports = router;