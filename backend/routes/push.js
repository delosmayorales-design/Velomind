const express  = require('express');
const webpush  = require('web-push');
const supabase = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || 'admin@velomind.app'}`,
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

// Guardar suscripción + horarios
router.post('/subscribe', requireAuth, async (req, res) => {
  try {
    const { subscription, waterTimes, mealTimes } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ error: 'Suscripción inválida' });

    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: String(req.user.id),
      subscription,
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

    await webpush.sendNotification(data.subscription, JSON.stringify({
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

module.exports = router;
