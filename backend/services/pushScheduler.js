const cron     = require('node-cron');
const webpush  = require('web-push');
const sgMail   = require('@sendgrid/mail');
const supabase = require('../db');
const { getTSBStatus } = require('../utils/training');

if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// ── Constantes de mantenimiento ──────────────────────────────────
const MAINT_KM_LIFE = { chain:3000, cassette:9000, chainring:15000, jockey_wheels:15000, brakes_pad:3000, brake_rotor:10000, tire_front:5000, tire_rear:4000 };
const MAINT_HR_LIFE = { fork:200, shock:100 };
const MAINT_HOUR_TYPES = new Set(['fork','shock']);
const MAINT_DATE_TYPES = new Set(['brake_fluid','tubeless_sealant']);
const MAINT_LABELS = {
  chain:'Cadena', cassette:'Cassette', chainring:'Platos', jockey_wheels:'Roldanas',
  brakes_pad:'Pastillas', brake_rotor:'Disco', tire_front:'Cubierta Del.', tire_rear:'Cubierta Tras.',
  fork:'Horquilla', shock:'Amortiguador', brake_fluid:'Líquido de Frenos', tubeless_sealant:'Sellante Tubeless',
};

function seasonalDaysTubeless(bikeType) {
  const m = new Date().getMonth();
  const season = m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : m === 11 || m <= 1 ? 'winter' : 'spring';
  const TBL = {
    summer:  { gravel:60,  mtb_hardtail:45,  mtb_full:45  },
    autumn:  { gravel:90,  mtb_hardtail:75,  mtb_full:75  },
    winter:  { gravel:150, mtb_hardtail:120, mtb_full:120 },
    spring:  { gravel:90,  mtb_hardtail:75,  mtb_full:75  },
  };
  return TBL[season]?.[bikeType] || 90;
}

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

