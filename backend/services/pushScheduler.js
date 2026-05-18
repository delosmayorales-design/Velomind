const cron     = require('node-cron');
const webpush  = require('web-push');
const supabase = require('../db');
const { getTSBStatus } = require('../utils/training');

function realSub(sub) {
  // Extract only the WebPush fields (strip our custom notify_types field)
  return { endpoint: sub.subscription.endpoint, keys: sub.subscription.keys, expirationTime: sub.subscription.expirationTime ?? null };
}

function notifAllowed(sub, type) {
  const nt = sub.subscription?.notify_types;
  if (!nt) return true; // legacy subscriptions: allow all
  return nt[type] !== false;
}

// Convert a fixed local hour to UTC minutes using the stored browser timezone offset
// offset = getTimezoneOffset() → negative for UTC+X zones (e.g. Spain UTC+2 = -120)
function localHourUtcMin(sub, localHour) {
  const off = sub.subscription?.timezone_offset ?? 0;
  return ((localHour * 60 + off) % 1440 + 1440) % 1440;
}

async function pushTo(sub, payload, expiredSet) {
  try {
    await webpush.sendNotification(realSub(sub), JSON.stringify(payload));
  } catch (e) {
    if (e.statusCode === 410) expiredSet.add(sub.user_id);
    else console.error('[push]', payload.tag, e.message);
  }
}

async function sendReminders() {
  const now        = new Date();
  const currentMin = now.getHours() * 60 + now.getMinutes();
  const todayStr   = now.toISOString().split('T')[0];

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('active', true);

  if (error || !subs?.length) return;

  const expired = new Set();

  for (const sub of subs) {
    const uid = sub.user_id;

    // ── Agua ────────────────────────────────────────────────
    if (notifAllowed(sub, 'water')) {
      for (const mins of (sub.water_times || [])) {
        if (mins !== currentMin) continue;
        await pushTo(sub, {
          title: '💧 Hora de hidratarte',
          body:  'Bebe un vaso de agua ahora para mantener un buen rendimiento.',
          tag:   `agua-${mins}`, url: './nutrition.html'
        }, expired);
      }
    }

    // ── Comidas ─────────────────────────────────────────────
    if (notifAllowed(sub, 'meals')) {
      for (const meal of (sub.meal_times || [])) {
        if (meal.hour * 60 + meal.minute !== currentMin) continue;
        await pushTo(sub, {
          title: meal.title, body: meal.body,
          tag:   `comida-${currentMin}`, url: './nutrition.html'
        }, expired);
      }
    }

    // ── Recordatorio entreno mañana (21:00 hora local) ──────
    const trainUtc = localHourUtcMin(sub, 21);
    if (currentMin === trainUtc && notifAllowed(sub, 'training')) {
      try {
        const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];
        const { data: plan } = await supabase
          .from('training_plans').select('sessions')
          .eq('user_id', uid).order('updated_at', { ascending: false }).limit(1).maybeSingle();
        if (plan?.sessions) {
          const tomorrowDow = (tomorrow.getDay() + 6) % 7; // lun=0
          const sess = plan.sessions[tomorrowDow];
          if (sess && !sess.isRest) {
            await pushTo(sub, {
              title: '🚴 Entreno mañana',
              body:  `${sess.name || 'Sesión de entrenamiento'} · ${sess.durationMin || '?'} min. Prepara todo esta noche.`,
              tag:   `entreno-manana-${tomorrowStr}`, url: './dashboard.html'
            }, expired);
          }
        }
      } catch {}
    }

    // ── Alerta TSB crítico (09:00 hora local) ───────────────
    const fatigUtc = localHourUtcMin(sub, 9);
    if (currentMin === fatigUtc && notifAllowed(sub, 'fatigue')) {
      try {
        const { data: pmcRow } = await supabase
          .from('pmc').select('tsb, ctl')
          .eq('user_id', uid).order('date', { ascending: false }).limit(1).maybeSingle();
        if (pmcRow) {
          const status = getTSBStatus(pmcRow.tsb);
          if (status.risk === 'alto' || status.risk === 'muy alto') {
            await pushTo(sub, {
              title: `🔴 Señal de fatiga — TSB ${pmcRow.tsb > 0 ? '+' : ''}${Math.round(pmcRow.tsb)}`,
              body:  status.advice,
              tag:   `tsb-alerta-${todayStr}`, url: './dashboard.html'
            }, expired);
          }
        }
      } catch {}
    }

    // ── Racha de sesiones perdidas (20:00 hora local) ───────
    const streakUtc = localHourUtcMin(sub, 20);
    if (currentMin === streakUtc && notifAllowed(sub, 'streak')) {
      try {
        const cutoff = new Date(now); cutoff.setDate(now.getDate() - 4);
        const cutoffStr = cutoff.toISOString().split('T')[0];
        const { data: recentActs } = await supabase
          .from('activities').select('date').eq('user_id', uid).gte('date', cutoffStr);
        const { data: plan } = await supabase
          .from('training_plans').select('sessions')
          .eq('user_id', uid).order('updated_at', { ascending: false }).limit(1).maybeSingle();
        if (plan?.sessions && (!recentActs || recentActs.length === 0)) {
          const plannedThisWeek = plan.sessions.filter(s => !s.isRest).length;
          if (plannedThisWeek >= 3) {
            await pushTo(sub, {
              title: '📉 Llevas varios días sin entrenar',
              body:  'Retoma el plan aunque sea con una sesión corta. Mantener el hábito es lo más importante.',
              tag:   `racha-perdida-${todayStr}`, url: './dashboard.html'
            }, expired);
          }
        }
      } catch {}
    }
  }

  // Limpiar suscripciones caducadas
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
    `mailto:${process.env.VAPID_EMAIL || 'info@velomind.org'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  cron.schedule('* * * * *', () => {
    sendReminders().catch(e => console.error('[pushScheduler]', e.message));
  });

  console.log('🔔 Push scheduler iniciado (cada minuto)');
}

module.exports = { start };
