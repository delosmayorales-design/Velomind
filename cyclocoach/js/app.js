/**
 * app.js — VeloMind
 * Estado global, utilidades, generador de planes REALES y gráficas.
 * Depende de Chart.js (cargado antes).
 */

/* ══════════════════════════════════════════════════════════════
   CONSTANTES: ZONAS COGGAN (7 zonas)
══════════════════════════════════════════════════════════════ */
const ZONES_COGGAN = [
  { id: 1, name: 'Z1 — Recuperación Activa', min: 0,    max: 0.55, color: '#6B7280', description: 'Muy baja intensidad. Pedaleo relajado, conversación fluida.' },
  { id: 2, name: 'Z2 — Resistencia Aeróbica', min: 0.56, max: 0.75, color: '#3B82F6', description: 'Base aeróbica fundamental. Puedes hablar en frases cortas.' },
  { id: 3, name: 'Z3 — Tempo',               min: 0.76, max: 0.90, color: '#10B981', description: 'Esfuerzo "comfortably hard". Respiración elevada.' },
  { id: 4, name: 'Z4 — Umbral Láctico',      min: 0.91, max: 1.05, color: '#F59E0B', description: 'En o cerca del FTP. Máximo sostenible ~60 min.' },
  { id: 5, name: 'Z5 — VO₂ Max',             min: 1.06, max: 1.20, color: '#EF4444', description: 'Alta intensidad. Máximo esfuerzo 3–8 min.' },
  { id: 6, name: 'Z6 — Capacidad Anaeróbica',min: 1.21, max: 1.50, color: '#8B5CF6', description: 'Muy alta. Esprints de 30 s a 2 min.' },
  { id: 7, name: 'Z7 — Potencia Neuromuscular',min:1.51,max: 99,   color: '#EC4899', description: 'Máxima potencia. Esprints < 30 s.' },
];

/* Tipos de sesión con etiquetas */
const WORKOUT_TYPES = {
  recovery:  { label: 'Recuperación Activa', color: '#6B7280', emoji: '😴' },
  endurance: { label: 'Resistencia Z2',      color: '#3B82F6', emoji: '🚴' },
  tempo:     { label: 'Tempo Z3',            color: '#10B981', emoji: '⚡' },
  threshold: { label: 'Umbral (FTP)',         color: '#F59E0B', emoji: '🎯' },
  vo2max:    { label: 'VO₂ Max',             color: '#EF4444', emoji: '🔥' },
  sprint:    { label: 'Sprints / Poten.',    color: '#8B5CF6', emoji: '💨' },
  long:      { label: 'Fondón Z1-Z2',        color: '#00D4FF', emoji: '🚴' },
  race:      { label: 'Activación Carrera',  color: '#EC4899', emoji: '🏁' },
  strength:  { label: 'Fuerza (Baja cadencia)',color:'#A855F7',emoji: '💪' },
  gym:       { label: 'Gimnasio / Fuerza',     color:'#F97316',emoji: '🏋️' },
  running:   { label: 'Running',               color:'#EF4444',emoji: '🏃' },
  walking:   { label: 'Caminata Activa',       color:'#10B981',emoji: '🚶' },
};

/* Normalización de objetivos entre pantallas y motor */
const GoalUtils = {
  normalize(goal) {
    const g = String(goal || '').toLowerCase().trim();
    const map = {
      resistencia: 'resistencia',
      ftp: 'ftp',
      vo2max: 'vo2max',
      sprint: 'sprint',
      gran_fondo: 'gran_fondo',
      perdida_peso: 'perdida_peso',
      carrera_corta: 'carrera_corta',
      carrera_larga: 'carrera_larga',
      ultra: 'ultra',
      velocidad: 'ftp',
      competicion: 'gran_fondo',
      salud: 'resistencia',
    };
    return map[g] || 'resistencia';
  },
  toTrainingGoal(goal) {
    const g = this.normalize(goal);
    if (g === 'perdida_peso') return 'resistencia';
    return g;
  },
};

