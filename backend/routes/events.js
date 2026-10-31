// Tracking de uso de la app (páginas vistas, llamadas a IA) para el panel de admin.
// Fire-and-forget: un fallo aquí nunca debe romper nada para el usuario.
const express = require('express');
const supabase = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

const PAGE_RE = /^[a-z0-9-]{1,40}$/;
const isDemo = (email) => /^demo_\d+@cyclocoach\.local$/.test(email || '');

// Evita inflar las métricas con recargas: misma página del mismo usuario cuenta 1 vez por minuto
const DEDUPE_MS = 60 * 1000;
const _recent = new Map();
setInterval(() => {
  const now = Date.now();
  _recent.forEach((t, k) => { if (now - t > DEDUPE_MS) _recent.delete(k); });
}, 5 * 60 * 1000).unref();

async function logEvent(user, event, page, platform = 'web') {
  if (!user?.id || isDemo(user.email)) return;
  const key = `${user.id}|${event}|${page}`;
  const now = Date.now();
  if (_recent.has(key) && now - _recent.get(key) < DEDUPE_MS) return;
  _recent.set(key, now);

  const nowIso = new Date(now).toISOString();
  const [{ error: evErr }, { error: seenErr }] = await Promise.all([
    supabase.from('app_events').insert({ user_id: user.id, event, page, platform }),
    supabase.from('users').update({ last_seen_at: nowIso }).eq('id', user.id),
  ]);
  // Si la migración add_usage_tracking.sql aún no se ha ejecutado, avisamos una sola vez
  if ((evErr || seenErr) && !logEvent._warned) {
    logEvent._warned = true;
    console.warn('[events] No se pudo guardar el evento (¿falta ejecutar migrations/add_usage_tracking.sql?):', (evErr || seenErr).message);
  }
}

router.post('/', requireAuth, async (req, res) => {
  const { event = 'page_view', page, platform } = req.body || {};
  if (event !== 'page_view' || !PAGE_RE.test(page || '')) {
    return res.status(400).json({ error: 'Evento no válido' });
  }
  res.status(204).end();
  logEvent(req.user, 'page_view', page, platform === 'android' ? 'android' : 'web')
    .catch(e => console.warn('[events]', e.message));
});

// Middleware para registrar en servidor las llamadas a un grupo de rutas (p. ej. IA del coach).
// req.user lo rellena requireAuth dentro del router, así que se lee al terminar la respuesta.
function trackApiCalls(event, prefix) {
  return (req, res, next) => {
    if (req.method === 'POST') {
      res.on('finish', () => {
        if (!req.user || res.statusCode >= 400) return;
        const page = `${prefix}${req.path}`.replace(/\/+$/, '').slice(0, 60);
        logEvent(req.user, event, page).catch(() => {});
      });
    }
    next();
  };
}

module.exports = router;
module.exports.logEvent = logEvent;
module.exports.trackApiCalls = trackApiCalls;
