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
    const r = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=50&_t=${Date.now()}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!r.ok) {
      return res.status(400).json({ error: 'Error al obtener actividades' });
    }

    const acts = await r.json();
    const ftp = Math.max(1, user.ftp || 200);

    for (const a of acts) {
      // Calcular TSS e Intensity Factor (IF) basándonos en la potencia normalizada
      const np = a.weighted_average_watts || a.average_watts || 0;
      const duration = a.moving_time || 0;
      let tss = 0, ifValue = 0;
      
      if (np && duration && ftp > 0) {
        ifValue = Math.round((np / ftp) * 100) / 100;
        tss = Math.round((duration * np * ifValue) / (ftp * 3600) * 100);
      } else if (a.average_heartrate > 0 && duration > 0) {
        // Fallback hrTSS si no hay potenciómetro pero sí pulso
        const lthr = user.lthr || (user.max_hr ? Math.round(user.max_hr * 0.88) : 160);
        const hrIF = a.average_heartrate / lthr;
        ifValue = Math.round(hrIF * 100) / 100;
        tss = Math.round((duration * a.average_heartrate * hrIF) / (lthr * 3600) * 100);
      } else if (duration > 0) {
        // Fallback básico: asume rodaje aeróbico si no hay pulso ni potencia
        ifValue = 0.65;
        tss = Math.round((duration * 0.65 * 0.65) / 3600 * 100);
      }

      const { error } = await supabase.from('activities').upsert({
        id: `strava_${a.id}`,
        user_id: uid,
        name: a.name,
        type: (a.sport_type || a.type || '').includes('Run') ? 'running' : 'cycling',
        date: (a.start_date_local || a.start_date).substring(0, 10),
        duration: duration,
        distance: a.distance || 0,
        elevation: a.total_elevation_gain || 0,
        avg_speed: a.average_speed ? (a.average_speed * 3.6) : 0, // Strava usa m/s, convertimos a km/h
        avg_power: a.average_watts || 0,
        max_power: a.max_watts || 0,
        np: np,
        avg_hr: a.average_heartrate || 0,
        max_hr: a.max_heartrate || 0,
        avg_cadence: a.average_cadence || 0,
        calories: a.kilojoules || a.calories || 0,
        tss: tss,
        if_value: ifValue,
        strava_id: String(a.id),
        gear_id: a.gear_id || null,
        source: 'Strava'
      }, { onConflict: 'id' });

      if (error) {
        console.error('[Strava Sync] Error en upsert de actividad', a.id, error.message);
      }
    }

    setImmediate(() => recalculatePMC(uid));

    res.json({ message: 'Sync OK', synced: acts.length, total: acts.length });

  } catch (e) {
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

module.exports = router;