/* ══════════════════════════════════════════════════════════════
   UTILIDADES
══════════════════════════════════════════════════════════════ */
const Utils = {
  formatDuration(s) {
    if (!s) return '--';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}min` : `${m} min`;
  },
  formatDistance(m) {
    if (!m) return '--';
    return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';
  },
  formatPower(w) { return w ? Math.round(w) + ' W' : '--'; },
  formatDate(d) {
    if (!d) return '--';
    const dateStr = String(d).substring(0, 10);
    const dt = new Date(dateStr + 'T00:00:00');
    if (isNaN(dt.getTime())) return dateStr || '--';
    return dt.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  },
  daysAgo(dateStr) {
    const s = String(dateStr || '').substring(0, 10);
    return Math.floor((Date.now() - new Date(s + 'T00:00:00')) / 86400000);
  },
  getPowerZone(watts, ftp) {
    if (!watts || !ftp) return null;
    const ratio = watts / ftp;
    return ZONES_COGGAN.find(z => ratio >= z.min && ratio < z.max) || ZONES_COGGAN[ZONES_COGGAN.length - 1];
  },
  getTSBStatus(tsb) {
    if (tsb > 25)  return { label: 'Muy fresco',      color: '#64a0ff', icon: '🚀' };
    if (tsb > 5)   return { label: 'Fresco',          color: '#00C882', icon: '✅' };
    if (tsb > -10) return { label: 'En forma',        color: '#b4e600', icon: '💪' };
    if (tsb > -20) return { label: 'Carga alta',        color: '#FFC800', icon: '⚖️' };
    if (tsb > -30) return { label: 'Fatiga acumulada', color: '#FF9632', icon: '🔥' };
    return           { label: 'Sobreentrenado',   color: '#ff4757', icon: '🛑' };
  },

  /** Calcula TSS de una actividad con datos mínimos */
  calcTSS(durationSec, np, ftp) {
    if (!np || !ftp || !durationSec) return 0;
    const IF = np / ftp;
    return Math.round((durationSec * np * IF) / (ftp * 3600) * 100);
  },

  /** IF de una actividad */
  calcIF(np, ftp) {
    if (!np || !ftp) return 0;
    return Math.round((np / ftp) * 100) / 100;
  },

  /** hrTSS para actividades sin potenciómetro (fórmula Bannister simplificada) */
  calcHRTSS(durationSec, avgHR, lthr) {
    if (!avgHR || !lthr || !durationSec) return 0;
    const IF_hr = avgHR / lthr;
    return Math.round((durationSec / 3600) * IF_hr * IF_hr * 100);
  },

  /** Rango de FC objetivo para una sesión planificada a partir del IF y el LTHR.
   *  Aproximación fisiológica: HR%LTHR ≈ 0.44 + 0.57 × IF (calibrado Z1-Z5) */
  hrTargetFromIF(lthr, ifTarget) {
    if (!lthr || !ifTarget) return null;
    const center = lthr * (0.44 + 0.57 * ifTarget);
    const bpmMin = Math.round(center * 0.96);
    const bpmMax = Math.round(center * 1.04);
    const pct = center / lthr;
    const zone = pct < 0.81 ? 'Z1' : pct < 0.90 ? 'Z2' : pct < 0.94 ? 'Z3' : pct < 1.00 ? 'Z4' : 'Z5';
    return { bpmMin, bpmMax, zone };
  },

  /** Parsea fecha ISO o yyyy-mm-dd */
  parseDate(str) {
    if (!str) return null;
    const d = new Date(str);
    return isNaN(d) ? null : d;
  },

  /** Navegación hacia atrás con fallback seguro al dashboard */
  goBack() {
    if (window.history.length > 1 && document.referrer.includes(window.location.hostname)) {
      window.history.back();
    } else {
      window.location.href = 'dashboard.html';
    }
  },

  /** Estima el tiempo de ciclismo basado en distancia, desnivel y FTP relativo */
  estimateCyclingTime(distM, elevM, ftp, weight) {
    if (!distM) return 0;
    const wkg = ftp / (weight || 70);
    // Velocidad base según nivel (W/kg)
    let baseSpeed = 18 + (wkg * 2); // Un ciclista de 4w/kg va a ~26km/h base
    if (baseSpeed > 32) baseSpeed = 32;
    
    const flatTimeHrs = (distM / 1000) / baseSpeed;
    const climbingPenaltyHrs = (elevM / 400) * (1 / Math.max(0.5, wkg * 0.4)); // Penalización por cada 400m de desnivel
    return Math.round((flatTimeHrs + climbingPenaltyHrs) * 3600);
  }
};

/* ══════════════════════════════════════════════════════════════
   PMC: Performance Management Chart (CTL/ATL/TSB)
══════════════════════════════════════════════════════════════ */
const PMC = {
  _cache: null,

  compute(activities, days = 120, seedCTL = 0) {
    // Memoización: si los inputs son idénticos, devolver resultado cacheado
    const totalTSS = activities.reduce((s, a) => s + (parseFloat(a.tss) || 0), 0);
    const sig = `${activities.length}|${activities[0]?.date || ''}|${activities[activities.length-1]?.date || ''}|${Math.round(totalTSS)}|${days}|${seedCTL}`;
    if (this._cache && this._cache.sig === sig) return this._cache.result;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result = [];
    let ctl = Math.max(0, seedCTL), atl = Math.max(0, seedCTL);

    // Mapa fecha -> TSS total del día
    const tssMap = {};
    for (const a of activities) {
      if (!a.date || typeof a.date !== 'string') continue;
      const dateKey = a.date.substring(0, 10);
      if (isNaN(new Date(dateKey).getTime())) continue; // Ignorar fechas corruptas por completo
      tssMap[dateKey] = (tssMap[dateKey] || 0) + (parseFloat(a.tss) || 0);
    }

    const allDates = Object.keys(tssMap).sort();
    if (!allDates.length) return result;

    // Arrancar desde la primera actividad para un PMC bien calentado
    let startDate = new Date(allDates[0]);
    // Evitar bloqueos del navegador si hay fechas corruptas antiguas (ej. año 1970 o 0001)
    if (isNaN(startDate.getTime()) || startDate.getFullYear() < 2000) {
      startDate = new Date(today);
      startDate.setFullYear(Math.max(2000, today.getFullYear() - 5));
    }
    const cutoff = new Date(today);
    cutoff.setDate(today.getDate() - days + 1);

    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().substring(0, 10);
      const tss = tssMap[key] || 0;

      // Exponential moving averages (fórmula TrainingPeaks)
      ctl = ctl + (tss - ctl) / 42;
      atl = atl + (tss - atl) / 7;
      const tsb = ctl - atl;

      // Solo incluir en el resultado los últimos `days` días
      if (d >= cutoff) {
        result.push({
          date: key,
          tss,
          ctl: Math.round(ctl * 10) / 10,
          atl: Math.round(atl * 10) / 10,
          tsb: Math.round(tsb * 10) / 10,
        });
      }
    }
    this._cache = { sig, result };
    return result;
  },
};

/* ══════════════════════════════════════════════════════════════
   ESTADO GLOBAL (AppState)
══════════════════════════════════════════════════════════════ */
const AppState = {
  athlete: null,
  activities: [],
  pmcData: [],
  weightLog: [], // [{date, weight, fat}]

  async init() {
    this.athlete    = this._loadAthlete();
    this.activities = this._loadActivities();
    this.weightLog  = this._loadWeightLog();
    this.pmcData    = PMC.compute(this.activities, 120, this.athlete?.initial_ctl || 0);
  },

  _loadAthlete() {
    try { return JSON.parse(localStorage.getItem('velomind_athlete') || sessionStorage.getItem('velomind_athlete')) || null; } catch { return null; }
  },
  _loadActivities() {
    try { return JSON.parse(localStorage.getItem('velomind_activities')) || []; } catch { return []; }
  },
  _loadWeightLog() {
    try { return JSON.parse(localStorage.getItem('velomind_weight_log')) || []; } catch { return []; }
  },

  saveAthlete(data) {
    this.athlete = { ...this.athlete, ...data };
    this.athlete._local_updated_at = Date.now();
    localStorage.setItem('velomind_athlete', JSON.stringify(this.athlete));
    // Mantener velomind_user sincronizado inmediatamente (sin esperar al backend)
    try {
      const { _local_updated_at, id, createdAt, ...profileFields } = data;
      const session = JSON.parse(localStorage.getItem('velomind_user') || '{}');
      localStorage.setItem('velomind_user', JSON.stringify({ ...session, ...profileFields }));
    } catch (e) {}
    if ('initial_ctl' in data || 'ftp' in data) {
      this.pmcData = PMC.compute(this.activities, 120, this.athlete?.initial_ctl || 0);
    }
  },

  saveActivity(activity) {
    if (!this.activities.find(a => a.id === activity.id)) {
      this.activities.push(activity);
      this.activities.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      localStorage.setItem('velomind_activities', JSON.stringify(this.activities));
      this.pmcData = PMC.compute(this.activities, 120, this.athlete?.initial_ctl || 0);
    }
  },

  removeActivity(id) {
    this.activities = this.activities.filter(a => a.id !== id);
    localStorage.setItem('velomind_activities', JSON.stringify(this.activities));
    this.pmcData = PMC.compute(this.activities, 120, this.athlete?.initial_ctl || 0);
  },

  saveWeightEntry(entry) {
    // Evitar duplicados de mismo día
    const idx = this.weightLog.findIndex(e => e.date === entry.date);
    if (idx >= 0) this.weightLog[idx] = entry;
    else this.weightLog.push(entry);
    this.weightLog.sort((a, b) => a.date < b.date ? -1 : 1);
    localStorage.setItem('velomind_weight_log', JSON.stringify(this.weightLog));
  },

  removeWeightEntry(date) {
    this.weightLog = this.weightLog.filter(e => e.date !== date);
    localStorage.setItem('velomind_weight_log', JSON.stringify(this.weightLog));
  },

  getCurrentMetrics() {
    if (!this.pmcData.length) return { ctl: 0, atl: 0, tsb: 0 };
    return this.pmcData[this.pmcData.length - 1];
  },

  getWeekTSS() {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    return this.activities
      .filter(a => new Date(a.date + 'T00:00:00') >= monday)
      .reduce((s, a) => s + (a.tss || 0), 0);
  },
};

/* ══════════════════════════════════════════════════════════════
   TRAINING PLAN GENERATOR — Planes REALES
══════════════════════════════════════════════════════════════ */
const TrainingPlanGenerator = {
  // Fracción del CTL que responde en una semana: 1 - e^(-7/42) ≈ 0.154 (constante de
  // tiempo de 42 días de TrainingPeaks). Usado tanto para medir el ramp rate real
  // (rampRate) como para despejar el TSS semanal necesario para un ramp objetivo
  // (_getMacrocycleContext) — debe ser el mismo valor en ambos sitios.
  _CTL_WEEKLY_RESPONSE: 0.154,

  /**
   * Genera plan semanal basado en:
   * - athlete.ftp, athlete.weight, athlete.weekly_hours, athlete.goal
   * - athlete.event_date (fecha objetivo)
   * - athlete.experience: 'principiante' | 'intermedio' | 'avanzado'
   * - pmcData para TSB/CTL actuales
   */
  generate(athlete, activities, options = {}) {
    const ftp    = athlete.ftp    || 200;
    const weight = athlete.weight || 75;
    const hours  = Math.max(4, Math.min(20, athlete.weekly_hours || 8));
    const goal   = GoalUtils.normalize(athlete.goal || 'resistencia');
    const trainingGoal = GoalUtils.toTrainingGoal(goal);
    const exp    = athlete.experience || 'intermedio';
    const days_per_week = Math.max(1, Math.min(7, athlete.days_per_week || 5));

    // TSB/CTL actuales — usar pmcData del AppState (fuente backend) si está disponible
    // Si no, calcular localmente como fallback offline
    const _CYCLING = ['cycling','Cycling','Ride','VirtualRide','EBikeRide','MountainBikeRide','GravelRide'];
    const cyclingActs = (activities || []).filter(a => !a.type || _CYCLING.includes(a.type));
    const pmcArr = (AppState.pmcData && AppState.pmcData.length >= 7)
      ? AppState.pmcData
      : PMC.compute(cyclingActs, 120, AppState.athlete?.initial_ctl || 0);
    const current = pmcArr.length ? pmcArr[pmcArr.length - 1] : { ctl: 30, atl: 30, tsb: 0 };
    const { ctl, atl, tsb } = current;
    console.log('[Plan] inputs:', { hours, exp, ftp, ctl: Math.round(ctl), atl: Math.round(atl), tsb: Math.round(tsb), cyclingActsCount: cyclingActs.length, totalActsCount: (activities||[]).length, weekly_hours: athlete.weekly_hours });

    // ── Eventos múltiples ──
    const events = this._parseEvents(athlete);
    const primaryEventDate = this._getPrimaryEventDate(events);

    // ── Aviso orientativo: ¿alcanzan las horas configuradas para el objetivo? ──
    const hoursWarning = this._checkMinRecommendedHours(goal, events, hours, ftp, weight);

    // ── Fase unificada (combina fecha de evento + ramp rate CTL) ──
    const effectivePhase = this._detectPhase(primaryEventDate, pmcArr, tsb);

    // ── Adherencia real: compara TSS completado vs esperado en últimas 4 semanas ──
    const adherence = this._calculateAdherence(cyclingActs, hours, exp);

    // ── Ciclo 3:1 — detectar semana del microciclo desde historial TSS ──
    const cycleInfo = options.cycleWeekOverride != null
      ? this._buildCycleFromWeek(options.cycleWeekOverride)
      : this._detectCycleWeek(cyclingActs);

    // ── TSS objetivo semanal ──
    const baseIF = { principiante: 0.60, intermedio: 0.68, avanzado: 0.74 }[exp] || 0.68;
    let targetTSS = Math.round(hours * 3600 * Math.pow(baseIF, 2) / 36);
    if (goal === 'perdida_peso') targetTSS = Math.round(targetTSS * 0.9);

    // Aplicar multiplicador de ciclo (semana 4 = recuperación)
    targetTSS = Math.round(targetTSS * cycleInfo.loadMultiplier);

    // Ajustar por adherencia real (baja adherencia → reducir carga para ser alcanzable)
    if (adherence < 0.6) {
      targetTSS = Math.round(targetTSS * 0.80);
    } else if (adherence < 0.75) {
      targetTSS = Math.round(targetTSS * 0.90);
    }

    // ── Macrociclo: contexto de posición hacia el evento ──
    const macrocycle = this._getMacrocycleContext(primaryEventDate, ctl, ftp, weight);

    // Si el macrociclo recomienda una carga específica, usarla como referencia
    if (macrocycle.weeklyTSSTarget && effectivePhase !== 'recovery' && tsb > -20) {
      const macroTSS = macrocycle.weeklyTSSTarget;
      // Tomar el que sea más conservador entre el calculado y el del macrociclo
      // (evitar saltos bruscos de carga)
      const maxAllowedJump = targetTSS * 1.10; // máximo +10% respecto al calculado por perfil
      targetTSS = Math.min(maxAllowedJump, Math.max(targetTSS * 0.85, macroTSS));
      targetTSS = Math.round(targetTSS);
    }

    // ── Ajuste automático de carga según TSB (override final de seguridad) ──
    let adaptation = null;
    const tsbRound = Math.round(tsb);

    if (tsb < -30) {
      targetTSS = Math.round(targetTSS * 0.60);
      adaptation = { level: 'danger', icon: '🛑', title: 'Semana de recuperación forzada',
        text: `TSB actual: ${tsbRound}. Zona de sobreentrenamiento. Plan sustituido por semana de recuperación activa.` };
    } else if (tsb < -20) {
      targetTSS = Math.round(targetTSS * 0.75);
      adaptation = { level: 'warning', icon: '⚠️', title: 'Plan aligerado — Fatiga alta',
        text: `TSB: ${tsbRound}. Volumen reducido un 25%. Prioriza el sueño y la nutrición.` };
    } else if (tsb < -10) {
      targetTSS = Math.round(targetTSS * 0.85);
      adaptation = { level: 'caution', icon: '⚖️', title: 'Plan ajustado — Fatiga moderada',
        text: `TSB: ${tsbRound}. Volumen reducido un 15% para asimilar carga sin acumular más estrés.` };
    } else if (cycleInfo.isRecoveryWeek) {
      adaptation = { level: 'info', icon: '🔄', title: `Semana ${cycleInfo.weekInCycle} — Recuperación programada`,
        text: `Llevas ${cycleInfo.weekInCycle - 1} semanas de carga progresiva. Esta semana es de recuperación activa (carga −25%) para que el cuerpo asimile las adaptaciones. La próxima semana retomará la carga completa.` };
    } else if (tsb >= -10 && tsb <= 5) {
      adaptation = { level: 'ok', icon: '💪', title: `Semana ${cycleInfo.weekInCycle} — En forma`,
        text: `TSB: ${tsbRound}. Equilibrio entre fitness y fatiga. ${macrocycle.blockLabel ? `Bloque actual: ${macrocycle.blockLabel}.` : 'Plan estándar.'}` };
    } else if (tsb > 5 && tsb <= 20) {
      adaptation = { level: 'good', icon: '✅', title: `Semana ${cycleInfo.weekInCycle} — Fresco y listo`,
        text: `TSB: ${tsbRound}. Fresco con buen fitness. ${macrocycle.blockLabel ? `Bloque: ${macrocycle.blockLabel}.` : ''} Carga completa planificada.` };
    } else if (tsb > 20) {
      adaptation = { level: 'peak', icon: '🚀', title: 'Forma óptima — Sesiones de calidad',
        text: `TSB: ${tsbRound}. Pico de forma. Plan prioriza calidad sobre volumen.` };
    }

    if (adherence < 0.65 && !adaptation) {
      adaptation = { level: 'caution', icon: '📉', title: 'Adherencia baja — Plan ajustado',
        text: `Has completado el ${Math.round(adherence * 100)}% de la carga esperada en las últimas 4 semanas. El plan se ha reducido para hacerlo más alcanzable. Cuando la consistencia mejore, la carga aumentará automáticamente.` };
    }

    // Reducir TSS ligeramente si hay un evento B la semana próxima (7-14 días)
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const nextBEvent = events.find(e => {
      if (e.priority !== 'B' || !e.date) return false;
      const d = new Date(e.date + 'T00:00:00');
      const days = Math.floor((d - today0) / 86400000);
      return days >= 7 && days <= 14;
    });
    if (nextBEvent) targetTSS = Math.round(targetTSS * 0.85);

    const advice = this._getAdvice(tsb, ctl, effectivePhase);
    const gymDays     = Math.max(0, Math.min(3, parseInt(athlete.gym_days)     || 0));
    const runningDays = Math.max(0, Math.min(3, parseInt(athlete.running_days) || 0));
    const walkingDays = Math.max(0, Math.min(3, parseInt(athlete.walking_days) || 0));
    const otherDays   = Math.max(0, Math.min(3, parseInt(athlete.other_days)   || 0));
    // Día previo de cada tipo de entrenamiento complementario (si se pasa), para que al
    // cambiar de tipo o quitar/añadir días se prefiera mantener el mismo día en vez de
    // saltar a otro por la preferencia fija de cada función _inject*Sessions.
    const previousDayTypes = options.previousDayTypes || {};
    // Índices de día (0=Lunes..6=Domingo) que el llamador va a sobreescribir igualmente
    // (días ya vividos de la semana en curso) — no asignar ahí entrenamiento complementario
    // nuevo, porque ese trabajo se descartaría justo después.
    const excludeDayIndices = options.excludeDayIndices || [];
    const sessions = this._injectOtherSessions(
      this._injectWalkingSessions(
        this._injectRunningSessions(
          this._injectGymSessions(
            this._buildSessions(trainingGoal, effectivePhase, ftp, weight, hours, exp, tsb, targetTSS, cyclingActs, days_per_week, athlete.segments, cycleInfo.weekInCycle, events, cycleInfo.globalWeekIdx || 0),
            gymDays, previousDayTypes, excludeDayIndices
          ),
          runningDays, previousDayTypes, excludeDayIndices
        ),
        walkingDays, previousDayTypes, excludeDayIndices
      ),
      otherDays, previousDayTypes, excludeDayIndices
    );

    // Tasa de progresión: ΔCTLsemana ≈ (carga_diaria - CTL) × (1 - e^(-7/42)) ≈ × 0.154
    const rampRate = Math.round((targetTSS / 7 - ctl) * this._CTL_WEEKLY_RESPONSE * 10) / 10;

    const today1 = new Date(); today1.setHours(0, 0, 0, 0);
    const upcomingEvents = events
      .filter(e => e.date && new Date(e.date + 'T00:00:00') >= today1)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 6);

    return {
      phase: effectivePhase,
      targetTSS,
      advice,
      adaptation,
      sessions,
      ctl: Math.round(ctl),
      tsb: tsbRound,
      rampRate,
      cycleInfo,
      macrocycle,
      adherence: Math.round(adherence * 100),
      upcomingEvents,
      hoursWarning,
    };
  },

  // ── Horas semanales mínimas orientativas por objetivo ──────────────
  // Referencia general de coaching, no un mínimo estricto: por debajo de estas
  // cifras el riesgo de llegar mal preparado al objetivo aumenta bastante.
  _MIN_HOURS_BY_GOAL: {
    sprint: 4, vo2max: 5, ftp: 6, resistencia: 6, perdida_peso: 5,
    carrera_corta: 6, gran_fondo: 8, carrera_larga: 9, ultra: 10,
  },

  _checkMinRecommendedHours(goal, events, hours, ftp, weight) {
    let minHours = this._MIN_HOURS_BY_GOAL[goal] || 6;
    let raceHoursEst = null;

    // Para objetivos de larga/ultra distancia, si el evento A trae distancia (y desnivel)
    // reales, afinamos el mínimo orientativo a partir del tiempo estimado de carrera.
    const aEvent = events.find(e => e.priority === 'A' && e.distance_km);
    if (aEvent && ['ultra', 'carrera_larga', 'gran_fondo'].includes(goal)) {
      const raceSec = Utils.estimateCyclingTime(aEvent.distance_km * 1000, aEvent.elevation_m || 0, ftp, weight);
      raceHoursEst = raceSec / 3600;
      // El volumen semanal en pico debería acercarse al tiempo estimado de carrera;
      // por debajo de ~70% de esa cifra el riesgo de no llegar preparado sube mucho.
      minHours = Math.max(minHours, Math.round(raceHoursEst * 0.7));
    }

    if (hours >= minHours) return null;
    return {
      hours,
      minHours,
      raceHoursEst: raceHoursEst != null ? Math.round(raceHoursEst * 10) / 10 : null,
    };
  },

  // ── Eventos múltiples ────────────────────────────────────────────
  _parseEvents(athlete) {
    let events = [];
    if (athlete.target_events) {
      try {
        events = typeof athlete.target_events === 'string'
          ? JSON.parse(athlete.target_events)
          : athlete.target_events;
        if (!Array.isArray(events)) events = [];
      } catch { events = []; }
    }
    // Backward compat: legacy event_date → A event si no hay ninguno A configurado
    if (!events.some(e => e.priority === 'A') && athlete.event_date) {
      events = [{ id: '_legacy', name: 'Evento principal', date: athlete.event_date, priority: 'A' }, ...events];
    }
    return events.filter(e => e.date);
  },

  _getPrimaryEventDate(events) {
    const aEvents = events.filter(e => e.priority === 'A' && e.date);
    if (!aEvents.length) return null;
    // Preferir eventos no-legacy; entre varios, tomar la fecha más futura
    const nonLegacy = aEvents.filter(e => e.id !== '_legacy');
    const candidates = nonLegacy.length ? nonLegacy : aEvents;
    return candidates.reduce((best, e) => e.date > best.date ? e : best).date;
  },

  // Inyecta marcadores de carrera A/B/C en el array de sesiones de la semana actual
  _injectEventMarkers(sessions, events) {
    if (!events || !events.length) return sessions;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    const result = sessions.map(s => ({ ...s }));

    for (const ev of events) {
      if (!ev.date) continue;
      const evDate = new Date(ev.date + 'T00:00:00');
      const dayIndex = Math.floor((evDate - monday) / 86400000);
      if (dayIndex < 0 || dayIndex > 6) continue;

      // Carrera A: marcar el día aunque ya esté en el plan como 'race' o descanso
      if (ev.priority === 'A') {
        // Solo sobreescribir si el slot actual no tiene ya un 'race' del template
        if (result[dayIndex].type !== 'race') {
          result[dayIndex] = {
            ...result[dayIndex], day: DAYS[dayIndex],
            type: 'race', name: `🏁 ${ev.name || 'Carrera A — Evento Principal'}`,
            description: 'Tu evento principal. Ejecuta el plan de carrera que has preparado. ¡A darlo todo!',
            isRaceA: true, isRest: false, durationMin: result[dayIndex].durationMin || 180, targetTSS: null,
          };
        } else {
          // El template ya tiene 'race' en ese día, solo marcar isRaceA
          result[dayIndex] = { ...result[dayIndex], isRaceA: true };
        }
        // Marcar 1-2 días antes como activación (solo si no son descanso ya)
        for (let pre = 1; pre <= 2; pre++) {
          const idx = dayIndex - pre;
          if (idx >= 0 && result[idx] && !result[idx].isRaceB && result[idx].type !== 'race') {
            result[idx] = {
              ...result[idx],
              name: pre === 1 ? 'Activación pre-carrera A' : 'Rodada suave (pre-carrera A)',
              description: `Sesión ligera previa a ${ev.name || 'la carrera A'}. Volumen mínimo, 4-6 aceleraciones cortas.`,
              type: 'z2',
              durationMin: Math.round((result[idx].durationMin || 60) * (pre === 1 ? 0.5 : 0.6)),
              targetTSS: null, isPreRace: true, isRest: false,
            };
          }
        }
        continue;
      }

      if (ev.priority === 'B') {
        result[dayIndex] = {
          ...result[dayIndex], day: DAYS[dayIndex],
          type: 'race', name: `🏁 ${ev.name || 'Carrera B'}`,
          description: 'Evento B. Calienta bien y ejecuta según sensaciones. No salgas al límite en el inicio.',
          isRaceB: true, isRest: false, durationMin: result[dayIndex].durationMin || 120, targetTSS: null,
        };
        // 1-2 días antes → activación
        for (let pre = 1; pre <= 2; pre++) {
          const idx = dayIndex - pre;
          if (idx >= 0 && result[idx] && !result[idx].isRest) {
            result[idx] = {
              ...result[idx],
              name: pre === 1 ? 'Activación pre-carrera' : 'Rodada suave (pre-carrera)',
              description: `Sesión ligera previa a ${ev.name || 'la carrera B'}. Volumen reducido, 4-6 aceleraciones cortas a ritmo carrera (10-15 s).`,
              type: 'z2',
              durationMin: Math.round((result[idx].durationMin || 60) * (pre === 1 ? 0.55 : 0.65)),
              targetTSS: null, isPreRaceB: true,
            };
          }
        }
        // 1-2 días después → recuperación
        for (let post = 1; post <= 2; post++) {
          const idx = dayIndex + post;
          if (idx <= 6 && result[idx] && !result[idx].isRest) {
            result[idx] = {
              ...result[idx],
              name: 'Recuperación post-carrera',
              description: `Recuperación activa tras ${ev.name || 'la carrera B'}. Rodada muy suave Z1, hidratación y nutrición prioritarias.`,
              type: 'recovery',
              durationMin: Math.min(55, result[idx].durationMin || 45),
              targetTSS: null, isPostRaceB: true,
            };
          }
        }
      } else if (ev.priority === 'C') {
        result[dayIndex] = {
          ...result[dayIndex], day: DAYS[dayIndex],
          name: `🏁 ${ev.name || 'Carrera C'} (+entreno)`,
          description: 'Evento C. Participa a ritmo controlado como entrenamiento de calidad; no altera el plan.',
          isRaceC: true, targetTSS: null,
        };
      }
    }
    return result;
  },

  // Inyecta días de gimnasio reemplazando los slots de menor prioridad
  _injectGymSessions(sessions, gymDays, previousDayTypes = {}, excludeDayIndices = []) {
    if (!gymDays || gymDays <= 0) return sessions;
    const result = sessions.map(s => ({ ...s }));
    // Preferencia de día: martes y jueves primero (no pisan fondo del fin de semana)
    const DAY_SCORE = { 'Martes':0, 'Jueves':1, 'Miércoles':2, 'Lunes':3, 'Viernes':4, 'Sábado':5, 'Domingo':6 };
    const typeScore = s => s.isRest ? 0 : ({ recovery:1, endurance:2 }[s.type] ?? 99);
    // 0 = el día ya era gimnasio (sin cambios) · 1 = el día tenía OTRO entrenamiento
    // complementario que ya no se usa (slot liberado, se reutiliza antes que uno nuevo) ·
    // 2 = descanso/recuperación nunca usado para cross-training.
    const stability = day => previousDayTypes[day] === 'gym' ? 0 : (previousDayTypes[day] ? 1 : 2);
    const excludeSet = new Set(excludeDayIndices);
    const candidates = result
      .map((s, i) => ({ i, st: stability(s.day), ts: typeScore(s), ds: DAY_SCORE[s.day] ?? 6 }))
      .filter(c => c.ts < 99 && !excludeSet.has(c.i))
      .sort((a, b) => a.st !== b.st ? a.st - b.st : a.ts !== b.ts ? a.ts - b.ts : a.ds - b.ds)
      .slice(0, gymDays);
    for (const { i } of candidates) {
      result[i] = {
        day: result[i].day, type: 'gym', emoji: '🏋️',
        name: 'Gimnasio — Fuerza y movilidad',
        description: 'Sesión de fuerza en sala: tren inferior (sentadilla, peso muerto, prensa), tren superior (press, dominadas/remo) y core. 3-4 series × 8-12 reps a RPE 7-8. Finaliza con 10 min de estiramientos y movilidad de cadera.',
        isGym: true, isRest: false, tss: 45, durationMin: 60, tssShare: 0, ifTarget: null, intervals: null,
      };
    }
    // Renormalizar tssShare entre las sesiones ciclistas restantes
    const total = result.reduce((s, r) => s + (r.tssShare || 0), 0);
    if (total > 0 && Math.abs(total - 1) > 0.01)
      result.forEach(s => { if (s.tssShare) s.tssShare = s.tssShare / total; });
    return result;
  },

  // Inyecta días de running reemplazando slots de menor prioridad
  _injectRunningSessions(sessions, runningDays, previousDayTypes = {}, excludeDayIndices = []) {
    if (!runningDays || runningDays <= 0) return sessions;
    const result = sessions.map(s => ({ ...s }));
    const DAY_SCORE = { 'Lunes':0, 'Miércoles':1, 'Martes':2, 'Jueves':3, 'Viernes':4, 'Sábado':5, 'Domingo':6 };
    const typeScore = s => s.isRest ? 0 : ({ recovery:1, endurance:2 }[s.type] ?? 99);
    const stability = day => previousDayTypes[day] === 'running' ? 0 : (previousDayTypes[day] ? 1 : 2);
    const excludeSet = new Set(excludeDayIndices);
    const candidates = result
      .map((s, i) => ({ i, st: stability(s.day), ts: typeScore(s), ds: DAY_SCORE[s.day] ?? 6 }))
      .filter(c => c.ts < 99 && !excludeSet.has(c.i))
      .sort((a, b) => a.st !== b.st ? a.st - b.st : a.ts !== b.ts ? a.ts - b.ts : a.ds - b.ds)
      .slice(0, runningDays);
    for (const { i } of candidates) {
      result[i] = {
        day: result[i].day, type: 'running', emoji: '🏃',
        name: 'Running — Carrera fácil Z2',
        description: 'Carrera a ritmo fácil aeróbico (Z2). Mantén una conversación cómoda durante toda la sesión. Cadencia 170-180 ppm. Finaliza con 5 min de estiramientos de piernas.',
        isRunning: true, isRest: false, tss: 38, durationMin: 45, tssShare: 0, ifTarget: null, intervals: null,
      };
    }
    const total = result.reduce((s, r) => s + (r.tssShare || 0), 0);
    if (total > 0 && Math.abs(total - 1) > 0.01)
      result.forEach(s => { if (s.tssShare) s.tssShare = s.tssShare / total; });
    return result;
  },

  // Inyecta días de caminata en días de descanso o recuperación
  _injectWalkingSessions(sessions, walkingDays, previousDayTypes = {}, excludeDayIndices = []) {
    if (!walkingDays || walkingDays <= 0) return sessions;
    const result = sessions.map(s => ({ ...s }));
    const DAY_SCORE = { 'Lunes':0, 'Miércoles':1, 'Viernes':2, 'Martes':3, 'Jueves':4, 'Sábado':5, 'Domingo':6 };
    const typeScore = s => ({ isRest: 0, recovery: 1 }[s.isRest ? 'isRest' : s.type] ?? (s.isRest ? 0 : 99));
    const stability = day => previousDayTypes[day] === 'walking' ? 0 : (previousDayTypes[day] ? 1 : 2);
    const excludeSet = new Set(excludeDayIndices);
    const candidates = result
      .map((s, i) => ({ i, st: stability(s.day), ts: s.isRest ? 0 : (s.type === 'recovery' ? 1 : 99), ds: DAY_SCORE[s.day] ?? 6 }))
      .filter(c => c.ts < 99 && !excludeSet.has(c.i))
      .sort((a, b) => a.st !== b.st ? a.st - b.st : a.ts !== b.ts ? a.ts - b.ts : a.ds - b.ds)
      .slice(0, walkingDays);
    for (const { i } of candidates) {
      result[i] = {
        day: result[i].day, type: 'walking', emoji: '🚶',
        name: 'Caminata — Recuperación activa',
        description: 'Caminata de recuperación activa al aire libre. Ritmo tranquilo sin superar Z1. Ideal para activar la circulación, reducir rigidez y despejar la mente. 30-45 min.',
        isWalking: true, isRest: false, tss: 15, durationMin: 40, tssShare: 0, ifTarget: null, intervals: null,
      };
    }
    return result;
  },

  // Inyecta días de otro deporte (escalada, karate, etc.) en slots de menor carga
  _injectOtherSessions(sessions, otherDays, previousDayTypes = {}, excludeDayIndices = []) {
    if (!otherDays || otherDays <= 0) return sessions;
    const result = sessions.map(s => ({ ...s }));
    const DAY_SCORE = { 'Martes':0, 'Jueves':1, 'Lunes':2, 'Miércoles':3, 'Viernes':4, 'Sábado':5, 'Domingo':6 };
    const stability = day => previousDayTypes[day] === 'other' ? 0 : (previousDayTypes[day] ? 1 : 2);
    const excludeSet = new Set(excludeDayIndices);
    const candidates = result
      .map((s, i) => ({ i, st: stability(s.day), ts: s.isRest ? 0 : (s.type === 'recovery' ? 1 : (s.type === 'endurance' ? 2 : 99)), ds: DAY_SCORE[s.day] ?? 6 }))
      .filter(c => c.ts < 99 && !excludeSet.has(c.i))
      .sort((a, b) => a.st !== b.st ? a.st - b.st : a.ts !== b.ts ? a.ts - b.ts : a.ds - b.ds)
      .slice(0, otherDays);
    for (const { i } of candidates) {
      result[i] = {
        day: result[i].day, type: 'other', emoji: '⚡',
        name: 'Otro deporte — Actividad complementaria',
        description: 'Sesión de deporte complementario (escalada, karate, natación, padel…). Intensidad moderada, RPE 5-6. Registra el TSS real en la sección Actividades para que el plan lo contabilice.',
        isOther: true, isRest: false, tss: 40, durationMin: 60, tssShare: 0, ifTarget: null, intervals: null,
      };
    }
    const total = result.reduce((s, r) => s + (r.tssShare || 0), 0);
    if (total > 0 && Math.abs(total - 1) > 0.01)
      result.forEach(s => { if (s.tssShare) s.tssShare = s.tssShare / total; });
    return result;
  },

  // Computa el consejo de terreno a partir del tipo y los intervalos actuales.
  // Método público para que training-plan.html pueda llamarlo al recargar el plan.
  _buildTerrain(type, intervals) {
    let t = '';
    if (type === 'sprint') {
      const seg = (this._activeSegments && this._activeSegments[0]) || { name: 'una subida corta de ~1 min', km: 1, grad: 5 };
      t = ` ⚡ Terreno ideal: ${seg.name}${seg.km && seg.grad && !seg.name.includes('~') ? ` (${seg.km} km / ${seg.grad}%)` : ''} — arranca en la entrada y da todo.`;
    } else if (type === 'vo2max') {
      const repDur = (intervals || []).find(iv => iv.label.includes('VO₂') || iv.label.includes('Series') || iv.label.includes('Micro-intervalos'))?.dur;
      const mins = repDur ? parseFloat(repDur) : 4;
      const seg = this._pickSegment(mins, 'minVO2');
      t = seg.name.includes('~')
        ? ` ⛰️ Terreno ideal: subida de ${mins} min — sube fuerte, baja suave como recuperación.`
        : ` ⛰️ Terreno ideal: ${seg.name} (${seg.km} km / ${seg.grad}%) — sube fuerte, baja suave como recuperación.`;
    } else if (type === 'threshold') {
      const repDur = (intervals || []).find(iv => iv.label.includes('umbral') || iv.label.includes('Umbral') || iv.label.includes('Over'))?.dur;
      const mins = repDur ? parseFloat(repDur) : 8;
      const seg = this._pickSegment(mins, 'minThresh');
      t = seg.name.includes('~')
        ? ` ⛰️ Terreno ideal: subida de ${mins} min — sostenida al FTP de inicio a fin.`
        : ` ⛰️ Terreno ideal: ${seg.name} (${seg.km} km / ${seg.grad}%) — sostenido al FTP de inicio a fin.`;
    } else if (type === 'strength') {
      const repDur = (intervals || []).find(iv => iv.label.includes('uerza') || iv.label.includes('fuerza'))?.dur;
      const mins = repDur ? parseFloat(repDur) : 6;
      const seg = this._pickSegment(mins, 'minThresh');
      t = seg.name.includes('~')
        ? ` ⛰️ Terreno ideal: subida de ${mins} min — cadencia baja (50-65 rpm), máxima aplicación de fuerza.`
        : ` ⛰️ Terreno ideal: ${seg.name} (${seg.km} km / ${seg.grad}%) — cadencia baja (50-65 rpm), máxima aplicación de fuerza.`;
    } else if (type === 'tempo') {
      const repDur = (intervals || []).find(iv => iv.label.includes('Z3') || iv.label.includes('Sweetspot') || iv.label.includes('Tempo'))?.dur;
      const mins = repDur ? parseFloat(repDur) : 12;
      const seg = this._pickSegment(mins, 'minThresh');
      t = seg.name.includes('~')
        ? ` ⛰️ Terreno ideal: subida o tramo de ${mins} min — sweetspot sostenido, respiración elevada pero rítmica.`
        : ` ⛰️ Terreno ideal: ${seg.name} (${seg.km} km / ${seg.grad}%) — sweetspot sostenido, respiración elevada pero rítmica.`;
    } else if (['endurance', 'recovery', 'long'].includes(type)) {
      t = ` 🛣️ Terreno ideal: Terreno lo más llano y continuo posible para mantener los vatios estables.`;
    }
    return t.trim();
  },

  // ── Detección de fase unificada ──────────────────────────────────
  // Combina fecha de evento + ramp rate CTL + TSB para una fase coherente
  _detectPhase(eventDate, pmcArr, tsb) {
    // Override crítico: sobreentrenamiento o fatiga extrema
    if (tsb < -30) return 'recovery';

    // Con fecha de evento configurada
    if (eventDate) {
      const eventLocal = new Date(eventDate + 'T00:00:00'); // hora local, no UTC
      const todayLocal = new Date(); todayLocal.setHours(0, 0, 0, 0);
      const daysUntil = Math.floor((eventLocal - todayLocal) / 86400000);
      if (daysUntil < 0)   return 'recovery'; // evento pasado → recuperación post-evento
      if (daysUntil < 7)   return 'race';
      if (daysUntil < 22)  return 'peak';    // ≤ 3 semanas: taper
      if (daysUntil < 113) return 'build';   // 3–16 semanas: build (inicio o intenso)
      return 'base';                          // > 16 semanas: base aeróbica
    }

    // Sin evento o evento muy lejano: usar tendencia CTL (ramp rate últimas 2 semanas)
    if (pmcArr && pmcArr.length >= 14) {
      const recent = pmcArr.slice(-7).reduce((s, p) => s + p.ctl, 0) / 7;
      const before = pmcArr.slice(-14, -7).reduce((s, p) => s + p.ctl, 0) / 7;
      const ramp = recent - before; // CTL ganado/perdido por semana

      if (ramp > 3)                        return 'build';    // CTL subiendo activamente
      if (ramp < -3 && tsb > -15)          return 'peak';     // CTL bajando, TSB positivo → tapering
      if (ramp < -3 && tsb <= -15)         return 'recovery'; // CTL bajando, muy fatigado
    }

    return 'base';
  },

  // ── Adherencia real de las últimas 4 semanas ────────────────────
  _calculateAdherence(activities, weeklyHoursTarget, exp = 'intermedio') {
    const now = new Date();
    const fourWeeksAgo = new Date(now.getTime() - 28 * 86400000);
    const recentActs = activities.filter(a => {
      const d = new Date((a.date || '1970-01-01') + 'T00:00:00');
      return d >= fourWeeksAgo && d <= now && (a.tss || 0) > 0;
    });

    const actualTSS4w = recentActs.reduce((s, a) => s + (a.tss || 0), 0);

    // TSS esperado según nivel de experiencia (igual que baseIF en _buildSessions)
    const baseIF = { principiante: 0.60, intermedio: 0.68, avanzado: 0.74 }[exp] || 0.68;
    const expectedWeeklyTSS = Math.round(weeklyHoursTarget * 3600 * baseIF * baseIF / 36);
    const expectedTSS4w = expectedWeeklyTSS * 4;

    if (expectedTSS4w === 0) return 1.0;
    return Math.min(1.20, actualTSS4w / expectedTSS4w);
  },

  // ── Ciclo 3:1: detectar semana del microciclo desde historial ────
  _detectCycleWeek(activities) {
    const now = new Date();
    // TSS de cada una de las últimas 4 semanas
    const weekTSS = [];
    for (let w = 0; w < 4; w++) {
      const end   = new Date(now.getTime() - w * 7 * 86400000);
      const start = new Date(now.getTime() - (w + 1) * 7 * 86400000);
      const tss = activities
        .filter(a => {
          const d = new Date((a.date || '1970-01-01') + 'T00:00:00');
          return d >= start && d < end;
        })
        .reduce((s, a) => s + (a.tss || 0), 0);
      weekTSS.unshift(tss); // índice 0 = hace 4 semanas, índice 3 = semana actual
    }

    // Determinar si la semana pasada fue de recuperación
    const prevWeek = weekTSS[2]; // semana pasada
    const avg3w = (weekTSS[0] + weekTSS[1] + weekTSS[2]) / 3;
    const lastWasRecovery = avg3w > 10 && prevWeek < avg3w * 0.55;

    // Contar semanas consecutivas de carga (sin recuperación)
    let consecLoadWeeks = 0;
    for (let i = 3; i >= 0; i--) {
      const ref = i > 0 ? weekTSS[i - 1] : weekTSS[0] * 0.9;
      if (weekTSS[i] >= ref * 0.70) consecLoadWeeks++;
      else break;
    }

    // Semana en el ciclo
    let weekInCycle, loadMultiplier, isRecoveryWeek;
    if (lastWasRecovery) {
      weekInCycle = 1; loadMultiplier = 1.00; isRecoveryWeek = false;
    } else if (consecLoadWeeks >= 3) {
      // 3 semanas de carga → esta semana es recuperación
      weekInCycle = 4; loadMultiplier = 0.75; isRecoveryWeek = true;
    } else if (consecLoadWeeks === 2) {
      weekInCycle = 3; loadMultiplier = 1.10; isRecoveryWeek = false;
    } else if (consecLoadWeeks === 1) {
      weekInCycle = 2; loadMultiplier = 1.05; isRecoveryWeek = false;
    } else {
      weekInCycle = 1; loadMultiplier = 1.00; isRecoveryWeek = false;
    }

    // Índice global de semanas entrenadas (no se resetea en semanas de recuperación)
    const mondayOf = d => { const x = new Date(d); const day = x.getDay()||7; x.setDate(x.getDate()-day+1); x.setHours(0,0,0,0); return x.toISOString().slice(0,10); };
    const globalWeekIdx = new Set(activities.filter(a => (a.tss||0) > 5).map(a => mondayOf((a.date?.slice(0,10)||'2000-01-01')+'T00:00:00'))).size;

    return { weekInCycle, loadMultiplier, isRecoveryWeek, weeklyTSS: weekTSS, globalWeekIdx };
  },

  // Construir cycleInfo sintético para simulación de semana futura
  _buildCycleFromWeek(weekInCycle) {
    const w = Math.max(1, Math.min(4, weekInCycle));
    const multipliers = { 1: 1.00, 2: 1.05, 3: 1.10, 4: 0.75 };
    return {
      weekInCycle: w,
      loadMultiplier: multipliers[w],
      isRecoveryWeek: w === 4,
      weeklyTSS: [0, 0, 0, 0],
    };
  },

  // ── Macrociclo: contexto de posición hacia el evento ────────────
  _getMacrocycleContext(eventDate, currentCTL, ftp, weight) {
    if (!eventDate) return { blockLabel: null, weeklyTSSTarget: null, weeksToEvent: null };

    const eventLocalM = new Date(eventDate + 'T00:00:00');
    const todayLocalM = new Date(); todayLocalM.setHours(0, 0, 0, 0);
    const daysToEvent = Math.floor((eventLocalM - todayLocalM) / 86400000);
    if (daysToEvent < 0) return { blockLabel: 'Post-evento — Recuperación', weeklyTSSTarget: null, weeksToEvent: 0 };

    const weeksToEvent = Math.ceil(daysToEvent / 7);
    const wkg = ftp / (weight || 70);

    // CTL objetivo en el evento: estimado según W/kg y objetivo
    // Un CTL de ~65-85 es típico para competidores recreativos, >85 para avanzados
    const targetCTLAtEvent = wkg < 2.5 ? 45 : wkg < 3.5 ? 65 : wkg < 4.5 ? 85 : 100;
    const ctlGap = Math.max(0, targetCTLAtEvent - currentCTL);

    // Ramp rate necesario para llegar al objetivo (máximo recomendado: 5-6 CTL/semana)
    const maxRamp = 5;
    const neededRamp = weeksToEvent > 0 ? ctlGap / weeksToEvent : 0;
    const feasibleRamp = Math.min(neededRamp, maxRamp);

    // Bloque actual basado en semanas al evento
    let blockLabel, blockWeeks;
    if (weeksToEvent <= 1)       { blockLabel = 'Semana de carrera';      blockWeeks = 1; }
    else if (weeksToEvent <= 3)  { blockLabel = 'Taper — Puesta a punto'; blockWeeks = weeksToEvent; }
    else if (weeksToEvent <= 8)  { blockLabel = 'Bloque Build';           blockWeeks = weeksToEvent - 3; }
    else if (weeksToEvent <= 16) { blockLabel = 'Bloque Build (inicio)';  blockWeeks = weeksToEvent - 8; }
    else                         { blockLabel = 'Bloque Base';            blockWeeks = weeksToEvent - 8; }

    // TSS objetivo esta semana basado en ramp deseado.
    // CTL_next = CTL_current + (weeklyTSS/7 - CTL_current) × _CTL_WEEKLY_RESPONSE, y
    // queremos CTL_next = CTL_current + feasibleRamp → despejando:
    // weeklyTSS = (CTL_current + feasibleRamp / _CTL_WEEKLY_RESPONSE) × 7
    // (antes faltaba dividir por el coeficiente, así que prescribía ~6.5x menos TSS
    // del necesario para llegar a tiempo al objetivo del atleta)
    const weeklyTSSTarget = weeksToEvent > 3
      ? Math.round((currentCTL + feasibleRamp / this._CTL_WEEKLY_RESPONSE) * 7)
      : null; // en taper: no prescribir carga del macrociclo

    return { blockLabel, blockWeeks, weeksToEvent, targetCTLAtEvent, currentCTL: Math.round(currentCTL), weeklyTSSTarget };
  },

  _getAdvice(tsb, ctl, phase) {
    if (tsb < -30) return { color: 'danger',  title: '🛑 Sobreentrenamiento — Reduce carga', text: 'Tu TSB está en territorio peligroso. Prioriza recuperación esta semana. Cancela las sesiones de calidad y haz únicamente Z1-Z2 suave.' };
    if (tsb < -15) return { color: 'warning', title: '⚠️ Fatiga acumulada — Semana de carga', text: 'Estás en bloque de entrenamiento. Ejecuta el plan pero asegura 8h de sueño. Monitorea el HRV.' };
    if (tsb > 20)  return { color: 'success', title: '🚀 Pico de forma — ¡Listo para competir!', text: 'TSB positivo alto: estás fresco con buen fitness. Ideal para rodadas de calidad o competición.' };
    const phaseMessages = {
      base:     { color: 'info',    title: '🏗️ Fase Base — Construye el motor aeróbico', text: 'El 80% del volumen debe ser Z1-Z2. Paciencia: la base aeróbica tarda 8-12 semanas en consolidarse.' },
      build:    { color: 'warning', title: '🔨 Fase Build — Añade intensidad específica', text: 'Momento de subir el FTP con intervalos al umbral y VO₂ Max. La carga aumenta progresivamente.' },
      peak:     { color: 'success', title: '🏔️ Fase Pico — Taper y agudeza', text: 'Reduce volumen 30-40% pero mantén algo de intensidad para conservar la agudeza neuromuscular.' },
      race:     { color: 'success', title: '🏁 Semana de carrera — Activa y descansa', text: 'Solo activación ligera. Duerme bien, hidrátate e ingiere carbohidratos los 2 días previos.' },
      recovery: { color: 'info',    title: '🔄 Recuperación post-evento', text: 'El cuerpo se adapta durante la recuperación. 1-2 semanas de Z1-Z2 ligero antes de retomar la carga.' },
    };
    return phaseMessages[phase] || phaseMessages.base;
  },

  // Endurance: IF máx 0.68 para mantener estabilidad aeróbica y baja fatiga.
  // Long: techo 0.72 — algunas plantillas piden 0.70-0.72 a propósito para simular
  // ritmo real de carrera/gran fondo, y antes se recortaban igual que endurance.
  _capAerobicIF(type, rawIF) {
    if (type === 'endurance') return Math.min(0.68, rawIF);
    if (type === 'long')      return Math.min(0.72, rawIF);
    return rawIF;
  },

  // Vatios representativos del bloque principal (no calentamiento/recuperación/vuelta a
  // la calma) para el badge "~XXXW" de la tarjeta de sesión.
  _mainBlockWatts(intervals, ftp, ifTarget) {
    const SKIP = /calentamiento|vuelta a la calma|enfriamiento|recuperaci[oó]n|descanso/i;
    const main = (intervals || []).find(iv => !SKIP.test(iv.label));
    const nums = main?.watts ? String(main.watts).match(/\d+/g) : null;
    if (!nums || !nums.length) return Math.round(ftp * ifTarget);
    const vals = nums.map(Number);
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  },

  _buildDesc(ivs) {
    let parts = [];
    for (let idx = 0; idx < ivs.length; idx++) {
      let i = ivs[idx];
      let repsMatch = i.label.match(/\(×(\d+)/);
      let baseLabel = i.label.split(' (')[0].trim();
      let durVal = i.dur.replace(' c/u', '').trim();
      if (repsMatch) {
        let reps = repsMatch[1];
        let next = ivs[idx + 1];
        if (next && (next.label.toLowerCase().includes('recuperación') || next.label.toLowerCase().includes('descanso')) && next.label.includes('(×')) {
           let nextDur = next.dur.replace(' c/u', '').trim();
           parts.push(`${reps}×${durVal} ${baseLabel} (rec: ${nextDur})`);
           idx++;
        } else {
           parts.push(`${reps}×${durVal} ${baseLabel}`);
        }
      } else {
        parts.push(`${durVal} ${baseLabel}`);
      }
    }
    return parts.join(' + ');
  },

  _buildSessions(goal, phase, ftp, weight, hours, exp, tsb, targetTSS, activities, days_per_week = 5, userSegments = null, weekInCycle = 1, events = [], globalWeekIdx = 0) {
    // Cargar segmentos configurados por el usuario (o usar los por defecto hardcoded como fallback)
    if (userSegments && Array.isArray(userSegments) && userSegments.length > 0) {
      this._activeSegments = userSegments.map(s => ({
        name: s.name || 'Subida local',
        km: Number(s.km) || 2,
        grad: Number(s.grad) || 5,
        // Estimar tiempos a partir de la geometría del segmento
        // Velocidad típica al umbral en subida ≈ 18 km/h en 5%; ajustar por pendiente
        minThresh: Math.round((s.km / Math.max(12, 22 - s.grad * 0.8)) * 60),
        minVO2:    Math.round((s.km / Math.max(14, 24 - s.grad * 0.8)) * 60),
      }));
    } else {
      this._activeSegments = this._LOCAL_SEGMENTS;
    }
    // ── Selección de plantilla según goal y phase ──
    let templates = this._getTemplate(goal, phase, exp, tsb, weekInCycle, globalWeekIdx);

    // ── Respetar días de entrenamiento configurados por el atleta ──
    // Prioridad de eliminación: recuperación primero, luego endurance, calidad al final.
    // Los fondos (long) son la base aeróbica más valiosa — se eliminan los últimos.
    const TYPE_PRIORITY = { recovery: 1, endurance: 2, tempo: 3, threshold: 4, strength: 4, sprint: 5, vo2max: 5, long: 6, race: 7 };
    const trainingDays = templates.filter(t => !t.isRest);
    if (trainingDays.length > days_per_week) {
      const excess = trainingDays.length - days_per_week;
      const WEEKEND = new Set(['Sábado', 'Domingo']);

      // 1. Eliminar primero días entre semana (por prioridad ascendente).
      //    El bloque Sáb+Dom se protege: reparte el volumen largo entre dos jornadas
      //    y no concentra 5h en un solo día.
      const weekdays  = trainingDays.filter(t => !WEEKEND.has(t.day))
        .sort((a, b) => (TYPE_PRIORITY[a.type] || 4) - (TYPE_PRIORITY[b.type] || 4));
      const weekends  = trainingDays.filter(t =>  WEEKEND.has(t.day))
        .sort((a, b) => (TYPE_PRIORITY[a.type] || 4) - (TYPE_PRIORITY[b.type] || 4));

      const toRemove = new Set();
      let left = excess;
      for (const d of weekdays)  { if (left <= 0) break; toRemove.add(d.day); left--; }
      // Solo si aún faltan días por eliminar se toca el fin de semana
      for (const d of weekends)  { if (left <= 0) break; toRemove.add(d.day); left--; }

      templates = templates.map(t =>
        toRemove.has(t.day)
          ? { day: t.day, isRest: true, description: 'Descanso activo — movilidad, estiramientos o caminar.' }
          : t
      );
      const remainingTotal = templates.filter(t => !t.isRest && t.tssShare).reduce((s, t) => s + t.tssShare, 0);
      if (remainingTotal > 0)
        templates = templates.map(t => (t.isRest || !t.tssShare) ? t : { ...t, tssShare: t.tssShare / remainingTotal });
    }

    // Con fatiga alta sustituir la sesión más intensa por endurance
    if (tsb < -20 && tsb >= -30) {
      const hardTypes = ['vo2max', 'sprint', 'strength'];
      let swapped = false;
      templates = templates.map(t => {
        if (!swapped && !t.isRest && hardTypes.includes(t.type)) {
          swapped = true;
          return { ...t, type: 'endurance', name: 'Z2 — Sesión suavizada por fatiga', ifTarget: 0.65,
            description: 'Sustituye la sesión de alta intensidad prevista. Tu cuerpo necesita asimilar antes de añadir más estrés.' };
        }
        return t;
      });
    }

    // Progresión de intensidad intra-fase: semana 1=base, 2=+1%, 3=+2%, 4(recuperación)=-5%
    // Solo se aplica a sesiones de calidad; Z2/recuperación/long no cambian de IF
    const INTENSITY_BOOST = { 1: 1.00, 2: 1.01, 3: 1.02, 4: 0.95 };
    const intensityBoost = INTENSITY_BOOST[weekInCycle] || 1.00;
    // Alternancia de variante de intervalos: semanas impares → main, pares → alt
    const intervalVariant = (weekInCycle % 2 === 1) ? 'main' : 'alt';

    // Calcular duración de cada sesión en minutos a partir de la distribución de TSS
    const sessions = templates.map(t => {
      if (t.isRest) return t;

      let sessTSS  = Math.round(t.tssShare * targetTSS);
      // Progresión: intensidad sube 1-2% en sesiones de calidad conforme avanza el ciclo 3:1
      const isQuality = ['threshold', 'vo2max', 'tempo', 'sprint', 'strength'].includes(t.type);
      const rawIF  = t.ifTarget || 0.65;
      const cappedIF = this._capAerobicIF(t.type, rawIF);
      let ifTarget = isQuality ? Math.min(1.05, Math.round(cappedIF * intensityBoost * 100) / 100) : cappedIF;

      // Cap de TSS por sesión ANTES del cálculo de duración.
      // Evita que la normalización de días_semana concentre TSS absurdos en una sola sesión.
      const MAX_TSS_PER_TYPE = { long: 185, endurance: 140, recovery: 45, tempo: 115, threshold: 115, vo2max: 115, sprint: 100, strength: 100 };
      sessTSS = Math.min(MAX_TSS_PER_TYPE[t.type] || 140, sessTSS);

      // Duración: TSS = (dur_h * NP * IF) / (FTP * 3600) * 100 → dur_h = TSS/(IF²*100) h
      let durMin = Math.round((sessTSS / (Math.pow(ifTarget, 2) * 100)) * 60);

      // Salvaguarda fisiológica: límites mínimos y máximos de duración
      // Mínimo 70 min (1h10) para cualquier sesión ciclista — nadie se viste de bici para menos
      let minDur = 70, maxDur = 240;
      if (['vo2max', 'threshold', 'tempo', 'sprint', 'strength'].includes(t.type)) {
        maxDur = 150;
      } else if (t.type === 'long') {
        minDur = (exp === 'avanzado') ? 120 : 90;
        maxDur = 240;
      } else if (t.type === 'endurance') {
        maxDur = 210;
      } else if (t.type === 'recovery') {
        maxDur = 90;
      }

      if (durMin < minDur) {
        // Mantener el TSS objetivo bajando el IF en lugar de subir el TSS
        const newIF = Math.sqrt(sessTSS / ((minDur / 60) * 100));
        if (newIF >= 0.50) ifTarget = Math.round(newIF * 100) / 100;
        durMin = minDur;
        sessTSS = Math.round((durMin / 60) * Math.pow(ifTarget, 2) * 100);
      }
      if (durMin > maxDur) {
        durMin = maxDur;
        sessTSS = Math.round((durMin / 60) * Math.pow(ifTarget, 2) * 100);
      }

      // Calibrar la duración para que el TSS REAL (NP) de los intervalos prescritos
      // coincida con el TSS objetivo — corrige la dilución del calentamiento/vuelta a la
      // calma sin tocar los vatios de cada zona (que se mantienen exactamente como están
      // diseñados). Se amortigua el paso (0.5) y se conserva el mejor candidato visto
      // porque algunos tipos (ej. VO₂max con reps enteras) cambian de estructura a saltos
      // y pueden oscilar entre dos duraciones sin converger nunca de forma monótona.
      {
        let _bestDur = durMin, _bestDiff = Infinity;
        for (let _cal = 0; _cal < 8; _cal++) {
          const _testIvs = this._buildIntervals(t.type, ftp, durMin, sessTSS, ifTarget, intervalVariant);
          const _real = this._realTSS(_testIvs, ftp);
          if (!_real || _real.tss <= 0) break;
          const _diff = Math.abs(_real.tss - sessTSS);
          if (_diff < _bestDiff) { _bestDiff = _diff; _bestDur = durMin; }
          if (_diff / sessTSS < 0.015) break;
          const _ratio = sessTSS / _real.tss;
          const _damped = durMin + 0.5 * (durMin * _ratio - durMin);
          const _nextDur = Math.max(minDur, Math.min(maxDur, Math.round(_damped)));
          if (_nextDur === durMin) break;
          durMin = _nextDur;
        }
        durMin = _bestDur;
      }

      // Generar intervalos: variante activa según semana del ciclo, alternando cada semana
      const intervals     = this._buildIntervals(t.type, ftp, durMin, sessTSS, ifTarget, intervalVariant);
      const altVariant    = intervalVariant === 'main' ? 'alt' : 'main';
      const alt_intervals = this._buildIntervals(t.type, ftp, durMin, sessTSS, ifTarget, altVariant);

      // Construir descripción dinámica que coincida exactamente con los intervalos
      let dynamicDesc = this._buildDesc(intervals);
      let altDesc = this._buildDesc(alt_intervals);

      // ── Consejo de terreno con segmentos locales ──
      const terrainAdvice = this._buildTerrain(t.type, intervals);

      return {
        ...t,
        tss: sessTSS,
        durationMin: durMin,
        // Para tipos de calidad, el badge de vatios refleja el bloque principal real
        // (ej. 291–322W de un umbral) en vez de un promedio plano ftp*ifTarget que no
        // se parece a los vatios de ningún intervalo concreto de la sesión.
        targetWatts: isQuality ? this._mainBlockWatts(intervals, ftp, ifTarget) : Math.round(ftp * ifTarget),
        description: dynamicDesc,
        alt_description: altDesc,
        terrain: terrainAdvice.trim(),
        advice: t.description,
        intervals,
        alt_intervals,
        intervalVariant,
      };
    });

    // ── Post-processing: reglas fisiológicas de VeloMind ──
    const HARD_QUALITY = new Set(['threshold', 'vo2max', 'sprint', 'strength']);
    const ANY_QUALITY  = new Set(['threshold', 'vo2max', 'sprint', 'strength', 'tempo']);

    const _makeRecovery = (day, reason) => {
      const rIF = 0.50, rDur = 40;
      const rTSS = Math.round((rDur / 60) * Math.pow(rIF, 2) * 100);
      const ivs    = this._buildIntervals('recovery', ftp, rDur, rTSS, rIF, 'main');
      const altIvs = this._buildIntervals('recovery', ftp, rDur, rTSS, rIF, 'alt');
      return { day, type: 'recovery', name: 'Recuperación activa Z1', ifTarget: rIF, emoji: '😴',
        tss: rTSS, durationMin: rDur, targetWatts: Math.round(ftp * rIF),
        description: this._buildDesc(ivs), alt_description: this._buildDesc(altIvs),
        terrain: '🛣️ Terreno llano y continuo para mantener los vatios estables.',
        advice: reason, intervals: ivs, alt_intervals: altIvs };
    };

    // Regla 1: Nunca dos días de calidad seguidos → el segundo se convierte en recuperación activa
    for (let i = 1; i < sessions.length; i++) {
      const prev = sessions[i - 1], curr = sessions[i];
      if (!prev.isRest && HARD_QUALITY.has(prev.type) && !curr.isRest && ANY_QUALITY.has(curr.type)) {
        sessions[i] = _makeRecovery(curr.day,
          `Recuperación obligatoria tras ${prev.name || prev.type}. Dos sesiones de calidad seguidas acumulan fatiga sin dar tiempo a la adaptación. Pedalea muy suave en Z1.`);
      }
    }

    // Regla 2: Dos descansos seguidos → el segundo se convierte en recuperación activa
    for (let i = 1; i < sessions.length; i++) {
      const prev = sessions[i - 1], curr = sessions[i];
      if (prev.isRest && curr.isRest) {
        sessions[i] = _makeRecovery(curr.day,
          'Dos días de descanso seguidos ralentizan la recuperación. Pedaleo muy suave en Z1 para activar la circulación y acelerar la regeneración muscular.');
      }
    }

    return this._injectEventMarkers(sessions, events);
  },

  /* ── Plantillas semanales según goal/phase ── */
  _getTemplate(goal, phase, exp, tsb, weekInCycle = 1, globalWeekIdx = 0) {
    // Principiante: plan especial sin series ni intensidad alta (sin rotación)
    if (exp === 'principiante') {
      const isPeso = goal === 'perdida_peso' || goal === 'resistencia';
      return [
        { day: 'Lunes',     isRest: true,  description: 'Descanso. Tu cuerpo se adapta mientras descansas. Hidratación y sueño.' },
        { day: 'Martes',    type: 'endurance', name: 'Rodada de inicio Z1-Z2', description: 'Puedes mantener una conversación fluida. Sin presión, aprende a controlar el esfuerzo.', tssShare: 0.16, ifTarget: 0.58, emoji: '🔵' },
        { day: 'Miércoles', isRest: true,  description: 'Descanso activo — caminar 20 min o estiramientos suaves de piernas.' },
        { day: 'Jueves',    type: 'endurance', name: 'Z2 continuo', description: 'Cadencia cómoda (70-85 rpm). Bebe cada 15-20 min aunque no tengas sed.', tssShare: 0.20, ifTarget: 0.60, emoji: '🔵' },
        { day: 'Viernes',   isRest: true,  description: 'Descanso. Prioriza el sueño: es cuando el cuerpo se adapta.' },
        { day: 'Sábado',    type: 'long',  name: 'Salida larga suave', description: isPeso ? 'Ritmo muy cómodo para quemar grasa eficientemente. Lleva agua y snack ligero.' : 'Explora sin presión. Lleva agua y algo para comer.', tssShare: 0.28, ifTarget: 0.58, emoji: '💙' },
        { day: 'Domingo',   isRest: true,  description: 'Descanso. Movilidad de cadera, cuádriceps y gemelos 10-15 min.' },
      ];
    }

    if (phase === 'recovery') {
      // Semana de recuperación: alterna entre dos variantes para no ser monótona
      return weekInCycle % 2 === 1 ? [
        { day: 'Lunes',    isRest: true,  description: 'Descanso total o movilidad 15 min' },
        { day: 'Martes',   type: 'recovery', name: 'Rodaje suave Z1', description: 'Pedaleo muy ligero para mover las piernas y activar la circulación.', tssShare: 0.08, ifTarget: 0.50, emoji: '😴' },
        { day: 'Miércoles',isRest: true,  description: 'Descanso. Masaje, foam roller, movilidad de cadera 15 min.' },
        { day: 'Jueves',   type: 'endurance', name: 'Z2 suave', description: 'Resistencia aeróbica ligera y relajada. Cadencia alta, sin presión.', tssShare: 0.12, ifTarget: 0.60, emoji: '🔵' },
        { day: 'Viernes',  isRest: true,  description: 'Descanso activo: caminar, yoga' },
        { day: 'Sábado',   type: 'endurance', name: 'Rodada moderada Z2', description: 'Base aeróbica, mantén la cadencia alta entre 85-95 rpm.', tssShare: 0.18, ifTarget: 0.62, emoji: '🔵' },
        { day: 'Domingo',  isRest: true,  description: 'Descanso total. Prepara la próxima semana' },
      ] : [
        { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto. Nutrición, hidratación y sueño.' },
        { day: 'Martes',   type: 'endurance', name: 'Z2 con aceleraciones suaves', description: 'Rueda tranquilo e incluye 4-5 aceleraciones de 10 s a cadencia alta para mantener la activación neuromuscular.', tssShare: 0.10, ifTarget: 0.60, emoji: '🔵' },
        { day: 'Miércoles',isRest: true,  description: 'Descanso. Foam roller en cuádriceps, isquios y gemelos.' },
        { day: 'Jueves',   type: 'recovery', name: 'Pedaleo de movilidad Z1', description: 'Rueda muy suave, enfócate en soltar las caderas y girar redondo.', tssShare: 0.07, ifTarget: 0.50, emoji: '😴' },
        { day: 'Viernes',  isRest: true,  description: 'Descanso activo: caminar o nadar suave.' },
        { day: 'Sábado',   type: 'endurance', name: 'Salida aeróbica libre Z2', description: 'Sin estructura: rueda a sensaciones. El objetivo es moverse, no acumular carga.', tssShare: 0.20, ifTarget: 0.63, emoji: '🔵' },
        { day: 'Domingo',  isRest: true,  description: 'Descanso. Prepara la semana de carga que viene.' },
      ];
    }

    if (phase === 'race') {
      return [
        { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto. Últimas 72h previas' },
        { day: 'Martes',   type: 'recovery', name: 'Pedaleo de activación', description: 'Mover piernas sin fatigarse en absoluto.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
        { day: 'Miércoles',type: 'endurance', name: 'Z2 con sprints cortos', description: 'Sprints al final para mantener agudeza neuromuscular.', tssShare: 0.10, ifTarget: 0.62, emoji: '🔵' },
        { day: 'Jueves',   isRest: true,  description: 'Descanso. Carga de carbohidratos: 8-10g/kg' },
        { day: 'Viernes',  type: 'z2', isPreRaceB: true, name: 'Activación pre-carrera', description: 'Despierta las piernas sin vaciar los depósitos.', tssShare: 0.07, ifTarget: 0.65, emoji: '🚴' },
        { day: 'Sábado',   type: 'race',  name: '🏁 DÍA DE CARRERA', description: 'Ejecuta tu plan de carrera. ¡A darlo todo!', tssShare: 0.30, ifTarget: 0.85, emoji: '🏁' },
        { day: 'Domingo',  isRest: true,  description: 'Recuperación post-carrera. Come bien y descansa' },
      ];
    }

    if (phase === 'peak') {
      // Peak: 3 variantes para el bloque de tapering
      const peakVariants = [
        // Semana 1 peak: calidad + activación aeróbica
        [
          { day: 'Lunes',    isRest: true,  description: 'Descanso — inicio del taper. Menos volumen, mantén la intensidad.' },
          { day: 'Martes',   type: 'threshold', name: 'Intervalos al umbral (taper)', description: 'Calidad sobre cantidad. Mantén la sensación de velocidad sin acumular fatiga.', tssShare: 0.13, ifTarget: 0.82, emoji: '🟡' },
          { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa', description: 'Rodaje fluido, enfocándote en cadencia alta y soltura.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
          { day: 'Jueves',   type: 'vo2max',   name: 'VO₂ Max — agudeza neuromuscular', description: 'Activa el sistema aeróbico superior sin generar fatiga residual. Vollúmen reducido, intensidad conservada.', tssShare: 0.12, ifTarget: 0.85, emoji: '🔴' },
          { day: 'Viernes',  isRest: true,  description: 'Descanso. Preparación mental y logística de carrera.' },
          { day: 'Sábado',   type: 'endurance', name: 'Rodada moderada con acelerones', description: 'Mantén la tensión muscular. 3-4 acelerones de 20 s al final para mantener la chispa.', tssShare: 0.16, ifTarget: 0.66, emoji: '🔵' },
          { day: 'Domingo',  type: 'recovery',  name: 'Recuperación activa', description: 'Pedaleo muy suave. Visualiza tu estrategia de carrera.', tssShare: 0.05, ifTarget: 0.52, emoji: '😴' },
        ],
        // Semana 2 peak: más énfasis en agudeza, menos volumen
        [
          { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto. El taper funciona descansando, no entrenando más.' },
          { day: 'Martes',   type: 'vo2max',   name: 'Micro-intervalos de agudeza', description: 'Series muy cortas e intensas para mantener la chispa sin acumular estrés.', tssShare: 0.11, ifTarget: 0.88, emoji: '🔴' },
          { day: 'Miércoles',type: 'endurance', name: 'Z2 con sprints finales', description: 'Rueda tranquilo y añade 5 sprints de 10 s al final. Mantén las fibras rápidas despiertas.', tssShare: 0.10, ifTarget: 0.64, emoji: '🔵' },
          { day: 'Jueves',   type: 'recovery',  name: 'Recuperación Z1', description: 'Piernas ligeras. Sin presión, solo mantener el flujo sanguíneo.', tssShare: 0.05, ifTarget: 0.50, emoji: '😴' },
          { day: 'Viernes',  isRest: true,  description: 'Descanso. Carga de carbohidratos si el evento es mañana.' },
          { day: 'Sábado',   type: 'threshold', name: 'Activación umbral corta', description: 'Una sola serie de 8-10 min al FTP para confirmar que las piernas responden. Nada más.', tssShare: 0.14, ifTarget: 0.83, emoji: '🟡' },
          { day: 'Domingo',  type: 'recovery',  name: 'Pedaleo de movilidad', description: 'Muy suave. Soltura, cadencia alta. El cuerpo está listo para el esfuerzo.', tssShare: 0.05, ifTarget: 0.50, emoji: '😴' },
        ],
        // Semana 3 peak: preparación final, casi todo descanso
        [
          { day: 'Lunes',    isRest: true,  description: 'Descanso total. El taper ya está hecho.' },
          { day: 'Martes',   type: 'endurance', name: 'Z2 suave de mantenimiento', description: 'Rueda tranquilo para mantener el flujo sin generar ninguna fatiga.', tssShare: 0.09, ifTarget: 0.62, emoji: '🔵' },
          { day: 'Miércoles',isRest: true,  description: 'Descanso. Hidratación activa, 3 L de agua mínimo.' },
          { day: 'Jueves',   type: 'recovery',  name: 'Activación pre-evento', description: '20-30 min muy suaves con 3-4 acelerones cortos al final. Que las piernas recuerden lo que saben hacer.', tssShare: 0.06, ifTarget: 0.52, emoji: '😴' },
          { day: 'Viernes',  isRest: true,  description: 'Descanso absoluto. Come bien, duerme más, descansa.' },
          { day: 'Sábado',   type: 'endurance', name: 'Rodada de activación final', description: 'Salida muy suave con 3-4 acelerones cortos al final para despertar las piernas. Nada de carga — solo mantener el flujo.', tssShare: 0.10, ifTarget: 0.62, emoji: '🔵' },
          { day: 'Domingo',  isRest: true,  description: 'Descanso total. Cuerpo fresco y listo para el evento.' },
        ],
      ];
      return peakVariants[(weekInCycle - 1) % 3];
    }

    // ── BASE y BUILD — 5 plantillas rotativas por goal ──────────────
    const N_TEMPLATES = 5;
    const w = globalWeekIdx % N_TEMPLATES;

    const templates = {
      resistencia: {
        base: [
          // Semana 1: volumen aeróbico puro
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso activo — movilidad de cadera, foam roller' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 con cadencia alta', description: 'Construye eficiencia aeróbica manteniendo 90-95 rpm sin forzar vatios.', tssShare: 0.15, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa Z1', description: 'Activa la circulación sin acumular fatiga. Muy suave.', tssShare: 0.07, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'tempo',    name: 'Tempo progresivo Z3', description: 'Eleva tu ritmo base gradualmente. Respiración elevada pero rítmica.', tssShare: 0.17, ifTarget: 0.75, emoji: '🟢' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso — prepara el fin de semana de volumen' },
            { day: 'Sábado',   type: 'endurance', name: 'Rodada media-larga Z2', description: 'Base aeróbica pura. Tiempo en sillín sin presión de vatios.', tssShare: 0.22, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón largo Z1-Z2', description: 'El rey del entrenamiento de base. Ritmo conversacional de inicio a fin.', tssShare: 0.30, ifTarget: 0.62, emoji: '💙' },
          ],
          // Semana 2: sweetspot + resistencia muscular
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso activo — estiramientos de piernas y core' },
            { day: 'Martes',   type: 'tempo',    name: 'Bloques Sweetspot', description: 'Zona dulce (88-93% FTP) en bloques de 10-15 min. Sube tu umbral aeróbico de forma controlada.', tssShare: 0.18, ifTarget: 0.78, emoji: '🟢' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa Z1', description: 'Muy suave. Hoy el cuerpo asimila el trabajo del martes.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'tempo',    name: 'Sweetspot en bloques cortos', description: 'Bloques de 10-12 min al 88-93% FTP. Más intenso que el tempo clásico pero sin cruzar el umbral anaeróbico.', tssShare: 0.15, ifTarget: 0.78, emoji: '🟢' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso — descansa bien para el fondo del domingo' },
            { day: 'Sábado',   type: 'endurance', name: 'Z2 largo continuo', description: 'Z2 puro y sostenido. Practica la ingesta de carbohidratos en bici.', tssShare: 0.24, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón con final progresivo', description: 'Base larga y en los últimos 20 min sube gradualmente hasta Z3. Simula el final de una salida real.', tssShare: 0.28, ifTarget: 0.64, emoji: '💙' },
          ],
          // Semana 3: calidad + volumen acumulado (semana de mayor carga antes del descanso)
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso — semana de mayor carga, empieza recuperado' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 con activaciones neuromusculares', description: 'Rodada Z2 e incluye 5-6 acelerones de 15 s a tope al final. Mantén la chispa.', tssShare: 0.14, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Miércoles',type: 'tempo',    name: 'Tempo largo sostenido', description: 'Bloque largo en Z3. Más tiempo que la semana 1 — tu cuerpo ya está adaptado.', tssShare: 0.20, ifTarget: 0.76, emoji: '🟢' },
            { day: 'Jueves',   type: 'recovery',  name: 'Recuperación activa Z1', description: 'Muy suave. No añadas estrés antes del fin de semana largo.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de activación', description: 'Rodada aeróbica moderada para llegar activo al fin de semana.', tssShare: 0.12, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'tempo',    name: 'Tempo + bloques sweetspot', description: 'Combina ritmo Z3 con algunos bloques de sweetspot. Semana pico de calidad.', tssShare: 0.22, ifTarget: 0.78, emoji: '🟢' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón máximo de la fase', description: 'El fondón más largo del bloque base. Máxima acumulación de volumen aeróbico.', tssShare: 0.32, ifTarget: 0.63, emoji: '💙' },
          ],
          // Semana 4: fuerza de base + sweetspot introductorio
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso activo — movilidad de cadera y core' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 con fuerza a baja cadencia', description: 'Bloques de 8 min a 60-65 rpm en llano para desarrollar torque aeróbico sin estrés cardiovascular alto.', tssShare: 0.22, ifTarget: 0.68, emoji: '🔵' },
            { day: 'Miércoles',isRest: true,  description: 'Descanso completo — descarga de mitad de semana' },
            { day: 'Jueves',   type: 'tempo',    name: 'Sweetspot a baja cadencia', description: 'Bloques de 10 min al 88-93% FTP con cadencia 65-70 rpm. Construye fuerza muscular específica en zona aeróbica superior, sin cruzar el umbral anaeróbico.', tssShare: 0.22, ifTarget: 0.79, emoji: '🟢' },
            { day: 'Viernes',  type: 'recovery',  name: 'Recuperación activa Z1', description: 'Pedaleo muy suave. Prepara el cuerpo para la jornada larga del sábado.', tssShare: 0.08, ifTarget: 0.50, emoji: '😴' },
            { day: 'Sábado',   type: 'long',    name: 'Fondón largo a ritmo estable Z2', description: 'Base aeróbica pura durante 3-4 horas. Cadencia alta y ritmo conversacional de inicio a fin.', tssShare: 0.38, ifTarget: 0.63, emoji: '💙' },
            { day: 'Domingo',  isRest: true,  description: 'Descanso total — recuperación post-fondón' },
          ],
          // Semana 5: estilo fin de semana — volumen concentrado sábado y domingo
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Semana polarizada hacia el fin de semana.' },
            { day: 'Martes',   type: 'recovery',  name: 'Pedaleo de movilidad Z1', description: 'Solo activar la circulación. Cadencia suave y sin presión de vatios.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Miércoles',type: 'endurance', name: 'Z2 moderado entre semana', description: 'Rodada aeróbica de mantenimiento. Cadencia cómoda sin aumentar la fatiga.', tssShare: 0.16, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Jueves',   isRest: true,  description: 'Descanso activo — estiramientos y foam roller' },
            { day: 'Viernes',  type: 'tempo',    name: 'Tempo de activación pre-fin de semana', description: 'Bloque Z3 corto para llegar activo al fin de semana. Sin sobrepasar el umbral aeróbico.', tssShare: 0.14, ifTarget: 0.75, emoji: '🟢' },
            { day: 'Sábado',   type: 'long',    name: 'Salida larga principal Z2', description: 'El fondón más largo de la semana. Tiempo en sillín puro, practica la nutrición en bici.', tssShare: 0.34, ifTarget: 0.63, emoji: '💙' },
            { day: 'Domingo',  type: 'endurance', name: 'Segunda jornada Z2 acumulada', description: 'Sal de nuevo con las piernas cargadas. Este back-to-back replica la fatiga real de un evento largo.', tssShare: 0.22, ifTarget: 0.65, emoji: '🔵' },
          ],
        ][w],

        build: [
          // Semana 1: umbral clásico + VO2
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Nutrición y sueño prioritarios' },
            { day: 'Martes',   type: 'threshold', name: 'Intervalos al umbral FTP', description: 'Aumenta tu capacidad de sostener potencia alta. Series de 8-12 min al FTP.', tssShare: 0.18, ifTarget: 0.82, emoji: '🟡' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa Z1', description: 'Crítico para asimilar el trabajo de umbral del martes.', tssShare: 0.07, ifTarget: 0.52, emoji: '😴' },
            { day: 'Jueves',   type: 'vo2max',   name: 'Intervalos VO₂ Max', description: 'Expande tu techo aeróbico. Esfuerzo muy exigente en series cortas de 3-5 min.', tssShare: 0.18, ifTarget: 0.85, emoji: '🔴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 moderado', description: 'Volumen aeróbico sin estrés. Mantiene la base sin comprometer la recuperación.', tssShare: 0.13, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'tempo',    name: 'Tempo largo + sweetspot', description: 'Sesión larga en Z3-sweetspot. Mejora la resistencia muscular en esfuerzos sostenidos.', tssShare: 0.22, ifTarget: 0.78, emoji: '🟢' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón aeróbico largo', description: 'Fondón que simula la fatiga de fin de carrera. Ritmo conversacional.', tssShare: 0.28, ifTarget: 0.65, emoji: '💙' },
          ],
          // Semana 2: capacidad anaeróbica + fuerza específica
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. La semana pasada fue dura — empieza fresco.' },
            { day: 'Martes',   type: 'vo2max',   name: 'Bloque VO₂ Max intenso', description: 'Series largas de VO₂ para forzar nuevas adaptaciones cardiopulmonares.', tssShare: 0.19, ifTarget: 0.87, emoji: '🔴' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Piernas girando suave. No comprometas la frescura del jueves.', tssShare: 0.07, ifTarget: 0.52, emoji: '😴' },
            { day: 'Jueves',   type: 'threshold', name: 'Umbral progresivo — bloques largos', description: 'Series de umbral más largas que la semana 1. La adaptación ya está en marcha.', tssShare: 0.20, ifTarget: 0.84, emoji: '🟡' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de asimilación', description: 'Rodada aeróbica para asimilar el umbral del jueves. Cadencia alta, sin presión.', tssShare: 0.13, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'strength', name: 'Fuerza específica + tempo', description: 'Baja cadencia en las subidas (55-65 rpm) combinado con tramos tempo. Potencia y resistencia.', tssShare: 0.20, ifTarget: 0.78, emoji: '💪' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón con bloques de tempo', description: 'Fondón largo con 2 bloques de 15 min en Z3 dentro. Simula la dureza de una carrera real.', tssShare: 0.28, ifTarget: 0.67, emoji: '💙' },
          ],
          // Semana 3: acumulación máxima antes de recuperación
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto — semana de mayor carga total del bloque' },
            { day: 'Martes',   type: 'threshold', name: 'Umbral clásico extendido', description: 'Más tiempo al FTP que las semanas anteriores. Máxima adaptación del bloque.', tssShare: 0.20, ifTarget: 0.84, emoji: '🟡' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa', description: 'Solo mover las piernas. Nada de esfuerzo.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'tempo',    name: 'Sweetspot sostenido largo', description: 'Bloque continuo en sweetspot. Más tiempo del habitual — pico de adaptación al umbral aeróbico.', tssShare: 0.22, ifTarget: 0.78, emoji: '🟢' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 aeróbico moderado', description: 'Mantiene las piernas activas. Sin presión de cara al fin de semana de carga.', tssShare: 0.14, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'threshold', name: 'Doble bloque umbral', description: 'Dos series largas al FTP con recuperación entre medias. Máximo estrés de umbral del bloque.', tssShare: 0.24, ifTarget: 0.83, emoji: '🟡' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón máximo del bloque build', description: 'El fondo más largo e intenso de la fase. La próxima semana es de recuperación — dalo todo.', tssShare: 0.30, ifTarget: 0.66, emoji: '💙' },
          ],
          // Semana 4: periodización invertida — VO2 mid-week, fondo el domingo
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Esta semana el miércoles es el más duro.' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 de preparación', description: 'Rodada aeróbica moderada para activar sin fatigar antes del VO₂ del miércoles.', tssShare: 0.13, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Miércoles',type: 'vo2max',   name: 'VO₂ Max — amplía el techo aeróbico', description: 'Series de 3-4 min al 110-115% FTP. Rompe la monotonía de la semana con intensidad máxima.', tssShare: 0.19, ifTarget: 0.87, emoji: '🔴' },
            { day: 'Jueves',   type: 'recovery',  name: 'Recuperación obligatoria Z1', description: 'El VO₂ de ayer necesita asimilación. Pedaleo muy ligero y cadencia alta.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'threshold', name: 'Umbral de soporte', description: 'Series de umbral moderadas. Consolida las adaptaciones sin acumular fatiga excesiva.', tssShare: 0.18, ifTarget: 0.83, emoji: '🟡' },
            { day: 'Sábado',   type: 'endurance', name: 'Z2 largo continuo', description: 'Rodada aeróbica extensa para mantener el volumen base del bloque.', tssShare: 0.18, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón aeróbico largo', description: 'Fondón a ritmo conversacional. El gran estímulo de volumen de la semana.', tssShare: 0.30, ifTarget: 0.65, emoji: '💙' },
          ],
          // Semana 5: polarizado — umbral y VO2 con días suaves intermedios
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Semana polarizada: intensidad alta o muy baja.' },
            { day: 'Martes',   type: 'threshold', name: 'Umbral concentrado', description: 'Series de umbral concentradas. Calidad máxima en el día más duro de la semana.', tssShare: 0.21, ifTarget: 0.84, emoji: '🟡' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Solo movilidad y circulación. Nada de estrés muscular.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'endurance', name: 'Z2 aeróbico puro', description: 'Z2 estricto y extenso. Sin cruzar el umbral aeróbico — recuperación con volumen.', tssShare: 0.16, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso activo — caminar o nadar suave' },
            { day: 'Sábado',   type: 'vo2max',   name: 'VO₂ Max — el motor se expande', description: 'Series de VO₂ Max concentradas en la jornada de mayor frescura de la segunda mitad de semana.', tssShare: 0.22, ifTarget: 0.88, emoji: '🔴' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón largo de cierre Z1-Z2', description: 'Fondón aeróbico puro. Consolida el estrés de la semana con volumen tranquilo.', tssShare: 0.30, ifTarget: 0.64, emoji: '💙' },
          ],
        ][w],
      },

      ftp: {
        base: [
          // Semana 1: sweetspot base
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Recuperación completa' },
            { day: 'Martes',   type: 'tempo', name: 'Sweetspot moderado', description: 'Zona dulce (88-93% FTP) en bloques. La base para subir tu umbral.', tssShare: 0.18, ifTarget: 0.78, emoji: '🟢' },
            { day: 'Miércoles',type: 'recovery', name: 'Recuperación Z1', description: 'Movilidad articular y limpieza de lactato. Muy suave.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'threshold', name: 'FTP progresivo — introducción', description: 'Acostumbra al cuerpo a trabajar cerca del FTP de forma controlada. Bloques cortos.', tssShare: 0.17, ifTarget: 0.82, emoji: '🟡' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso activo — estiramientos de cadena posterior' },
            { day: 'Sábado',   type: 'threshold', name: 'Intervalos umbral largos', description: 'Intervalos más largos para crear resistencia mental y física al FTP.', tssShare: 0.22, ifTarget: 0.83, emoji: '🟡' },
            { day: 'Domingo',  type: 'endurance', name: 'Rodada larga Z2', description: 'Soporte aeróbico vital para asimilar todo el trabajo de umbral de la semana.', tssShare: 0.24, ifTarget: 0.65, emoji: '🔵' },
          ],
          // Semana 2: umbral + volumen aeróbico de soporte
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. La semana 1 fue intensa — recupérate bien.' },
            { day: 'Martes',   type: 'threshold', name: 'FTP clásico — bloques medios', description: 'Bloques de umbral al FTP. Un escalón más que la semana pasada.', tssShare: 0.20, ifTarget: 0.83, emoji: '🟡' },
            { day: 'Miércoles',type: 'recovery', name: 'Recuperación activa', description: 'Pedaleo muy suave. El cuerpo está construyendo ahora mismo — no lo interrumpas.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'tempo',   name: 'Sweetspot largo', description: 'Bloque continuo de sweetspot más largo que el martes. Más tiempo cerca del umbral aeróbico.', tssShare: 0.18, ifTarget: 0.78, emoji: '🟢' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso — prepara el fin de semana de mayor carga' },
            { day: 'Sábado',   type: 'threshold', name: 'Umbral extendido', description: 'Series largas al FTP. Máximo tiempo en zona de umbral de la semana.', tssShare: 0.24, ifTarget: 0.84, emoji: '🟡' },
            { day: 'Domingo',  type: 'endurance', name: 'Z2 largo de asimilación', description: 'Volumen aeróbico extenso para consolidar las adaptaciones de umbral de la semana.', tssShare: 0.26, ifTarget: 0.65, emoji: '🔵' },
          ],
          // Semana 3: pico de sweetspot + carga máxima
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso — semana de mayor carga antes de la recuperación' },
            { day: 'Martes',   type: 'tempo',    name: 'Bloques Sweetspot intensivos', description: 'Más tiempo y más bloques en sweetspot que cualquier semana anterior. Máxima adaptación.', tssShare: 0.20, ifTarget: 0.79, emoji: '🟢' },
            { day: 'Miércoles',type: 'recovery', name: 'Recuperación Z1', description: 'Solo mover las piernas. Guarda energía para el jueves.', tssShare: 0.05, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'threshold', name: 'FTP — series largas acumuladas', description: 'El mayor volumen de umbral del bloque. Exígete, la recuperación viene la semana que viene.', tssShare: 0.22, ifTarget: 0.84, emoji: '🟡' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 aeróbico activo', description: 'Rodada moderada para mantener las piernas activas antes del fin de semana.', tssShare: 0.14, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'threshold', name: 'Doble sesión FTP', description: 'Dos bloques de umbral con mini-recuperación entre medias. Pico de estrés metabólico.', tssShare: 0.26, ifTarget: 0.84, emoji: '🟡' },
            { day: 'Domingo',  type: 'endurance', name: 'Z2 largo de cierre de bloque', description: 'Rodada aeróbica larga para cerrar el bloque base con máxima carga acumulada.', tssShare: 0.24, ifTarget: 0.65, emoji: '🔵' },
          ],
          // Semana 4: sweetspot pesado — estructura invertida con descanso mid-week
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso activo — foam roller y estiramientos de cuádriceps' },
            { day: 'Martes',   type: 'tempo',    name: 'Sweetspot largo con cadencia alta', description: 'Tres bloques de 12 min al 90% FTP. Cadencia 92-96 rpm. Eficiencia aeróbica en zona sweetspot.', tssShare: 0.20, ifTarget: 0.79, emoji: '🟢' },
            { day: 'Miércoles',type: 'recovery', name: 'Recuperación Z1 activa', description: 'Pedaleo muy ligero para soltar las piernas. Ningún estrés muscular hoy.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'tempo',    name: 'Sweetspot largo progresivo', description: 'Bloque largo de 30-40 min continuo en sweetspot. Más tiempo que el martes — resistencia específica.', tssShare: 0.22, ifTarget: 0.80, emoji: '🟢' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso total — prepara el fin de semana de umbral' },
            { day: 'Sábado',   type: 'threshold', name: 'Umbral clásico base', description: 'Series de umbral. El escalón clave para subir el techo aeróbico de la fase.', tssShare: 0.24, ifTarget: 0.83, emoji: '🟡' },
            { day: 'Domingo',  type: 'endurance', name: 'Z2 de soporte aeróbico', description: 'Rodada larga aeróbica. El volumen Z2 consolida las adaptaciones de sweetspot de la semana.', tssShare: 0.22, ifTarget: 0.65, emoji: '🔵' },
          ],
          // Semana 5: volumen + umbral equilibrado — dos días de umbral separados
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Semana de umbral doble con base aeróbica de soporte.' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 de base activa', description: 'Rodada aeróbica moderada. El motor de fondo que hace que el umbral sea sostenible.', tssShare: 0.14, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Miércoles',type: 'threshold', name: 'FTP corto de mitad de semana', description: 'Series de umbral cortas. Sesión de calidad sin acumular excesiva fatiga residual.', tssShare: 0.18, ifTarget: 0.83, emoji: '🟡' },
            { day: 'Jueves',   type: 'recovery',  name: 'Recuperación activa Z1', description: 'Pedaleo suave para asimilar el umbral del miércoles. Imprescindible antes del fin de semana.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de activación', description: 'Rodada aeróbica para llegar activo al fin de semana. Sin cruzar el umbral aeróbico.', tssShare: 0.14, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'threshold', name: 'FTP largo — sesión principal de la semana', description: 'Series de umbral largas. El mayor estrés de umbral de la semana.', tssShare: 0.28, ifTarget: 0.84, emoji: '🟡' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón aeróbico de cierre', description: 'Fondón a ritmo Z2 para consolidar la doble semana de umbral con volumen tranquilo.', tssShare: 0.24, ifTarget: 0.65, emoji: '💙' },
          ],
        ][w],

        build: [
          // Semana 1: FTP clásico + VO2 de soporte
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto' },
            { day: 'Martes',   type: 'threshold', name: 'Bloque Umbral (FTP) Clásico', description: 'El trabajo FTP por excelencia. Mentalízate para tolerar el esfuerzo sostenido.', tssShare: 0.20, ifTarget: 0.84, emoji: '🟡' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa', description: 'No estreses el sistema hoy. Pedaleo suave y cadencia alta.', tssShare: 0.07, ifTarget: 0.52, emoji: '😴' },
            { day: 'Jueves',   type: 'vo2max',   name: 'Trabajo VO₂ Max', description: 'El VO₂ tira del FTP hacia arriba. Series exigentes de 3-5 min.', tssShare: 0.18, ifTarget: 0.86, emoji: '🔴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de asimilación', description: 'Rodada aeróbica. El cuerpo se adapta aquí. Cadencia alta, sin presión.', tssShare: 0.15, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'threshold', name: 'Series Umbral (FTP) Extendidas', description: 'Volumen umbral extendido para máxima adaptación fisiológica. Más tiempo que el martes.', tssShare: 0.25, ifTarget: 0.84, emoji: '🟡' },
            { day: 'Domingo',  type: 'endurance', name: 'Z2 largo con finalización Z3', description: 'Larga base aeróbica que termina con un bloque de Z3 para simular el desgaste real.', tssShare: 0.22, ifTarget: 0.68, emoji: '🔵' },
          ],
          // Semana 2: VO2 prioritario para elevar el techo
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Esta semana el VO₂ Max es el protagonista.' },
            { day: 'Martes',   type: 'vo2max',   name: 'VO₂ Max — series largas', description: 'Máximo estrés cardiovascular en series de 4-5 min. Esto eleva directamente tu FTP.', tssShare: 0.20, ifTarget: 0.87, emoji: '🔴' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa Z1', description: 'Imprescindible después del VO₂. Pedaleo muy suave.', tssShare: 0.07, ifTarget: 0.52, emoji: '😴' },
            { day: 'Jueves',   type: 'threshold', name: 'FTP sostenido — bloques medios', description: 'Umbral clásico con volumen moderado. Las piernas ya conocen el esfuerzo.', tssShare: 0.19, ifTarget: 0.84, emoji: '🟡' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 aeróbico', description: 'Rodada suave de soporte. Mantiene el volumen sin añadir estrés.', tssShare: 0.14, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'threshold', name: 'Umbral con bloques progresivos', description: 'Cada bloque al FTP empieza al 95% y termina al 102%. Enseña al cuerpo a aguantar cuando duele.', tssShare: 0.24, ifTarget: 0.85, emoji: '🟡' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón con ritmo de carrera final', description: 'Base larga con los últimos 30 min en Z3. Simula la fatiga final de una prueba.', tssShare: 0.22, ifTarget: 0.67, emoji: '💙' },
          ],
          // Semana 3: acumulación máxima de umbral
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso — la semana más dura del bloque build' },
            { day: 'Martes',   type: 'threshold', name: 'FTP máximo — series muy largas', description: 'El mayor volumen de umbral del bloque. Series de 15-20 min al FTP.', tssShare: 0.22, ifTarget: 0.85, emoji: '🟡' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 obligatoria', description: 'Solo recuperación. No te saltes esto después de la sesión del martes.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'tempo',    name: 'Sweetspot acumulado', description: 'Bloque largo en sweetspot. Más cómodo que el FTP pero más tiempo. Resistencia de umbral.', tssShare: 0.20, ifTarget: 0.79, emoji: '🟢' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 moderado', description: 'Rodada aeróbica de soporte activo de cara al fin de semana.', tssShare: 0.14, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'threshold', name: 'Sesión FTP de cierre de bloque', description: 'Último gran bloque de umbral antes de la recuperación. Máximo estrés — máxima adaptación.', tssShare: 0.26, ifTarget: 0.85, emoji: '🟡' },
            { day: 'Domingo',  type: 'endurance', name: 'Z2 largo de recuperación activa', description: 'Cierra la semana con volumen aeróbico puro. El cuerpo necesita oxígeno, no más estrés.', tssShare: 0.24, ifTarget: 0.65, emoji: '🔵' },
          ],
          // Semana 4: doble VO2 — estructura con dos sesiones VO2 en una semana
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso total. Esta semana tiene dos sesiones VO₂.' },
            { day: 'Martes',   type: 'vo2max',   name: 'VO₂ Max — primera sesión de la semana', description: 'Series de 3 min al 110% FTP con igual recuperación. Primer estímulo VO₂ de la semana.', tssShare: 0.19, ifTarget: 0.87, emoji: '🔴' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Pedaleo muy suave. El VO₂ del martes necesita asimilación completa.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'threshold', name: 'Umbral de soporte mid-week', description: 'Serie larga al FTP. Consolida las adaptaciones del VO₂ con trabajo de umbral.', tssShare: 0.18, ifTarget: 0.84, emoji: '🟡' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de recuperación activa', description: 'Base aeróbica moderada. Permite llegar fresco al segundo VO₂ del sábado.', tssShare: 0.14, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'vo2max',   name: 'VO₂ Max — segunda sesión semanal', description: 'Segunda tanda de VO₂ de la semana. Series ligeramente más cortas pero misma intensidad.', tssShare: 0.19, ifTarget: 0.88, emoji: '🔴' },
            { day: 'Domingo',  type: 'endurance', name: 'Z2 de asimilación extendido', description: 'Rodada aeróbica tranquila tras la doble semana de VO₂. El cuerpo se adapta ahora.', tssShare: 0.22, ifTarget: 0.65, emoji: '🔵' },
          ],
          // Semana 5: FTP concentrado — bloque de umbral doble separado por descanso
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Semana de umbral doble para el pico de adaptación FTP.' },
            { day: 'Martes',   type: 'threshold', name: 'FTP de martes — sesión de apertura', description: 'Series de umbral con recuperación intermedia. Primer bloque de umbral de la semana.', tssShare: 0.20, ifTarget: 0.84, emoji: '🟡' },
            { day: 'Miércoles',type: 'endurance', name: 'Z2 de transición', description: 'Rodada aeróbica moderada entre las dos sesiones de umbral. Volumen sin estrés adicional.', tssShare: 0.14, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Jueves',   type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Muy suave. Prepara el cuerpo para el umbral del viernes.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'threshold', name: 'FTP de viernes — sesión de calidad', description: 'Series de umbral. Segunda sesión de umbral de la semana para forzar supercompensación.', tssShare: 0.22, ifTarget: 0.85, emoji: '🟡' },
            { day: 'Sábado',   type: 'long',    name: 'Fondón largo de soporte aeróbico', description: 'Fondón a ritmo Z2 puro. El volumen aeróbico es el que consolida las adaptaciones de umbral.', tssShare: 0.28, ifTarget: 0.65, emoji: '💙' },
            { day: 'Domingo',  isRest: true,  description: 'Descanso total. La semana de doble umbral lo merece.' },
          ],
        ][w],
      },

      vo2max: {
        base: [
          // Semana 1: base aeróbica + introducción VO2
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 base aeróbica', description: 'Base estructurada pura para soportar la carga de VO₂ que viene. Cadencia alta.', tssShare: 0.12, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Miércoles',type: 'tempo',     name: 'Sweetspot + sprints cortos', description: 'Base en sweetspot con 4-5 sprints de 10 s al final. Activa las fibras rápidas sin acumular fatiga.', tssShare: 0.17, ifTarget: 0.78, emoji: '🟢' },
            { day: 'Jueves',   type: 'recovery',  name: 'Recuperación activa', description: 'Pedaleo muy suave. Guarda piernas frescas para el VO₂ del sábado.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'tempo',     name: 'Sweetspot + arranques', description: 'Bloques en sweetspot (88-92% FTP) con 3 arranques explosivos de 8 s al final de cada uno. Base aeróbica superior con activación neuromuscular sin generar fatiga residual.', tssShare: 0.17, ifTarget: 0.78, emoji: '🟢' },
            { day: 'Sábado',   type: 'vo2max',   name: 'Intervalos VO₂ introductorios', description: 'Primeras series de VO₂ del bloque. Cortas pero exigentes. El dolor bueno empieza aquí.', tssShare: 0.18, ifTarget: 0.85, emoji: '🔴' },
            { day: 'Domingo',  type: 'endurance', name: 'Rodada larga Z2', description: 'Base aeróbica que permite sostener alta intensidad semana tras semana.', tssShare: 0.22, ifTarget: 0.65, emoji: '🔵' },
          ],
          // Semana 2: intensidad VO2 + umbral de soporte
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto' },
            { day: 'Martes',   type: 'vo2max',   name: 'VO₂ Max — series medias', description: 'Un escalón más que la semana pasada. Series de 3-4 min con recuperación completa.', tssShare: 0.17, ifTarget: 0.86, emoji: '🔴' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa Z1', description: 'Pedaleo muy suave. No comprometas la frescura del jueves.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'threshold', name: 'Umbral de soporte', description: 'Series de umbral para construir la base que sostiene las adaptaciones VO₂.', tssShare: 0.17, ifTarget: 0.83, emoji: '🟡' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 moderado', description: 'Rodada aeróbica de soporte. Cadencia alta, sin estrés.', tssShare: 0.12, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'tempo',    name: 'Sweetspot + activaciones VO₂', description: 'Bloque sweetspot con 2-3 mini-series de VO₂ al final. Combina las zonas del bloque.', tssShare: 0.20, ifTarget: 0.80, emoji: '🟢' },
            { day: 'Domingo',  type: 'endurance', name: 'Rodada Z2 larga', description: 'Base aeróbica pura. El motor de fondo que hace que el VO₂ sirva de algo.', tssShare: 0.22, ifTarget: 0.65, emoji: '🔵' },
          ],
          // Semana 3: pico de intensidad VO2 base
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso — semana de máxima intensidad del bloque base' },
            { day: 'Martes',   type: 'threshold', name: 'Umbral largo + arranques explosivos', description: 'Series de umbral seguidas de arranques máximos de 10-15 s. Mezcla de sistemas energéticos.', tssShare: 0.18, ifTarget: 0.84, emoji: '🟡' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1', description: 'Solo mover las piernas. Sin ningún esfuerzo.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'vo2max',   name: 'VO₂ Max — series largas', description: 'El mayor esfuerzo VO₂ del bloque base. Series de 4-5 min con recuperación completa.', tssShare: 0.20, ifTarget: 0.87, emoji: '🔴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 activo de asimilación', description: 'Rodada aeróbica moderada. El cuerpo necesita oxígeno y flujo, no más estrés.', tssShare: 0.13, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'sprint',   name: 'Capacidad anaeróbica máxima', description: 'Sprints máximos con recuperación completa. Activa las fibras rápidas al máximo.', tssShare: 0.16, ifTarget: 0.82, emoji: '🟣' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón largo de base', description: 'Cierra el bloque con el fondón más largo. Base aeróbica máxima antes de la recuperación.', tssShare: 0.26, ifTarget: 0.63, emoji: '💙' },
          ],
          // Semana 4: base neuromuscular — sweetspot en viernes, VO2 en sábado
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Semana de calidad concentrada en la segunda mitad.' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 de preparación aeróbica', description: 'Z2 estricto y extenso. Construye la base aeróbica que soporta las sesiones VO₂.', tssShare: 0.15, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Miércoles',type: 'tempo',    name: 'Sweetspot con sprints de activación', description: 'Bloque de sweetspot con 4 sprints de 10 s al final de cada intervalo. Mezcla aeróbica-neuromuscular.', tssShare: 0.18, ifTarget: 0.80, emoji: '🟢' },
            { day: 'Jueves',   type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Pedaleo suave. Guarda las piernas para las dos sesiones de calidad del fin de semana.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'tempo',     name: 'Sweetspot de activación pre-VO₂', description: 'Bloque continuo en sweetspot (88-92% FTP). Activa el sistema aeróbico sin la fatiga residual del umbral anaeróbico — llega fresco al VO₂ del sábado.', tssShare: 0.17, ifTarget: 0.79, emoji: '🟢' },
            { day: 'Sábado',   type: 'vo2max',   name: 'VO₂ Max — sesión principal de la semana', description: 'Series de 3-4 min al 110-115% FTP. La sesión clave de la semana con piernas algo activadas.', tssShare: 0.19, ifTarget: 0.87, emoji: '🔴' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón Z2 de recuperación', description: 'Fondón aeróbico largo para asimilar el estrés de intensidad del fin de semana.', tssShare: 0.26, ifTarget: 0.63, emoji: '💙' },
          ],
          // Semana 5: base explosiva — sprint el martes, VO2 el jueves
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Sprints el martes, VO₂ el jueves — separados por recuperación.' },
            { day: 'Martes',   type: 'sprint',   name: 'Sprints neuromusculares de base', description: 'Series de 10 s al máximo con 5 min de recuperación completa. Activa las fibras rápidas sin fatiga cardiovascular.', tssShare: 0.15, ifTarget: 0.82, emoji: '🟣' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Pedaleo muy suave. El sistema nervioso necesita 24h para recuperar los sprints del martes antes del VO₂.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'vo2max',   name: 'VO₂ Max — base progresiva', description: 'Series de 2-3 min al 108-112% FTP. Con los sprints del martes como activación previa, el sistema aeróbico superior responde mejor.', tssShare: 0.20, ifTarget: 0.86, emoji: '🔴' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso activo — movilidad y estiramientos' },
            { day: 'Sábado',   type: 'tempo',    name: 'Sweetspot de consolidación', description: 'Bloque de sweetspot (88-93% FTP) para asentar las adaptaciones de la semana sin añadir más estrés anaeróbico.', tssShare: 0.18, ifTarget: 0.79, emoji: '🟢' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón de cierre Z1-Z2', description: 'Fondón largo aeróbico. Cierra la semana intensa con volumen tranquilo para maximizar la adaptación.', tssShare: 0.26, ifTarget: 0.63, emoji: '💙' },
          ],
        ][w],

        build: [
          // Semana 1: VO2 clásico + capacidad anaeróbica
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto' },
            { day: 'Martes',   type: 'vo2max',   name: 'Series VO₂ Max Largas', description: 'Trabajo VO₂ clásico: series de 4-5 min para exprimir la capacidad cardiopulmonar.', tssShare: 0.19, ifTarget: 0.87, emoji: '🔴' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa Z1', description: 'Pedaleo fluido. No comprometemos la frescura del jueves.', tssShare: 0.07, ifTarget: 0.52, emoji: '😴' },
            { day: 'Jueves',   type: 'sprint',   name: 'Capacidad anaeróbica', description: 'Sprints máximos para exprimidr la potencia pico y la tolerancia láctica.', tssShare: 0.16, ifTarget: 0.82, emoji: '🟣' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 moderado', description: 'Recuperación activa con volumen. Cadencia viva, sin estrés.', tssShare: 0.12, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'vo2max',   name: 'Bloque VO₂ Max Intenso', description: 'Segunda sesión VO₂ de la semana. Más volumen de series para forzar adaptaciones.', tssShare: 0.21, ifTarget: 0.88, emoji: '🔴' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón largo Z1-Z2', description: 'Base aeróbica vital para recuperar y hacer que el VO₂ sirva de algo.', tssShare: 0.25, ifTarget: 0.62, emoji: '💙' },
          ],
          // Semana 2: sprints + VO2 en estructura diferente
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Esta semana cambia el orden de las piezas.' },
            { day: 'Martes',   type: 'sprint',   name: 'Sprints máximos + umbral', description: 'Primero potencia pico máxima, luego termina con series de umbral. Estrés mixto en una sesión.', tssShare: 0.17, ifTarget: 0.84, emoji: '🟣' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1', description: 'Piernas ligeras. Solo circulación.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'vo2max',   name: 'Micro-intervalos VO₂ (30/30)', description: 'Series de 30 s al 120% FTP con 30 s de recuperación. Estimula el VO₂ de forma diferente.', tssShare: 0.18, ifTarget: 0.87, emoji: '🔴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 aeróbico', description: 'Rodada aeróbica de soporte. Sin estrés.', tssShare: 0.13, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'threshold', name: 'Umbral + VO₂ combinados', description: 'Bloques de umbral seguidos de mini-series VO₂ al final. Combina las dos zonas más importantes.', tssShare: 0.22, ifTarget: 0.86, emoji: '🟡' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón con inserción de calidad', description: 'Fondo largo con 3 bloques de 5 min en Z4 en el medio. No es solo base — es rendimiento.', tssShare: 0.25, ifTarget: 0.65, emoji: '💙' },
          ],
          // Semana 3: acumulación máxima VO2
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso — la semana más dura del bloque VO₂' },
            { day: 'Martes',   type: 'vo2max',   name: 'VO₂ Max — máximo volumen de series', description: 'El mayor esfuerzo VO₂ del bloque. El cuerpo tiene que adaptarse por obligación.', tssShare: 0.21, ifTarget: 0.88, emoji: '🔴' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 obligatoria', description: 'No te saltes la recuperación. El esfuerzo de ayer lo requiere.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'threshold', name: 'Umbral de soporte — series largas', description: 'Base de umbral que consolida las adaptaciones VO₂. Más tiempo que semanas anteriores.', tssShare: 0.19, ifTarget: 0.84, emoji: '🟡' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 activo', description: 'Rodada moderada. El sistema necesita oxígeno, no más estrés.', tssShare: 0.13, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'vo2max',   name: 'VO₂ Max — sesión de cierre de bloque', description: 'Última sesión VO₂ antes de la recuperación. Dalo todo — la próxima semana descanso.', tssShare: 0.22, ifTarget: 0.89, emoji: '🔴' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón largo de cierre', description: 'Cierra el bloque con base aeróbica pura. El cuerpo agradece el cambio de estímulo.', tssShare: 0.26, ifTarget: 0.63, emoji: '💙' },
          ],
          // Semana 4: sprints + VO2 combinados — dos calidades en días distintos
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso total. Sprints el martes, VO₂ el jueves.' },
            { day: 'Martes',   type: 'sprint',   name: 'Sprints neuromusculares explosivos', description: 'Ocho sprints de 8 s al máximo con 7 min de recuperación completa. Potencia pico antes del VO₂.', tssShare: 0.16, ifTarget: 0.84, emoji: '🟣' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Muy suave. El sistema nervioso necesita descanso tras los sprints del martes.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'vo2max',   name: 'VO₂ Max — máxima capacidad aeróbica', description: 'Series de 4 min al 112% FTP. La sesión cardiovascular más dura de la semana.', tssShare: 0.21, ifTarget: 0.89, emoji: '🔴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de asimilación', description: 'Rodada aeróbica para absorber los dos estímulos duros de martes y jueves.', tssShare: 0.14, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'threshold', name: 'Umbral de soporte + mini-sprints', description: 'Bloques de umbral con un sprint de 6 s al final de cada uno. Conecta intensidades.', tssShare: 0.20, ifTarget: 0.85, emoji: '🟡' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón largo de soporte aeróbico', description: 'Fondón en Z2 para consolidar las adaptaciones de alta intensidad de la semana.', tssShare: 0.27, ifTarget: 0.63, emoji: '💙' },
          ],
          // Semana 5: micro-VO2 + umbral largo — cambio de estructura temporal
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Esta semana el VO₂ es en formato corto y el umbral es largo.' },
            { day: 'Martes',   type: 'vo2max',   name: 'Micro-series VO₂ (30/30)', description: 'Doce series de 30 s al 120% FTP con 30 s de recuperación. Estimula el VO₂ de forma diferente y tolerable.', tssShare: 0.17, ifTarget: 0.88, emoji: '🔴' },
            { day: 'Miércoles',type: 'endurance', name: 'Z2 de soporte aeróbico', description: 'Rodada aeróbica moderada. Mantiene el volumen sin comprometer la recuperación del jueves.', tssShare: 0.13, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Jueves',   type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Pedaleo suave. Prepara el cuerpo para el umbral largo del viernes.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'threshold', name: 'Umbral largo sostenido', description: 'Serie continua al FTP. Resistencia de umbral máxima en una sola serie.', tssShare: 0.22, ifTarget: 0.85, emoji: '🟡' },
            { day: 'Sábado',   type: 'vo2max',   name: 'VO₂ Max — segunda sesión semanal', description: 'Series de 3 min al 110% FTP. El segundo VO₂ de la semana para forzar supercompensación.', tssShare: 0.20, ifTarget: 0.88, emoji: '🔴' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón aeróbico de cierre', description: 'Fondón tranquilo en Z1-Z2. Después de una semana dura, el cuerpo necesita volumen suave.', tssShare: 0.26, ifTarget: 0.63, emoji: '💙' },
          ],
        ][w],
      },

      sprint: {
        base: [
          // Semana 1: fuerza muscular + esprints
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Los sprinters necesitan recuperación total entre sesiones de alta intensidad.' },
            { day: 'Martes',   type: 'strength', name: 'Fuerza muscular (baja cadencia)', description: 'Cadencia 50-65 rpm en subidas para desarrollar torque alto. La fuerza es la base del sprint.', tssShare: 0.17, ifTarget: 0.75, emoji: '💪' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1', description: 'Cadencia fluida y libre. Limpia el lactato y prepara el jueves.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'sprint',   name: 'Esprints largos — reclutamiento', description: 'Esprints de 15-20 s con recuperación completa (5 min). Activa las fibras rápidas puras.', tssShare: 0.15, ifTarget: 0.78, emoji: '🟣' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso activo — caminar o nadar suave' },
            { day: 'Sábado',   type: 'sprint',   name: 'Potencia máxima absoluta', description: 'Sprints de 8-10 s al 100% con 10 min de recuperación. Trabajo neuromuscular puro.', tssShare: 0.17, ifTarget: 0.80, emoji: '🟣' },
            { day: 'Domingo',  type: 'endurance', name: 'Rodada larga Z2', description: 'Base aeróbica indispensable. Los sprinters también necesitan motor aeróbico.', tssShare: 0.22, ifTarget: 0.65, emoji: '🔵' },
          ],
          // Semana 2: explosividad + base aeróbica reforzada
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Semana 2 cambia el énfasis.' },
            { day: 'Martes',   type: 'sprint',   name: 'Esprints desde parado — explosividad', description: 'Arranca desde velocidad muy baja con máximo torque. Activa el sistema neuromuscular diferente.', tssShare: 0.16, ifTarget: 0.82, emoji: '🟣' },
            { day: 'Miércoles',type: 'endurance', name: 'Z2 largo + activaciones finales', description: 'Rodada aeróbica larga y en los últimos 10 min añade 4 acelerones cortos. Base con chispa.', tssShare: 0.18, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Jueves',   type: 'recovery',  name: 'Recuperación activa Z1', description: 'Pedaleo muy suave. Prepara el cuerpo para el sábado.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso — piernas frescas para el sábado' },
            { day: 'Sábado',   type: 'strength', name: 'Fuerza + sprints combinados', description: 'Bloques de baja cadencia seguidos de sprints explosivos. Enlaza fuerza y velocidad.', tssShare: 0.20, ifTarget: 0.78, emoji: '💪' },
            { day: 'Domingo',  type: 'endurance', name: 'Z2 de asimilación', description: 'Base aeróbica tranquila para asimilar la carga neuromuscular del sábado.', tssShare: 0.22, ifTarget: 0.65, emoji: '🔵' },
          ],
          // Semana 3: máxima potencia pico del bloque base
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso — semana de máxima carga neuromuscular' },
            { day: 'Martes',   type: 'strength', name: 'Fuerza máxima en subidas', description: 'Máximo torque en subidas largas con cadencia baja. Más carga que las semanas anteriores.', tssShare: 0.18, ifTarget: 0.76, emoji: '💪' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1', description: 'Solo circulación. Guarda potencia para el jueves y el sábado.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'sprint',   name: 'Sprints máximos — pico de potencia', description: 'Mayor volumen de sprints del bloque. Primeros 3 son los más importantes — máxima frescura.', tssShare: 0.17, ifTarget: 0.82, emoji: '🟣' },
            { day: 'Viernes',  type: 'tempo',    name: 'Tempo de soporte aeróbico', description: 'Base tempo para mantener el motor aeróbico que alimenta la recuperación entre sprints.', tssShare: 0.14, ifTarget: 0.75, emoji: '🟢' },
            { day: 'Sábado',   type: 'sprint',   name: 'Sprints de competición simulada', description: 'Simula el final de una carrera: esprints tras 2h de rodada. Replica la fatiga real.', tssShare: 0.22, ifTarget: 0.80, emoji: '🟣' },
            { day: 'Domingo',  type: 'endurance', name: 'Z2 largo — cierre de bloque', description: 'Rodada larga tranquila para cerrar el bloque con volumen aeróbico.', tssShare: 0.24, ifTarget: 0.65, emoji: '🔵' },
          ],
          // Semana 4: base neuromuscular específica — sprints el martes y VO2 el sábado
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso total. Sprints introductores el martes.' },
            { day: 'Martes',   type: 'sprint',   name: 'Sprints cortos — activación neuromuscular', description: 'Seis sprints de 6-8 s desde velocidad baja. Activa las fibras rápidas con recuperación completa de 8 min.', tssShare: 0.17, ifTarget: 0.80, emoji: '🟣' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa Z1', description: 'Pedaleo muy suave. El sistema nervioso necesita recuperación completa.', tssShare: 0.07, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'endurance', name: 'Z2 largo con cadencia alta', description: 'Base aeróbica larga en Z2. Cadencia 90-95 rpm para mantener la eficiencia sin carga neuromuscular.', tssShare: 0.22, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso activo — movilidad y estiramientos de piernas' },
            { day: 'Sábado',   type: 'vo2max',   name: 'VO₂ Max — motor aeróbico de los sprints', description: 'Series de 3 min al 110% FTP. El VO₂ mejora la recuperación entre sprints en competición.', tssShare: 0.22, ifTarget: 0.87, emoji: '🔴' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón Z2 largo de base', description: 'Fondón aeróbico puro. Los sprinters también necesitan motor de fondo para aguantar una carrera.', tssShare: 0.32, ifTarget: 0.63, emoji: '💙' },
          ],
          // Semana 5: base explosiva — sprint el viernes, fuerza el martes
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Fuerza el martes, sprint el viernes.' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 con inserción de sprints cortos', description: 'Rodada Z2 e incluye 5 sprints de 8 s a cadencia muy alta al final. Activación neuromuscular ligera.', tssShare: 0.16, ifTarget: 0.66, emoji: '🔵' },
            { day: 'Miércoles',type: 'tempo',    name: 'Tempo aeróbico de soporte', description: 'Bloque de Z3 para mantener el umbral aeróbico activo. Base que alimenta la recuperación entre sprints.', tssShare: 0.18, ifTarget: 0.75, emoji: '🟢' },
            { day: 'Jueves',   isRest: true,  description: 'Descanso activo — foam roller y movilidad de cadera' },
            { day: 'Viernes',  type: 'sprint',   name: 'Sprints explosivos de máxima cadencia', description: 'Ocho sprints de 10 s con arranque rodando a máxima cadencia posible. Velocidad pura de pedaleo.', tssShare: 0.16, ifTarget: 0.82, emoji: '🟣' },
            { day: 'Sábado',   type: 'threshold', name: 'Umbral + sprints de competición', description: 'Bloque de umbral seguido de sprints máximos. Simula el sprint tras la ruptura.', tssShare: 0.22, ifTarget: 0.84, emoji: '🟡' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón largo de cierre Z1-Z2', description: 'Rodada larga tranquila. El volumen aeróbico consolida las adaptaciones neuromusculares de la semana.', tssShare: 0.24, ifTarget: 0.63, emoji: '💙' },
          ],
        ][w],

        build: [
          // Semana 1: sprints con rampa + VO2 de soporte
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso' },
            { day: 'Martes',   type: 'sprint',   name: 'Sprints con rampa de potencia', description: 'Cada sprint más potente que el anterior. Trabaja la explosividad progresiva.', tssShare: 0.17, ifTarget: 0.82, emoji: '🟣' },
            { day: 'Miércoles',type: 'endurance', name: 'Z2 + sprints de activación', description: 'Rodaje base con picos neuromusculares cortos. Mantiene la chispa sin fatiga.', tssShare: 0.12, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Jueves',   type: 'vo2max',   name: 'Micro-intervalos VO₂', description: 'VO₂ que mejora la recuperación entre sprints en carrera real.', tssShare: 0.18, ifTarget: 0.85, emoji: '🔴' },
            { day: 'Viernes',  type: 'recovery',  name: 'Recuperación activa', description: 'Piernas al 100% para el sábado. Pedaleo muy suave.', tssShare: 0.07, ifTarget: 0.52, emoji: '😴' },
            { day: 'Sábado',   type: 'sprint',   name: 'Sprints de competición + umbral', description: 'Simula los constantes ataques o un cierre de carrera muy agresivo.', tssShare: 0.22, ifTarget: 0.80, emoji: '🟣' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón Z1-Z2', description: 'Base aeróbica extensa para asimilar el estrés neuromuscular de la semana.', tssShare: 0.25, ifTarget: 0.62, emoji: '💙' },
          ],
          // Semana 2: VO2 + sprints en orden invertido
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Esta semana el VO₂ abre la semana.' },
            { day: 'Martes',   type: 'vo2max',   name: 'VO₂ Max + arranques explosivos', description: 'Series de VO₂ con arranque explosivo en cada repetición. Estrés cardiovascular y neuromuscular.', tssShare: 0.19, ifTarget: 0.87, emoji: '🔴' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1', description: 'Muy suave. El jueves necesita piernas frescas.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'sprint',   name: 'Sprints de velocidad pura', description: 'Solo velocidad. Esprints de 8 s al máximo con 10 min de recuperación. Calidad sobre cantidad.', tssShare: 0.16, ifTarget: 0.82, emoji: '🟣' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 aeróbico de soporte', description: 'Base aeróbica moderada. Mantiene el volumen sin estrés.', tssShare: 0.13, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'threshold', name: 'Umbral + sprints de activación', description: 'Bloques de umbral con 3-4 sprints máximos al final. Combina resistencia y explosividad.', tssShare: 0.22, ifTarget: 0.83, emoji: '🟡' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón largo con chispa final', description: 'Base larga con 5 sprints de 10 s en los últimos 20 min. Entrena el sprint con fatiga real.', tssShare: 0.26, ifTarget: 0.63, emoji: '💙' },
          ],
          // Semana 3: acumulación máxima de sprints
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso — semana de máxima carga del bloque sprint' },
            { day: 'Martes',   type: 'sprint',   name: 'Sprints de máxima potencia pico', description: 'El mayor esfuerzo neuromuscular del bloque. Todos los sprints al absoluto máximo.', tssShare: 0.18, ifTarget: 0.84, emoji: '🟣' },
            { day: 'Miércoles',type: 'endurance', name: 'Z2 activo', description: 'Rodada aeróbica moderada. El sistema nervioso también necesita recuperarse.', tssShare: 0.13, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Jueves',   type: 'vo2max',   name: 'VO₂ Max — máxima capacidad aeróbica', description: 'El motor aeróbico que alimenta la recuperación entre sprints. Máximo volumen del bloque.', tssShare: 0.19, ifTarget: 0.87, emoji: '🔴' },
            { day: 'Viernes',  type: 'recovery',  name: 'Recuperación activa Z1', description: 'Piernas ligeras para el sábado. Imprescindible.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Sábado',   type: 'sprint',   name: 'Sprints de cierre — simulacro competición', description: 'El mayor volumen de sprints del bloque. Simula varios cierres de carrera consecutivos.', tssShare: 0.24, ifTarget: 0.82, emoji: '🟣' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón largo de cierre de bloque', description: 'Cierra con base aeróbica extensa. La recuperación de la semana que viene te hará más rápido.', tssShare: 0.26, ifTarget: 0.62, emoji: '💙' },
          ],
          // Semana 4: acumulación de sprints — dos sesiones separadas por VO2
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Sprint martes, VO₂ miércoles, sprint sábado.' },
            { day: 'Martes',   type: 'sprint',   name: 'Sprints de apertura — potencia inicial', description: 'Seis sprints de 10 s desde rodada con 8 min de recuperación completa. Primera tanda de la semana.', tssShare: 0.17, ifTarget: 0.83, emoji: '🟣' },
            { day: 'Miércoles',type: 'vo2max',   name: 'VO₂ Max — soporte cardiovascular', description: 'Series de 3 min al 110% FTP. Mejora la recuperación cardiovascular entre sprints de carrera.', tssShare: 0.19, ifTarget: 0.87, emoji: '🔴' },
            { day: 'Jueves',   type: 'recovery',  name: 'Recuperación Z1 doble estímulo', description: 'Pedaleo muy suave tras los dos días de alta intensidad. Imprescindible para el sábado.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de activación pre-sprint', description: 'Rodada aeróbica moderada con 3 acelerones de 8 s al final. Activa el sistema neuromuscular.', tssShare: 0.13, ifTarget: 0.66, emoji: '🔵' },
            { day: 'Sábado',   type: 'sprint',   name: 'Sprints de cierre con umbral previo', description: 'Rodada de 45 min con bloque de umbral y 5 sprints máximos al final. Simula un cierre real de carrera.', tssShare: 0.22, ifTarget: 0.83, emoji: '🟣' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón aeróbico de recuperación', description: 'Fondón en Z1-Z2. Tres sesiones de calidad esta semana — el fondón es solo asimilación.', tssShare: 0.27, ifTarget: 0.62, emoji: '💙' },
          ],
          // Semana 5: VO2 y sprint mezclados — estructura de alta densidad
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Semana de alta densidad de calidad.' },
            { day: 'Martes',   type: 'vo2max',   name: 'VO₂ Max mixto + arranques', description: 'Series de VO₂ con arranque explosivo en cada repetición. Estrés cardiovascular y neuromuscular combinados.', tssShare: 0.19, ifTarget: 0.88, emoji: '🔴' },
            { day: 'Miércoles',type: 'sprint',   name: 'Sprints de velocidad pura', description: 'Ocho sprints de 8 s al máximo absoluto. Solo velocidad — recuperación de 10 min entre series.', tssShare: 0.16, ifTarget: 0.84, emoji: '🟣' },
            { day: 'Jueves',   type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Solo circulación. Dos días duros seguidos requieren recuperación real.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de soporte aeróbico', description: 'Rodada aeróbica tranquila. Mantiene el volumen sin añadir estrés neuromuscular.', tssShare: 0.13, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'threshold', name: 'Umbral largo + sprints finales', description: 'Dos series de 12 min al FTP seguidas de 4 sprints explosivos. Entrena el sprint con fatiga acumulada.', tssShare: 0.22, ifTarget: 0.85, emoji: '🟡' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón largo de cierre Z1-Z2', description: 'Fondón aeróbico extenso. El cuerpo procesa la semana de alta densidad con volumen tranquilo.', tssShare: 0.28, ifTarget: 0.62, emoji: '💙' },
          ],
        ][w],
      },

      gran_fondo: {
        base: [
          // Semana 1: volumen aeróbico + tempo
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso activo — movilidad de caderas y core' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 con cadencia alta', description: 'Eficiencia metabólica estricta. 90-95 rpm en Z2 puro.', tssShare: 0.14, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Miércoles',type: 'tempo',     name: 'Tempo con subidón final', description: 'Rodada Z3 que construye fatiga útil de cara al fin de semana.', tssShare: 0.17, ifTarget: 0.75, emoji: '🟢' },
            { day: 'Jueves',   type: 'recovery',  name: 'Recuperación activa', description: 'Suéltate sin estresar el sistema cardiopulmonar.', tssShare: 0.07, ifTarget: 0.52, emoji: '😴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 largo — práctica nutricional', description: 'Practica metódicamente la ingesta de carbohidratos en bici. Cada 20-30 min.', tssShare: 0.17, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'long',    name: 'Simulacro de gran fondo', description: 'Practica tu estrategia nutricional exacta. Misma duración y ritmo que el día de carrera.', tssShare: 0.30, ifTarget: 0.68, emoji: '💙' },
            { day: 'Domingo',  type: 'endurance', name: 'Segunda jornada acumulada', description: 'Salir habiendo entrenado duro el día anterior es exactamente lo que replica un gran fondo real.', tssShare: 0.18, ifTarget: 0.65, emoji: '🔵' },
          ],
          // Semana 2: subidas + resistencia muscular
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso — el fondón de ayer necesita recuperación' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 con variaciones de cadencia', description: 'Alterna bloques de 5 min a 70 rpm y 5 min a 95 rpm. Trabaja la eficiencia en diferentes cadencias.', tssShare: 0.14, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Miércoles',type: 'tempo',     name: 'Tempo en subidas largas', description: 'Trabaja las subidas al ritmo tempo. Prepara los puertos del gran fondo.', tssShare: 0.18, ifTarget: 0.76, emoji: '🟢' },
            { day: 'Jueves',   type: 'recovery',  name: 'Recuperación activa', description: 'Rodaje muy suave. Prepara el viernes activo.', tssShare: 0.07, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'threshold', name: 'Umbral suave — resistencia de puerto', description: 'Series suaves de umbral que preparan para sostener potencia en los puertos largos.', tssShare: 0.16, ifTarget: 0.82, emoji: '🟡' },
            { day: 'Sábado',   type: 'long',    name: 'Gran fondo con puertos', description: 'Incluye 2-3 subidas largas en el recorrido. Replica el perfil del evento objetivo.', tssShare: 0.30, ifTarget: 0.68, emoji: '💙' },
            { day: 'Domingo',  type: 'endurance', name: 'Recuperación activa en bici', description: 'Muy suave, piernas pesadas pero que no paren. Acumular tiempo en sillín es el objetivo.', tssShare: 0.16, ifTarget: 0.63, emoji: '🔵' },
          ],
          // Semana 3: acumulación máxima volumen + sweetspot
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso — la semana de mayor volumen total del bloque base' },
            { day: 'Martes',   type: 'tempo',    name: 'Sweetspot + tempo combinados', description: 'Alterna bloques sweetspot y Z3. Más tiempo total que las semanas anteriores.', tssShare: 0.18, ifTarget: 0.77, emoji: '🟢' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa Z1', description: 'Muy suave. No añadas estrés innecesario.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'endurance', name: 'Z2 largo con práctica nutricional', description: 'Tiempo extenso en Z2. Practica el protocolo nutricional completo de carrera.', tssShare: 0.18, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Viernes',  type: 'tempo',    name: 'Tempo progresivo de activación', description: 'Rodada progresiva que activa el sistema sin agotar de cara al fin de semana.', tssShare: 0.14, ifTarget: 0.75, emoji: '🟢' },
            { day: 'Sábado',   type: 'long',    name: 'Gran fondo máximo del bloque', description: 'El fondón más largo del bloque base. Máximo tiempo en sillín y práctica nutricional completa.', tssShare: 0.34, ifTarget: 0.68, emoji: '💙' },
            { day: 'Domingo',  type: 'endurance', name: 'Segunda jornada máxima', description: 'La segunda jornada más larga del bloque. Acumula fatiga como en un gran fondo real de dos días.', tssShare: 0.18, ifTarget: 0.65, emoji: '🔵' },
          ],
          // Semana 4: foco en subidas — simulación de puertos del gran fondo
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso activo — movilidad de caderas y glúteos' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 en subidas — fuerza aeróbica', description: 'Rodada con variaciones de cadencia en las subidas. Alterna 70 rpm (fuerza) y 90 rpm (cadencia). Base de montaña.', tssShare: 0.16, ifTarget: 0.67, emoji: '🔵' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Pedaleo suave para bajar la fatiga acumulada. Estiramientos de isquiotibiales y cuádriceps.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'threshold', name: 'Simulación de puerto — umbral sostenido', description: 'Serie larga de 15-20 min al FTP en subida. Replica el esfuerzo de sostener potencia en los puertos del evento.', tssShare: 0.20, ifTarget: 0.83, emoji: '🟡' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso total — prepara el gran fondón del sábado' },
            { day: 'Sábado',   type: 'long',    name: 'Gran fondo con subidas incluidas', description: 'Incluye dos o tres puertos en el recorrido. Ritmo de base con los puertos al ritmo de carrera objetivo.', tssShare: 0.34, ifTarget: 0.68, emoji: '💙' },
            { day: 'Domingo',  type: 'endurance', name: 'Segunda jornada de consolidación', description: 'Salida moderada con las piernas cargadas. El cuerpo aprende a gestionar la fatiga acumulada de montaña.', tssShare: 0.18, ifTarget: 0.65, emoji: '🔵' },
          ],
          // Semana 5: entrenamiento nutricional — práctica sistemática de la estrategia de avituallamiento
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Esta semana practicamos la estrategia nutricional del gran fondo.' },
            { day: 'Martes',   type: 'tempo',    name: 'Tempo aeróbico de mantenimiento', description: 'Bloque de Z3 moderado para mantener el umbral activo. Sin exceder la zona de confort.', tssShare: 0.17, ifTarget: 0.75, emoji: '🟢' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Pedaleo muy suave. Asimilación del tempo del martes.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'endurance', name: 'Z2 con práctica nutricional enfocada', description: 'Rodada larga en Z2. El objetivo es practicar metódicamente la ingesta: gel cada 25 min, bebida cada 15 min.', tssShare: 0.20, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso activo — preparar la mochila y el material del fin de semana' },
            { day: 'Sábado',   type: 'long',    name: 'Simulacro completo gran fondo', description: 'Sal con el mismo material, comida y ritmo que el día de carrera. Estrategia nutricional exacta de principio a fin.', tssShare: 0.34, ifTarget: 0.68, emoji: '💙' },
            { day: 'Domingo',  type: 'endurance', name: 'Segunda jornada — asimilación y resistencia mental', description: 'Sal a rodar con fatiga acumulada. Practica la gestión del esfuerzo cuando el cuerpo no quiere más.', tssShare: 0.19, ifTarget: 0.65, emoji: '🔵' },
          ],
        ][w],

        build: [
          // Semana 1: umbral + fondón con bloques
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto' },
            { day: 'Martes',   type: 'threshold', name: 'Umbral específico de puerto', description: 'Series de umbral que replican el esfuerzo en subidas largas del gran fondo.', tssShare: 0.17, ifTarget: 0.82, emoji: '🟡' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa Z1', description: 'Asimilación pura. No busques picos de potencia hoy.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'tempo',    name: 'Bloque sweetspot largo', description: 'Eleva el umbral aeróbico para aguantar mejor las zonas medias del gran fondo.', tssShare: 0.22, ifTarget: 0.78, emoji: '🟢' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 moderado', description: 'Piernas activas sin estrés de cara al fin de semana de máxima carga.', tssShare: 0.13, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'long',    name: 'Gran fondo largo con bloques de calidad', description: 'Fondón con 2-3 bloques de sweetspot en las subidas. Replica el día de carrera real.', tssShare: 0.32, ifTarget: 0.68, emoji: '💙' },
            { day: 'Domingo',  type: 'endurance', name: 'Vuelta de acumulación Z2', description: 'Segunda jornada para enseñarle al cuerpo a digerir la fatiga crónica del gran fondo.', tssShare: 0.18, ifTarget: 0.65, emoji: '🔵' },
          ],
          // Semana 2: sweetspot + volumen máximo de fondo
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Esta semana el volumen es el protagonista.' },
            { day: 'Martes',   type: 'tempo',    name: 'Sweetspot progresivo', description: 'Bloques de sweetspot que van aumentando en duración. Resistencia específica de gran fondo.', tssShare: 0.18, ifTarget: 0.79, emoji: '🟢' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa Z1', description: 'Muy suave. El sábado será muy duro.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'threshold', name: 'Umbral de resistencia', description: 'Series de umbral más largas que la semana 1. El cuerpo ya está adaptado.', tssShare: 0.19, ifTarget: 0.83, emoji: '🟡' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 largo — carga de carbohidratos', description: 'Rodada larga aeróbica. Practica la carga de carbohidratos pre-evento.', tssShare: 0.18, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'long',    name: 'Gran fondo más largo del bloque', description: 'El fondón más largo del bloque build. Máxima resistencia específica.', tssShare: 0.35, ifTarget: 0.68, emoji: '💙' },
            { day: 'Domingo',  type: 'endurance', name: 'Segunda jornada acumulada máxima', description: 'La segunda jornada más larga del bloque. Máxima fatiga acumulada controlada.', tssShare: 0.20, ifTarget: 0.65, emoji: '🔵' },
          ],
          // Semana 3: pico de carga total antes de recuperación
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso — la semana de mayor carga total del bloque' },
            { day: 'Martes',   type: 'threshold', name: 'Umbral máximo — series muy largas', description: 'El mayor volumen de umbral del bloque. Potencia sostenida en los puertos del gran fondo.', tssShare: 0.20, ifTarget: 0.83, emoji: '🟡' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 obligatoria', description: 'No te lo saltes. El estrés de ayer y el de mañana lo requieren.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'tempo',    name: 'Sweetspot + bloques de umbral mixtos', description: 'Combina sweetspot y umbral en una sola sesión larga. Resistencia específica máxima.', tssShare: 0.22, ifTarget: 0.80, emoji: '🟢' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de activación previa', description: 'Rodada aeróbica que activa sin fatigar de cara al fin de semana de máxima carga.', tssShare: 0.14, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'long',    name: 'Gran fondo simulacro completo', description: 'La réplica más fiel del evento: distancia, ritmo, nutrición y estrategia idénticos al día de carrera.', tssShare: 0.36, ifTarget: 0.68, emoji: '💙' },
            { day: 'Domingo',  type: 'endurance', name: 'Segunda jornada de cierre', description: 'Cierra el bloque con la segunda jornada. Máxima acumulación de fatiga controlada del bloque.', tssShare: 0.20, ifTarget: 0.65, emoji: '🔵' },
          ],
          // Semana 4: back-to-back largo — dos jornadas largas consecutivas
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso total. El back-to-back del fin de semana es el objetivo.' },
            { day: 'Martes',   type: 'threshold', name: 'Umbral específico de gran fondo', description: 'Series largas al FTP simulando el ritmo de puerto del gran fondo. Potencia mantenida con técnica perfecta.', tssShare: 0.19, ifTarget: 0.83, emoji: '🟡' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Pedaleo suave para asimilar el umbral del martes. El fin de semana será el pico de la semana.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'endurance', name: 'Z2 de volumen y práctica nutricional', description: 'Rodada aeróbica extensa con ingesta cada 25 min. Practica el protocolo completo de avituallamiento.', tssShare: 0.16, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso activo — carga de carbohidratos para el back-to-back' },
            { day: 'Sábado',   type: 'long',    name: 'Jornada larga 1 — ritmo de gran fondo', description: 'Primera jornada del back-to-back. Sal al ritmo objetivo del evento. Estrategia nutricional completa.', tssShare: 0.34, ifTarget: 0.68, emoji: '💙' },
            { day: 'Domingo',  type: 'long',    name: 'Jornada larga 2 — aguantar con fatiga', description: 'Segunda jornada con las piernas cargadas. Aprende a gestionar el esfuerzo cuando el cuerpo pide parar.', tssShare: 0.24, ifTarget: 0.66, emoji: '💙' },
          ],
          // Semana 5: alta velocidad media — tempo en subidas + fondón con bloques
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Esta semana subiremos el ritmo medio del gran fondo.' },
            { day: 'Martes',   type: 'vo2max',   name: 'VO₂ Max de gran fondo — subidas cortas', description: 'Series de 3 min al 110% FTP simulando ataques en los puertos. Eleva el techo para las subidas.', tssShare: 0.18, ifTarget: 0.87, emoji: '🔴' },
            { day: 'Miércoles',type: 'endurance', name: 'Z2 largo de soporte aeróbico', description: 'Rodada aeróbica extensa. Volumen que soporta el ritmo alto de la semana.', tssShare: 0.16, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Jueves',   type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Pedaleo muy suave. Prepara el cuerpo para el fondón del fin de semana.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'tempo',    name: 'Tempo en subida con ritmo de gran fondo', description: 'Bloques de Z3 en subidas a ritmo superior al objetivo del evento. Eleva la velocidad media del gran fondo.', tssShare: 0.17, ifTarget: 0.77, emoji: '🟢' },
            { day: 'Sábado',   type: 'long',    name: 'Gran fondo con bloques de tempo en los puertos', description: 'Fondón largo a ritmo de carrera con los puertos al sweetspot-umbral. Simula el ritmo real del evento.', tssShare: 0.34, ifTarget: 0.70, emoji: '💙' },
            { day: 'Domingo',  type: 'endurance', name: 'Segunda jornada de consolidación', description: 'Rodada aeróbica moderada. Consolida la semana de alta velocidad con volumen tranquilo.', tssShare: 0.18, ifTarget: 0.65, emoji: '🔵' },
          ],
        ][w],
      },
    };

    Object.assign(templates, {

      carrera_corta: {
        // Carreras < 2h: criterium, XCO, carretera corta — VO2max + capacidad anaeróbica + surges
        base: [
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Carreras cortas se ganan con frescura.' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 con activación neuromuscular', description: 'Rodada aeróbica con 6 sprints de 10 s al máximo en el último tercio. Mantén la chispa.', tssShare: 0.14, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Muy suave. El cuerpo asimila los sprints del martes.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'tempo',    name: 'Sweetspot en bloques', description: 'Tres bloques de 10 min al 88-93% FTP. Construye la base para aguantar cambios de ritmo.', tssShare: 0.17, ifTarget: 0.78, emoji: '🟢' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso. Prepara el fin de semana de calidad.' },
            { day: 'Sábado',   type: 'threshold', name: 'Umbral + sprints de activación', description: 'Bloques de umbral con 4 sprints máximos de 10 s al final. Desarrolla el perfil de carrera corta.', tssShare: 0.21, ifTarget: 0.85, emoji: '🟡' },
            { day: 'Domingo',  type: 'endurance', name: 'Rodada aeróbica de consolidación', description: 'Z2 moderado. Consolida la semana sin añadir fatiga extra.', tssShare: 0.18, ifTarget: 0.65, emoji: '🔵' },
          ],
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso activo — movilidad y estiramientos.' },
            { day: 'Martes',   type: 'vo2max',   name: 'Intro VO₂ Max — series cortas', description: 'Primera toma de contacto con el VO₂ Max. Series de 2 min con igual recuperación.', tssShare: 0.16, ifTarget: 0.85, emoji: '🔴' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación obligatoria Z1', description: 'El VO₂ Max requiere recuperación real. Sin compromisos hoy.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'threshold', name: 'Umbral sostenido base', description: 'Series al FTP. Construye la base aeróbica de alta velocidad.', tssShare: 0.18, ifTarget: 0.82, emoji: '🟡' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso. Nutrición e hidratación correctas.' },
            { day: 'Sábado',   type: 'tempo',    name: 'Tempo largo + acelerones', description: 'Z3 sostenido con 5 arrancadas de 20 s al final de cada bloque. Simula los cambios de ritmo en carrera.', tssShare: 0.22, ifTarget: 0.79, emoji: '🟢' },
            { day: 'Domingo',  type: 'long',    name: 'Fondo moderado Z2', description: 'Fondón a ritmo aeróbico. Carreras cortas también requieren base, pero no exagerada.', tssShare: 0.24, ifTarget: 0.65, emoji: '💙' },
          ],
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso — semana de mayor carga del bloque base.' },
            { day: 'Martes',   type: 'threshold', name: 'Umbral + neuromuscular', description: 'Dos bloques de umbral + 5 sprints de 15 s máximos al final. Semana pico de calidad.', tssShare: 0.20, ifTarget: 0.85, emoji: '🟡' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1', description: 'Solo mover las piernas. El trabajo de ayer fue duro.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'vo2max',   name: 'VO₂ Max base progresivo', description: 'Series de 2-3 min con buen ritmo de trabajo. Más tiempo total que la semana 2.', tssShare: 0.18, ifTarget: 0.87, emoji: '🔴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 suave de asimilación', description: 'Rodada aeróbica para recuperar y mantener el volumen base.', tssShare: 0.12, ifTarget: 0.63, emoji: '🔵' },
            { day: 'Sábado',   type: 'tempo',    name: 'Sweetspot máximo del bloque', description: 'El bloque de sweetspot más largo del ciclo base. Prepara el umbral para la fase build.', tssShare: 0.24, ifTarget: 0.80, emoji: '🟢' },
            { day: 'Domingo',  isRest: true,  description: 'Descanso. La semana fue intensa — meréces este descanso.' },
          ],
          // Semana 4: base de VO2 — introducción progresiva VO2Max
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso activo — movilidad de cadera y activación de core' },
            { day: 'Martes',   type: 'vo2max',   name: 'VO₂ Max introductorio — series cortas', description: 'Seis series de 90 s al 110% FTP con 2 min de recuperación. Primer estímulo VO₂ concentrado de la semana.', tssShare: 0.19, ifTarget: 0.86, emoji: '🔴' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 obligatoria', description: 'Pedaleo muy suave. Las series de VO₂ del martes necesitan asimilación completa.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'tempo',    name: 'Sweetspot de soporte aeróbico', description: 'Tres bloques de 10 min al 90% FTP. Construye la base que sostiene la alta intensidad de carrera corta.', tssShare: 0.22, ifTarget: 0.79, emoji: '🟢' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso. Prepara el fin de semana de calidad.' },
            { day: 'Sábado',   type: 'threshold', name: 'Umbral con activaciones neuromusculares', description: 'Dos bloques de 10 min al FTP con 3 sprints de 10 s al final de cada uno. Perfil de carrera corta.', tssShare: 0.26, ifTarget: 0.85, emoji: '🟡' },
            { day: 'Domingo',  type: 'endurance', name: 'Z2 de consolidación aeróbica', description: 'Rodada aeróbica moderada. Asienta las dos sesiones de calidad del fin de semana.', tssShare: 0.22, ifTarget: 0.65, emoji: '🔵' },
          ],
          // Semana 5: sprint base — neuromuscular con soporte aeróbico
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Esta semana el énfasis es neuromuscular.' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 con sprints incorporados', description: 'Rodada Z2 con cinco sprints de 10 s intercalados cada 15 min. Activa las fibras rápidas sin fatiga cardiovascular alta.', tssShare: 0.18, ifTarget: 0.67, emoji: '🔵' },
            { day: 'Miércoles',type: 'tempo',    name: 'Sweetspot con cambios de ritmo', description: 'Bloques de sweetspot con arrancadas de 20 s al 120% al final de cada uno. Simula los ataques de carrera corta.', tssShare: 0.22, ifTarget: 0.81, emoji: '🟢' },
            { day: 'Jueves',   isRest: true,  description: 'Descanso activo — foam roller y movilidad de piernas' },
            { day: 'Viernes',  type: 'recovery',  name: 'Recuperación Z1 previa al sprint', description: 'Pedaleo muy suave. Prepara el sistema neuromuscular para los sprints del sábado.', tssShare: 0.07, ifTarget: 0.50, emoji: '😴' },
            { day: 'Sábado',   type: 'sprint',   name: 'Sprint base — potencia explosiva', description: 'Ocho sprints de 10 s al máximo absoluto con 8 min de recuperación completa. Desarrolla la potencia pico.', tssShare: 0.20, ifTarget: 0.82, emoji: '🟣' },
            { day: 'Domingo',  type: 'endurance', name: 'Z2 largo de cierre de base', description: 'Fondón aeróbico moderado. Consolida la semana neuromuscular con base aeróbica extensa.', tssShare: 0.30, ifTarget: 0.65, emoji: '🔵' },
          ],
        ][w],

        build: [
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso total. Empezamos el bloque duro.' },
            { day: 'Martes',   type: 'vo2max',   name: 'VO₂ Max — series 3 min', description: 'Series de 3 min al 110-115% FTP con 3 min de recuperación. Expande tu techo aeróbico.', tssShare: 0.19, ifTarget: 0.88, emoji: '🔴' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 obligatoria', description: 'El VO₂ Max del martes requiere recuperación completa.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'threshold', name: 'Umbral con surges', description: 'Bloques de 10 min al FTP con 3 arrancadas de 30 s al 120% dentro. Replicas el ritmo de carrera.', tssShare: 0.20, ifTarget: 0.87, emoji: '🟡' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de asimilación', description: 'Rodada aeróbica para absorber los dos días duros.', tssShare: 0.12, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'sprint',   name: 'Capacidad anaeróbica', description: 'Series de 1 min al máximo con 4 min de recuperación. Desarrolla la capacidad de ataque.', tssShare: 0.18, ifTarget: 0.95, emoji: '🟣' },
            { day: 'Domingo',  type: 'tempo',    name: 'Tempo de consolidación', description: 'Z3 sostenido. Añade base al bloque de alta intensidad.', tssShare: 0.22, ifTarget: 0.78, emoji: '🟢' },
          ],
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. La semana pasada fue muy exigente.' },
            { day: 'Martes',   type: 'sprint',   name: 'Sprints máximos repetidos', description: 'Series de 30 s máximos con recuperación completa. Desarrolla la potencia pico de carrera.', tssShare: 0.16, ifTarget: 0.98, emoji: '🟣' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Solo mover las piernas. Las fibras rápidas necesitan recuperarse.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'vo2max',   name: 'VO₂ Max — series largas 4-5 min', description: 'Series más largas que la semana 1. Mayor tiempo en zona de VO₂ Max — más adaptación.', tssShare: 0.20, ifTarget: 0.90, emoji: '🔴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 moderado', description: 'Base aeróbica. Fundamental aunque el objetivo sea corto.', tssShare: 0.13, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'threshold', name: 'Umbral extendido', description: 'Series largas al FTP. Más tiempo en zona de umbral que la semana 1.', tssShare: 0.22, ifTarget: 0.85, emoji: '🟡' },
            { day: 'Domingo',  type: 'long',    name: 'Fondo aeróbico moderado', description: 'Fondón Z2. No muy largo — las carreras cortas no requieren volumen extremo.', tssShare: 0.22, ifTarget: 0.65, emoji: '💙' },
          ],
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto — semana pico del bloque build.' },
            { day: 'Martes',   type: 'vo2max',   name: 'VO₂ Max máximo del bloque', description: 'Mayor volumen de VO₂ Max del ciclo. La próxima semana es de recuperación, dalo todo.', tssShare: 0.22, ifTarget: 0.90, emoji: '🔴' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1', description: 'Solo girar las piernas. Es crítico después del esfuerzo del martes.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'sprint',   name: 'Capacidad anaeróbica pico', description: 'Series anaeróbicas en el momento de mayor adaptación del bloque. Máxima potencia.', tssShare: 0.18, ifTarget: 0.98, emoji: '🟣' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de activación', description: 'Mantiene las piernas activas de cara al fin de semana de calidad.', tssShare: 0.12, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'threshold', name: 'Simulacro de carrera corta', description: 'Esfuerzo de 45-60 min a intensidad de carrera con ataques y cambios de ritmo. El ensayo final.', tssShare: 0.24, ifTarget: 0.90, emoji: '🟡' },
            { day: 'Domingo',  type: 'tempo',    name: 'Sweetspot de cierre', description: 'Cierra el bloque con sweetspot sostenido. Resistencia específica de carrera.', tssShare: 0.20, ifTarget: 0.79, emoji: '🟢' },
          ],
          // Semana 4: simulacro de carrera — umbral + sprint + soporte
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. El jueves simularemos una carrera corta.' },
            { day: 'Martes',   type: 'threshold', name: 'Umbral con surges — perfil de carrera', description: 'Tres bloques de 8 min al FTP con dos arrancadas de 30 s al 120% dentro. El patrón de esfuerzo de carrera corta.', tssShare: 0.20, ifTarget: 0.87, emoji: '🟡' },
            { day: 'Miércoles',type: 'sprint',   name: 'Sprints máximos de activación', description: 'Cinco sprints de 8 s al máximo con 8 min de recuperación. Mantiene la chispa neuromuscular.', tssShare: 0.14, ifTarget: 0.85, emoji: '🟣' },
            { day: 'Jueves',   type: 'recovery',  name: 'Recuperación Z1 pre-simulacro', description: 'Solo mover las piernas. El sábado es el simulacro de carrera — necesitas las piernas frescas.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de activación pre-carrera', description: 'Rodada aeróbica moderada con 3 acelerones de 8 s al final. Activa el sistema neuromuscular.', tssShare: 0.13, ifTarget: 0.66, emoji: '🔵' },
            { day: 'Sábado',   type: 'vo2max',   name: 'VO₂ Max — motor de las carreras cortas', description: 'Series de 4 min al 112% FTP. El VO₂ max es el factor limitante en las carreras de menos de 2h.', tssShare: 0.22, ifTarget: 0.90, emoji: '🔴' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón aeróbico de consolidación', description: 'Fondón moderado en Z2. El bloque de alta intensidad necesita base aeróbica para consolidarse.', tssShare: 0.24, ifTarget: 0.65, emoji: '💙' },
          ],
          // Semana 5: capacidad anaeróbica — acumulación final antes de recuperación
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto — semana de máxima capacidad anaeróbica.' },
            { day: 'Martes',   type: 'sprint',   name: 'Sprints de potencia pico — primera sesión', description: 'Diez sprints de 10 s al máximo con 10 min de recuperación. Mayor volumen de sprints del bloque.', tssShare: 0.18, ifTarget: 0.98, emoji: '🟣' },
            { day: 'Miércoles',type: 'vo2max',   name: 'VO₂ Max — segunda tanda de calidad', description: 'Series de 3 min al 110% FTP. Segundo estímulo de alta intensidad de la semana para forzar supercompensación.', tssShare: 0.20, ifTarget: 0.90, emoji: '🔴' },
            { day: 'Jueves',   type: 'recovery',  name: 'Recuperación Z1 obligatoria', description: 'Pedaleo muy suave. Dos días duros seguidos requieren recuperación real entre semana.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de asimilación activa', description: 'Rodada aeróbica moderada para absorber la carga de calidad de los dos días anteriores.', tssShare: 0.13, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'threshold', name: 'Umbral de cierre — máximo volumen', description: 'El mayor volumen de umbral del bloque. Series largas al FTP con surges integrados. Máxima adaptación.', tssShare: 0.24, ifTarget: 0.88, emoji: '🟡' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón aeróbico de cierre', description: 'Fondón tranquilo en Z2. Cierra el bloque de máxima carga con un estímulo aeróbico de asimilación.', tssShare: 0.22, ifTarget: 0.65, emoji: '💙' },
          ],
        ][w],
      },

      carrera_larga: {
        // Carreras 2-4h: carretera media-larga, marathon MTB, granfondo competitivo
        base: [
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso activo — movilidad y foam roller.' },
            { day: 'Martes',   type: 'tempo',    name: 'Sweetspot aeróbico', description: 'Bloques de 12-15 min al 88-93% FTP. Construye el motor para sostener ritmo de carrera largo.', tssShare: 0.17, ifTarget: 0.79, emoji: '🟢' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1', description: 'Suave. Asimilación del sweetspot del martes.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'endurance', name: 'Z2 de volumen', description: 'Z2 extenso y continuo. La base aeróbica es el pilar de las carreras largas.', tssShare: 0.16, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso. Prepara el fin de semana de volumen.' },
            { day: 'Sábado',   type: 'threshold', name: 'Umbral introductorio', description: 'Dos series de 10 min al FTP. Primer contacto con la intensidad de carrera.', tssShare: 0.20, ifTarget: 0.83, emoji: '🟡' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón largo Z2', description: 'Ritmo conversacional de principio a fin. Desarrolla la resistencia específica de las carreras largas.', tssShare: 0.30, ifTarget: 0.65, emoji: '💙' },
          ],
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. El fondón de ayer lo requiere.' },
            { day: 'Martes',   type: 'threshold', name: 'Intervalos de umbral', description: 'Dos series de 12-15 min al FTP. Las carreras largas se deciden al umbral.', tssShare: 0.20, ifTarget: 0.84, emoji: '🟡' },
            { day: 'Miércoles',type: 'recovery',  name: 'Z1 activo de recuperación', description: 'Pedaleo muy ligero. El umbral del martes necesita asimilación.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'tempo',    name: 'Tempo con bloques sweetspot', description: 'Sesión mixta Z3 + sweetspot. Resistencia muscular para los tramos duros de carrera.', tssShare: 0.18, ifTarget: 0.80, emoji: '🟢' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso. El fin de semana es el bloque de volumen.' },
            { day: 'Sábado',   type: 'endurance', name: 'Z2 largo con acelerones', description: 'Rodada larga con 4-5 acelerones de 30 s a intensidad de carrera. Desarrolla el perfil de esfuerzo.', tssShare: 0.22, ifTarget: 0.68, emoji: '🔵' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón con bloques de tempo', description: 'Fondo largo con 2 bloques de 15 min en Z3. Simula los tramos duros dentro de la carrera larga.', tssShare: 0.30, ifTarget: 0.68, emoji: '💙' },
          ],
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto — semana pico de base.' },
            { day: 'Martes',   type: 'tempo',    name: 'Sweetspot largo sostenido', description: 'El bloque de sweetspot más largo del ciclo base. Máxima adaptación al umbral aeróbico.', tssShare: 0.22, ifTarget: 0.80, emoji: '🟢' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa Z1', description: 'Solo mover las piernas. El trabajo de ayer fue significativo.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'threshold', name: 'Umbral extendido', description: 'Más tiempo al FTP que las semanas anteriores. El cuerpo ya está adaptado para asumir más.', tssShare: 0.20, ifTarget: 0.84, emoji: '🟡' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de activación', description: 'Activa las piernas sin fatigar de cara al fondo del fin de semana.', tssShare: 0.12, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'endurance', name: 'Z2 largo continuo', description: 'Volumen aeróbico puro. Practica la nutrición en bici como en carrera.', tssShare: 0.24, ifTarget: 0.66, emoji: '🔵' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón máximo de la fase base', description: 'El fondón más largo del bloque. Máxima acumulación de tiempo en sillín.', tssShare: 0.34, ifTarget: 0.65, emoji: '💙' },
          ],
          // Semana 4: sweetspot pesado + umbral — bloques medianos con descanso mid-week
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso activo — estiramientos de cadena posterior y core' },
            { day: 'Martes',   type: 'tempo',    name: 'Sweetspot base — primer bloque semanal', description: 'Tres bloques de 12 min al 90% FTP. Construye la tolerancia lactática que necesitan las carreras largas.', tssShare: 0.20, ifTarget: 0.79, emoji: '🟢' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Pedaleo muy suave. El sweetspot del martes necesita asimilarse.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'threshold', name: 'Umbral base — series medias', description: 'Dos series de 10 min al FTP. El umbral es el factor decisivo en las carreras de 2-4 horas.', tssShare: 0.20, ifTarget: 0.83, emoji: '🟡' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso total — prepara el fin de semana de volumen' },
            { day: 'Sábado',   type: 'endurance', name: 'Z2 largo con variaciones de cadencia', description: 'Z2 largo alternando bloques de 5 min a 70 rpm y 5 min a 95 rpm. Resistencia muscular.', tssShare: 0.24, ifTarget: 0.67, emoji: '🔵' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón dominical con ritmo progresivo', description: 'Con el último tercio a ritmo de carrera. Simula el esfuerzo de llegar al final con energía.', tssShare: 0.28, ifTarget: 0.67, emoji: '💙' },
          ],
          // Semana 5: back-to-back con fondón doble — volumen y resistencia de carrera larga
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. El back-to-back del fin de semana es el estímulo central.' },
            { day: 'Martes',   type: 'threshold', name: 'Umbral de activación semanal', description: 'Dos series de 8 min al FTP. Mantiene el umbral activo de cara al gran volumen del fin de semana.', tssShare: 0.18, ifTarget: 0.83, emoji: '🟡' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Pedaleo muy suave. Guarda energía para las dos jornadas largas del fin de semana.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'endurance', name: 'Z2 con práctica nutricional', description: 'Rodada aeróbica moderada. Practica el protocolo de ingesta que usarás en el back-to-back del fin de semana.', tssShare: 0.14, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso activo — carga de carbohidratos para el fin de semana' },
            { day: 'Sábado',   type: 'long',    name: 'Primera jornada larga — ritmo de carrera', description: 'Ritmo objetivo de carrera con estrategia nutricional completa. El simulacro del sábado.', tssShare: 0.34, ifTarget: 0.68, emoji: '💙' },
            { day: 'Domingo',  type: 'long',    name: 'Segunda jornada — resistencia con fatiga', description: 'Con las piernas cargadas del sábado. Esto es exactamente lo que replica una carrera larga.', tssShare: 0.26, ifTarget: 0.66, emoji: '💙' },
          ],
        ][w],

        build: [
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Comenzamos el bloque de calidad.' },
            { day: 'Martes',   type: 'threshold', name: 'Umbral progresivo — series largas', description: 'Series de 15-20 min al FTP. El umbral es el factor decisivo en carreras de 2-4h.', tssShare: 0.21, ifTarget: 0.85, emoji: '🟡' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Crítico para asimilar el umbral del martes.', tssShare: 0.06, ifTarget: 0.52, emoji: '😴' },
            { day: 'Jueves',   type: 'vo2max',   name: 'VO₂ Max — series 4 min', description: 'Series de 4 min a alta intensidad. Eleva tu techo aeróbico para resistir los ataques.', tssShare: 0.18, ifTarget: 0.88, emoji: '🔴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de recuperación activa', description: 'Volumen aeróbico sin estrés para absorber los dos días duros.', tssShare: 0.13, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'tempo',    name: 'Tempo + sweetspot de resistencia', description: 'Sesión larga en Z3-sweetspot. Resistencia muscular para sostener ritmo de carrera.', tssShare: 0.22, ifTarget: 0.80, emoji: '🟢' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón con ritmo de carrera', description: 'Fondo largo con los últimos 30 min a ritmo de carrera. Simula la fatiga acumulada.', tssShare: 0.30, ifTarget: 0.70, emoji: '💙' },
          ],
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. La semana pasada fue muy dura.' },
            { day: 'Martes',   type: 'vo2max',   name: 'VO₂ Max — bloques intensos', description: 'Series más largas de VO₂ Max. Mayor tiempo total en la zona de máxima adaptación.', tssShare: 0.20, ifTarget: 0.90, emoji: '🔴' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1', description: 'Muy suave. El VO₂ Max requiere recuperación completa.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'threshold', name: 'Umbral con ritmo de carrera', description: 'Intervalos de umbral con un bloque final a ritmo de carrera. Simula los tramos decisivos.', tssShare: 0.22, ifTarget: 0.86, emoji: '🟡' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de asimilación', description: 'Rodada aeróbica moderada. Mantiene el volumen sin comprometer la recuperación.', tssShare: 0.13, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'threshold', name: 'Fuerza específica + umbral', description: 'Baja cadencia en subidas (55-65 rpm) combinado con tramos de umbral. Resistencia muscular de carrera.', tssShare: 0.22, ifTarget: 0.85, emoji: '💪' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón simulacro de carrera', description: 'Fondón a ritmo e intensidad de carrera. Practica la nutrición y estrategia exactas.', tssShare: 0.32, ifTarget: 0.72, emoji: '💙' },
          ],
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto — semana pico del bloque build.' },
            { day: 'Martes',   type: 'threshold', name: 'Umbral máximo del bloque', description: 'El mayor volumen de umbral del ciclo. La próxima semana es recuperación, dalo todo.', tssShare: 0.24, ifTarget: 0.86, emoji: '🟡' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 obligatoria', description: 'No negociable. El umbral de ayer necesita asimilación completa.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'vo2max',   name: 'VO₂ Max pico de la fase', description: 'Máximo VO₂ Max del bloque. El cuerpo está en el punto óptimo de adaptación.', tssShare: 0.20, ifTarget: 0.90, emoji: '🔴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de activación previa', description: 'Rodada aeróbica que activa sin fatigar de cara al fin de semana de carga máxima.', tssShare: 0.12, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'tempo',    name: 'Sweetspot + umbral combinado', description: 'Bloques de sweetspot y umbral mixtos. Máxima resistencia específica de carrera larga.', tssShare: 0.24, ifTarget: 0.83, emoji: '🟢' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón final del bloque', description: 'El fondón más largo y exigente del ciclo. Réplica de carrera. Sigue tu plan nutricional.', tssShare: 0.36, ifTarget: 0.72, emoji: '💙' },
          ],
          // Semana 4: umbral doble + VO2 — estructura de máxima carga metabólica
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Umbral el martes, VO₂ el jueves, fondón el domingo.' },
            { day: 'Martes',   type: 'threshold', name: 'Umbral largo de apertura semanal', description: 'Dos series de 15 min al FTP. Primer bloque de umbral de la semana con la máxima frescura.', tssShare: 0.22, ifTarget: 0.85, emoji: '🟡' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Pedaleo suave para asimilar el umbral del martes. No comprometas el VO₂ del jueves.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'vo2max',   name: 'VO₂ Max — amplía el techo para las carreras largas', description: 'Series de 4 min al 110% FTP. El VO₂ permite resistir los ataques y recuperarse en las marchas del pelotón.', tssShare: 0.20, ifTarget: 0.89, emoji: '🔴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de asimilación activa', description: 'Rodada aeróbica moderada. Absorbe el umbral del martes y el VO₂ del jueves con volumen suave.', tssShare: 0.13, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Sábado',   type: 'threshold', name: 'Segundo bloque de umbral semanal', description: 'Una serie larga de 20 min al FTP. Segundo estímulo de umbral de la semana para forzar supercompensación.', tssShare: 0.20, ifTarget: 0.85, emoji: '🟡' },
            { day: 'Domingo',  type: 'long',    name: 'Fondón con ritmo de carrera final', description: 'Fondón largo con los últimos 45 min a ritmo objetivo de carrera. La semana más dura del bloque.', tssShare: 0.30, ifTarget: 0.72, emoji: '💙' },
          ],
          // Semana 5: polarizado carrera larga — alta intensidad y fondón largo
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Semana polarizada: alta intensidad o base. Sin zona media.' },
            { day: 'Martes',   type: 'vo2max',   name: 'VO₂ Max — calidad máxima de apertura', description: 'Series de 4 min al 112% FTP. La sesión de mayor intensidad de la semana con piernas frescas.', tssShare: 0.21, ifTarget: 0.90, emoji: '🔴' },
            { day: 'Miércoles',type: 'endurance', name: 'Z2 de soporte aeróbico puro', description: 'Rodada en Z2 estricto sin cruzar el umbral aeróbico. Volumen de soporte sin estrés metabólico.', tssShare: 0.14, ifTarget: 0.65, emoji: '🔵' },
            { day: 'Jueves',   type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Solo circulación. Prepara el cuerpo para el bloque de calidad del viernes.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'threshold', name: 'Umbral de carrera — resistencia específica', description: 'Dos series de 15 min al FTP con énfasis en la gestión del esfuerzo y la posición aerodinámica.', tssShare: 0.21, ifTarget: 0.86, emoji: '🟡' },
            { day: 'Sábado',   type: 'long',    name: 'Fondón con bloques de tempo integrados', description: 'Fondón largo con tres bloques de 15 min al sweetspot dentro. Simula la resistencia real de carrera.', tssShare: 0.32, ifTarget: 0.72, emoji: '💙' },
            { day: 'Domingo',  type: 'endurance', name: 'Z2 de asimilación post-fondón', description: 'Rodada aeróbica suave tras el fondón intenso del sábado. Facilita la recuperación activa.', tssShare: 0.14, ifTarget: 0.65, emoji: '🔵' },
          ],
        ][w],
      },

      ultra: {
        // Ultra-distancia: 200km+, multi-día, RBKM, Transcontinental, 24h
        base: [
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Los ultras se construyen con paciencia.' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 aeróbico largo', description: 'Z2 cómodo y sostenido. Desarrolla la oxidación de grasa que será tu combustible en los ultras.', tssShare: 0.16, ifTarget: 0.63, emoji: '🔵' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Mueve las piernas suavemente. Facilita la recuperación.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'endurance', name: 'Z2 con bloque sweetspot', description: 'Una hora Z2 + 2 bloques de 10 min sweetspot. La única intensidad de la semana.', tssShare: 0.18, ifTarget: 0.72, emoji: '🔵' },
            { day: 'Viernes',  isRest: true,  description: 'Descanso. Duerme bien — el fin de semana es el bloque clave.' },
            { day: 'Sábado',   type: 'long',    name: 'Salida larga Z2 — día 1', description: 'Ritmo conversacional de principio a fin. Aprende a nutrirte, gestiona el ritmo.', tssShare: 0.30, ifTarget: 0.63, emoji: '💙' },
            { day: 'Domingo',  type: 'endurance', name: 'Segunda jornada — back-to-back', description: 'Rueda de nuevo con las piernas cargadas. Este es el estímulo específico del ultra.', tssShare: 0.22, ifTarget: 0.63, emoji: '🔵' },
          ],
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. El back-to-back del fin de semana tiene un precio.' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 de asimilación', description: 'Rodada aeróbica suave. El cuerpo está absorbiendo el estímulo del fin de semana.', tssShare: 0.14, ifTarget: 0.63, emoji: '🔵' },
            { day: 'Miércoles',type: 'tempo',    name: 'Sweetspot de resistencia', description: 'Bloques de sweetspot para mantener el umbral aeróbico activo sin acumular excesiva fatiga.', tssShare: 0.18, ifTarget: 0.78, emoji: '🟢' },
            { day: 'Jueves',   type: 'recovery',  name: 'Recuperación Z1', description: 'Muy suave. Prepara el cuerpo para el gran volumen del fin de semana.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 de preparación', description: 'Rodada moderada para activar sin fatigar de cara al fin de semana largo.', tssShare: 0.12, ifTarget: 0.63, emoji: '🔵' },
            { day: 'Sábado',   type: 'long',    name: 'Salida muy larga Z2 — día 1', description: 'La salida más larga de la semana. Practica tu estrategia nutricional real. Come cada 45 min.', tssShare: 0.34, ifTarget: 0.63, emoji: '💙' },
            { day: 'Domingo',  type: 'long',    name: 'Back-to-back máximo', description: 'Segunda jornada larga consecutiva. El adaptador más específico del ultra. Ritmo muy cómodo.', tssShare: 0.26, ifTarget: 0.62, emoji: '💙' },
          ],
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto — semana pico de base. Come y duerme.' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 con activación suave', description: 'Rodada aeróbica con el cuerpo algo cargado. Aprende a rodar con fatiga acumulada.', tssShare: 0.14, ifTarget: 0.63, emoji: '🔵' },
            { day: 'Miércoles',type: 'tempo',    name: 'Sweetspot + resistencia aeróbica', description: 'Bloque largo de sweetspot que sube el umbral aeróbico. Lo más intenso de la semana.', tssShare: 0.20, ifTarget: 0.80, emoji: '🟢' },
            { day: 'Jueves',   type: 'recovery',  name: 'Recuperación Z1', description: 'Solo girar las piernas. El fin de semana será el mayor volumen del bloque.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 moderado de activación', description: 'Mantiene las piernas activas de cara al mega fin de semana.', tssShare: 0.12, ifTarget: 0.63, emoji: '🔵' },
            { day: 'Sábado',   type: 'long',    name: 'Máximo volumen del bloque base', description: 'La salida más larga del ciclo base. Ritmo conversacional. Nutrición perfecta.', tssShare: 0.38, ifTarget: 0.63, emoji: '💙' },
            { day: 'Domingo',  type: 'endurance', name: 'Segunda jornada acumulada — pico', description: 'Cierra el bloque con la segunda jornada más larga. El cuerpo aprende a gestionar la fatiga.', tssShare: 0.24, ifTarget: 0.62, emoji: '🔵' },
          ],
          // Semana 4: jornadas largas en terreno variado — practica la gestión del ritmo
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. El ultra se construye ladrillo a ladrillo.' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 aeróbico largo de base', description: 'Z2 estricto y largo. Desarrolla la oxidación de grasa que será tu combustible en el ultra.', tssShare: 0.16, ifTarget: 0.63, emoji: '🔵' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1 activa', description: 'Muy suave. Asimilación del volumen del martes antes del sweetspot del jueves.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'tempo',    name: 'Sweetspot — calidad semanal específica', description: 'Dos bloques de 15 min al 88-92% FTP. El único estímulo de calidad real de la semana en el ultra.', tssShare: 0.20, ifTarget: 0.80, emoji: '🟢' },
            { day: 'Viernes',  type: 'recovery',  name: 'Z1 de preparación para el back-to-back', description: 'Solo circulación. Guarda energía para las dos jornadas largas del fin de semana.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Sábado',   type: 'long',    name: 'Salida larga — gestión del ritmo y la nutrición', description: 'Ritmo ultra conversacional de principio a fin. Practica la estrategia de avituallamiento cada 40 min.', tssShare: 0.34, ifTarget: 0.63, emoji: '💙' },
            { day: 'Domingo',  type: 'endurance', name: 'Segunda jornada — aprender a rodar con fatiga', description: 'Con las piernas cargadas del día anterior. Este back-to-back es el estímulo más específico del ultra.', tssShare: 0.22, ifTarget: 0.62, emoji: '🔵' },
          ],
          // Semana 5: volumen puro — tiempo en sillín máximo con nutrición planificada
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. Esta semana el volumen es el protagonista absoluto.' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 aeróbico con práctica nutricional', description: 'Z2 extenso. Practica el protocolo nutricional completo del ultra: come cada 30 min sin excepción.', tssShare: 0.16, ifTarget: 0.63, emoji: '🔵' },
            { day: 'Miércoles',type: 'tempo',    name: 'Sweetspot + bloques de fuerza baja cadencia', description: 'Sweetspot con bloques intermedios a 60-65 rpm. Desarrolla la resistencia muscular que el ultra demanda.', tssShare: 0.16, ifTarget: 0.78, emoji: '🟢' },
            { day: 'Jueves',   type: 'recovery',  name: 'Z1 de recuperación profunda', description: 'Muy suave. El volumen acumulado de la semana necesita recuperación activa.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 moderado de preparación', description: 'Rodada aeróbica para llegar activo al fin de semana de máximo volumen. Sin sobrepasar el umbral aeróbico.', tssShare: 0.10, ifTarget: 0.63, emoji: '🔵' },
            { day: 'Sábado',   type: 'long',    name: 'Jornada ultra de máximo volumen', description: 'La salida más larga del bloque base, a ritmo ultra. Aprende a gestionar el esfuerzo hora tras hora.', tssShare: 0.36, ifTarget: 0.63, emoji: '💙' },
            { day: 'Domingo',  type: 'long',    name: 'Back-to-back máximo del bloque', description: 'Segunda jornada larga tras el máximo del sábado. El ultra empieza cuando el cuerpo quiere parar.', tssShare: 0.22, ifTarget: 0.62, emoji: '💙' },
          ],
        ][w],

        build: [
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. El bloque build del ultra sigue siendo volumen, pero más específico.' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 largo con fuerza baja cadencia', description: 'Incluye 3 bloques de 10 min pedaleando a 55-65 rpm en llano. Simula la fatiga muscular acumulada en el ultra.', tssShare: 0.18, ifTarget: 0.67, emoji: '🔵' },
            { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa Z1', description: 'Mover las piernas suavemente. Esencial para aguantar el volumen del fin de semana.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'tempo',    name: 'Sweetspot sostenido largo', description: 'El único bloque de calidad de la semana. Mantiene el umbral activo sin sacrificar la recuperación.', tssShare: 0.20, ifTarget: 0.80, emoji: '🟢' },
            { day: 'Viernes',  type: 'recovery',  name: 'Z1 de preparación', description: 'Muy suave. Prepara el cuerpo para el mega fin de semana.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Sábado',   type: 'long',    name: 'Ultra-simulacro día 1', description: 'Ritmo constante toda la salida, estrategia nutricional exacta del evento. Practica comer sin parar.', tssShare: 0.38, ifTarget: 0.63, emoji: '💙' },
            { day: 'Domingo',  type: 'long',    name: 'Ultra-simulacro día 2', description: 'Segunda jornada larga con piernas cargadas. Esto es exactamente lo que vivirás en el ultra.', tssShare: 0.28, ifTarget: 0.62, emoji: '💙' },
          ],
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso obligatorio. Dos días largos tienen su precio.' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 de asimilación build', description: 'Rodada aeróbica moderada. El cuerpo está procesando el enorme estímulo del fin de semana.', tssShare: 0.14, ifTarget: 0.63, emoji: '🔵' },
            { day: 'Miércoles',type: 'tempo',    name: 'Sweetspot — calidad semanal', description: 'Bloques de sweetspot. Es la única sesión de calidad real de la semana en el ultra.', tssShare: 0.20, ifTarget: 0.80, emoji: '🟢' },
            { day: 'Jueves',   type: 'recovery',  name: 'Z1 de recuperación', description: 'Pedaleo suave para facilitar la recuperación de mitad de semana.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'endurance', name: 'Z2 moderado de carga', description: 'Añade volumen aeróbico moderado de cara al fin de semana. Sin forzar.', tssShare: 0.14, ifTarget: 0.63, emoji: '🔵' },
            { day: 'Sábado',   type: 'long',    name: 'Jornada ultra máxima', description: 'La salida más larga del bloque build, ajustada a la duración de tu evento. Estrategia de ultra real.', tssShare: 0.42, ifTarget: 0.63, emoji: '💙' },
            { day: 'Domingo',  type: 'endurance', name: 'Segunda jornada de acumulación', description: 'Rodada moderada-larga para acumular fatiga específica de ultra. Ritmo muy cómodo.', tssShare: 0.22, ifTarget: 0.62, emoji: '🔵' },
          ],
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto — semana pico del ciclo build.' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 + bloques de resistencia muscular', description: 'Z2 con 4 bloques de baja cadencia. La resistencia muscular es crítica en los ultras.', tssShare: 0.18, ifTarget: 0.68, emoji: '🔵' },
            { day: 'Miércoles',type: 'recovery',  name: 'Z1 activo', description: 'Muy suave. La semana pico requiere gestión perfecta de la recuperación.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'tempo',    name: 'Sweetspot máximo del bloque', description: 'El bloque de sweetspot más largo del ciclo. Máxima adaptación aeróbica antes de la recuperación.', tssShare: 0.22, ifTarget: 0.80, emoji: '🟢' },
            { day: 'Viernes',  type: 'recovery',  name: 'Z1 de preparación', description: 'Muy suave. El fin de semana es el mayor esfuerzo del bloque.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Sábado',   type: 'long',    name: 'Simulacro de ultra máximo', description: 'La réplica más fiel del evento: misma duración, ritmo, nutrición y estrategia mental. El ensayo general.', tssShare: 0.44, ifTarget: 0.63, emoji: '💙' },
            { day: 'Domingo',  type: 'long',    name: 'Cierre del bloque — segunda jornada', description: 'Segunda jornada del simulacro. Aprende a rodar cuando el cuerpo ya no quiere. El ultra empieza aquí.', tssShare: 0.30, ifTarget: 0.62, emoji: '💙' },
          ],
          // Semana 4: volumen específico ultra — sweetspot + back-to-back enorme
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso. El ultra se entrena con paciencia y volumen estratégico.' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 largo con fuerza integrada', description: 'Z2 extenso con cinco bloques de 8 min a 60 rpm intercalados. Resistencia muscular de ultra.', tssShare: 0.14, ifTarget: 0.67, emoji: '🔵' },
            { day: 'Miércoles',type: 'recovery',  name: 'Z1 de recuperación activa', description: 'Pedaleo suave para asimilar el volumen y la fuerza del martes. Estiramientos de isquiotibiales.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Jueves',   type: 'tempo',    name: 'Sweetspot de calidad semanal', description: 'Tres bloques de 15 min al 90% FTP. La sesión de mayor intensidad de la semana para mantener el umbral activo.', tssShare: 0.16, ifTarget: 0.80, emoji: '🟢' },
            { day: 'Viernes',  type: 'recovery',  name: 'Z1 de preparación del fin de semana', description: 'Muy suave. El back-to-back del fin de semana es el mayor estímulo de la semana.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Sábado',   type: 'long',    name: 'Jornada ultra día 1 — ritmo y nutrición', description: 'Ritmo ultra sostenible de principio a fin. Estrategia nutricional exacta del evento. Come y bebe como en carrera.', tssShare: 0.36, ifTarget: 0.63, emoji: '💙' },
            { day: 'Domingo',  type: 'long',    name: 'Jornada ultra día 2 — gestión de la fatiga', description: 'Con las piernas muy cargadas del día anterior. Aprende a gestionar el esfuerzo cuando el cuerpo rechaza el ritmo.', tssShare: 0.22, ifTarget: 0.62, emoji: '💙' },
          ],
          // Semana 5: densidad específica ultra — volumen máximo con calidad integrada
          [
            { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto — la semana de mayor volumen total del bloque build.' },
            { day: 'Martes',   type: 'endurance', name: 'Z2 extenso con práctica nutricional completa', description: 'Z2 largo practicando la estrategia nutricional real: gel cada 25 min, bebida isotónica cada 15 min.', tssShare: 0.14, ifTarget: 0.63, emoji: '🔵' },
            { day: 'Miércoles',type: 'tempo',    name: 'Sweetspot + bloques de resistencia mental', description: 'Bloques de sweetspot de larga duración. Practica la gestión mental de mantener el esfuerzo cuando duele.', tssShare: 0.16, ifTarget: 0.80, emoji: '🟢' },
            { day: 'Jueves',   type: 'recovery',  name: 'Z1 de recuperación profunda', description: 'Solo moverse con mucha suavidad. El volumen acumulado necesita recuperación activa real.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Viernes',  type: 'recovery',  name: 'Z1 de preparación activa', description: 'Muy suave. El simulacro final del fin de semana es el mayor estímulo del bloque — llega fresco.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
            { day: 'Sábado',   type: 'long',    name: 'Gran simulacro de ultra — día 1', description: 'El mayor esfuerzo del bloque. Misma duración, ritmo, material y nutrición que el evento real. El ensayo definitivo.', tssShare: 0.36, ifTarget: 0.63, emoji: '💙' },
            { day: 'Domingo',  type: 'long',    name: 'Gran simulacro de ultra — día 2', description: 'Segunda jornada del ensayo. Aquí es donde el ultra de verdad empieza: cuando el cuerpo pide parar y sigues.', tssShare: 0.24, ifTarget: 0.62, emoji: '💙' },
          ],
        ][w],
      },

    });

    const goalMap = templates[goal] || templates['resistencia'];
    const phaseMap = goalMap[phase] || goalMap['base'];
    return phaseMap;
  },

  /** Sin segmentos predefinidos — el usuario configura los suyos en ajustes */
  _LOCAL_SEGMENTS: [],

  /** Devuelve el segmento configurado cuya duración estimada más se acerca a targetMin */
  _pickSegment(targetMin, intensityKey = 'minThresh') {
    const segs = this._activeSegments && this._activeSegments.length ? this._activeSegments : null;
    if (!segs) {
      // Sin segmentos configurados: descripción genérica con duración aproximada
      const mins = Math.round(targetMin);
      return { name: `una subida de ~${mins} min`, km: Math.round(targetMin * 0.3 * 10) / 10, grad: 5, minThresh: targetMin, minVO2: targetMin };
    }
    return segs.reduce((best, s) =>
      Math.abs(s[intensityKey] - targetMin) < Math.abs(best[intensityKey] - targetMin) ? s : best
    );
  },

  // ── Verificación de TSS real (NP) de los intervalos ya construidos ──
  // El ifTarget de la plantilla asume una intensidad plana para toda la sesión, pero el
  // calentamiento y la vuelta a la calma van a baja potencia y diluyen la Potencia
  // Normalizada real por debajo de ese ifTarget. Estos helpers recalculan el TSS que
  // producirían de verdad los vatios prescritos, con el mismo algoritmo (ventana móvil
  // de 30s → 4ª potencia → media → raíz 4ª) que usa FileParser._calcNP para actividades reales,
  // de forma que "planificado" y "realizado" se puedan comparar en igualdad de condiciones.
  _expandIntervalsToTrace(intervals, ftp) {
    const parseDurSec = (durStr) => {
      const m = String(durStr).match(/([\d.]+)\s*(min|s)/);
      if (!m) return 0;
      const val = parseFloat(m[1]);
      return Math.round(m[2] === 'min' ? val * 60 : val);
    };
    const parseReps = (label) => {
      const m = String(label).match(/\(×\s*(\d+)/);
      return m ? parseInt(m[1], 10) : 1;
    };
    const parseWattsSegs = (wattsStr) => {
      const s = String(wattsStr || '');
      if (/m[áa]x/i.test(s) && !s.includes('/')) return [Math.round(ftp * 1.5)];
      const nums = (s.match(/\d+(\.\d+)?/g) || []).map(Number);
      if (s.includes('/') && nums.length >= 2) return [nums[0], nums[1]];
      if (nums.length >= 2) return [(nums[0] + nums[1]) / 2];
      if (nums.length === 1) return [nums[0]];
      return [Math.round(ftp * 0.5)];
    };

    const trace = [];
    for (const iv of (intervals || [])) {
      const reps = parseReps(iv.label);
      const perRepSec = parseDurSec(iv.dur);
      if (!perRepSec) continue;
      const wSegs = parseWattsSegs(iv.watts);
      for (let r = 0; r < reps; r++) {
        if (wSegs.length === 2) {
          const half = Math.round(perRepSec / 2);
          for (let s = 0; s < half; s++) trace.push(wSegs[0]);
          for (let s = 0; s < perRepSec - half; s++) trace.push(wSegs[1]);
        } else {
          for (let s = 0; s < perRepSec; s++) trace.push(wSegs[0]);
        }
      }
    }
    return trace;
  },

  _npFromTrace(trace) {
    const WIN = 30;
    if (!trace.length) return 0;
    if (trace.length < WIN) return trace.reduce((a, b) => a + b, 0) / trace.length;
    let sum = 0;
    for (let i = 0; i < WIN; i++) sum += trace[i];
    let pow4sum = 0;
    const count = trace.length - WIN + 1;
    for (let i = WIN - 1; i < trace.length; i++) {
      if (i >= WIN) sum += trace[i] - trace[i - WIN];
      const avg = sum / WIN;
      pow4sum += avg * avg * avg * avg;
    }
    return Math.pow(pow4sum / count, 0.25);
  },

  /** TSS real (vía NP) que producirían los vatios ya prescritos en `intervals` */
  _realTSS(intervals, ftp) {
    const trace = this._expandIntervalsToTrace(intervals, ftp);
    if (!trace.length || !ftp) return null;
    const np = this._npFromTrace(trace);
    const ifReal = np / ftp;
    const hours = trace.length / 3600;
    return { tss: hours * ifReal * ifReal * 100, ifReal, durSec: trace.length };
  },

  /** Genera estructura de intervalos detallada */
  _buildIntervals(type, ftp, durMin, tss, ifTarget, variant = 'main') {
    const pct = (ratio) => Math.round(ftp * ratio);

    // Días de series (umbral/VO2/sprint/fuerza/tempo): calentamiento mínimo de 15 min,
    // escalando con el 20% de la duración hasta un techo de 30 min en sesiones largas
    // (150 min, el máximo para estos tipos) — el resto de tipos mantiene el mínimo de 10 min.
    const QUALITY_TYPES = ['tempo', 'threshold', 'vo2max', 'sprint', 'strength'];
    const minWarm = QUALITY_TYPES.includes(type) ? 15 : 10;
    let warm = Math.max(minWarm, Math.round(durMin * 0.2));
    let cool = Math.max(10, Math.round(durMin * 0.15));
    let main = Math.max(0, durMin - warm - cool);

    // Salvaguarda para entrenos calculados extremadamente cortos
    if (main < 10 && type !== 'recovery') {
      return [
        { label: 'Rodaje corto', dur: `${durMin} min`, watts: `${pct(0.55)}–${pct(0.70)} W`, rpm: '85-90 rpm', desc: 'Sesión muy corta, rodaje aeróbico continuo.' }
      ];
    }

    let intervals = [];

    switch(type) {
      case 'recovery':
        if (variant === 'main') {
          intervals.push({ label: 'Pedaleo suave Z1', dur: `${durMin} min`, watts: `${pct(0.45)}–${pct(0.55)} W`, rpm: '90-100 rpm', desc: 'Pedaleo muy ligero, sin estrés. Recuperación activa.' });
        } else {
          intervals.push({ label: 'Pedaleo suave Z1', dur: `${durMin - 5} min`, watts: `${pct(0.45)}–${pct(0.55)} W`, rpm: '90-100 rpm', desc: 'Pedaleo muy ligero.' });
          intervals.push({ label: 'Aceleraciones de agilidad (×3 repeticiones)', dur: `10 s c/u`, watts: `libre`, rpm: '110+ rpm', desc: 'Aceleraciones cortas de alta cadencia para soltar piernas.' });
          intervals.push({ label: 'Recuperación (×3 repeticiones)', dur: `50 s c/u`, watts: `${pct(0.40)}–${pct(0.50)} W`, rpm: '90 rpm', desc: 'Recuperación entre aceleraciones.' });
          intervals.push({ label: 'Vuelta a la calma', dur: `2 min`, watts: `< ${pct(0.50)} W`, rpm: 'libre', desc: 'Soltar piernas.' });
        }
        break;

      case 'endurance':
      case 'long':
        warm = Math.max(10, Math.round(durMin * 0.15));
        cool = Math.max(10, Math.round(durMin * 0.10));
        main = durMin - warm - cool;
        intervals.push({ label: 'Calentamiento', dur: `${warm} min`, watts: `${pct(0.50)}–${pct(0.60)} W`, rpm: '85-90 rpm', desc: 'Activación suave.' });

        if (ifTarget >= 0.70 && type === 'endurance' && main >= 30) {
          // Z2 + 2 bloques sweetspot: estructura para sesiones de endurance con componente de calidad
          const ssBlock = 10;
          const ssRec   = Math.max(3, Math.round(main * 0.10));
          const z2Block = Math.max(10, main - ssBlock * 2 - ssRec);
          intervals.push({ label: 'Bloque Z2 aeróbico', dur: `${z2Block} min`, watts: `${pct(0.60)}–${pct(0.70)} W`, rpm: '85-90 rpm', desc: 'Base aeróbica estable antes de la calidad.' });
          intervals.push({ label: 'Sweetspot (×2 repeticiones)', dur: `${ssBlock} min c/u`, watts: `${pct(0.88)}–${pct(0.93)} W`, rpm: '88-92 rpm', desc: 'Esfuerzo "comfortably hard". Respiración elevada pero rítmica.' });
          intervals.push({ label: 'Recuperación Z2 (×1 repeticiones)', dur: `${ssRec} min c/u`, watts: `${pct(0.60)}–${pct(0.68)} W`, rpm: '90 rpm', desc: 'Recuperación parcial entre bloques sweetspot.' });
        } else if (variant === 'main') {
          intervals.push({ label: 'Bloque Z2 principal', dur: `${main} min`, watts: `${pct(0.56)}–${pct(0.75)} W`, rpm: '85-92 rpm', desc: 'Esfuerzo aeróbico continuo.' });
        } else {
          let blocks = Math.floor(main / 20);
          if (blocks >= 2) {
            for (let b = 0; b < blocks; b++) {
              intervals.push({ label: 'Z2 Aeróbico', dur: '18 min', watts: `${pct(0.60)}–${pct(0.70)} W`, rpm: '85-90 rpm', desc: 'Base aeróbica estable.' });
              intervals.push({ label: 'Inserción Tempo', dur: '2 min', watts: `${pct(0.80)}–${pct(0.85)} W`, rpm: '95 rpm', desc: 'Romper la monotonía muscular.' });
            }
            const remaining = main - (blocks * 20);
            if (remaining > 0) {
              intervals.push({ label: 'Z2 Aeróbico', dur: `${remaining} min`, watts: `${pct(0.60)}–${pct(0.70)} W`, rpm: '85-90 rpm', desc: 'Completar tiempo aeróbico.' });
            }
          } else {
            intervals.push({ label: 'Bloque Z2 con variaciones de cadencia', dur: `${main} min`, watts: `${pct(0.56)}–${pct(0.75)} W`, rpm: '75-95 rpm (alternando)', desc: 'Esfuerzo aeróbico continuo alternando cadencias.' });
          }
        }
        intervals.push({ label: 'Vuelta a la calma', dur: `${cool} min`, watts: `${pct(0.45)}–${pct(0.55)} W`, rpm: '90 rpm', desc: 'Reducir gradualmente.' });
        break;

      case 'tempo': {
        intervals.push({ label: 'Calentamiento progresivo', dur: `${warm} min`, watts: `${pct(0.55)}–${pct(0.70)} W`, rpm: '88 rpm', desc: 'Incremento gradual.' });
        if (variant === 'main') {
          if (main >= 25) {
            let blockTime = Math.floor(main / 2.5);
            let recTime = main - (blockTime * 2);
            const tempoSeg = this._pickSegment(blockTime, 'minThresh');
            intervals.push({ label: `Bloques Z3 en ${tempoSeg.name} (×2 repeticiones)`, dur: `${blockTime} min c/u`, watts: `${pct(0.76)}–${pct(0.88)} W`, rpm: '85-90 rpm', desc: `Sube ${tempoSeg.name} (${tempoSeg.km} km / ${tempoSeg.grad}%) "comfortably hard". Respiración elevada pero rítmica.` });
            intervals.push({ label: `Recuperación Z1 (×1 repeticiones)`, dur: `${recTime} min c/u`, watts: `${pct(0.50)}–${pct(0.55)} W`, rpm: '90+ rpm', desc: 'Pedaleo suave bajando.' });
          } else {
            const tempoSegS = this._pickSegment(main, 'minThresh');
            intervals.push({ label: `Bloque Sweetspot en ${tempoSegS.name}`, dur: `${main} min`, watts: `${pct(0.76)}–${pct(0.88)} W`, rpm: '85-90 rpm', desc: `${tempoSegS.name} sostenido en sweetspot. "Comfortably hard".` });
          }
        } else {
          let reps = 4;
          let blockTime = Math.floor((main * 0.8) / reps);
          let recTime = Math.floor((main * 0.2) / (reps - 1));
          const tempoSegAlt = this._pickSegment(blockTime, 'minThresh');
          intervals.push({ label: `Intervalos Z3 en ${tempoSegAlt.name} (×${reps} repeticiones)`, dur: `${blockTime} min c/u`, watts: `${pct(0.80)}–${pct(0.88)} W`, rpm: '90 rpm', desc: `Sweetspot dinámico en ${tempoSegAlt.name}.` });
          intervals.push({ label: `Recuperación (×${reps-1} repeticiones)`, dur: `${recTime} min c/u`, watts: `${pct(0.50)}–${pct(0.55)} W`, rpm: '90+ rpm', desc: 'Micro-descansos bajando.' });
          let remaining = main - (reps * blockTime + (reps - 1) * recTime);
          if (remaining > 0) cool += remaining;
        }
        intervals.push({ label: 'Vuelta a la calma', dur: `${cool} min`, watts: `< ${pct(0.60)} W`, rpm: 'libre', desc: 'Reducción gradual.' });
        break;
      }

      case 'threshold': {
        intervals.push({ label: 'Calentamiento', dur: `${warm} min`, watts: `${pct(0.55)}–${pct(0.70)} W`, rpm: '88-92 rpm', desc: 'Incluye sprints cortos para activar.' });
        if (variant === 'main') {
          let repsTh = main > 40 ? 3 : 2;
          let workTh = Math.floor((main * 0.75) / repsTh);
          let recTh = Math.floor((main * 0.25) / (repsTh - 1));
          if (workTh < 8) { repsTh = 1; workTh = main; recTh = 0; }
          let actualMainTh = (repsTh * workTh) + ((repsTh > 1 ? repsTh - 1 : 0) * recTh);
          cool += (main - actualMainTh);
          const thSeg = this._pickSegment(workTh, 'minThresh');
          if (repsTh > 1) {
            intervals.push({ label: `Series de umbral en ${thSeg.name} (×${repsTh} repeticiones)`, dur: `${workTh} min c/u`, watts: `${pct(0.93)}–${pct(1.03)} W`, rpm: '85-90 rpm', desc: `Sube ${thSeg.name} (${thSeg.km} km / ${thSeg.grad}%) al FTP. Respiración muy alta pero controlada.` });
            intervals.push({ label: `Recuperación activa (×${repsTh-1} repeticiones)`, dur: `${recTh} min c/u`, watts: `${pct(0.50)}–${pct(0.55)} W`, rpm: '90+ rpm', desc: 'Recuperación bajando. No parar.' });
          } else {
            intervals.push({ label: `Intervalo al umbral en ${thSeg.name}`, dur: `${workTh} min`, watts: `${pct(0.93)}–${pct(1.03)} W`, rpm: '85-90 rpm', desc: `Sube ${thSeg.name} (${thSeg.km} km / ${thSeg.grad}%) sostenido al FTP.` });
          }
        } else {
          let repsOU = 3;
          let blockTime = Math.floor((main * 0.75) / repsOU);
          let recTime = Math.floor((main * 0.25) / (repsOU - 1));
          const ouSeg = this._pickSegment(blockTime, 'minThresh');
          intervals.push({ label: `Over-Unders en ${ouSeg.name}: 2m al 90% + 1m al 105% (×${repsOU} repeticiones)`, dur: `${blockTime} min c/u`, watts: `${pct(0.90)} / ${pct(1.05)} W`, rpm: '90 rpm', desc: `Cambios de ritmo en ${ouSeg.name}. Alterna intensidad para tolerar y limpiar lactato.` });
          intervals.push({ label: `Recuperación activa (×${repsOU-1} repeticiones)`, dur: `${recTime} min c/u`, watts: `${pct(0.50)}–${pct(0.55)} W`, rpm: '90+ rpm', desc: 'Recuperación completa bajando.' });
          let actualMainOU = (repsOU * blockTime) + ((repsOU > 1 ? repsOU - 1 : 0) * recTime);
          cool += (main - actualMainOU);
        }
        intervals.push({ label: 'Vuelta a la calma', dur: `${cool} min`, watts: `< ${pct(0.60)} W`, rpm: 'libre', desc: 'Reducir gradualmente.' });
        break;
      }

      case 'vo2max': {
        intervals.push({ label: 'Calentamiento', dur: `${warm} min`, watts: `${pct(0.55)}–${pct(0.70)} W`, rpm: '90 rpm', desc: 'Activación completa. Incluye 2×2 min al 90% FTP.' });
        if (variant === 'main') {
          let repWorkV = 4;
          let repRestV = 4;
          let repsV = Math.floor(main / (repWorkV + repRestV));
          if (repsV < 3 && main >= 15) { repWorkV = 3; repRestV = 3; repsV = Math.floor(main / 6); }
          if (repsV < 2) { repsV = 2; repWorkV = Math.floor(main/4); repRestV = Math.floor(main/4); }
          let actualMainV = repsV * (repWorkV + repRestV);
          cool += (main - actualMainV);
          const vo2Seg = this._pickSegment(repWorkV, 'minVO2');
          intervals.push({ label: `Series VO₂Max en ${vo2Seg.name} (×${repsV} repeticiones)`, dur: `${repWorkV} min c/u`, watts: `${pct(1.06)}–${pct(1.20)} W`, rpm: '90-100 rpm', desc: `Sube ${vo2Seg.name} (${vo2Seg.km} km / ${vo2Seg.grad}%) a tope. FC máxima ~90-95%. Baja pedaleando suave.` });
          intervals.push({ label: `Recuperación activa (×${repsV} repeticiones)`, dur: `${repRestV} min c/u`, watts: `${pct(0.50)}–${pct(0.55)} W`, rpm: '90+ rpm', desc: 'Recuperación activa bajando. No parar.' });
        } else {
          let blockDur = 8;
          let restDur = 4;
          let repsMicro = Math.floor(main / (blockDur + restDur));
          if (repsMicro < 2) { repsMicro = 2; blockDur = 6; restDur = 3; }
          let actualMainM = repsMicro * (blockDur + restDur);
          cool += (main - actualMainM);
          const vo2SegB = this._pickSegment(blockDur, 'minVO2');
          intervals.push({ label: `Micro-intervalos 40s ON / 20s OFF en ${vo2SegB.name} (×${repsMicro} repeticiones)`, dur: `${blockDur} min c/u`, watts: `${pct(1.15)} / ${pct(0.50)} W`, rpm: '100 / 85 rpm', desc: `Bloques en ${vo2SegB.name}: 40s fuerte + 20s suave de forma continua.` });
          intervals.push({ label: `Recuperación de bloque (×${repsMicro} repeticiones)`, dur: `${restDur} min c/u`, watts: `${pct(0.45)}–${pct(0.50)} W`, rpm: '90 rpm', desc: 'Limpiar lactato entre bloques.' });
        }
        intervals.push({ label: 'Vuelta a la calma', dur: `${cool} min`, watts: `< ${pct(0.60)} W`, rpm: 'libre', desc: 'Reducción gradual. Hidratación.' });
        break;
      }

      case 'sprint': {
        const sprintSeg = (this._activeSegments && this._activeSegments[0]) || { name: 'una subida corta de ~1 min', km: 1, grad: 5, minThresh: 3.5, minVO2: 2.5 };
        intervals.push({ label: 'Calentamiento extenso', dur: `${warm} min`, watts: `${pct(0.55)}–${pct(0.70)} W`, rpm: '88-95 rpm', desc: 'Activación completa.' });
        if (variant === 'main') {
          let sprintReps = Math.floor(main / 3);
          if (sprintReps < 4) sprintReps = 4;
          if (sprintReps > 12) sprintReps = 12;
          let actualMainS = sprintReps * 3;
          cool += (main - actualMainS);
          intervals.push({ label: `Sprints en ${sprintSeg.name} (×${sprintReps} repeticiones)`, dur: '20 s c/u', watts: `${pct(1.50)}–máx`, rpm: '110-130+ rpm', desc: `MÁXIMO esfuerzo arrancando en ${sprintSeg.name} (${sprintSeg.km} km / ${sprintSeg.grad}%). Power peaking.` });
          intervals.push({ label: `Recuperación (×${sprintReps} repeticiones)`, dur: '2.5 min c/u', watts: `< ${pct(0.55)} W`, rpm: 'libre', desc: 'Recuperación completa entre sprints.' });
        } else {
          let sprintReps = Math.floor(main / 4);
          if (sprintReps < 4) sprintReps = 4;
          if (sprintReps > 10) sprintReps = 10;
          let actualMainS = sprintReps * 4;
          cool += (main - actualMainS);
          intervals.push({ label: `Sprints desde parado en ${sprintSeg.name} (×${sprintReps} repeticiones)`, dur: '12 s c/u', watts: `Máx W`, rpm: 'arranca duro', desc: `Fuerza máxima absoluta. Arranca casi parado en la entrada de ${sprintSeg.name}.` });
          intervals.push({ label: `Recuperación (×${sprintReps} repeticiones)`, dur: '3.5 min c/u', watts: `< ${pct(0.55)} W`, rpm: 'libre', desc: 'Recuperación completa y total.' });
        }
        intervals.push({ label: 'Vuelta a la calma', dur: `${cool} min`, watts: `< ${pct(0.55)} W`, rpm: 'libre', desc: 'Limpiar el lactato. Muy importante post-sprints.' });
        break;
      }

      case 'strength': {
        intervals.push({ label: 'Calentamiento', dur: `${warm} min`, watts: `${pct(0.55)}–${pct(0.65)} W`, rpm: '85 rpm', desc: 'Calentamiento estándar.' });
        if (variant === 'main') {
          let repsS = 4;
          let workS = Math.floor((main * 0.8) / repsS);
          let recS = Math.floor((main * 0.2) / repsS);
          if (workS < 5) { repsS = 3; workS = Math.floor((main * 0.8) / repsS); recS = Math.floor((main * 0.2) / repsS); }
          let actualMainStr = repsS * (workS + recS);
          cool += (main - actualMainStr);
          const strSeg = this._pickSegment(workS, 'minThresh');
          intervals.push({ label: `Fuerza en ${strSeg.name} — cadencia baja (×${repsS} repeticiones)`, dur: `${workS} min c/u`, watts: `${pct(0.80)}–${pct(0.95)} W`, rpm: '50-65 rpm', desc: `Sube ${strSeg.name} (${strSeg.km} km / ${strSeg.grad}%) con cadencia muy baja. Activa fibras de alta potencia.` });
          intervals.push({ label: `Recuperación activa (×${repsS} repeticiones)`, dur: `${recS} min c/u`, watts: `< ${pct(0.55)} W`, rpm: '90+ rpm', desc: 'Cadencia alta bajando para limpiar lactato.' });
        } else {
          let repsS = 6;
          let workS = Math.floor((main * 0.75) / repsS);
          let recS = Math.floor((main * 0.25) / repsS);
          let actualMainStr = repsS * (workS + recS);
          cool += (main - actualMainStr);
          const strSegB = this._pickSegment(workS, 'minThresh');
          intervals.push({ label: `Fuerza específica en ${strSegB.name} (×${repsS} repeticiones)`, dur: `${workS} min c/u`, watts: `${pct(0.90)}–${pct(1.00)} W`, rpm: '55-60 rpm', desc: `${strSegB.name}: fuerza submáxima con cadencia muy baja. Siente cada pedalada.` });
          intervals.push({ label: `Recuperación fluida (×${repsS} repeticiones)`, dur: `${recS} min c/u`, watts: `< ${pct(0.55)} W`, rpm: '100+ rpm', desc: 'Mucho molinillo para limpiar lactato.' });
        }
        intervals.push({ label: 'Vuelta a la calma', dur: `${cool} min`, watts: `< ${pct(0.55)} W`, rpm: 'libre', desc: 'Importante: estirar cuádriceps post-sesión.' });
        break;
      }

      case 'race':
        intervals.push({ label: 'Activación suave', dur: `${warm + main} min`, watts: `${pct(0.55)}–${pct(0.65)} W`, rpm: '85-90 rpm', desc: 'Llegar a la línea de salida con las piernas activas.' });
        intervals.push({ label: 'Vuelta a la calma + preparación', dur: `${cool} min`, watts: `< ${pct(0.55)} W`, rpm: 'libre', desc: 'Hidratación. Revisar equipamiento.' });
        break;

      default:
        intervals.push({ label: 'Calentamiento', dur: '10 min', watts: `${pct(0.50)}–${pct(0.60)} W`, rpm: '85-90 rpm', desc: 'Activación suave.' });
        intervals.push({ label: 'Bloque principal', dur: `${Math.max(10, durMin - 20)} min`, watts: `${pct(0.56)}–${pct(0.75)} W`, rpm: '85-92 rpm', desc: 'Esfuerzo aeróbico.' });
        intervals.push({ label: 'Vuelta a la calma', dur: '10 min', watts: `${pct(0.45)}–${pct(0.55)} W`, rpm: '90 rpm', desc: 'Reducir gradualmente.' });
        break;
    }

    return intervals;
  },
};

/* ══════════════════════════════════════════════════════════════
   GPX / TCX PARSER
══════════════════════════════════════════════════════════════ */
const FileParser = {
  // Potencia normalizada real (algoritmo TrainingPeaks): promedio rodante 30s → 4ª potencia → media → raíz 4ª
  _calcNP(powerPoints) {
    // powerPoints: [{time: Date, power: number}] ordenados por tiempo
    if (!powerPoints || powerPoints.length < 2) return null;
    const startMs = powerPoints[0].time.getTime();
    const endMs   = powerPoints[powerPoints.length - 1].time.getTime();
    const durSec  = Math.round((endMs - startMs) / 1000);
    if (durSec < 30) return null;

    // Interpolar a resolución de 1 segundo (hold-last-value)
    const sec = new Float64Array(durSec + 1);
    let pi = 0;
    for (let s = 0; s <= durSec; s++) {
      const tMs = startMs + s * 1000;
      while (pi < powerPoints.length - 1 && powerPoints[pi + 1].time.getTime() <= tMs) pi++;
      sec[s] = powerPoints[pi].power;
    }

    // Promedio rodante de 30 segundos
    const WIN = 30;
    let sum = 0;
    for (let i = 0; i < WIN; i++) sum += sec[i];
    let pow4sum = 0;
    const count = sec.length - WIN + 1;
    for (let i = WIN - 1; i < sec.length; i++) {
      if (i >= WIN) sum += sec[i] - sec[i - WIN];
      const avg = sum / WIN;
      pow4sum += avg * avg * avg * avg;
    }
    return Math.round(Math.pow(pow4sum / count, 0.25));
  },

  async parse(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'fit') {
      await this._ensureFitLibrary();
      const buffer = await file.arrayBuffer();
      return this.parseFIT(buffer, file.name);
    }
    const text = await file.text();
    if (ext === 'gpx') return this.parseGPX(text, file.name);
    if (ext === 'tcx') return this.parseTCX(text, file.name);
    if (ext === 'csv') return this.parseCSV(text, file.name);
    throw new Error('Formato no soportado. Usa FIT, GPX, TCX o CSV.');
  },

  _ensureFitLibrary() {
    return new Promise((resolve, reject) => {
      if (typeof window.FitParser !== 'undefined' || typeof window.EasyFit !== 'undefined') {
        return resolve();
      }
        import('https://cdn.jsdelivr.net/npm/fit-file-parser/+esm')
          .then(module => {
            window.FitParser = module.default || module.FitParser || module;
            resolve();
          })
          .catch(err => {
            console.error("Error descargando librería FIT:", err);
            reject(new Error('No se pudo descargar la librería FIT. Revisa tu conexión a internet.'));
          });
    });
  },

  parseFIT(buffer, name) {
    return new Promise((resolve, reject) => {
      const ParserClass = window.FitParser || window.EasyFit;
      if (!ParserClass) {
        reject(new Error('Librería FIT no disponible. Recarga la página.'));
        return;
      }
      const parser = new ParserClass({ force: true, speedUnit: 'm/s', lengthUnit: 'm', mode: 'list' });
      parser.parse(buffer, (err, data) => {
        try {
        if (err) { reject(new Error('No se pudo leer el archivo FIT: ' + err)); return; }

        console.log('[FIT] claves raíz:', Object.keys(data || {}));

        // Soporta easy-fit (data.activity.sessions) y fit-file-parser (data.sessions)
        const session = data.activity?.sessions?.[0]
          || data.sessions?.[0]
          || data.session
          || null;

        // Records pueden estar dentro de session o al nivel raíz (fit-file-parser)
        const records = session?.records || data.records || data.activity?.records || [];

        console.log('[FIT] session:', !!session, '| records:', records.length);

        if (!session && records.length === 0) {
          reject(new Error('El archivo FIT no contiene datos de sesión.'));
          return;
        }

        // Si no hay session, construir una sintética desde records
        const eff = session || {
          start_time:          records[0]?.timestamp ?? null,
          total_elapsed_time:  records.length > 1
            ? (new Date(records[records.length-1].timestamp) - new Date(records[0].timestamp)) / 1000
            : 0,
          total_distance: null, avg_speed: null, avg_power: null,
          avg_heart_rate: null, avg_cadence: null, total_ascent: null,
        };

        let d = new Date();
        const startTime = eff.start_time || records[0]?.timestamp || data.session?.start_time;
        if (startTime) {
          const rawD = new Date(startTime);
          if (!isNaN(rawD.getTime())) {
            // Si el año es menor a 2010, compensamos el Epoch de Garmin (segundos desde 1989)
            d = rawD.getFullYear() < 2010 ? new Date(rawD.getTime() + 631065600000) : rawD;
          }
        }
        const date = d.toISOString().substring(0, 10);

        // total_timer_time = tiempo con el cronómetro corriendo (excluye pausas);
        // total_elapsed_time incluye cualquier pausa entre inicio y fin, así que
        // NO debe usarse para los cálculos (TSS, velocidad media, etc).
        const duration = eff.total_timer_time
          ? Math.round(eff.total_timer_time)
          : eff.total_elapsed_time
            ? Math.round(eff.total_elapsed_time)
            : records.length > 1
              ? Math.round((new Date(records[records.length - 1].timestamp) - new Date(records[0].timestamp)) / 1000)
              : 0;

        const distance = Math.round(eff.total_distance || 0);

        const maxPCap = Math.min(2000, (AppState.athlete?.ftp || 250) * 10);
        const powers = records.filter(r => r.power != null && r.power >= 0 && r.power <= maxPCap).map(r => r.power);
        const avgPower = powers.length
          ? Math.round(powers.reduce((s, p) => s + p, 0) / powers.length)
          : (eff.avg_power || 0);

        const hrs = records.filter(r => r.heart_rate > 0 && r.heart_rate < 250).map(r => r.heart_rate);
        const avgHR = hrs.length
          ? Math.round(hrs.reduce((s, h) => s + h, 0) / hrs.length)
          : (eff.avg_heart_rate || 0);

        const cads = records.filter(r => r.cadence > 0 && r.cadence < 250).map(r => r.cadence);
        const avgCad = cads.length
          ? Math.round(cads.reduce((s, c) => s + c, 0) / cads.length)
          : (eff.avg_cadence || 0);

        const elevation = eff.total_ascent
          ? Math.round(eff.total_ascent)
          : (() => {
              const alts = records.map(r => r.altitude ?? r.enhanced_altitude).filter(a => a != null && a > -500);
              return Math.round(alts.reduce((sum, a, i) => {
                if (i === 0) return 0;
                const d = a - alts[i - 1];
                return sum + (d > 0 ? d : 0);
              }, 0));
            })();

        const avgSpeed = eff.avg_speed
          ? Math.round(eff.avg_speed * 3.6 * 10) / 10
          : (duration > 0 && distance > 0 ? Math.round((distance / duration) * 3.6 * 10) / 10 : 0);

        resolve({
          id:          'fit_' + Date.now(),
          name:        name.replace(/\.fit$/i, '').replace(/[_-]+/g, ' ').trim() || 'Actividad FIT',
          date,
          type:        'cycling',
          source:      'FIT',
          duration,
          distance,
          avg_power:   avgPower  || null,
          max_power:   eff.max_power ? Math.round(Number(eff.max_power)) : (powers.length ? Math.max(...powers) : null),
          np:          eff.normalized_power
            ? Math.round(Number(eff.normalized_power))
            : (() => {
                const pts = records
                  .filter(r => r.power != null && r.power >= 0 && r.power <= maxPCap && r.timestamp)
                  .map(r => ({ time: new Date(r.timestamp), power: r.power }));
                return FileParser._calcNP(pts) || null;
              })(),
          avg_hr:      avgHR     || null,
          max_hr:      eff.max_heart_rate ? Math.round(Number(eff.max_heart_rate)) : (hrs.length ? Math.max(...hrs) : null),
          avg_cadence: avgCad    || null,
          avg_speed:   avgSpeed  || null,
          elevation:   elevation || null,
          calories:    eff.total_calories ? Math.round(Number(eff.total_calories)) : null,
          tss:         0,
          if_value:    0,
        });
        } catch (cbErr) {
          console.error('[FIT] error en callback:', cbErr);
          reject(new Error('Error procesando FIT: ' + cbErr.message));
        }
      });
    });
  },

  parseGPX(text, name) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');
    const trkpts = Array.from(doc.querySelectorAll('trkpt'));

    if (!trkpts.length) throw new Error('No se encontraron puntos GPS en el GPX.');

    const points = trkpts.map(pt => {
      // Garmin/Strava GPX usan namespace gpxtpx:, fallback a querySelector simple
      const pwrNode = pt.querySelector('power')    || pt.getElementsByTagNameNS('*', 'power')[0];
      const hrNode  = pt.querySelector('hr')       || pt.getElementsByTagNameNS('*', 'hr')[0];
      const cadNode = pt.querySelector('cad')      || pt.getElementsByTagNameNS('*', 'cad')[0]
                   || pt.querySelector('cadence')  || pt.getElementsByTagNameNS('*', 'cadence')[0];
      return {
        lat: parseFloat(pt.getAttribute('lat')),
        lon: parseFloat(pt.getAttribute('lon')),
        ele: parseFloat(pt.querySelector('ele')?.textContent || 0),
        time: new Date(pt.querySelector('time')?.textContent || 0),
        power: pwrNode ? parseFloat(pwrNode.textContent) : null,
        hr:   hrNode  ? (parseFloat(hrNode.textContent)  || null) : null,
        cad:  cadNode ? (parseFloat(cadNode.textContent) || null) : null,
      };
    });

    const date = points[0].time.getTime() > 0 ? points[0].time.toISOString().substring(0, 10) : new Date().toISOString().substring(0, 10);
    const distance = this._calcDistance(points);
    const elevation = this._calcElevation(points);
    
    // 1. Intentar sacar tiempo real de los puntos.
    // Si el GPX tiene varios <trkseg>, cada segmento nuevo suele nacer de una
    // pausa/reanudación (o pérdida de señal) del dispositivo: sumamos la duración
    // de cada segmento por separado para excluir el hueco entre ellos, en vez de
    // usar el primer y último punto de todo el archivo (que incluiría la pausa).
    const trksegs = Array.from(doc.querySelectorAll('trkseg'));
    let durationSec = 0;
    if (trksegs.length > 1) {
      for (const seg of trksegs) {
        const segTimes = Array.from(seg.querySelectorAll('trkpt'))
          .map(pt => new Date(pt.querySelector('time')?.textContent || 0).getTime())
          .filter(t => t > 0);
        if (segTimes.length >= 2) durationSec += (segTimes[segTimes.length - 1] - segTimes[0]) / 1000;
      }
    } else {
      const startTime = points[0].time.getTime();
      const endTime = points[points.length - 1].time.getTime();
      durationSec = (startTime > 0 && endTime > startTime) ? (endTime - startTime) / 1000 : 0;
    }

    // 2. Fallback: Si no hay tiempo en los puntos (es una ruta planificada), buscar en metadatos o estimar
    if (durationSec <= 0) {
      const metaTime = doc.querySelector('metadata > time, metadata duration');
      if (metaTime) {
        durationSec = parseFloat(metaTime.textContent) || 0;
      }
      if (durationSec <= 0) {
        durationSec = Utils.estimateCyclingTime(distance, elevation, AppState.athlete?.ftp || 200, AppState.athlete?.weight || 70);
      }
    }

    const maxPowerCap = Math.min(2000, (AppState.athlete?.ftp || 250) * 10);
    const validPowers = points.filter(p => p.power != null && p.power >= 0 && p.power <= maxPowerCap);
    const avgPower = validPowers.length
      ? Math.round(validPowers.reduce((s, p) => s + p.power, 0) / validPowers.length)
      : 0;
    const maxPower = validPowers.length ? Math.max(...validPowers.map(p => p.power)) : null;

    const validHRs = points.filter(p => p.hr && p.hr > 0 && p.hr < 250);
    const avgHR = validHRs.length
      ? Math.round(validHRs.reduce((s, p) => s + p.hr, 0) / validHRs.length)
      : 0;
    const maxHR = validHRs.length ? Math.max(...validHRs.map(p => p.hr)) : null;

    const validCads = points.filter(p => p.cad && p.cad > 0 && p.cad < 200);
    const avgCad = validCads.length
      ? Math.round(validCads.reduce((s, p) => s + p.cad, 0) / validCads.length)
      : null;

    const activity = {
      id: 'gpx_' + Date.now(),
      name: name.replace('.gpx', '').replace(/_/g, ' '),
      date,
      type: 'cycling',
      source: 'GPX',
      duration: Math.round(durationSec),
      distance: Math.round(distance),
      avg_power: avgPower || null,
      max_power: maxPower || null,
      np: (() => {
        const gpxPowerPoints = validPowers.filter(p => p.time && !isNaN(p.time.getTime()))
          .map(p => ({ time: p.time, power: p.power }));
        return this._calcNP(gpxPowerPoints) || null;
      })(),
      avg_hr: avgHR || null,
      max_hr: maxHR || null,
      avg_cadence: avgCad,
      avg_speed: durationSec > 0 ? Math.round((distance / durationSec) * 36) / 10 : null,
      elevation: elevation,
      tss: 0,
      if_value: 0,
    };

    return activity;
  },

  parseTCX(text, name) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');
    const trackpoints = Array.from(doc.querySelectorAll('Trackpoint'));

    if (!trackpoints.length) throw new Error('No se encontraron trackpoints en el TCX.');

    const date = doc.querySelector('Id')?.textContent?.substring(0, 10) ||
                 trackpoints[0].querySelector('Time')?.textContent?.substring(0, 10) || '';

    const powers = [], powerPoints = [], hrs = [], cads = [], times = [], alts = [];
    const maxPCap = Math.min(2000, (AppState.athlete?.ftp || 250) * 10);
    for (const tp of trackpoints) {
      const time = new Date(tp.querySelector('Time')?.textContent || 0);
      const pwrNode = tp.querySelector('Watts') || tp.getElementsByTagNameNS('*', 'Watts')[0];
      const power = pwrNode ? parseFloat(pwrNode.textContent) : null;
      const hr = parseFloat(tp.querySelector('HeartRateBpm > Value')?.textContent || 0);
      const cadNode = tp.querySelector('Cadence') || tp.getElementsByTagNameNS('*', 'RunCadence')[0]
                   || tp.getElementsByTagNameNS('*', 'Cadence')[0];
      const cad = cadNode ? parseFloat(cadNode.textContent) : null;
      const altNode = tp.querySelector('AltitudeMeters');
      const alt = altNode ? parseFloat(altNode.textContent) : null;
      if (!isNaN(time.getTime())) times.push(time);
      if (power != null && power >= 0 && power <= maxPCap) {
        powers.push(power);
        if (!isNaN(time.getTime())) powerPoints.push({ time, power });
      }
      if (hr > 0 && hr < 250) hrs.push(hr);
      if (cad != null && cad > 0 && cad < 200) cads.push(cad);
      if (alt != null && !isNaN(alt) && alt > -500 && alt < 9000) alts.push(alt);
    }

    // TotalTimeSeconds de cada Lap es el tiempo con el cronómetro del dispositivo
    // corriendo (excluye pausas); usar el primer/último Trackpoint en su lugar
    // incluiría cualquier pausa larga entre el inicio y el fin de la grabación.
    const lapNodesForDuration = Array.from(doc.querySelectorAll('Lap'));
    const lapDurationSum = Math.round(lapNodesForDuration.reduce(
      (s, lap) => s + (parseFloat(lap.querySelector('TotalTimeSeconds')?.textContent || 0) || 0), 0));
    const durationSec = lapDurationSum > 0
      ? lapDurationSum
      : (times.length >= 2 ? Math.round((times[times.length - 1] - times[0]) / 1000) : 0);

    // Distancia: último DistanceMeters del último trackpoint (más preciso que el primero del doc)
    const distNodes = doc.querySelectorAll('Trackpoint > DistanceMeters');
    const lastDistNode = distNodes.length ? distNodes[distNodes.length - 1] : doc.querySelector('DistanceMeters');
    const distance = parseFloat(lastDistNode?.textContent || 0);

    const elevation = alts.length >= 2
      ? Math.round(alts.reduce((sum, a, i) => {
          if (i === 0) return 0;
          const d = a - alts[i - 1];
          return sum + (d > 0 ? d : 0);
        }, 0))
      : null;

    const avgPower = powers.length ? Math.round(powers.reduce((a, b) => a + b, 0) / powers.length) : 0;
    const maxPower = powers.length ? Math.max(...powers) : null;
    const avgHR = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : 0;
    const maxHR = hrs.length ? Math.max(...hrs) : null;
    const avgCad = cads.length ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null;
    // Intentar leer AvgSpeed de las extensiones de los laps (valor de Garmin = tiempo en movimiento)
    const laps = lapNodesForDuration;
    let avgSpeed = null;
    if (laps.length) {
      let totalWeight = 0, weightedSpeed = 0;
      for (const lap of laps) {
        const lapTime = parseFloat(lap.querySelector('TotalTimeSeconds')?.textContent || 0);
        const lapSpeedNode = lap.getElementsByTagNameNS('*', 'AvgSpeed')[0];
        const lapSpeed = lapSpeedNode ? parseFloat(lapSpeedNode.textContent) : NaN;
        if (!isNaN(lapSpeed) && lapTime > 0) {
          weightedSpeed += lapSpeed * lapTime;
          totalWeight += lapTime;
        }
      }
      if (totalWeight > 0) avgSpeed = Math.round((weightedSpeed / totalWeight) * 3.6 * 10) / 10;
    }
    // Fallback: distancia / tiempo total transcurrido
    if (avgSpeed === null && durationSec > 0 && distance > 0)
      avgSpeed = Math.round((distance / durationSec) * 3.6 * 10) / 10;

    return {
      id: 'tcx_' + Date.now(),
      name: name.replace('.tcx', '').replace(/_/g, ' '),
      date,
      type: 'cycling',
      source: 'TCX',
      duration: durationSec,
      distance: Math.round(distance),
      avg_power: avgPower || null,
      max_power: maxPower || null,
      np: this._calcNP(powerPoints) || null,
      avg_hr: avgHR || null,
      max_hr: maxHR || null,
      avg_cadence: avgCad,
      avg_speed: avgSpeed,
      elevation: elevation,
      tss: 0,
      if_value: 0,
    };
  },

  parseCSV(text, name) {
    const lines = text.trim().split('\n');
    const header = lines[0].toLowerCase().split(',').map(h => h.trim());
    const rows = lines.slice(1).map(l => {
      const cols = l.split(',');
      const obj = {};
      header.forEach((h, i) => obj[h] = cols[i]?.trim() || '');
      return obj;
    });

    const f = (k) => {
      const keys = header.filter(h => h.includes(k));
      return keys[0] || null;
    };

    const dateKey   = f('date') || f('fecha') || 'date';
    const powerKey  = f('power') || f('potencia') || f('np') || 'power';
    const hrKey     = f('heart') || f('hr') || f('fc') || 'hr';
    const durKey    = f('duration') || f('duracion') || f('time') || 'duration';
    const distKey   = f('distance') || f('distancia') || 'distance';
    const tssKey    = f('tss') || 'tss';
    const nameKey   = f('name') || f('nombre') || f('activity') || 'name';

    return rows.filter(r => r[dateKey]).map((r, i) => {
      const durStr = r[durKey] || '';
      let durSec = 0;
      if (durStr.includes(':')) {
        const parts = durStr.split(':').map(Number);
        durSec = parts.length === 3 ? parts[0]*3600 + parts[1]*60 + parts[2] : parts[0]*60 + parts[1];
      } else {
        durSec = parseFloat(durStr) * 60 || 0;
      }

      return {
        id: 'csv_' + i + '_' + Date.now(),
        name: r[nameKey] || `Actividad ${i + 1}`,
        date: r[dateKey]?.substring(0, 10) || '',
        type: 'cycling',
        source: 'CSV',
        duration: Math.round(durSec),
        distance: parseFloat(r[distKey]) * (parseFloat(r[distKey]) < 200 ? 1000 : 1) || null,
        avg_power: parseFloat(r[powerKey]) || null,
        np:        null,
        avg_hr:    parseFloat(r[hrKey]) || null,
        tss:       parseFloat(r[tssKey]) || 0,
        if_value:  0,
      };
    });
  },

  _calcDistance(points) {
    let dist = 0;
    for (let i = 1; i < points.length; i++) {
      dist += this._haversine(points[i - 1], points[i]);
    }
    return dist;
  },

  _haversine(a, b) {
    const R = 6371000;
    const φ1 = a.lat * Math.PI / 180, φ2 = b.lat * Math.PI / 180;
    const Δφ = (b.lat - a.lat) * Math.PI / 180;
    const Δλ = (b.lon - a.lon) * Math.PI / 180;
    const x = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  },

  _calcElevation(points) {
    let gain = 0;
    for (let i = 1; i < points.length; i++) {
      const diff = points[i].ele - points[i-1].ele;
      if (diff > 0) gain += diff;
    }
    return Math.round(gain);
  },
};

/* ══════════════════════════════════════════════════════════════
   CHARTS — Wrappers para Chart.js
══════════════════════════════════════════════════════════════ */
const Charts = {
  _defaults() {
    return {
      color: '#9ca3af',
      borderColor: 'rgba(255,255,255,0.07)',
      font: { family: 'Inter', size: 12 },
    };
  },

  createMacroChart(canvasId, carbsG, proteinG, fatG) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    return new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Carbohidratos', 'Proteina', 'Grasa'],
        datasets: [{
          data: [carbsG || 0, proteinG || 0, fatG || 0],
          backgroundColor: ['#00D4FF', '#2ECC71', '#FFD93D'],
          borderColor: ['#00D4FF', '#2ECC71', '#FFD93D'],
          borderWidth: 1,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        cutout: '68%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 10 },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${ctx.parsed} g`,
            },
          },
        },
      },
    });
  },

  createWeightChart(canvasId, entries) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || !entries.length) return null;

    const sorted = [...entries].sort((a, b) => a.date < b.date ? -1 : 1);
    return new Chart(ctx, {
      type: 'line',
      data: {
        labels: sorted.map(e => e.date.substring(5)),
        datasets: [
          {
            label: 'Peso (kg)',
            data: sorted.map(e => e.weight),
            borderColor: '#FF6B35',
            backgroundColor: 'rgba(255,107,53,0.08)',
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: '#FF6B35',
            borderWidth: 2,
            fill: true,
          },
          ...(sorted.some(e => e.fat) ? [{
            label: '% Grasa',
            data: sorted.map(e => e.fat || null),
            borderColor: '#8B5CF6',
            backgroundColor: 'transparent',
            tension: 0.4,
            pointRadius: 3,
            pointBackgroundColor: '#8B5CF6',
            borderWidth: 1.5,
            fill: false,
            yAxisID: 'y2',
          }] : []),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#9ca3af', font: { size: 12 }, usePointStyle: true, pointStyleWidth: 10 } },
          tooltip: {
            backgroundColor: '#1a1d26',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            titleColor: '#f0f2f7',
            bodyColor: '#9ca3af',
            callbacks: {
              label: (ctx) => {
                const unit = ctx.dataset.label.includes('%') ? '%' : ' kg';
                return `${ctx.dataset.label}: ${ctx.parsed.y}${unit}`;
              }
            }
          },
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6b7280', font: { size: 11 } } },
          y: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#6b7280', font: { size: 11 }, callback: v => (+v).toFixed(1) + ' kg' },
          },
          ...(sorted.some(e => e.fat) ? {
            y2: {
              position: 'right',
              grid: { drawOnChartArea: false },
              ticks: { color: '#8B5CF6', font: { size: 11 }, callback: v => v + '%' },
            },
          } : {}),
        },
      },
    });
  },
};

