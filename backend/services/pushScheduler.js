const cron     = require('node-cron');
const webpush  = require('web-push');
const supabase = require('../db');

async function sendReminders() {
  const now = new Date();
  const currentMin = now.getHours() * 60 + now.getMinutes();

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('active', true);

  if (error || !subs?.length) return;

  const expired = new Set();

  for (const sub of subs) {
    // Agua
    for (const mins of (sub.water_times || [])) {
      if (mins !== currentMin) continue;
      const hh = String(Math.floor(mins / 60)).padStart(2, '0');
      const mm = String(mins % 60).padStart(2, '0');
      try {
        await webpush.sendNotification(sub.subscription, JSON.stringify({
          title: '💧 Hora de hidratarte',
          body:  `Bebe un vaso de agua ahora — ${hh}:${mm}`,
          tag:   `agua-${mins}`,
          url:   './nutrition.html'
        }));
      } catch (e) {
        if (e.statusCode === 410) expired.add(sub.user_id);
        else console.error('[push] agua:', e.message);
      }
    }

    // Comidas
    for (const meal of (sub.meal_times || [])) {
      if (meal.hour * 60 + meal.minute !== currentMin) continue;
      try {
        await webpush.sendNotification(sub.subscription, JSON.stringify({
          title: meal.title,
          body:  meal.body,
          tag:   `comida-${currentMin}`,
          url:   './nutrition.html'
        }));
      } catch (e) {
        if (e.statusCode === 410) expired.add(sub.user_id);
        else console.error('[push] comida:', e.message);
      }
    }
  }

  // Limpiar suscripciones caducadas (HTTP 410 = el navegador ya no las acepta)
  for (const uid of expired) {
    await supabase.from('push_subscriptions').update({ active: false }).eq('user_id', uid);
  }
}

function start() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('⚠️  VAPID keys no configuradas — push reminders desactivados');
    return;
  }

  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || 'admin@velomind.app'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  cron.schedule('* * * * *', () => {
    sendReminders().catch(e => console.error('[pushScheduler]', e.message));
  });

  console.log('🔔 Push scheduler iniciado (cada minuto)');
}

module.exports = { start };
