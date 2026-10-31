// Panel de administración: métricas de uso y salud de la app (solo ADMIN_EMAIL).
// Todo se calcula aquí a partir de Supabase; el frontend (admin.html) solo pinta.
const express = require('express');
const supabase = require('../db');
const { requireAuth, requireAdmin, isAdminEmail } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth, requireAdmin);

const DAY = 24 * 60 * 60 * 1000;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const isDemo = (email) => /^demo_\d+@cyclocoach\.local$/.test(email || '');
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

// Semáforo: green / amber / red según umbrales (higherIsBetter=false invierte la escala)
function health(v, good, warn, higherIsBetter = true) {
  if (v == null) return 'none';
  if (higherIsBetter) return v >= good ? 'green' : v >= warn ? 'amber' : 'red';
  return v <= good ? 'green' : v <= warn ? 'amber' : 'red';
}

// Lunes (UTC) de la semana de t, como YYYY-MM-DD
function weekKey(t) {
  const d = new Date(dayKey(t));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return dayKey(d);
}

// Supabase devuelve como mucho 1000 filas por petición: paginamos
async function fetchAll(table, cols, apply = (q) => q, orderCol = 'id') {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await apply(supabase.from(table).select(cols))
      .order(orderCol, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

// Usuarios distintos de una tabla de "función"; null si la tabla no existe
async function distinctUsers(table, col = 'user_id') {
  try {
    const rows = await fetchAll(table, col, (q) => q, col);
    return new Set(rows.map((r) => String(r[col])));
  } catch (e) {
    console.warn(`[admin] ${table}:`, e.message);
    return null;
  }
}

const SEGMENTS = {
  diario:     { label: 'Muy activos',  desc: '4+ días de entreno/semana', color: 'green' },
  regular:    { label: 'Regulares',    desc: '2-3 días/semana',           color: 'green' },
  esporadico: { label: 'Esporádicos',  desc: '1-5 días en 28 días',       color: 'amber' },
  solo_app:   { label: 'Solo app',     desc: 'Abren la app pero no registran entrenos', color: 'amber' },
  nuevo:      { label: 'Nuevos',       desc: 'Registrados hace ≤7 días, sin entrenos aún', color: 'blue' },
  dormido:    { label: 'Dormidos',     desc: 'Entrenaban, pero nada en 28 días', color: 'red' },
  sin_uso:    { label: 'Sin uso',      desc: 'Se registraron y nunca la usaron', color: 'red' },
};

const PAGE_LABELS = {
  dashboard: 'Inicio', activities: 'Actividades', analytics: 'Métricas', 'training-plan': 'Entrenamiento',
  nutrition: 'Nutrición', 'body-weight': 'Peso', rutas: 'Rutas', 'salidas-grupales': 'Salidas grupales',
  biomechanics: 'Biomecánica', garaje: 'Garaje', integrations: 'Integraciones', index: 'Perfil',
  notificaciones: 'Notificaciones', feedback: 'Feedback', soporte: 'Soporte', pricing: 'Precios',
};

router.get('/overview', async (req, res) => {
  try {
    res.json(await buildOverview(req.user));
  } catch (e) {
    console.error('[admin/overview]', e.message);
    res.status(500).json({ error: 'Error calculando métricas: ' + e.message });
  }
});

// Calcula todas las métricas del panel. También lo usan los avisos para resolver segmentos.
async function buildOverview(viewer) {
  {
    const now = Date.now();
    const today = dayKey(now);
    const since = (days) => dayKey(now - days * DAY);

    // ── Usuarios ────────────────────────────────────────────────
    const baseCols = 'id, email, name, created_at, email_verified, subscription_tier, ftp, weight, strava_token, garmin_token, fitbit_token';
    let trackingEnabled = true;
    let allUsers;
    try {
      allUsers = await fetchAll('users', `${baseCols}, last_seen_at`);
    } catch (e) {
      trackingEnabled = false; // migración add_usage_tracking.sql sin ejecutar
      allUsers = await fetchAll('users', baseCols);
    }
    // Fuera de las estadísticas: demos y cuentas de admin (incluida la que está mirando)
    const isAdminUser = (u) => isAdminEmail(u.email) || String(u.id) === String(viewer.id);
    const users = allUsers.filter((u) => !isDemo(u.email) && !isAdminUser(u));
    const adminCount = allUsers.filter(isAdminUser).length;
    const demoCount = allUsers.filter((u) => isDemo(u.email)).length;
    const realIds = new Set(users.map((u) => String(u.id)));

    // intervals.icu aparte: si su migración no se ha ejecutado, la columna no existe
    let icuIds = new Set();
    try {
      icuIds = new Set((await fetchAll('users', 'id', (q) => q.not('intervals_api_key', 'is', null))).map((u) => String(u.id)));
    } catch (_) {}

    // ── Actividades (180 días) y eventos de uso (90 días) ───────
    const acts = (await fetchAll('activities', 'user_id, date, source', (q) => q.gte('date', since(180))))
      .filter((a) => realIds.has(String(a.user_id)));

    let events = [];
    if (trackingEnabled) {
      try {
        events = (await fetchAll('app_events', 'user_id, event, page, platform, created_at', (q) => q.gte('created_at', new Date(now - 90 * DAY).toISOString())))
          .filter((e) => realIds.has(String(e.user_id)));
      } catch (e) {
        trackingEnabled = false;
      }
    }

    // Días con entreno y días con uso de la app, por usuario
    const trainDays = new Map(); // uid -> Set(YYYY-MM-DD)
    const appDays = new Map();
    const add = (map, uid, d) => { if (!map.has(uid)) map.set(uid, new Set()); map.get(uid).add(d); };
    acts.forEach((a) => a.date && add(trainDays, String(a.user_id), String(a.date).slice(0, 10)));
    events.forEach((e) => add(appDays, String(e.user_id), dayKey(e.created_at)));
    users.forEach((u) => { if (u.last_seen_at) add(appDays, String(u.id), dayKey(u.last_seen_at)); });

    const anyActiveOn = (uid, d) => trainDays.get(uid)?.has(d) || appDays.get(uid)?.has(d);
    const countDays = (set, fromKey, toKey = today) => {
      if (!set) return 0;
      let n = 0;
      set.forEach((d) => { if (d > fromKey && d <= toKey) n++; });
      return n;
    };
    const activeIn = (uid, fromKey, toKey = today) =>
      countDays(trainDays.get(uid), fromKey, toKey) + countDays(appDays.get(uid), fromKey, toKey) > 0;

    // ── Funciones utilizadas (por datos guardados) ──────────────
    const [plans, adaptations, bikes, routes, ridesCreated, ridesJoined, wellness, weight, biomech, nutrition, push, feedbackUsers] =
      await Promise.all([
        distinctUsers('training_plans'), distinctUsers('plan_adaptations'), distinctUsers('bikes'),
        distinctUsers('routes'), distinctUsers('group_rides', 'creator_id'), distinctUsers('group_ride_participants'),
        distinctUsers('wellness_log'), distinctUsers('weight_log'), distinctUsers('biomechanics'),
        distinctUsers('nutrition_plans'), distinctUsers('push_subscriptions'), distinctUsers('feedback'),
      ]);
    const groupRides = ridesCreated || ridesJoined ? new Set([...(ridesCreated || []), ...(ridesJoined || [])]) : null;
    const providerOf = (u) => [u.strava_token && 'Strava', icuIds.has(String(u.id)) && 'Intervals.icu', u.garmin_token && 'Garmin', u.fitbit_token && 'Fitbit'].filter(Boolean);

    const featureDefs = [
      ['Integración (cualquiera)', new Set(users.filter((u) => providerOf(u).length).map((u) => String(u.id)))],
      ['Strava', new Set(users.filter((u) => u.strava_token).map((u) => String(u.id)))],
      ['intervals.icu', icuIds],
      ['Plan de entrenamiento', plans], ['Adaptaciones del plan', adaptations], ['Garaje (bicis)', bikes],
      ['Rutas', routes], ['Salidas grupales', groupRides], ['Bienestar / sueño', wellness], ['Peso', weight],
      ['Biomecánica', biomech], ['Nutrición', nutrition], ['Notificaciones push', push], ['Feedback', feedbackUsers],
    ];
    const total = users.length;
    const features = featureDefs
      .filter(([, set]) => set)
      .map(([name, set]) => {
        const n = [...set].filter((id) => realIds.has(id)).length;
        const p = pct(n, total);
        return { name, users: n, pct: p, health: health(p, 40, 15) };
      })
      .sort((a, b) => b.users - a.users);
    const featureCount = (uid) => featureDefs.filter(([, set]) => set?.has(uid)).length;

    // ── Segmentación ────────────────────────────────────────────
    const since28 = since(28);
    const userRows = users.map((u) => {
      const uid = String(u.id);
      const created = u.created_at ? new Date(u.created_at).getTime() : now;
      const train28 = countDays(trainDays.get(uid), since28);
      const app28 = countDays(appDays.get(uid), since28);
      const allTrain = trainDays.get(uid);
      const lastActivity = allTrain?.size ? [...allTrain].sort().pop() : null;
      const lastApp = appDays.get(uid)?.size ? [...appDays.get(uid)].sort().pop() : null;

      let segment;
      if (train28 >= 16) segment = 'diario';
      else if (train28 >= 6) segment = 'regular';
      else if (train28 >= 1) segment = 'esporadico';
      else if (now - created <= 7 * DAY) segment = 'nuevo';
      else if (app28 > 0) segment = 'solo_app';
      else if (allTrain?.size) segment = 'dormido';
      else segment = 'sin_uso';

      return {
        id: u.id, name: u.name, email: u.email, created_at: u.created_at,
        last_seen_at: u.last_seen_at || null, last_activity: lastActivity, last_app: lastApp,
        train_days_28: train28, app_days_28: app28, segment,
        providers: providerOf(u), premium: u.subscription_tier === 'premium',
        email_verified: u.email_verified !== false, profile_complete: !!(u.ftp && u.weight),
        features: featureCount(uid),
      };
    });

    const segments = Object.entries(SEGMENTS).map(([key, s]) => {
      const n = userRows.filter((r) => r.segment === key).length;
      return { key, ...s, users: n, pct: pct(n, total) };
    });

    // ── Activos diarios / semanales / mensuales ─────────────────
    const dailyActive = [];
    for (let i = 29; i >= 0; i--) {
      const d = since(i);
      let app = 0, train = 0, any = 0;
      users.forEach((u) => {
        const uid = String(u.id);
        const t = trainDays.get(uid)?.has(d), a = appDays.get(uid)?.has(d);
        if (t) train++;
        if (a) app++;
        if (t || a) any++;
      });
      dailyActive.push({ date: d, any, app, train });
    }
    const dau = dailyActive[dailyActive.length - 1].any;
    const wau = users.filter((u) => activeIn(String(u.id), since(7))).length;
    const mau = users.filter((u) => activeIn(String(u.id), since(28))).length;
    const avgDau28 = dailyActive.slice(-28).reduce((s, d) => s + d.any, 0) / 28;
    const stickiness = mau ? Math.round((avgDau28 / mau) * 1000) / 10 : null;

    // Semanas: altas y usuarios activos (12 semanas)
    const weekly = [];
    const thisWeek = weekKey(now);
    for (let i = 11; i >= 0; i--) {
      const start = dayKey(new Date(thisWeek).getTime() - i * 7 * DAY);
      const end = dayKey(new Date(start).getTime() + 6 * DAY);
      const prevDay = dayKey(new Date(start).getTime() - DAY);
      weekly.push({
        week: start,
        signups: users.filter((u) => u.created_at && weekKey(u.created_at) === start).length,
        active: users.filter((u) => activeIn(String(u.id), prevDay, end)).length,
        training: users.filter((u) => countDays(trainDays.get(String(u.id)), prevDay, end) > 0).length,
      });
    }

    // ── Retención por cohortes (semana de alta → % activos en semana N tras el alta) ──
    const cohorts = [];
    for (let i = 7; i >= 0; i--) {
      const start = dayKey(new Date(thisWeek).getTime() - i * 7 * DAY);
      const members = users.filter((u) => u.created_at && weekKey(u.created_at) === start);
      const weeks = [];
      for (let k = 0; k <= 6; k++) {
        let eligible = 0, active = 0;
        members.forEach((u) => {
          const c = new Date(dayKey(u.created_at)).getTime();
          const wStart = c + k * 7 * DAY, wEnd = wStart + 7 * DAY;
          if (wEnd > now + DAY) return; // semana aún no terminada para este usuario
          eligible++;
          const uid = String(u.id);
          for (let t = wStart; t < wEnd; t += DAY) if (anyActiveOn(uid, dayKey(t))) { active++; break; }
        });
        const p = eligible ? pct(active, eligible) : null;
        weeks.push(p == null ? null : { pct: p, health: health(p, 40, 20) });
      }
      cohorts.push({ week: start, size: members.length, weeks });
    }

    // ── Embudo de activación ────────────────────────────────────
    const hasProvider = userRows.filter((r) => r.providers.length);
    const funnelSteps = [
      ['Registrados', userRows],
      ['Email verificado', userRows.filter((r) => r.email_verified)],
      ['Perfil completo (FTP + peso)', userRows.filter((r) => r.profile_complete)],
      ['Conectó Strava, intervals.icu u otro', hasProvider],
      ['Tiene entrenos registrados', userRows.filter((r) => r.last_activity)],
      ['Creó plan de entrenamiento', plans ? userRows.filter((r) => plans.has(String(r.id))) : null],
      ['Activo esta semana', userRows.filter((r) => activeIn(String(r.id), since(7)))],
    ].filter(([, rows]) => rows);
    const funnel = funnelSteps.map(([step, rows], i) => {
      const prev = i ? funnelSteps[i - 1][1].length : rows.length;
      return { step, users: rows.length, pct: pct(rows.length, total), stepPct: pct(rows.length, prev) };
    });

    // ── Riesgo de abandono: activos hace 4-8 semanas, nada en 14 días ──
    const atRisk = userRows
      .filter((r) => {
        const uid = String(r.id);
        const before = countDays(trainDays.get(uid), since(56), since(28)) + countDays(appDays.get(uid), since(56), since(28));
        return before >= 3 && !activeIn(uid, since(14));
      })
      .map((r) => ({ id: r.id, name: r.name, email: r.email, last_activity: r.last_activity, last_app: r.last_app }));
    const prevActive = users.filter((u) => activeIn(String(u.id), since(56), since(28))).length;

    // ── Uso por página e IA (requiere tracking) ─────────────────
    const ev30 = events.filter((e) => new Date(e.created_at).getTime() >= now - 30 * DAY);
    const groupEvents = (type, labelOf) => {
      const m = new Map();
      ev30.filter((e) => e.event === type).forEach((e) => {
        const k = e.page || '?';
        if (!m.has(k)) m.set(k, { key: k, label: labelOf(k), views: 0, users: new Set() });
        const row = m.get(k);
        row.views++;
        row.users.add(String(e.user_id));
      });
      return [...m.values()].map((r) => ({ ...r, users: r.users.size, pct: pct(r.users.size, mau) })).sort((a, b) => b.users - a.users || b.views - a.views);
    };
    const pageUsage = groupEvents('page_view', (k) => PAGE_LABELS[k] || k);
    const aiUsage = groupEvents('ai_call', (k) => k.replace(/^coach\//, ''));
    const platforms = {};
    ev30.forEach((e) => { platforms[e.platform || 'web'] = (platforms[e.platform || 'web'] || 0) + 1; });

    // ── Fuentes de entrenos (30 días) ───────────────────────────
    const sources = {};
    acts.filter((a) => String(a.date) > since(30)).forEach((a) => {
      const s = String(a.source || 'Manual').toLowerCase();
      const label = s.charAt(0).toUpperCase() + s.slice(1);
      sources[label] = (sources[label] || 0) + 1;
    });

    // ── Feedback ────────────────────────────────────────────────
    let feedback = { avgRating: null, count: 0, recent: [] };
    try {
      const { data: fb } = await supabase.from('feedback').select('user_name, message, rating, created_at, reply').order('created_at', { ascending: false }).limit(200);
      const rated = (fb || []).filter((f) => f.rating);
      feedback = {
        count: (fb || []).length,
        avgRating: rated.length ? Math.round((rated.reduce((s, f) => s + f.rating, 0) / rated.length) * 10) / 10 : null,
        unanswered: (fb || []).filter((f) => !f.reply).length,
        recent: (fb || []).slice(0, 5),
      };
    } catch (_) {}

    // ── KPIs con semáforo ───────────────────────────────────────
    const new7 = users.filter((u) => u.created_at && u.created_at >= new Date(now - 7 * DAY).toISOString()).length;
    const newPrev7 = users.filter((u) => u.created_at && u.created_at >= new Date(now - 14 * DAY).toISOString() && u.created_at < new Date(now - 7 * DAY).toISOString()).length;
    const new30 = users.filter((u) => u.created_at && u.created_at >= new Date(now - 30 * DAY).toISOString()).length;
    const matured = userRows.filter((r) => r.created_at && now - new Date(r.created_at).getTime() > 7 * DAY);
    const activated = matured.filter((r) => r.providers.length || r.last_activity).length;
    const w1Base = users.filter((u) => u.created_at && now - new Date(u.created_at).getTime() >= 14 * DAY && now - new Date(u.created_at).getTime() <= 60 * DAY);
    const w1Active = w1Base.filter((u) => {
      const c = new Date(dayKey(u.created_at)).getTime();
      for (let t = c + 7 * DAY; t < c + 14 * DAY; t += DAY) if (anyActiveOn(String(u.id), dayKey(t))) return true;
      return false;
    }).length;
    const premium = userRows.filter((r) => r.premium).length;

    const kpi = (key, label, value, unit, h, hint, extra = {}) => ({ key, label, value, unit, health: h, hint, ...extra });
    const activePct = pct(wau, total);
    const activationPct = pct(activated, matured.length);
    const w1Pct = pct(w1Active, w1Base.length);
    const riskPct = pct(atRisk.length, prevActive);
    const verifiedPct = pct(userRows.filter((r) => r.email_verified).length, total);
    const profilePct = pct(userRows.filter((r) => r.profile_complete).length, total);

    const kpis = [
      kpi('users', 'Usuarios registrados', total, '', 'none', `${new30} nuevos en 30 días`),
      kpi('new7', 'Altas últimos 7 días', new7, '', health(new7 - newPrev7, 0, -Math.max(1, Math.ceil(newPrev7 * 0.3))), `Semana anterior: ${newPrev7}`, { delta: new7 - newPrev7 }),
      kpi('dau', 'Activos hoy', dau, '', 'none', `Media 28 días: ${Math.round(avgDau28 * 10) / 10}`),
      kpi('wau', 'Activos 7 días', wau, '', health(activePct, 40, 20), `${activePct ?? 0}% de la base`),
      kpi('mau', 'Activos 28 días', mau, '', health(pct(mau, total), 60, 35), `${pct(mau, total) ?? 0}% de la base`),
      kpi('stickiness', 'Stickiness (DAU/MAU)', stickiness, '%', health(stickiness, 20, 10), 'Bueno >20%: vuelven casi a diario'),
      kpi('activation', 'Activación', activationPct, '%', health(activationPct, 60, 35), 'Conectan proveedor o registran entrenos (altas >7 días)'),
      kpi('retention_w1', 'Retención semana 2', w1Pct, '%', health(w1Pct, 30, 15), `Vuelven entre el día 7 y 14 (${w1Base.length} usuarios)`),
      kpi('at_risk', 'En riesgo de abandono', atRisk.length, '', health(riskPct, 10, 25, false), `${riskPct ?? 0}% de los que estaban activos`),
      kpi('verified', 'Email verificado', verifiedPct, '%', health(verifiedPct, 80, 60), 'Usuarios con email confirmado'),
      kpi('profile', 'Perfil completo', profilePct, '%', health(profilePct, 70, 45), 'Tienen FTP y peso (necesarios para métricas)'),
      kpi('premium', 'Premium', premium, '', 'none', `${pct(premium, total) ?? 0}% de conversión`),
      kpi('rating', 'Valoración media', feedback.avgRating, '★', health(feedback.avgRating, 4, 3), `${feedback.count} comentarios · ${feedback.unanswered || 0} sin responder`),
    ];

    // ── Recomendaciones automáticas ─────────────────────────────
    const insights = [];
    const seg = Object.fromEntries(segments.map((s) => [s.key, s.users]));
    if (!trackingEnabled) {
      insights.push({ level: 'red', title: 'Tracking de uso desactivado', text: 'Ejecuta backend/migrations/add_usage_tracking.sql en Supabase para medir aperturas de la app y uso por página. Ahora mismo "activo" solo significa "registró un entreno".' });
    }
    if (seg.sin_uso) insights.push({ level: 'red', title: `${seg.sin_uso} usuarios registrados que nunca usaron la app`, text: 'Envíales un email de reactivación con un único paso claro: conectar intervals.icu o subir sus archivos .fit (Strava está limitado a 10 plazas). Es el grupo más fácil de recuperar en volumen.' });
    if (seg.dormido) insights.push({ level: 'red', title: `${seg.dormido} usuarios dormidos`, text: 'Entrenaban y llevan 28+ días sin actividad. Una notificación push o email con su forma (CTL) actual y "vuelve con un plan de 2 semanas" suele funcionar.' });
    if (atRisk.length) insights.push({ level: 'amber', title: `${atRisk.length} usuarios en riesgo de abandono`, text: 'Eran activos hace 1-2 meses y no han vuelto en 14 días. Tienes la lista abajo: contáctalos personalmente o pregúntales qué les falta.' });
    if (seg.solo_app) insights.push({ level: 'amber', title: `${seg.solo_app} usuarios abren la app sin registrar entrenos`, text: 'Probablemente no han conectado ninguna fuente de entrenos. Envíales un aviso para conectar intervals.icu (sin límite de plazas, a diferencia de Strava); sin datos la app pierde casi todo su valor.' });
    if (seg.nuevo) insights.push({ level: 'blue', title: `${seg.nuevo} nuevos esta semana sin entrenos aún`, text: 'Los primeros 3 días son críticos: un email de bienvenida al día 1 y un recordatorio al día 3 si siguen sin conectar proveedor.' });
    const worstStep = funnel.slice(1).reduce((w, s) => (w == null || (s.stepPct ?? 100) < (w.stepPct ?? 100) ? s : w), null);
    if (worstStep && worstStep.stepPct != null && worstStep.stepPct < 70) {
      const idx = funnel.indexOf(worstStep);
      insights.push({ level: 'amber', title: `Mayor fuga del embudo: "${funnel[idx - 1].step}" → "${worstStep.step}"`, text: `Solo el ${worstStep.stepPct}% pasa este paso. Es donde más usuarios se pierden: simplificarlo es lo que más mueve la activación.` });
    }
    const leastUsed = features.filter((f) => f.name !== 'Feedback').slice(-2).filter((f) => f.pct != null && f.pct < 15);
    if (leastUsed.length) insights.push({ level: 'blue', title: `Funciones poco usadas: ${leastUsed.map((f) => f.name).join(', ')}`, text: 'Valora si es un problema de descubrimiento (no la encuentran) o de valor. Prueba destacarlas en el Inicio un par de semanas y compara.' });
    if (verifiedPct != null && verifiedPct < 80) insights.push({ level: 'amber', title: `Solo el ${verifiedPct}% verificó el email`, text: 'Revisa si el email de verificación llega a spam (SendGrid) y añade un botón de reenvío visible.' });
    if (push && pct([...push].filter((id) => realIds.has(id)).length, total) < 30) insights.push({ level: 'blue', title: 'Pocos usuarios con notificaciones push', text: 'Las push son tu mejor canal de reactivación. Pide el permiso en un momento de valor (al generar el plan), no al entrar.' });
    if (feedback.unanswered) insights.push({ level: 'blue', title: `${feedback.unanswered} comentarios de feedback sin responder`, text: 'Responder rápido a quien escribe convierte usuarios en embajadores.' });
    if (new7 < newPrev7) insights.push({ level: 'amber', title: 'Las altas bajan respecto a la semana anterior', text: `${new7} vs ${newPrev7}. Revisa si cambió alguna fuente de tráfico (redes, Strava clubs, boca a boca).` });
    if (!insights.length) insights.push({ level: 'green', title: 'Todo en verde', text: 'No hay alertas. Buen momento para invertir en adquisición.' });

    return {
      generatedAt: new Date(now).toISOString(),
      trackingEnabled,
      excluded: { demo: demoCount, admin: adminCount },
      kpis, segments, funnel, features, pageUsage, aiUsage, platforms, sources,
      dailyActive, weekly, cohorts, atRisk, insights, feedback,
      users: userRows.sort((a, b) => String(b.last_app || b.last_activity || '').localeCompare(String(a.last_app || a.last_activity || ''))),
    };
  }
}

// ── Plazas de Strava ────────────────────────────────────────
// Strava limita cuántos atletas puede autorizar la app. Desde aquí se ve quién ocupa
// cada plaza y se pueden liberar las de usuarios inactivos.
const STRAVA_CAPACITY = parseInt(process.env.STRAVA_ATHLETE_CAPACITY, 10) || 10;
// Cuentas que nunca se pueden liberar (por defecto, la del creador de la app)
const STRAVA_RESERVED = (process.env.STRAVA_RESERVED_EMAILS || 'jbautistaalvarez@hotmail.com')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const isReserved = (email) => STRAVA_RESERVED.includes((email || '').toLowerCase());

router.get('/strava-slots', async (req, res) => {
  try {
    const now = Date.now();
    const connected = (q) => q.or('strava_token.not.is.null,strava_refresh.not.is.null');
    let users;
    try {
      users = await fetchAll('users', 'id, name, email, created_at, last_seen_at', connected);
    } catch (e) {
      users = await fetchAll('users', 'id, name, email, created_at', connected);
    }

    const lastAct = new Map();
    if (users.length) {
      const acts = await fetchAll('activities', 'user_id, date',
        (q) => q.in('user_id', users.map((u) => u.id)).gte('date', dayKey(now - 365 * DAY)));
      acts.forEach((a) => {
        const k = String(a.user_id), d = String(a.date).slice(0, 10);
        if (!lastAct.has(k) || d > lastAct.get(k)) lastAct.set(k, d);
      });
    }

    const slots = users.map((u) => {
      const last_activity = lastAct.get(String(u.id)) || null;
      const lastTs = Math.max(u.last_seen_at ? new Date(u.last_seen_at).getTime() : 0, last_activity ? new Date(last_activity).getTime() : 0);
      const inactiveDays = lastTs ? Math.floor((now - lastTs) / DAY) : null;
      const reserved = isReserved(u.email);
      let status;
      if (reserved) status = 'reserved';
      else if (inactiveDays != null && inactiveDays <= 14) status = 'active';
      else if (inactiveDays != null && inactiveDays <= 30) status = 'low';
      else status = 'inactive';
      return { id: u.id, name: u.name, email: u.email, last_seen_at: u.last_seen_at || null, last_activity, inactive_days: inactiveDays, reserved, status };
    }).sort((a, b) => (b.inactive_days ?? 9999) - (a.inactive_days ?? 9999));

    const used = slots.length;
    res.json({
      capacity: STRAVA_CAPACITY, used, free: Math.max(0, STRAVA_CAPACITY - used),
      health: health(pct(used, STRAVA_CAPACITY), 70, 99, false),
      releasable: slots.filter((s) => s.status === 'inactive').length,
      slots,
    });
  } catch (e) {
    console.error('[admin/strava-slots]', e.message);
    res.status(500).json({ error: 'Error leyendo plazas de Strava: ' + e.message });
  }
});

router.post('/strava-slots/:userId/release', async (req, res) => {
  try {
    const { data: user } = await supabase.from('users').select('id, email').eq('id', req.params.userId).single();
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (isReserved(user.email)) return res.status(403).json({ error: 'Esta plaza está reservada y no se puede liberar' });

    const result = await require('./providers').releaseStrava(user.id);
    if (!result.ok) return res.status(502).json({ error: `No se pudo revocar en Strava (${result.error}). La plaza sigue ocupada.` });
    console.log(`[admin] Plaza de Strava liberada: usuario ${user.id} (por ${req.user.email})`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin/strava-release]', e.message);
    res.status(500).json({ error: 'Error liberando la plaza: ' + e.message });
  }
});

module.exports = router;
module.exports.buildOverview = buildOverview;