/* ══════════════════════════════════════════════════════════════
   STRAVA / GARMIN SYNC (simulado — listo para backend real)
══════════════════════════════════════════════════════════════ */
const NutritionPlanner = {
  generate(athlete, activity = null) {
    const weight = Math.max(40, Number(athlete?.weight) || 70);
    const height = Math.max(140, Number(athlete?.height) || 175);
    const age = Math.max(15, Number(athlete?.age) || 30);
    const sex = String(athlete?.sex || 'M').toUpperCase();
    const goal = GoalUtils.normalize(athlete?.goal || 'resistencia');

    const tss = Number(activity?.tss) || 0;
    const durationSec = Number(activity?.duration) || 0;
    const trainingDay = !!activity && (tss > 0 || durationSec > 0);

    const bmr = sex === 'F'
      ? Math.round(10 * weight + 6.25 * height - 5 * age - 161)
      : Math.round(10 * weight + 6.25 * height - 5 * age + 5);
    const baseDaily = Math.round(bmr * 1.45);
    const workoutCals = this._estimateWorkoutCalories(activity, weight);
    
    // Ajuste por objetivo (solo se aplica si no estamos en déficit agresivo en días de carga)
    const dailyGoalAdjust = { perdida_peso: -350, resistencia: 0, ftp: 120, vo2max: 180, sprint: 120, gran_fondo: 220, carrera_corta: 200, carrera_larga: 240, ultra: 280 }[goal] || 0;
    const dailyCalories = Math.max(1500, baseDaily + workoutCals + dailyGoalAdjust);

    // ── Lógica Dinámica de Carbohidratos ──
    // Base de descanso según objetivo
    const baseCarb = { perdida_peso: 2.5, resistencia: 3.5, ftp: 4.0, vo2max: 4.0, sprint: 3.8, gran_fondo: 4.2, carrera_corta: 4.0, carrera_larga: 4.3, ultra: 4.5 }[goal] || 3.5;
    // Plus por intensidad: +1g de CH por cada 50 TSS
    const tssBonus = trainingDay ? (tss / 50) : 0;
    const carbPerKg = baseCarb + tssBonus;

    // ── Lógica Dinámica de Proteína ──
    // Más proteína en días de carga para reparación
    const baseProt = goal === 'perdida_peso' ? 2.0 : 1.6;
    const proteinPerKg = trainingDay ? baseProt + 0.3 : baseProt;

    let carbs_g = Math.round(weight * carbPerKg);
    let protein_g = Math.round(weight * proteinPerKg);
    // Cap grasa al 28% de las calorías totales (recomendación deportiva: 20-30%)
    const maxFatKcal = dailyCalories * 0.28;
    const minFatKcal = weight * 0.8 * 9; // mínimo 0.8g/kg para funciones hormonales
    const fatKcal = Math.min(maxFatKcal, Math.max(minFatKcal, dailyCalories - carbs_g * 4 - protein_g * 4));
    let fat_g = Math.round(fatKcal / 9);
    // Reasignar las kcal sobrantes del cap en carbohidratos
    const kcalUsed = carbs_g * 4 + protein_g * 4 + fat_g * 9;
    if (kcalUsed < dailyCalories - 20) {
      carbs_g = Math.round((dailyCalories - protein_g * 4 - fat_g * 9) / 4);
    }

    // ── Hidratación Dinámica ──
    // Base (30ml/kg para atletas) + 500ml por cada hora de ejercicio
    // 30ml/kg es más preciso que 35 cuando el ejercicio se suma por separado
    const durationH = durationSec / 3600;
    const hydration_ml = Math.round(weight * 30 + (durationH * 750));

    const durationMin = Math.max(0, Math.round(durationSec / 60));
    const during = durationMin >= 60 ? this._duringWorkout(durationMin) : null;
    const workoutNutrition = trainingDay ? {
      pre: {
        timing: '90-150 min antes',
        calories: Math.round(dailyCalories * 0.18),
        description: 'Comida facil de digerir con carbohidratos y poca grasa.',
        examples: ['Avena + platano', 'Tostadas con miel + yogur', 'Arroz blanco + pavo'],
      },
      during,
      post: {
        timing: '0-45 min post',
        description: 'Recuperar glucogeno y reparacion muscular.',
        protein: Math.max(20, Math.round(weight * 0.35)),
        carbs: Math.max(40, Math.round(weight * 0.8)),
        examples: ['Batido + fruta', 'Arroz + pollo', 'Sandwich de pavo + zumo'],
      },
    } : null;

    return {
      dailyCalories,
      bmr,
      workoutCals,
      carbs_g,
      protein_g,
      fat_g,
      hydration_ml,
      workoutNutrition,
      tips: this._tips(goal, trainingDay),
      supplements: this._supplements(goal, activity, trainingDay),
    };
  },

  _estimateWorkoutCalories(activity, weight) {
    if (!activity) return 0;
    const durationSec = Number(activity.duration) || 0;
    const avgPower = Number(activity.avg_power) || Number(activity.np) || 0;
    if (durationSec > 0 && avgPower > 0) return Math.round((avgPower * durationSec) / 1000);
    const tss = Number(activity.tss) || 0;
    if (tss > 0) return Math.round(tss * weight * 0.1);
    return 0;
  },

  _duringWorkout(durationMin) {
    const hours = durationMin / 60;
    const carbsPerHour = durationMin >= 180 ? 90 : durationMin >= 120 ? 75 : 60;
    return {
      carbsPerHour,
      totalCarbs: Math.round(carbsPerHour * hours),
      hydration: durationMin >= 120 ? 700 : 550,
      sodium: durationMin >= 120 ? 700 : 500,
      description: 'Fracciona cada 20 minutos para mejorar tolerancia digestiva.',
      examples: ['Gel + agua', 'Bebida isotónica', 'Barrita baja en fibra'],
    };
  },

  _tips(goal, trainingDay) {
    const base = [
      { icon: '💧', text: 'Empieza hidratado: 400-600 ml en la hora previa.' },
      { icon: '🥩', text: 'Distribuye proteina en 4-5 tomas durante el dia.' },
    ];
    const goalTip = {
      perdida_peso: { icon: '⚖️', text: 'Mantén deficit moderado, evita recortes agresivos en dias intensos.' },
      resistencia: { icon: '🚴', text: 'Prioriza volumen de carbohidratos en salidas largas.' },
      ftp: { icon: '🎯', text: 'Refuerza carbohidratos en sesiones de umbral.' },
      vo2max: { icon: '🔥', text: 'No entrenes VO2 con glucogeno bajo.' },
      sprint: { icon: '⚡', text: 'Creatina y carbohidrato pre-sesion pueden mejorar potencia pico.' },
      gran_fondo: { icon: '🧃', text: 'Practica nutricion en bici exactamente como en carrera.' },
      carrera_corta: { icon: '🏁', text: 'Alta densidad de carbohidrato pre-sesion para sostener intensidad en esfuerzos cortos.' },
      carrera_larga: { icon: '🚴', text: 'Entrena la ingesta en bici: 60-90g de CH/h en salidas de mas de 2h.' },
      ultra: { icon: '🏔️', text: 'Habituate a comer solido en bici; el estomago tambien se entrena.' },
    }[goal];
    if (goalTip) base.push(goalTip);
    if (!trainingDay) base.push({ icon: '😴', text: 'Dia suave: baja carbohidrato, no bajes proteina.' });
    return base;
  },

  _supplements(goal, activity = null, trainingDay = false) {
    const sessType = activity?.type || null;
    const durationMin = activity ? Math.round((Number(activity.duration) || 0) / 60) : 0;

    // ── Día de descanso / recuperación ──────────────────────────
    if (!trainingDay || sessType === 'recovery') {
      return [
        { name: 'Magnesio (bisglicinato)', dose: '300-400mg', timing: 'Antes de dormir', note: 'Mejora la calidad del sueño y acelera la recuperación muscular. Especialmente importante tras días de carga alta.' },
        { name: 'Proteína Caseína', dose: '25-30g', timing: 'Antes de dormir', note: 'Digestión lenta que mantiene el suministro de aminoácidos durante las 7-8h de sueño. Maximiza la síntesis proteica nocturna.' },
        { name: 'Colágeno + Vitamina C', dose: '10-15g + 50mg vit C', timing: '30min antes de movilidad', note: 'La vitamina C activa la síntesis de colágeno. Mejora la recuperación de tendones, ligamentos y cartílagos.' },
        { name: 'Omega-3 (EPA/DHA)', dose: '2-3g', timing: 'Con comida', note: 'Antiinflamatorio natural. Reduce el DOMS y mejora la sensibilidad a la insulina en los días de recuperación.' },
      ];
    }

    // ── Bloques comunes de entrenamiento ────────────────────────
    const ELECTROLITOS = { name: 'Electrolitos (Sodio + Magnesio)', dose: '500-1000mg/h', timing: 'Durante', note: 'Esencial para mantener la contracción muscular y prevenir calambres. Imprescindible si sudas mucho o hace calor.' };
    const WHEY         = { name: 'Proteína Whey Isolate', dose: '25-30g', timing: '15-30min post', note: 'Ventana anabólica: la whey isolate se absorbe en ~30min. Combina con 40-60g de carbohidratos para maximizar la recuperación.' };
    const MALTO        = { name: 'Maltodextrina + Fructosa (1:0.8)', dose: '60-90g/h', timing: 'Durante (cada 30min)', note: 'La mezcla óptima para transportar carbohidratos por dos vías distintas. Permite hasta 90g/h sin problemas gástricos.' };
    const CAFEINA      = { name: 'Cafeína', dose: '3-5mg/kg', timing: '45-60min antes', note: 'Reduce la percepción de esfuerzo y mejora la potencia pico. Evitar si hay sensibilidad o es por la tarde (afecta al sueño).' };
    const BETAALANINA  = { name: 'Beta-Alanina', dose: '3-6g/día', timing: 'Con comida (carga diaria)', note: 'Buffer del lactato. Retrasa la acidificación muscular en esfuerzos de 1-4 min. Tomar a diario; el efecto es acumulativo.' };
    const NITRATOS     = { name: 'Zumo de Remolacha (Nitratos)', dose: '400-500mg', timing: '2-3h antes', note: 'Mejora la eficiencia del oxígeno y reduce el coste energético del pedaleo. Efecto más marcado en altitud.' };
    const CREATINA     = { name: 'Creatina Monohidrato', dose: '3-5g/día', timing: 'Con comida (carga diaria)', note: 'Aumenta las reservas de fosfocreatina. Mejora la potencia máxima en esfuerzos de 5-15s y la recuperación entre series.' };
    const BCAAS        = { name: 'BCAAs / EAAs', dose: '5-10g', timing: 'Intra (desde hora 2)', note: 'Reduce la fatiga central del SNC en salidas largas y protege el músculo cuando el glucógeno baja. Útil a partir de 3-4h.' };

    // ── Lógica por tipo de sesión ────────────────────────────────
    let result = [];

    if (sessType === 'z2' || sessType === 'endurance') {
      result = durationMin >= 90
        ? [MALTO, ELECTROLITOS, WHEY]
        : [ELECTROLITOS, WHEY];
      if (durationMin >= 180) result.push(BCAAS);

    } else if (sessType === 'long') {
      result = [MALTO, ELECTROLITOS, BCAAS, WHEY];

    } else if (sessType === 'threshold' || sessType === 'tempo') {
      result = [CAFEINA, BETAALANINA, MALTO, ELECTROLITOS, WHEY];

    } else if (sessType === 'vo2max') {
      result = [NITRATOS, CAFEINA, BETAALANINA, ELECTROLITOS, WHEY];

    } else if (sessType === 'sprint' || sessType === 'strength') {
      result = [CREATINA, CAFEINA, MALTO, ELECTROLITOS, WHEY];

    } else if (sessType === 'race') {
      result = [CAFEINA, NITRATOS, MALTO, ELECTROLITOS, BCAAS, WHEY];

    } else {
      // fallback: sesión genérica
      result = [ELECTROLITOS, MALTO, WHEY];
    }

    // ── Extras por objetivo (complementan lo anterior) ──────────
    const goalExtras = {
      sprint:       [CREATINA].filter(s => !result.includes(s)),
      vo2max:       [NITRATOS, BETAALANINA].filter(s => !result.includes(s)),
      ftp:          [BETAALANINA].filter(s => !result.includes(s)),
      gran_fondo:   [BCAAS].filter(s => !result.includes(s)),
      carrera_corta:[CREATINA, CAFEINA].filter(s => !result.includes(s)),
      carrera_larga:[BCAAS, NITRATOS].filter(s => !result.includes(s)),
      ultra:        [BCAAS].filter(s => !result.includes(s)),
    }[goal] || [];

    return [...result, ...goalExtras];
  }
};