async function sendReminders({ force = false } = {}) {
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

    // ── Alerta mantenimiento garaje (09:00 hora local, una sola vez por umbral) ──
    const maintUtc = localHourUtcMin(sub, 9);
    if ((force || currentMin === maintUtc) && notifAllowed(sub, 'maintenance')) {
      try {
        const { data: userRow } = await supabase
          .from('users').select('email, name').eq('id', uid).single();
        const userEmail = userRow?.email;

        const { data: bikes } = await supabase
          .from('bikes').select('id, name, type, total_km, total_hours')
          .eq('user_id', uid).eq('is_active', true);

        const emailAlerts = []; // acumula alertas de todas las bicis para el email resumen

        for (const bike of bikes || []) {
          const { data: comps } = await supabase
            .from('bike_components').select('*')
            .eq('bike_id', bike.id).eq('is_active', true);

          const newRed    = [];
          const newYellow = [];
          const markRed   = [];
          const markYellow= [];

          for (const c of comps || []) {
            let pct = 0;
            const label = MAINT_LABELS[c.component_type] || c.component_type;

            // Posposición manual ("el mecánico dice que aguanta más") — no notificar
            // hasta que se supere el km/hora objetivo que eligió el usuario.
            if (c.snooze_until_km != null) {
              const currentKm = Math.max(0, (bike.total_km || 0) - (c.km_installed || 0));
              if (currentKm < c.snooze_until_km) continue;
            } else if (c.snooze_until_hours != null) {
              const currentHours = Math.max(0, (bike.total_hours || 0) - (c.hours_installed || 0));
              if (currentHours < c.snooze_until_hours) continue;
            }

            if (MAINT_DATE_TYPES.has(c.component_type)) {
              const days = Math.floor((Date.now() - new Date(c.created_at)) / 86400000);
              const threshold = c.component_type === 'tubeless_sealant'
                ? seasonalDaysTubeless(bike.type) : 365;
              pct = Math.min(Math.round((days / threshold) * 100), 110);
            } else if (MAINT_HOUR_TYPES.has(c.component_type)) {
              const lifespan = MAINT_HR_LIFE[c.component_type];
              if (!lifespan) continue;
              const current_hours = Math.max(0, (bike.total_hours || 0) - (c.hours_installed || 0));
              pct = Math.min(Math.round((current_hours / lifespan) * 100), 110);
            } else {
              const lifespan = MAINT_KM_LIFE[c.component_type];
              if (!lifespan) continue;
              const current_km = Math.max(0, (bike.total_km || 0) - (c.km_installed || 0));
              pct = Math.min(Math.round((current_km / lifespan) * 100), 110);
            }

            if (pct >= 100 && !c.notified_red) {
              newRed.push({ label, pct });
              markRed.push(c.id);
            } else if (pct >= 70 && !c.notified_yellow) {
              newYellow.push({ label, pct });
              markYellow.push(c.id);
            }
          }

          if (markRed.length)
            await supabase.from('bike_components').update({ notified_red: true }).in('id', markRed);
          if (markYellow.length)
            await supabase.from('bike_components').update({ notified_yellow: true }).in('id', markYellow);

          const allNew = [...newRed, ...newYellow];
          if (!allNew.length) continue;

          allNew.sort((a, b) => b.pct - a.pct);
          const hasUrgent = newRed.length > 0;
          const pushBody = allNew.slice(0, 3).map(a => `${a.label} ${a.pct}%`).join(' · ');

          await pushTo(sub, {
            title: hasUrgent
              ? `🔴 Mantenimiento urgente — ${bike.name}`
              : `🔧 Revisa tu ${bike.name}`,
            body: pushBody,
            tag: `mantenimiento-${bike.id}`,
            url: './garaje.html',
          }, expired);

          if (userEmail) emailAlerts.push({ bike: bike.name, items: allNew, hasUrgent });
        }

        // Enviar email resumen si hay alertas y SendGrid está configurado
        if (emailAlerts.length && userEmail && process.env.SENDGRID_API_KEY) {
          const hasAnyUrgent = emailAlerts.some(a => a.hasUrgent);
          const rows = emailAlerts.map(a => {
            const items = a.items.map(i =>
              `<tr><td style="padding:6px 12px;border-bottom:1px solid #2a2a2a">${i.label}</td>` +
              `<td style="padding:6px 12px;border-bottom:1px solid #2a2a2a;text-align:right;font-weight:700;color:${i.pct>=100?'#ef4444':'#f59e0b'}">${i.pct}%</td></tr>`
            ).join('');
            return `<p style="margin:12px 0 4px;font-weight:700;color:#9ed62b">${a.bike}</p>
              <table width="100%" style="border-collapse:collapse;background:#1a1a1a;border-radius:8px;overflow:hidden">${items}</table>`;
          }).join('');

          await sgMail.send({
            from: { name: 'VeloMind', email: process.env.SENDGRID_FROM_EMAIL || 'info@velomind.org' },
            to: userEmail,
            subject: hasAnyUrgent
              ? '🔴 Mantenimiento urgente en tu garaje — VeloMind'
              : '🔧 Componentes con desgaste elevado — VeloMind',
            html: `<div style="background:#111;color:#eee;font-family:sans-serif;padding:24px;max-width:520px;margin:0 auto;border-radius:12px">
              <h2 style="color:#9ed62b;margin:0 0 8px">🔧 Alerta de mantenimiento</h2>
              <p style="color:#aaa;margin:0 0 20px;font-size:14px">
                ${hasAnyUrgent ? 'Hay componentes que necesitan cambio inmediato.' : 'Hay componentes con desgaste elevado que conviene revisar pronto.'}
              </p>
              ${rows}
              <div style="margin-top:24px;text-align:center">
                <a href="https://www.velomind.org/garaje.html" style="background:#9ed62b;color:#111;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Abrir Garaje</a>
              </div>
              <p style="color:#555;font-size:11px;margin-top:20px;text-align:center">VeloMind · <a href="https://www.velomind.org" style="color:#555">velomind.org</a></p>
            </div>`,
          }).catch(e => console.error('[email] maintenance', e.message));
        }
      } catch(e) { console.error('[push] maintenance', e.message); }
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

module.exports = { start, sendReminders };
