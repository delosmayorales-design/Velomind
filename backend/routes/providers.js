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

  try {
    const r = await fetch(
      'https://www.strava.com/api/v3/athlete/activities?per_page=50',
      { headers: { Authorization: `Bearer ${user.strava_token}` } }
    );

    if (!r.ok) {
      return res.status(400).json({ error: 'Error al obtener actividades' });
    }

    const acts = await r.json();

    for (const a of acts) {
      await supabase.from('activities').upsert({
        id: `strava_${a.id}`,
        user_id: uid,
        name: a.name,
        date: a.start_date.substring(0, 10),
        duration: a.moving_time,
        distance: a.distance,
        source: 'Strava'
      });
    }

    setImmediate(() => recalculatePMC(uid));

    res.json({ message: 'Sync OK', total: acts.length });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;