/* Exportar al ámbito global */
window.AppState       = AppState;
window.PMC            = PMC;
window.Utils          = Utils;
window.Charts         = Charts;
window.FileParser     = FileParser;
window.ZONES_COGGAN   = ZONES_COGGAN;
window.WORKOUT_TYPES  = WORKOUT_TYPES;
window.GoalUtils      = GoalUtils;
window.TrainingPlanGenerator = TrainingPlanGenerator;
window.NutritionPlanner = NutritionPlanner;

/* ══════════════════════════════════════════════════════════════
   GEO CACHE — evita pedir permiso de ubicación en cada pantalla
   Guarda coordenadas en sessionStorage hasta 15 min.
══════════════════════════════════════════════════════════════ */
window.getGeoPosition = function() {
  return new Promise((resolve, reject) => {
    try {
      const _raw = sessionStorage.getItem('_vm_geo');
      if (_raw) {
        const _c = JSON.parse(_raw);
        if (Date.now() - _c.ts < 15 * 60 * 1000) {
          resolve({ coords: { latitude: _c.lat, longitude: _c.lon, accuracy: _c.acc || 100 } });
          return;
        }
      }
    } catch (_) {}
    if (!navigator.geolocation) { reject(new Error('no-geo')); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      try {
        sessionStorage.setItem('_vm_geo', JSON.stringify({
          lat: pos.coords.latitude, lon: pos.coords.longitude,
          acc: pos.coords.accuracy, ts: Date.now()
        }));
      } catch (_) {}
      resolve(pos);
    }, reject, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });
};

