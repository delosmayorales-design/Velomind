const express  = require('express');
const webpush  = require('web-push');
const supabase = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || 'info@velomind.org'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// Clave pública para el frontend
router.get('/vapid-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: 'Push no configurado' });
  res.json({ publicKey: key });
});

// Guardar suscripción + horarios + preferencias por tipo
router.post('/subscribe', requireAuth, async (req, res) => {
  try {
    const { subscription, waterTimes, mealTimes, notifyTypes } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ error: 'Suscripción inválida' });

    // Embed notifyTypes inside the subscription JSONB so no schema change is needed
    const subWithPrefs = {
      endpoint: subscription.endpoint,
      keys:     subscription.keys,
      expirationTime: subscription.expirationTime ?? null,
      timezone_offset: typeof req.body.timezoneOffset === 'number' ? req.body.timezoneOffset : 0,
      notify_types: {
        training: notifyTypes?.training !== false,
        fatigue:  notifyTypes?.fatigue  !== false,
        streak:   notifyTypes?.streak   !== false,
        water:    notifyTypes?.water    !== false,
        meals:    notifyTypes?.meals    !== false,
      }
    };

    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: String(req.user.id),
      subscription: subWithPrefs,
      water_times: waterTimes || [],
      meal_times:  mealTimes  || [],
      active: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error('[push/subscribe]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Desactivar suscripción
router.delete('/subscribe', requireAuth, async (req, res) => {
  try {
    await supabase.from('push_subscriptions')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('user_id', String(req.user.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Notificación de prueba
router.post('/test', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('push_subscriptions')
      .select('subscription')
      .eq('user_id', String(req.user.id))
      .eq('active', true)
      .single();

    if (!data) return res.status(404).json({ error: 'Sin suscripción activa' });

    const realSub = { endpoint: data.subscription.endpoint, keys: data.subscription.keys, expirationTime: data.subscription.expirationTime ?? null };
    await webpush.sendNotification(realSub, JSON.stringify({
      title: '🚴 VeloMind',
      body:  'Notificaciones en segundo plano funcionando ✅',
      tag:   'test'
    }));
    res.json({ ok: true });
  } catch (e) {
    console.error('[push/test]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Resetea los flags de notificación de mantenimiento para re-enviar alertas
router.post('/reset-maintenance-flags', requireAuth, async (req, res) => {
  try {
    const uid = String(req.user.id);
    const { data: bikes } = await supabase.from('bikes').select('id').eq('user_id', uid).eq('is_active', true);
    const bikeIds = (bikes || []).map(b => b.id);
    if (bikeIds.length) {
      await supabase.from('bike_components')
        .update({ notified_yellow: false, notified_red: false })
        .in('bike_id', bikeIds);
    }
    res.json({ ok: true, bikes: bikeIds.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint para cron externo (cron-job.org) — despierta Render y dispara notificaciones
// Protegido por CRON_SECRET para evitar llamadas no autorizadas
router.post('/cron', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers['x-cron-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const scheduler = require('../services/pushScheduler');
    await scheduler.sendReminders();
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (e) {
    console.error('[push/cron]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