/* ══════════════════════════════════════════════════════════════
   RESPONSIVE MOBILE ADAPTER (Injected Globally)
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // 1. Inyectar CSS global para móviles
  const mobileStyle = document.createElement('style');
  mobileStyle.innerHTML = `
    @media (max-width: 768px) {
      /* Prevenir desbordamiento de pantalla (scroll horizontal accidental). Evitamos 100vw que puede dar problemas. */
      html, body { overflow-x: hidden; }
      /* Usar altura de viewport estable para evitar que Safari reserve espacio para su barra de navegación */
      html { height: -webkit-fill-available; }
      body { min-height: -webkit-fill-available; }
      * { box-sizing: border-box !important; }

      /* Menú Lateral (Sidebar) Off-Canvas — estilo Garmin Connect */
      .sidebar {
        position: fixed !important;
        top: 0; left: 0; bottom: 0;
        width: 100vw !important;
        max-width: 100vw !important;
        transform: translateX(-100%) !important;
        transition: transform 0.32s cubic-bezier(0.4, 0, 0.2, 1) !important;
        z-index: 9999 !important;
        background: var(--bg-card, #0E1117) !important;
        border-right: none !important;
        box-shadow: 8px 0 40px rgba(0,0,0,0.65) !important;
        display: flex !important;
      }
      body.sidebar-open .sidebar {
        transform: translateX(0) !important;
      }

      /* Ítems de nav — full width, texto grande, flecha a la derecha */
      .sidebar .nav-item {
        display: flex !important;
        align-items: center !important;
        gap: 16px !important;
        padding: 18px 22px !important;
        font-size: 18px !important;
        font-weight: 600 !important;
        border-radius: 0 !important;
        width: 100% !important;
        border-bottom: 1px solid rgba(255,255,255,0.05) !important;
        position: relative !important;
        color: var(--text-primary, #EEF2FF) !important;
      }
      .sidebar .nav-item::after {
        content: '›';
        position: absolute;
        right: 20px;
        font-size: 22px;
        line-height: 1;
        color: rgba(255,255,255,0.25);
        font-weight: 300;
      }
      .sidebar .nav-item.active {
        background: rgba(158,214,43,0.10) !important;
        color: var(--primary-light, #C4EF44) !important;
        border-left: 3px solid var(--primary, #9ED62B) !important;
      }
      .sidebar .nav-item.active::after { color: var(--primary, #9ED62B); }
      .sidebar .nav-item i {
        font-size: 18px !important;
        width: 22px !important;
        text-align: center !important;
        color: rgba(255,255,255,0.5) !important;
      }
      .sidebar .nav-item.active i { color: var(--primary, #9ED62B) !important; }
      .sidebar .nav-section-title {
        font-size: 11px !important;
        padding: 20px 22px 6px !important;
        letter-spacing: 1.2px !important;
      }
      /* Logo section más compacta */
      .sidebar .sidebar-logo {
        padding: 22px 22px 18px !important;
      }
      /* Footer — Tarjeta de perfil ciclista */
      .sidebar .sidebar-footer {
        padding: 12px 16px !important;
      }
      .sidebar .athlete-card {
        flex-direction: column !important;
        align-items: center !important;
        text-align: center !important;
        gap: 10px !important;
        background: rgba(158,214,43,0.07) !important;
        border: 1px solid rgba(158,214,43,0.18) !important;
        border-radius: 14px !important;
        padding: 16px 12px !important;
      }
      .sidebar .athlete-avatar {
        width: 64px !important;
        height: 64px !important;
        font-size: 24px !important;
        box-shadow: 0 0 22px rgba(158,214,43,0.42) !important;
      }
      .sidebar .athlete-info { text-align: center !important; }
      .sidebar .athlete-info .name { font-size: 15px !important; font-weight: 700 !important; }
      .sidebar .athlete-info .ftp  { font-size: 12px !important; }
      /* Light theme */
      html.light-theme .sidebar .nav-item { color: #1a2e18 !important; border-bottom-color: rgba(0,0,0,0.06) !important; }
      html.light-theme .sidebar .nav-item::after { color: rgba(0,0,0,0.25); }
      html.light-theme .sidebar .nav-item i { color: #2D5016 !important; }
      html.light-theme .sidebar .nav-item.active i { color: #4d7a00 !important; }
      
      /* Overlay (Fondo oscuro al abrir el menú) */
      .sidebar-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.7);
        backdrop-filter: blur(2px); z-index: 9998;
        opacity: 0; pointer-events: none; transition: opacity 0.3s ease;
      }
      body.sidebar-open .sidebar-overlay { 
        opacity: 1; pointer-events: auto; 
      }
      
      /* Contenido principal */
      .main-content {
        margin-left: 0 !important;
        width: 100% !important;
        max-width: 100vw !important;
        padding: 14px 12px !important;
        overflow-x: hidden !important;
        padding-bottom: 100px !important; /* Espacio extra para que la Bottom Bar no tape contenido */
      }
      .page-header { flex-direction: column; align-items: flex-start !important; gap: 12px; margin-bottom: 20px; width: 100%; }
      
      /* Arreglo de Botones en Cabecera (Para que no se salgan de la pantalla) */
      .header-actions { 
        width: 100% !important; 
        display: flex !important; 
        flex-wrap: nowrap !important;
        overflow-x: auto !important;
        padding-bottom: 4px;
        gap: 8px !important; 
      }
      .header-actions .btn, .header-actions button, .header-actions select { 
        flex: 0 0 auto !important;
        width: auto !important;
        margin: 0 !important;
        padding: 10px 8px !important; 
        font-size: 11px !important; 
        white-space: normal !important; 
        height: auto !important;
        text-align: center;
        justify-content: center;
      }

      /* Asegurar que las Tarjetas no rompan la pantalla */
      .card, .mb-6 {
        width: 100% !important;
        max-width: 100% !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
      }
      .card-header, .card-body { padding: 12px !important; }

      /* ── ARREGLO PARA INTEGRACIONES Y PANELES FLEXIBLES ── */
      .integration-card {
        flex-direction: column !important;
        align-items: stretch !important;
        gap: 18px !important;
        padding: 50px 24px !important;
        min-height: 220px !important;
        text-align: center !important;
        height: auto !important;
      }
      /* Forzar que todos los botones en las tarjetas móviles ocupen el 100% */
      .card .btn, .card button, .card a.btn, .integration-card .btn, .modal-body .btn {
        width: 100% !important;
        justify-content: center !important;
        margin: 0 0 8px 0 !important;
        white-space: normal !important;
        height: auto !important;
      }
      .card .btn:last-child { margin-bottom: 0 !important; }
      .card-body svg, .card-body img { margin: 0 auto; max-width: 100%; }

      /* Arreglo de Tablas para que hagan scroll interno y no rompan la app */
      table, .data-table, div[style*="overflow-x:auto"], div[style*="overflow-x: auto"] {
        display: block !important;
        width: 100% !important;
        max-width: 100vw !important;
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch;
      }
      .data-table td { white-space: nowrap !important; }
      
      /* Desenrollar Grids rígidos de PC a 1 columna (Móvil) */
      div[style*="grid-template-columns: 1fr 1fr"],
      div[style*="grid-template-columns: 2fr 1fr"],
      div[style*="grid-template-columns: 1fr 1fr 1fr"],
      div[style*="grid-template-columns:repeat(4,1fr)"],
      div[style*="grid-template-columns:repeat(5,1fr)"],
      div[style*="grid-template-columns: repeat(7"],
      div[style*="grid-template-columns:repeat(7"] {
        display: flex !important; 
        flex-direction: column !important; 
        gap: 12px !important;
        width: 100% !important; 
        max-width: 100% !important;
      }
      
      /* Excepción: Contenedores con scroll horizontal explícito */
      .scroll-x-mobile {
        display: flex !important; flex-direction: row !important; overflow-x: auto !important;
        flex-wrap: nowrap !important; -webkit-overflow-scrolling: touch;
      }
      
      /* Clases comunes de layout en la app */
      .metrics-grid, .grid-2, #stats-row, .summary-grid, .color-grid, .mod-grid, .calc-row, .wc-grid, .plan-grid, .plan-sessions { 
        display: flex !important; flex-direction: column !important; gap: 12px !important;
        width: 100% !important; max-width: 100% !important;
      }
      .mod-card { grid-column: span 1 !important; }
      
      /* Tipografía y ajustes de componentes */
      .page-title h1 { font-size: 20px !important; line-height: 1.2; }
      .page-title p { font-size: 12px !important; }
      .wc-val { font-size: 22px !important; }
      .fs-pmc-grid { display: flex !important; flex-direction: column !important; gap: 12px; }
      .fs-vdiv { height: 1px; width: 100%; background: var(--border); }
      .adapt-input-row { flex-direction: column; align-items: stretch; gap: 8px; }
      .adapt-submit, .btn-full { width: 100%; justify-content: center; white-space: normal !important; height: auto !important; }

      /* Arreglo de Gráficos (Chart.js) */
      .chart-wrap-md, .chart-wrap-lg, .chart-container, canvas {
        width: 100% !important;
        max-width: 100% !important;
      }

      /* --- Manejo de Modales (Ventanas emergentes como la de datos de actividad) --- */
      /* Clase que se añade al <body> con JS al abrir un modal */
      body.modal-open {
        overflow: hidden;
        /* En iOS, a veces se necesita position:fixed para bloquear el scroll del fondo.
           Descomentar si 'overflow:hidden' no es suficiente. */
        /* position: fixed; */
        /* width: 100%; */
      }

      /* Contenedor del modal que permite scroll interno */
      .modal-scroll-content {
        overflow-y: auto;
        -webkit-overflow-scrolling: touch; /* Scroll suave en iOS */
        max-height: 85vh; /* Altura máxima antes de que aparezca el scroll */
        padding: 1px; /* Evita colapso de márgenes */
      }
      /* --- Fin de manejo de Modales --- */
      
      /* Ajustar notificaciones flotantes (Toasts) para no chocar con el menú */
      .toast-wrap { bottom: 90px !important; right: 16px !important; }

      /* Ocultar botón hamburguesa superior, ahora usamos la barra inferior */
      .mobile-menu-btn { display: none !important; }

      /* ── Barra de Navegación Inferior — Glass Morphism Flotante ── */
      .bottom-nav {
        position: fixed !important;
        bottom: calc(2px + env(safe-area-inset-bottom, 0px));
        left: 8px; right: 8px;
        height: 60px;
        background: rgba(10, 12, 18, 0.90) !important;
        backdrop-filter: blur(28px) saturate(180%) !important;
        -webkit-backdrop-filter: blur(28px) saturate(180%) !important;
        border: 1px solid rgba(255,255,255,0.10);
        border-radius: 22px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.60), inset 0 0 0 0.5px rgba(255,255,255,0.05);
        display: flex !important;
        justify-content: space-around;
        align-items: center;
        z-index: 9997;
        padding: 0 4px;
        transition: transform 0.38s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease;
      }
      .bottom-nav.mob-hidden {
        transform: translateY(calc(100% + 20px));
        opacity: 0;
        pointer-events: none;
      }
      html.light-theme .bottom-nav {
        background: rgba(255,255,255,0.88) !important;
        border-color: rgba(0,0,0,0.08);
        box-shadow: 0 8px 32px rgba(0,0,0,0.15), inset 0 0 0 0.5px rgba(0,0,0,0.04);
      }
      .bottom-nav-item {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        color: rgba(255,255,255,0.38); text-decoration: none;
        font-size: 9.5px; font-weight: 600; letter-spacing: 0.02em;
        gap: 3px; flex: 1; height: 100%;
        transition: color 0.2s ease, transform 0.15s cubic-bezier(0.34,1.56,0.64,1);
        -webkit-tap-highlight-color: transparent;
        user-select: none; -webkit-user-select: none;
      }
      .bottom-nav-item:active { transform: scale(0.85); }
      .bottom-nav-item.active { color: var(--primary, #9ED62B); }
      .bottom-nav-item.active i { filter: drop-shadow(0 0 6px rgba(158,214,43,0.55)); }
      .bottom-nav-item i { font-size: 19px; }
      html.light-theme .bottom-nav-item { color: rgba(0,0,0,0.62); }
      html.light-theme .bottom-nav-item.active { color: #4d7a00; }
    }
    
    /* Diseño del Botón Hamburguesa */
    .mobile-menu-btn {
      display: none; background: rgba(255,255,255,0.05); border: 1px solid var(--border);
      color: var(--text, #fff); border-radius: 8px; cursor: pointer; margin-right: 12px;
      font-size: 18px; width: 40px; height: 40px; align-items: center; justify-content: center;
      transition: background 0.2s; flex-shrink: 0;
    }
    .mobile-menu-btn:hover { background: rgba(255,255,255,0.1); }
  `;
  document.head.appendChild(mobileStyle);

  // 2. Overlay + Bottom Nav — se inyectan en CUALQUIER página que tenga sidebar
  if (document.querySelector('.sidebar')) {
    // Swipe para abrir/cerrar el sidebar
    let _swipeStartX = null;
    let _swipeStartY = null;
    document.addEventListener('touchstart', e => {
      _swipeStartX = e.touches[0].clientX;
      _swipeStartY = e.touches[0].clientY;
    }, { passive: true });

    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);

    // Bottom Navigation Bar
    const bottomNav = document.createElement('nav');
    bottomNav.className = 'bottom-nav';
    bottomNav.style.display = 'none'; // Oculto en PC, visible solo por CSS en móvil

    const currentPath = window.location.pathname;
    const navItems = [
      { name: 'Inicio',    icon: 'fa-home',           href: 'dashboard.html' },
      { name: 'Plan',      icon: 'fa-calendar-check', href: 'training-plan.html' },
      { name: 'Nutrición', icon: 'fa-apple-alt',      href: 'nutrition.html' },
      { name: 'Métricas',  icon: 'fa-chart-bar',      href: 'analytics.html' },
      { name: 'Menú',      icon: 'fa-bars',           href: '#', isMenu: true }
    ];

    navItems.splice(
      2,
      2,
      { name: 'Rutas',       icon: 'fa-route',         href: 'rutas.html' },
      { name: 'Actividades', icon: 'fa-biking', href: 'activities.html' }
    );

    bottomNav.innerHTML = navItems.map(item => {
      const isActive = currentPath.includes(item.href) && !item.isMenu ? 'active' : '';
      return `
        <a href="${item.href}" class="bottom-nav-item ${isActive}" ${item.isMenu ? 'id="bottom-nav-menu-btn"' : ''}>
          <i class="fas ${item.icon}"></i>
          <span>${item.name}</span>
        </a>
      `;
    }).join('');

    document.body.appendChild(bottomNav);

    document.getElementById('bottom-nav-menu-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.body.classList.add('sidebar-open');
    });

    // Auto-ocultar menú inferior tras 4s, mostrar al tocar pantalla
    let _bnTimer;
    const _hideBN = () => {
      clearTimeout(_bnTimer);
      bottomNav.classList.add('mob-hidden');
    };
    window._showBottomNav = () => {
      if (document.getElementById('garmin-overlay')?.classList.contains('visible')) return;
      bottomNav.classList.remove('mob-hidden');
      clearTimeout(_bnTimer);
      _bnTimer = setTimeout(_hideBN, 3000);
    };
    document.addEventListener('touchstart', window._showBottomNav, { passive: true });

    // Cerrar sidebar + ocultar nav al instante: enlaces del sidebar, overlay y swipe izquierda
    const _closeSidebar = () => {
      document.body.classList.remove('sidebar-open');
      _hideBN();
    };
    document.querySelectorAll('.sidebar a').forEach(link => {
      link.addEventListener('click', _closeSidebar);
    });
    overlay.onclick = _closeSidebar;
    document.addEventListener('touchend', e => {
      if (_swipeStartX === null) return;
      const dx = e.changedTouches[0].clientX - _swipeStartX;
      const dy = e.changedTouches[0].clientY - _swipeStartY;
      if (Math.abs(dx) < Math.abs(dy) * 1.2 || Math.abs(dx) < 40) return;
      const sidebarOpen = document.body.classList.contains('sidebar-open');
      if (dx > 0 && !sidebarOpen && _swipeStartX < 40) {
        document.body.classList.add('sidebar-open');
      } else if (dx < 0 && sidebarOpen) {
        _closeSidebar();
      }
      _swipeStartX = null;
      _swipeStartY = null;
    }, { passive: true });

    // Ocultar al instante cuando el usuario pulsa un ítem de navegación directo
    bottomNav.querySelectorAll('.bottom-nav-item:not(#bottom-nav-menu-btn)').forEach(item => {
      item.addEventListener('click', _hideBN);
    });

    // Mostrar al inicio y luego ocultar
    setTimeout(_hideBN, 3000);
  }

  // 3. Botón hamburguesa en el page-header — solo si existe el header
  const headerTitle = document.querySelector('.page-header .page-title');
  if (headerTitle && document.querySelector('.sidebar')) {
    const h1 = headerTitle.querySelector('h1');
    const p  = headerTitle.querySelector('p');

    const btn = document.createElement('button');
    btn.className = 'mobile-menu-btn';
    btn.innerHTML = '<i class="fas fa-bars"></i>';
    btn.onclick = () => document.body.classList.toggle('sidebar-open');

    const textWrapper = document.createElement('div');
    if (h1) textWrapper.appendChild(h1);
    if (p)  textWrapper.appendChild(p);

    headerTitle.innerHTML = '';
    headerTitle.style.display = 'flex';
    headerTitle.style.alignItems = 'center';
    headerTitle.appendChild(btn);
    headerTitle.appendChild(textWrapper);
  }

  // PWA Installation Prompt for Mobile
  if (window.matchMedia('(display-mode: browser)').matches && (navigator.userAgent.includes("iPhone") || navigator.userAgent.includes("Android"))) {
    const installPromptId = 'pwa-install-prompt';
    // Only show once per session
    if (!sessionStorage.getItem(installPromptId)) {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

        const banner = document.createElement('div');
        banner.id = installPromptId;
        banner.style.cssText = `
            position: fixed;
            bottom: calc(75px + env(safe-area-inset-bottom, 0px));
            left: 12px; right: 12px;
            background: var(--bg-card, #0E1117);
            color: var(--text-primary, #EEF2FF);
            padding: 16px;
            border-radius: 14px;
            border: 1px solid var(--border-light);
            box-shadow: 0 8px 25px rgba(0,0,0,0.5);
            z-index: 10000;
            display: flex;
            align-items: center;
            gap: 16px;
            transform: translateY(200%);
            transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        `;
        
        const instructions = isIOS
            ? `Pulsa el botón de <strong>Compartir</strong> <i class="fas fa-share-square"></i> y luego <strong>"Añadir a pantalla de inicio"</strong>.`
            : `Pulsa el botón de <strong>menú (⋮)</strong> y luego <strong>"Instalar aplicación"</strong>.`;

        banner.innerHTML = `
            <img src="icon-192.png" alt="VeloMind Logo" style="width: 48px; height: 48px; border-radius: 10px;">
            <div style="flex: 1;">
                <h4 style="margin: 0 0 4px 0; font-size: 15px; font-family: 'Plus Jakarta Sans', sans-serif;">Instala VeloMind en tu móvil</h4>
                <p style="margin: 0; font-size: 12px; color: var(--text-secondary, #CBD5E1); line-height: 1.5;">
                    Para una experiencia sin distracciones y a pantalla completa. ${instructions}
                </p>
            </div>
            <button id="close-install-prompt" style="background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer; align-self: flex-start;">&times;</button>
        `;

        document.body.appendChild(banner);
        setTimeout(() => { banner.style.transform = 'translateY(0)'; }, 500);
        banner.querySelector('#close-install-prompt').addEventListener('click', () => { banner.style.transform = 'translateY(200%)'; sessionStorage.setItem(installPromptId, 'dismissed'); setTimeout(() => banner.remove(), 500); });
    }
  }
});

/* ══════════════════════════════════════════════════════════════
   THEME ADAPTER (Light / Dark Mode) — botón flotante global
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Función compartida de cambio de tema
  const _applyTheme = (newTheme) => {
    document.documentElement.setAttribute('data-theme', newTheme);
    if (newTheme === 'light') document.documentElement.classList.add('light-theme');
    else document.documentElement.classList.remove('light-theme');
    localStorage.setItem('velomind_theme', newTheme);
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) themeColorMeta.content = newTheme === 'light' ? '#ffffff' : '#0a0b0f';
  };

  // Botón flotante de tema — visible en cualquier pantalla, arrastrable
  const _themeBtn = document.createElement('button');
  _themeBtn.id = 'global-theme-fab';
  _themeBtn.title = 'Cambiar tema (arrastra para mover)';
  _themeBtn.setAttribute('aria-label', 'Alternar modo claro/oscuro');

  const _updateThemeFab = () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    _themeBtn.innerHTML = isLight
      ? '<i class="fas fa-moon"></i>'
      : '<i class="fas fa-sun"></i>';
    _themeBtn.style.background = isLight
      ? 'rgba(0,0,0,0.08)'
      : 'rgba(255,255,255,0.08)';
    _themeBtn.style.color = isLight ? '#374151' : '#cbd5e1';
    _themeBtn.style.borderColor = isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.12)';
  };

  const _FAB_SIZE = 38, _FAB_MARGIN = 10;
  _themeBtn.style.cssText = `
    position: fixed; z-index: 9998;
    width: ${_FAB_SIZE}px; height: ${_FAB_SIZE}px;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.12);
    cursor: grab;
    display: flex; align-items: center; justify-content: center;
    font-size: 15px;
    transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 2px 8px rgba(0,0,0,0.22);
    -webkit-tap-highlight-color: transparent;
    touch-action: none;
    user-select: none; -webkit-user-select: none;
  `;
  _updateThemeFab();

  // Posición inicial (esquina superior derecha) o la última guardada
  const _fabClamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const _fabApplyPos = (left, top) => {
    const l = _fabClamp(left, _FAB_MARGIN, window.innerWidth  - _FAB_SIZE - _FAB_MARGIN);
    const t = _fabClamp(top,  _FAB_MARGIN, window.innerHeight - _FAB_SIZE - _FAB_MARGIN);
    _themeBtn.style.left = l + 'px';
    _themeBtn.style.top  = t + 'px';
    _themeBtn.style.right = 'auto';
  };
  (() => {
    try {
      const s = localStorage.getItem('_vm_fab_pos');
      if (s) { const p = JSON.parse(s); _fabApplyPos(p.l, p.t); return; }
    } catch (_) {}
    _fabApplyPos(window.innerWidth - _FAB_SIZE - 14, 14);
  })();

  // Lógica de arrastre
  let _fabDrag = false, _fabMoved = false;
  let _fabSX, _fabSY, _fabBL, _fabBT;

  const _fabMove = (e) => {
    const p = e.touches ? e.touches[0] : e;
    const dx = p.clientX - _fabSX, dy = p.clientY - _fabSY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) _fabMoved = true;
    _fabApplyPos(_fabBL + dx, _fabBT + dy);
    e.preventDefault();
  };
  const _fabUp = () => {
    if (!_fabDrag) return;
    _fabDrag = false;
    document.removeEventListener('mousemove', _fabMove);
    document.removeEventListener('touchmove', _fabMove);
    document.removeEventListener('mouseup',   _fabUp);
    document.removeEventListener('touchend',  _fabUp);
    _themeBtn.style.transition = '';
    _themeBtn.style.cursor = 'grab';
    if (_fabMoved) {
      const r = _themeBtn.getBoundingClientRect();
      try { localStorage.setItem('_vm_fab_pos', JSON.stringify({ l: r.left, t: r.top })); } catch (_) {}
    }
  };
  const _fabDown = (e) => {
    _fabDrag = true; _fabMoved = false;
    const p = e.touches ? e.touches[0] : e;
    _fabSX = p.clientX; _fabSY = p.clientY;
    const r = _themeBtn.getBoundingClientRect();
    _fabBL = r.left; _fabBT = r.top;
    _themeBtn.style.transition = 'none';
    _themeBtn.style.cursor = 'grabbing';
    document.addEventListener('mousemove', _fabMove, { passive: false });
    document.addEventListener('touchmove', _fabMove, { passive: false });
    document.addEventListener('mouseup',   _fabUp);
    document.addEventListener('touchend',  _fabUp);
    if (!e.touches) e.preventDefault();
  };

  _themeBtn.addEventListener('mousedown',  _fabDown, { passive: false });
  _themeBtn.addEventListener('touchstart', _fabDown, { passive: true });

  // Click solo si no hubo arrastre
  _themeBtn.addEventListener('click', () => {
    if (_fabMoved) { _fabMoved = false; return; }
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    _applyTheme(isLight ? 'dark' : 'light');
    _updateThemeFab();
    _themeBtn.style.transform = 'scale(0.85)';
    setTimeout(() => { _themeBtn.style.transform = 'scale(1)'; }, 160);
  });

  document.body.appendChild(_themeBtn);

  /* ══════════════════════════════════════════════════════════════
     PWA (Progressive Web App) - Instalación y Service Worker
  ══════════════════════════════════════════════════════════════ */
  
  // 1. Inyectar el manifest.json dinámicamente
  if (!document.querySelector('link[rel="manifest"]')) {
    const manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = 'manifest.json';
    document.head.appendChild(manifest);
  }

  // 2. Viewport con safe-area (notch / Dynamic Island) y sin zoom
  const vpMeta = document.querySelector('meta[name="viewport"]');
  const vpContent = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  if (vpMeta) { vpMeta.content = vpContent; }
  else {
    const vp = document.createElement('meta');
    vp.name = 'viewport';
    vp.content = vpContent;
    document.head.appendChild(vp);
  }

  // 3. Theme-color para la barra de estado del móvil
  if (!document.querySelector('meta[name="theme-color"]')) {
    const themeColor = document.createElement('meta');
    themeColor.name = 'theme-color';
    themeColor.content = document.documentElement.getAttribute('data-theme') === 'light' ? '#ffffff' : '#05070a';
    document.head.appendChild(themeColor);
  }

  // 4. Apple PWA meta tags (para iOS — "Añadir a pantalla de inicio")
  const appleMetas = [
    { name: 'apple-mobile-web-app-capable',           content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style',  content: 'black-translucent' },
    { name: 'apple-mobile-web-app-title',             content: 'VeloMind' },
    { name: 'mobile-web-app-capable',                 content: 'yes' },
    { name: 'application-name',                       content: 'VeloMind' },
  ];
  appleMetas.forEach(({ name, content }) => {
    if (!document.querySelector(`meta[name="${name}"]`)) {
      const m = document.createElement('meta');
      m.name = name; m.content = content;
      document.head.appendChild(m);
    }
  });

  // 5. Apple touch icon
  if (!document.querySelector('link[rel="apple-touch-icon"]')) {
    const ati = document.createElement('link');
    ati.rel  = 'apple-touch-icon';
    ati.href = 'apple-touch-icon.png';
    document.head.appendChild(ati);
  }

  // 6. Registrar Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('[PWA] Service Worker registrado', reg.scope))
        .catch(err => console.warn('[PWA] Fallo en Service Worker:', err));
    });
  }
});

/* ══════════════════════════════════════════════════════════════
   TOAST GLOBAL (fallback — las páginas pueden definir el suyo)
══════════════════════════════════════════════════════════════ */
if (!window.showToast) {
  window.showToast = function showToast(msg, type = 'info') {
    const colors = {
      success: 'var(--accent-green,#10B981)',
      warning: 'var(--accent-yellow,#F59E0B)',
      error:   'var(--accent-red,#EF4444)',
      info:    'var(--accent,#9ED62B)',
    };
    const color = colors[type] || colors.info;
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed;bottom:24px;right:24px;background:var(--bg-card,#1a1d26);`
      + `border:1px solid ${color};color:${color};padding:12px 20px;border-radius:10px;`
      + `font-size:14px;font-weight:600;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);`
      + `max-width:400px;opacity:0;transition:opacity 0.25s;`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  };
}

// ── Ampliar Logo (Efecto Lightbox) en todas las pantallas ───────────────────
(function setupLogoZoom() {
  const initZoom = () => {
    const logo = document.querySelector('.sidebar-logo img');
    if (!logo) return;
    
    logo.style.cursor = 'zoom-in';
    logo.title = 'Ampliar logo';
    
    logo.addEventListener('click', () => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(5px);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;opacity:0;transition:opacity 0.3s;';
      
      const img = document.createElement('img');
      img.src = logo.src;
      const isLight = document.documentElement.classList.contains('light-theme') || document.documentElement.getAttribute('data-theme') === 'light';
      const themeFilter = isLight ? 'invert(1) hue-rotate(180deg) contrast(1.2)' : '';
      img.style.cssText = `max-width:85vw;max-height:85vh;object-fit:contain;border-radius:16px;filter:drop-shadow(0 10px 40px rgba(158,214,43,0.15)) ${themeFilter};transform:scale(0.9);transition:transform 0.3s cubic-bezier(0.34,1.56,0.64,1);`;
      
      overlay.appendChild(img);
      document.body.appendChild(overlay);
      
      requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        img.style.transform = 'scale(1)';
      });
      
      const closeLightbox = () => {
        overlay.style.opacity = '0';
        img.style.transform = 'scale(0.9)';
        setTimeout(() => overlay.remove(), 300);
      };
      
      overlay.addEventListener('click', closeLightbox);
      
      document.addEventListener('keydown', function escListener(e) {
        if (e.key === 'Escape' || e.key === 'Esc') {
          closeLightbox();
          document.removeEventListener('keydown', escListener);
        }
      });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initZoom);
  else initZoom();
})();

/* ══════════════════════════════════════════════════════════════
   PULL TO REFRESH GLOBAL (PWA / Mobile)
══════════════════════════════════════════════════════════════ */
(function initPullToRefresh() {
  if (window.matchMedia('(display-mode: standalone)').matches || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
    let startY = 0;
    let currentY = 0;
    let isPulling = false;
    let ptrEl = null;
    let ptrIcon = null;
    let ptrText = null;
    const threshold = 110;

    // Detectar si el usuario está scrolleando dentro de un contenedor interno
    function getScrollTop(el) {
      let current = el;
      while (current && current !== document.body && current !== document.documentElement) {
        if (current.scrollHeight > current.clientHeight && current.scrollTop > 0) {
          return current.scrollTop;
        }
        current = current.parentElement;
      }
      return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }

    document.addEventListener('touchstart', (e) => {
      // Ignorar en el mapa de Leaflet, modales o lienzos de dibujo
      if (e.target.closest('.leaflet-container') || e.target.closest('.modal-scroll-content') || e.target.closest('canvas')) {
        return;
      }
      if (getScrollTop(e.target) <= 0 && e.touches.length === 1) {
        startY = e.touches[0].clientY;
        isPulling = true;
      }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!isPulling) return;
      
      if (getScrollTop(e.target) > 0) {
        isPulling = false;
        if (ptrEl) ptrEl.style.transform = 'translateY(-100%)';
        return;
      }

      currentY = e.touches[0].clientY;
      const dist = currentY - startY;

      // Detectar drag hacia abajo en el top
      if (dist > 15) {
        document.body.style.overscrollBehaviorY = 'none'; // Prevenir PTR nativo en Chrome/Safari

        if (!ptrEl) {
          ptrEl = document.createElement('div');
          ptrEl.style.cssText = 'position:fixed;top:0;left:0;right:0;height:65px;display:flex;align-items:center;justify-content:center;z-index:99999;pointer-events:none;transform:translateY(-100%);transition:transform 0s;';
          const pill = document.createElement('div');
          pill.style.cssText = 'background:var(--bg-card,#1a1d26);border:1px solid var(--border,rgba(255,255,255,0.1));border-radius:20px;padding:8px 18px;box-shadow:0 4px 16px rgba(0,0,0,0.4);display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;color:var(--text-secondary,#cbd5e1);font-family:"Plus Jakarta Sans",sans-serif;';
          
          ptrIcon = document.createElement('i');
          ptrIcon.className = 'fas fa-arrow-down';
          ptrIcon.style.transition = 'transform 0.3s ease, color 0.3s ease';
          
          ptrText = document.createElement('span');
          ptrText.textContent = 'Desliza para actualizar';
          
          pill.appendChild(ptrIcon);
          pill.appendChild(ptrText);
          ptrEl.appendChild(pill);
          document.body.appendChild(ptrEl);
        }

        const pullDist = Math.min(dist * 0.45, threshold + 30);
        ptrEl.style.transition = 'none';
        ptrEl.style.transform = `translateY(${Math.max(-65, pullDist - 65)}px)`;

        if (dist > threshold) {
          ptrIcon.style.transform = 'rotate(180deg)';
          ptrIcon.style.color = 'var(--primary,#9ED62B)';
          ptrText.textContent = 'Suelta para actualizar';
        } else {
          ptrIcon.style.transform = 'rotate(0deg)';
          ptrIcon.style.color = '';
          ptrText.textContent = 'Desliza para actualizar';
        }
      }
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (!isPulling) return;
      isPulling = false;
      document.body.style.overscrollBehaviorY = '';

      if (ptrEl) {
        const dist = currentY - startY;
        ptrEl.style.transition = 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)';
        
        if (dist > threshold) {
          ptrEl.style.transform = 'translateY(15px)';
          ptrIcon.className = 'fas fa-circle-notch fa-spin';
          ptrIcon.style.transform = 'none';
          ptrText.textContent = 'Actualizando...';
          setTimeout(() => window.location.reload(), 400);
        } else {
          ptrEl.style.transform = 'translateY(-100%)';
          setTimeout(() => { if(ptrEl) { ptrEl.remove(); ptrEl = null; } }, 300);
        }
      }
      startY = 0;
      currentY = 0;
    });
  }
})();
