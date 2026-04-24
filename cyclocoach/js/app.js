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
  endurance: { label: 'Resistencia Z2',      color: '#3B82F6', emoji: '🔵' },
  tempo:     { label: 'Tempo Z3',            color: '#10B981', emoji: '🟢' },
  threshold: { label: 'Umbral (FTP)',         color: '#F59E0B', emoji: '🟡' },
  vo2max:    { label: 'VO₂ Max',             color: '#EF4444', emoji: '🔴' },
  sprint:    { label: 'Sprints / Poten.',    color: '#8B5CF6', emoji: '🟣' },
  long:      { label: 'Fondón Z1-Z2',        color: '#00D4FF', emoji: '🩵' },
  race:      { label: 'Activación Carrera',  color: '#EC4899', emoji: '🏁' },
  strength:  { label: 'Fuerza (Baja cadencia)',color:'#A855F7',emoji: '💪' },
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
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  },
  daysAgo(dateStr) {
    return Math.floor((Date.now() - new Date(dateStr + 'T00:00:00')) / 86400000);
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
    if (tsb > -20) return { label: 'Cansado',         color: '#FFC800', icon: '⚖️' };
    if (tsb > -30) return { label: 'Fatigado',        color: '#FF9632', icon: '🔥' };
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
  }
};

/* ══════════════════════════════════════════════════════════════
   PMC: Performance Management Chart (CTL/ATL/TSB)
══════════════════════════════════════════════════════════════ */
const PMC = {
  /**
   * Genera array de {date, ctl, atl, tsb}.
   * Siempre arranca desde la primera actividad para que CTL/ATL
   * estén bien calentados. El parámetro `days` filtra solo la ventana
   * de salida (cuántos días devuelve), no el arranque del cálculo.
   */
  compute(activities, days = 120) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result = [];
    let ctl = 0, atl = 0;

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
    this.pmcData    = PMC.compute(this.activities, 120);
  },

  _loadAthlete() {
    try { return JSON.parse(localStorage.getItem('velomind_athlete')) || null; } catch { return null; }
  },
  _loadActivities() {
    try { return JSON.parse(localStorage.getItem('velomind_activities')) || []; } catch { return []; }
  },
  _loadWeightLog() {
    try { return JSON.parse(localStorage.getItem('velomind_weight_log')) || []; } catch { return []; }
  },

  saveAthlete(data) {
    this.athlete = { ...this.athlete, ...data };
    localStorage.setItem('velomind_athlete', JSON.stringify(this.athlete));
  },

  saveActivity(activity) {
    if (!this.activities.find(a => a.id === activity.id)) {
      this.activities.push(activity);
      this.activities.sort((a, b) => a.date < b.date ? -1 : 1);
      localStorage.setItem('velomind_activities', JSON.stringify(this.activities));
      this.pmcData = PMC.compute(this.activities, 120);
    }
  },

  removeActivity(id) {
    this.activities = this.activities.filter(a => a.id !== id);
    localStorage.setItem('velomind_activities', JSON.stringify(this.activities));
    this.pmcData = PMC.compute(this.activities, 120);
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
  /**
   * Genera plan semanal basado en:
   * - athlete.ftp, athlete.weight, athlete.weekly_hours, athlete.goal
   * - athlete.event_date (fecha objetivo)
   * - athlete.experience: 'principiante' | 'intermedio' | 'avanzado'
   * - pmcData para TSB/CTL actuales
   */
  generate(athlete, activities) {
    const ftp    = athlete.ftp    || 200;
    const weight = athlete.weight || 75;
    const hours  = Math.max(4, Math.min(20, athlete.weekly_hours || 8));
    const goal   = GoalUtils.normalize(athlete.goal || 'resistencia');
    const trainingGoal = GoalUtils.toTrainingGoal(goal);
    const exp    = athlete.experience || 'intermedio';

    // Determinar fase (si hay fecha objetivo)
    const phase = this._detectPhase(athlete.event_date);

    // TSB/CTL actuales
    const pmcArr = PMC.compute(activities, 120);
    const current = pmcArr.length ? pmcArr[pmcArr.length - 1] : { ctl: 30, atl: 30, tsb: 0 };
    const { ctl, atl, tsb } = current;

    // TSS objetivo semanal según horas y experiencia
    const baseIF = { principiante: 0.60, intermedio: 0.68, avanzado: 0.74 }[exp] || 0.68;
    let targetTSS = Math.round(hours * 3600 * Math.pow(baseIF, 2) / 36);
    if (goal === 'perdida_peso') targetTSS = Math.round(targetTSS * 0.9);

    // Consejo según TSB
    const advice = this._getAdvice(tsb, ctl, phase);

    // Sesiones según goal y phase
    const sessions = this._buildSessions(trainingGoal, phase, ftp, weight, hours, exp, tsb, targetTSS, activities);

    return { phase, targetTSS, advice, sessions, ctl: Math.round(ctl), tsb: Math.round(tsb) };
  },

  _detectPhase(eventDate) {
    if (!eventDate) return 'base';
    const daysUntil = Math.floor((new Date(eventDate) - new Date()) / 86400000);
    if (daysUntil < 0)   return 'recovery';
    if (daysUntil < 7)   return 'race';
    if (daysUntil < 21)  return 'peak';
    if (daysUntil < 70)  return 'build';
    return 'base';
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

  _buildSessions(goal, phase, ftp, weight, hours, exp, tsb, targetTSS, activities) {
    // ── Selección de plantilla según goal y phase ──
    const templates = this._getTemplate(goal, phase, exp, tsb);

    // Calcular duración de cada sesión en minutos a partir de la distribución de TSS
    return templates.map(t => {
      if (t.isRest) return t;

      let sessTSS  = Math.round(t.tssShare * targetTSS);
      const ifTarget = t.ifTarget || 0.65;
      // Duración: TSS = (dur_h * NP * IF) / (FTP * 3600) * 100 → dur_h = TSS/(IF²*100) h
      let durMin = Math.round((sessTSS / (Math.pow(ifTarget, 2) * 100)) * 60);

      // Salvaguarda fisiológica: Tiempos mínimos lógicos según el nivel del atleta
      let minDur = 30;
      if (['vo2max', 'threshold', 'tempo', 'sprint', 'strength'].includes(t.type)) {
        minDur = (exp === 'avanzado') ? 65 : 45;
      } else if (t.type === 'long') {
        minDur = (exp === 'avanzado') ? 150 : 90;
      } else if (t.type === 'endurance') {
        minDur = (exp === 'avanzado') ? 75 : 45;
      }

      if (durMin < minDur) {
        durMin = minDur;
        // Recalcular el TSS para reflejar la duración extra
        sessTSS = Math.round((durMin / 60) * Math.pow(ifTarget, 2) * 100);
      }

      // Generar estructura de intervalos real
      const intervals = this._buildIntervals(t.type, ftp, durMin, sessTSS, t.ifTarget, 'main');
      const alt_intervals = this._buildIntervals(t.type, ftp, durMin, sessTSS, t.ifTarget, 'alt');

      // Construir descripción dinámica que coincida exactamente con los intervalos
      const buildDesc = (ivs) => {
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
      };

      let dynamicDesc = buildDesc(intervals);
      let altDesc = buildDesc(alt_intervals);

      // ── Asignación del consejo de terreno ──
      let terrainAdvice = '';
      if (['vo2max', 'threshold'].includes(t.type)) {
        terrainAdvice = ` ⛰️ Terreno ideal: Busca un tramo de subida constante del 4-7% sin cruces ni interrupciones.`;
      } else if (t.type === 'strength') {
        terrainAdvice = ` ⛰️ Terreno ideal: Subida tendida del 5-8% para poder ir atrancado con seguridad.`;
      } else if (t.type === 'sprint') {
        terrainAdvice = ` ⚡ Terreno ideal: Llano o falso llano ascendente (1-3%) con buena visibilidad.`;
      } else if (['endurance', 'recovery', 'long'].includes(t.type)) {
        terrainAdvice = ` 🛣️ Terreno ideal: Terreno lo más llano y continuo posible para mantener los vatios estables.`;
      }

      return {
        ...t,
        tss: sessTSS,
        durationMin: durMin,
        targetWatts: Math.round(ftp * ifTarget),
        description: dynamicDesc,
        alt_description: altDesc,
        advice: t.description + terrainAdvice,
        intervals,
        alt_intervals,
      };
    });
  },

  /* ── Plantillas semanales según goal/phase ── */
  _getTemplate(goal, phase, exp, tsb) {
    const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

    // Principiante: plan especial sin series ni intensidad alta
    if (exp === 'principiante') {
      const isPeso = goal === 'perdida_peso' || goal === 'resistencia';
      return [
        { day: 'Lunes',     isRest: true,  description: 'Descanso. Tu cuerpo se adapta mientras descansas. Hidratación y sueño.' },
        { day: 'Martes',    type: 'endurance', name: 'Rodada de inicio Z1-Z2', description: 'Puedes mantener una conversación fluida. Sin presión, aprende a controlar el esfuerzo.', tssShare: 0.16, ifTarget: 0.58, emoji: '🔵' },
        { day: 'Miércoles', isRest: true,  description: 'Descanso activo — caminar 20 min o estiramientos suaves de piernas.' },
        { day: 'Jueves',    type: 'endurance', name: 'Z2 continuo', description: 'Cadencia cómoda (70-85 rpm). Bebe cada 15-20 min aunque no tengas sed.', tssShare: 0.20, ifTarget: 0.60, emoji: '🔵' },
        { day: 'Viernes',   isRest: true,  description: 'Descanso. Prioriza el sueño: es cuando el cuerpo se adapta.' },
        { day: 'Sábado',    type: 'long',  name: 'Salida larga suave', description: isPeso ? 'Ritmo muy cómodo para quemar grasa eficientemente. Lleva agua y snack ligero.' : 'Explora sin presión. Lleva agua y algo para comer.', tssShare: 0.28, ifTarget: 0.58, emoji: '🩵' },
        { day: 'Domingo',   isRest: true,  description: 'Descanso. Movilidad de cadera, cuádriceps y gemelos 10-15 min.' },
      ];
    }

    if (phase === 'recovery') {
      return [
        { day: 'Lunes',    isRest: true,  description: 'Descanso total o movilidad 15 min' },
        { day: 'Martes',   type: 'recovery', name: 'Rodaje suave', description: 'Pedaleo muy ligero en Z1 para mover las piernas.', tssShare: 0.08, ifTarget: 0.50, emoji: '😴' },
        { day: 'Miércoles',isRest: true,  description: 'Descanso. Masaje, foam roller, natación suave' },
        { day: 'Jueves',   type: 'endurance', name: 'Z2 suave', description: 'Resistencia aeróbica ligera y relajada.', tssShare: 0.12, ifTarget: 0.60, emoji: '🔵' },
        { day: 'Viernes',  isRest: true,  description: 'Descanso activo: caminar, yoga' },
        { day: 'Sábado',   type: 'endurance', name: 'Rodada moderada Z2', description: 'Base aeróbica, mantén la cadencia alta entre 85-95 rpm.', tssShare: 0.18, ifTarget: 0.62, emoji: '🔵' },
        { day: 'Domingo',  isRest: true,  description: 'Descanso total. Prepara la próxima semana' },
      ];
    }

    if (phase === 'race') {
      return [
        { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto. Últimas 72h previas' },
        { day: 'Martes',   type: 'recovery', name: 'Pedaleo de activación', description: 'Mover piernas sin fatigarse en absoluto.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
        { day: 'Miércoles',type: 'endurance', name: 'Z2 con sprints cortos', description: 'Sprints al final para mantener agudeza neuromuscular.', tssShare: 0.10, ifTarget: 0.62, emoji: '🔵' },
        { day: 'Jueves',   isRest: true,  description: 'Descanso. Carga de carbohidratos: 8-10g/kg' },
        { day: 'Viernes',  type: 'race',  name: 'Activación pre-carrera', description: 'Despierta las piernas sin vaciar los depósitos.', tssShare: 0.07, ifTarget: 0.65, emoji: '🏁' },
        { day: 'Sábado',   type: 'race',  name: '🏁 DÍA DE CARRERA', description: 'Ejecuta tu plan de carrera. ¡A darlo todo!', tssShare: 0.30, ifTarget: 0.85, emoji: '🏁' },
        { day: 'Domingo',  isRest: true,  description: 'Recuperación post-carrera. Come bien y descansa' },
      ];
    }

    if (phase === 'peak') {
      return [
        { day: 'Lunes',    isRest: true,  description: 'Descanso — inicio del taper' },
        { day: 'Martes',   type: 'threshold', name: 'Intervalos al umbral', description: 'Calidad sobre cantidad. Mantén la sensación de velocidad.', tssShare: 0.13, ifTarget: 0.82, emoji: '🟡' },
        { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa', description: 'Rodaje fluido, enfocándote en cadencia alta.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
        { day: 'Jueves',   type: 'vo2max',   name: 'VO₂ Max agudeza', description: 'Activa el sistema aeróbico superior sin generar fatiga residual.', tssShare: 0.12, ifTarget: 0.85, emoji: '🔴' },
        { day: 'Viernes',  isRest: true,  description: 'Descanso. Preparación mental' },
        { day: 'Sábado',   type: 'endurance', name: 'Rodada moderada', description: 'Mantén la tensión muscular correcta para evitar aletargamiento.', tssShare: 0.16, ifTarget: 0.70, emoji: '🔵' },
        { day: 'Domingo',  type: 'recovery',  name: 'Recuperación activa', description: 'Pedaleo muy suave. Visualiza tu estrategia.', tssShare: 0.05, ifTarget: 0.52, emoji: '😴' },
      ];
    }

    // ── BASE y BUILD — varía según goal ──
    const templates = {
      resistencia: {
        base: [
          { day: 'Lunes',    isRest: true,  description: 'Descanso activo — movilidad, foam roller' },
          { day: 'Martes',   type: 'endurance', name: 'Z2 con cadencia alta', description: 'Construye eficiencia aeróbica.', tssShare: 0.15, ifTarget: 0.65, emoji: '🔵' },
          { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa', description: 'Activa la circulación sin acumular fatiga.', tssShare: 0.07, ifTarget: 0.50, emoji: '😴' },
          { day: 'Jueves',   type: 'tempo',    name: 'Tempo progresivo', description: 'Eleva tu ritmo base sin generar excesiva fatiga.', tssShare: 0.17, ifTarget: 0.75, emoji: '🟢' },
          { day: 'Viernes',  isRest: true,  description: 'Descanso — preparar el fin de semana' },
          { day: 'Sábado',   type: 'endurance', name: 'Rodada media larga Z2', description: 'Base aeróbica pura para acostumbrar al cuerpo al tiempo sobre el sillín.', tssShare: 0.22, ifTarget: 0.65, emoji: '🔵' },
          { day: 'Domingo',  type: 'long',    name: 'Fondón largo Z1-Z2', description: 'El rey del entrenamiento de base. Mantén un ritmo conversacional.', tssShare: 0.30, ifTarget: 0.62, emoji: '🩵' },
        ],
        build: [
          { day: 'Lunes',    isRest: true,  description: 'Descanso. Nutrición y sueño prioritarios' },
          { day: 'Martes',   type: 'threshold', name: 'Intervalos al umbral FTP', description: 'Aumenta tu capacidad de sostener potencia alta.', tssShare: 0.18, ifTarget: 0.82, emoji: '🟡' },
          { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa Z1', description: 'Crítico para asimilar el trabajo del martes.', tssShare: 0.07, ifTarget: 0.52, emoji: '😴' },
          { day: 'Jueves',   type: 'vo2max',   name: 'Intervalos VO₂ Max', description: 'Expande tu techo aeróbico con esfuerzo muy exigente.', tssShare: 0.18, ifTarget: 0.85, emoji: '🔴' },
          { day: 'Viernes',  type: 'endurance', name: 'Z2 moderado', description: 'Mantiene volumen de entrenamiento sin añadir estrés al sistema.', tssShare: 0.13, ifTarget: 0.65, emoji: '🔵' },
          { day: 'Sábado',   type: 'tempo',    name: 'Tempo largo + sweetspot', description: 'Mejora la resistencia muscular en esfuerzos sostenidos.', tssShare: 0.22, ifTarget: 0.78, emoji: '🟢' },
          { day: 'Domingo',  type: 'long',    name: 'Fondón aeróbico largo', description: 'Simula la fatiga de fin de carrera.', tssShare: 0.28, ifTarget: 0.65, emoji: '🩵' },
        ],
      },

      ftp: {
        base: [
          { day: 'Lunes',    isRest: true,  description: 'Descanso. Recuperación completa' },
          { day: 'Martes',   type: 'tempo', name: 'Sweetspot moderado', description: 'Trabajo en la zona dulce (Sweetspot) para subir tu umbral.', tssShare: 0.18, ifTarget: 0.78, emoji: '🟢' },
          { day: 'Miércoles',type: 'recovery', name: 'Recuperación Z1', description: 'Movilidad articular y limpieza de lactato.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
          { day: 'Jueves',   type: 'threshold', name: 'FTP progresivo', description: 'Acostumbra al cuerpo a trabajar cerca del FTP de forma controlada.', tssShare: 0.17, ifTarget: 0.82, emoji: '🟡' },
          { day: 'Viernes',  isRest: true,  description: 'Descanso activo — estiramientos' },
          { day: 'Sábado',   type: 'threshold', name: 'Intervalos umbral largos', description: 'Intervalos largos para crear resistencia mental y física.', tssShare: 0.22, ifTarget: 0.83, emoji: '🟡' },
          { day: 'Domingo',  type: 'endurance', name: 'Rodada larga Z2', description: 'Soporte aeróbico vital para asimilar el trabajo de umbral.', tssShare: 0.24, ifTarget: 0.65, emoji: '🔵' },
        ],
        build: [
          { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto' },
          { day: 'Martes',   type: 'threshold', name: 'Bloque Umbral (FTP) Clásico', description: 'El trabajo FTP por excelencia. Mentalízate para tolerar el esfuerzo.', tssShare: 0.20, ifTarget: 0.84, emoji: '🟡' },
          { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa', description: 'No estreses el sistema hoy, limítate a rodar suave.', tssShare: 0.07, ifTarget: 0.52, emoji: '😴' },
          { day: 'Jueves',   type: 'vo2max',   name: 'Trabajo VO₂ Max', description: 'Tira de tu FTP hacia arriba mejorando el consumo de oxígeno.', tssShare: 0.18, ifTarget: 0.86, emoji: '🔴' },
          { day: 'Viernes',  type: 'tempo',    name: 'Sweetspot continuo', description: 'Acumula tiempo en la zona dulce para mayor eficiencia.', tssShare: 0.18, ifTarget: 0.78, emoji: '🟢' },
          { day: 'Sábado',   type: 'threshold', name: 'Series Umbral (FTP) Extendidas', description: 'Volumen umbral extendido para máxima adaptación fisiológica.', tssShare: 0.22, ifTarget: 0.84, emoji: '🟡' },
          { day: 'Domingo',  type: 'endurance', name: 'Z2 largo con finalización Z3', description: 'Simula el desgaste aeróbico y la fatiga final.', tssShare: 0.22, ifTarget: 0.68, emoji: '🔵' },
        ],
      },

      vo2max: {
        base: [
          { day: 'Lunes',    isRest: true,  description: 'Descanso' },
          { day: 'Martes',   type: 'endurance', name: 'Z2 base', description: 'Base estructurada pura para soportar la carga de VO₂ posterior.', tssShare: 0.12, ifTarget: 0.65, emoji: '🔵' },
          { day: 'Miércoles',type: 'tempo',     name: 'Sweetspot + sprints', description: 'Toca intensidades altas utilizando una base tempo.', tssShare: 0.17, ifTarget: 0.78, emoji: '🟢' },
          { day: 'Jueves',   type: 'recovery',  name: 'Recuperación activa', description: 'Crucial descansar activo antes de las sesiones fuertes.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
          { day: 'Viernes',  type: 'threshold', name: 'Umbral + arranques', description: 'Acostumbra las piernas al lactato.', tssShare: 0.17, ifTarget: 0.83, emoji: '🟡' },
          { day: 'Sábado',   type: 'vo2max',   name: 'Intervalos VO₂ introductorios', description: 'Introducción al dolor bueno: intervalos exigentes pero cortos.', tssShare: 0.18, ifTarget: 0.85, emoji: '🔴' },
          { day: 'Domingo',  type: 'endurance', name: 'Rodada larga Z2', description: 'Construye base aeróbica que te permita sostener alta intensidad.', tssShare: 0.22, ifTarget: 0.65, emoji: '🔵' },
        ],
        build: [
          { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto' },
          { day: 'Martes',   type: 'vo2max',   name: 'Series VO₂ Max Largas', description: 'Trabajo VO₂ clásico para exprimir tu capacidad cardiopulmonar.', tssShare: 0.19, ifTarget: 0.87, emoji: '🔴' },
          { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa', description: 'Pedalea fluido, no debes comprometer la frescura del jueves.', tssShare: 0.07, ifTarget: 0.52, emoji: '😴' },
          { day: 'Jueves',   type: 'sprint',   name: 'Capacidad anaeróbica', description: 'Exprime la potencia máxima y tu tolerancia láctica.', tssShare: 0.16, ifTarget: 0.82, emoji: '🟣' },
          { day: 'Viernes',  type: 'endurance', name: 'Z2 moderado', description: 'Recuperación activa con volumen. Mantén la cadencia viva.', tssShare: 0.12, ifTarget: 0.65, emoji: '🔵' },
          { day: 'Sábado',   type: 'vo2max',   name: 'Bloque VO₂ Max Intenso', description: 'Sesión sumamente exigente para forzar el cuerpo a crear nuevas adaptaciones.', tssShare: 0.21, ifTarget: 0.88, emoji: '🔴' },
          { day: 'Domingo',  type: 'long',    name: 'Fondón largo Z1-Z2', description: 'Mantenimiento de la base aeróbica vital para recuperar los esfuerzos.', tssShare: 0.25, ifTarget: 0.62, emoji: '🩵' },
        ],
      },

      sprint: {
        base: [
          { day: 'Lunes',    isRest: true,  description: 'Descanso' },
          { day: 'Martes',   type: 'strength', name: 'Fuerza muscular (baja cadencia)', description: 'Desarrolla la fuerza específica de pedaleo utilizando torque alto.', tssShare: 0.17, ifTarget: 0.75, emoji: '💪' },
          { day: 'Miércoles',type: 'recovery',  name: 'Recuperación Z1', description: 'Cadencia fluida y libre, limpia toxinas.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
          { day: 'Jueves',   type: 'sprint',   name: 'Esprints largos', description: 'Reclutamiento de fibras rápidas puras.', tssShare: 0.15, ifTarget: 0.78, emoji: '🟣' },
          { day: 'Viernes',  isRest: true,  description: 'Descanso activo' },
          { day: 'Sábado',   type: 'sprint',   name: 'Potencia máxima', description: 'Trabajo neuromuscular puro de alta potencia pico.', tssShare: 0.17, ifTarget: 0.80, emoji: '🟣' },
          { day: 'Domingo',  type: 'endurance', name: 'Rodada larga Z2', description: 'Soporte aeróbico indispensable para que los días intensos asimilen bien.', tssShare: 0.22, ifTarget: 0.65, emoji: '🔵' },
        ],
        build: [
          { day: 'Lunes',    isRest: true,  description: 'Descanso' },
          { day: 'Martes',   type: 'sprint',   name: 'Sprints con rampa', description: 'Desarrollo clave de tu potencia pico y la repetibilidad del esfuerzo.', tssShare: 0.17, ifTarget: 0.82, emoji: '🟣' },
          { day: 'Miércoles',type: 'endurance', name: 'Z2 + sprints de activación', description: 'Rodaje base condimentado con picos neuromusculares.', tssShare: 0.12, ifTarget: 0.65, emoji: '🔵' },
          { day: 'Jueves',   type: 'vo2max',   name: 'Micro-intervalos VO₂', description: 'Soporte aeróbico de alta gama para recuperar antes entre sprint y sprint.', tssShare: 0.18, ifTarget: 0.85, emoji: '🔴' },
          { day: 'Viernes',  type: 'recovery',  name: 'Recuperación activa', description: 'Preparar las piernas al 100% de cara al fin de semana.', tssShare: 0.07, ifTarget: 0.52, emoji: '😴' },
          { day: 'Sábado',   type: 'sprint',   name: 'Sprints de competición + umbral', description: 'Simula constantes ataques o un cierre de carrera agresivo.', tssShare: 0.22, ifTarget: 0.80, emoji: '🟣' },
          { day: 'Domingo',  type: 'long',    name: 'Fondón Z1-Z2', description: 'Rodaje extenso para forzar la oxidación de grasas y asimilar el estrés.', tssShare: 0.25, ifTarget: 0.62, emoji: '🩵' },
        ],
      },

      gran_fondo: {
        base: [
          { day: 'Lunes',    isRest: true,  description: 'Descanso activo — movilidad de caderas y core' },
          { day: 'Martes',   type: 'endurance', name: 'Z2 con cadencia', description: 'Eficiencia metabólica estricta de base.', tssShare: 0.14, ifTarget: 0.65, emoji: '🔵' },
          { day: 'Miércoles',type: 'tempo',     name: 'Tempo con subidón final', description: 'Construye fatiga moderada útil para las salidas del fin de semana.', tssShare: 0.17, ifTarget: 0.75, emoji: '🟢' },
          { day: 'Jueves',   type: 'recovery',  name: 'Recuperación activa', description: 'Sueltate sin estresar el sistema cardiopulmonar.', tssShare: 0.07, ifTarget: 0.52, emoji: '😴' },
          { day: 'Viernes',  type: 'endurance', name: 'Z2 largo', description: 'Practica metódicamente la ingesta de nutrición en la bici.', tssShare: 0.17, ifTarget: 0.65, emoji: '🔵' },
          { day: 'Sábado',   type: 'long',    name: 'Simulacro de gran fondo', description: 'Practica tu estrategia nutricional exacta para el día de carrera.', tssShare: 0.30, ifTarget: 0.68, emoji: '🩵' },
          { day: 'Domingo',  type: 'endurance', name: 'Rodada acumulada (segunda jornada)', description: 'Acostumbra a tu mente y piernas a salir habiendo trabajado duro el día anterior.', tssShare: 0.18, ifTarget: 0.65, emoji: '🔵' },
        ],
        build: [
          { day: 'Lunes',    isRest: true,  description: 'Descanso absoluto' },
          { day: 'Martes',   type: 'threshold', name: 'Umbral específico', description: 'Eleva la potencia sostenida para rendir mejor en los puertos largos.', tssShare: 0.17, ifTarget: 0.82, emoji: '🟡' },
          { day: 'Miércoles',type: 'recovery',  name: 'Recuperación activa Z1', description: 'Asimilación pura, no vayas a buscar picos de potencia.', tssShare: 0.06, ifTarget: 0.50, emoji: '😴' },
          { day: 'Jueves',   type: 'tempo',    name: 'Bloque sweetspot', description: 'Eleva el umbral aeróbico para aguantar mejor la zona media.', tssShare: 0.22, ifTarget: 0.78, emoji: '🟢' },
          { day: 'Viernes',  type: 'endurance', name: 'Z2 moderado', description: 'Mantiene las piernas fluidas sin añadir estrés de cara al finde.', tssShare: 0.13, ifTarget: 0.65, emoji: '🔵' },
          { day: 'Sábado',   type: 'long',    name: 'Gran fondo largo con bloques', description: 'Prepara para las subidas fatigosas en medio de recorridos eternos.', tssShare: 0.32, ifTarget: 0.70, emoji: '🩵' },
          { day: 'Domingo',  type: 'endurance', name: 'Vuelta de acumulación Z2', description: 'Imprescindible para enseñarle al cuerpo a digerir la fatiga crónica.', tssShare: 0.18, ifTarget: 0.65, emoji: '🔵' },
        ],
      },
    };

    const goalMap = templates[goal] || templates['resistencia'];
    return goalMap[phase] || goalMap['base'];
  },

  /** Genera estructura de intervalos detallada */
  _buildIntervals(type, ftp, durMin, tss, ifTarget, variant = 'main') {
    const pct = (ratio) => Math.round(ftp * ratio);

    let warm = Math.max(10, Math.round(durMin * 0.2));
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
        
        if (variant === 'main') {
          intervals.push({ label: 'Bloque Z2 principal', dur: `${main} min`, watts: `${pct(0.56)}–${pct(0.75)} W`, rpm: '85-92 rpm', desc: 'Esfuerzo aeróbico continuo.' });
        } else {
          let blocks = Math.floor(main / 20);
          if (blocks >= 2) {
            intervals.push({ label: `Z2 Aeróbico (×${blocks} repeticiones)`, dur: `18 min c/u`, watts: `${pct(0.60)}–${pct(0.70)} W`, rpm: '85-90 rpm', desc: 'Base aeróbica estable.' });
            intervals.push({ label: `Inserción Tempo (×${blocks} repeticiones)`, dur: `2 min c/u`, watts: `${pct(0.80)}–${pct(0.85)} W`, rpm: '95 rpm', desc: 'Romper la monotonía muscular.' });
            if (main - (blocks * 20) > 0) {
              intervals.push({ label: 'Z2 Aeróbico', dur: `${main - (blocks * 20)} min`, watts: `${pct(0.60)}–${pct(0.70)} W`, rpm: '85-90 rpm', desc: 'Completar tiempo aeróbico.' });
            }
          } else {
            intervals.push({ label: 'Bloque Z2 con variaciones de cadencia', dur: `${main} min`, watts: `${pct(0.56)}–${pct(0.75)} W`, rpm: '75-95 rpm (alternando)', desc: 'Esfuerzo aeróbico continuo alternando cadencias.' });
          }
        }
        intervals.push({ label: 'Vuelta a la calma', dur: `${cool} min`, watts: `${pct(0.45)}–${pct(0.55)} W`, rpm: '90 rpm', desc: 'Reducir gradualmente.' });
        break;

      case 'tempo':
        intervals.push({ label: 'Calentamiento progresivo', dur: `${warm} min`, watts: `${pct(0.55)}–${pct(0.70)} W`, rpm: '88 rpm', desc: 'Incremento gradual.' });
        if (variant === 'main') {
          if (main >= 25) {
            let blockTime = Math.floor(main / 2.5);
            let recTime = main - (blockTime * 2);
            intervals.push({ label: `Bloque Z3 (×2 repeticiones)`, dur: `${blockTime} min c/u`, watts: `${pct(0.76)}–${pct(0.88)} W`, rpm: '85-90 rpm', desc: '"Comfortably hard". Respiración elevada pero rítmica.' });
            intervals.push({ label: `Recuperación Z1 (×1 repeticiones)`, dur: `${recTime} min c/u`, watts: `${pct(0.50)}–${pct(0.55)} W`, rpm: '90+ rpm', desc: 'Pedaleo suave para recuperar.' });
          } else {
            intervals.push({ label: `Bloque Z3 / Sweetspot`, dur: `${main} min`, watts: `${pct(0.76)}–${pct(0.88)} W`, rpm: '85-90 rpm', desc: '"Comfortably hard". Respiración elevada pero rítmica.' });
          }
        } else {
          let reps = 4;
          let blockTime = Math.floor((main * 0.8) / reps);
          let recTime = Math.floor((main * 0.2) / (reps - 1));
          intervals.push({ label: `Intervalos Z3 cortos (×${reps} repeticiones)`, dur: `${blockTime} min c/u`, watts: `${pct(0.80)}–${pct(0.88)} W`, rpm: '90 rpm', desc: 'Sweetspot dinámico.' });
          intervals.push({ label: `Recuperación (×${reps-1} repeticiones)`, dur: `${recTime} min c/u`, watts: `${pct(0.50)}–${pct(0.55)} W`, rpm: '90+ rpm', desc: 'Micro-descansos.' });
          let remaining = main - (reps * blockTime + (reps - 1) * recTime);
          if (remaining > 0) cool += remaining;
        }
        intervals.push({ label: 'Vuelta a la calma', dur: `${cool} min`, watts: `< ${pct(0.60)} W`, rpm: 'libre', desc: 'Reducción gradual.' });
        break;

      case 'threshold':
        intervals.push({ label: 'Calentamiento', dur: `${warm} min`, watts: `${pct(0.55)}–${pct(0.70)} W`, rpm: '88-92 rpm', desc: 'Incluye sprints cortos para activar.' });
        if (variant === 'main') {
          let repsTh = main > 40 ? 3 : 2;
          let workTh = Math.floor((main * 0.75) / repsTh);
          let recTh = Math.floor((main * 0.25) / (repsTh - 1));
          if (workTh < 8) { repsTh = 1; workTh = main; recTh = 0; }
          let actualMainTh = (repsTh * workTh) + ((repsTh > 1 ? repsTh - 1 : 0) * recTh);
          cool += (main - actualMainTh);
          if (repsTh > 1) {
            intervals.push({ label: `Intervalo Umbral (×${repsTh} repeticiones)`, dur: `${workTh} min c/u`, watts: `${pct(0.93)}–${pct(1.03)} W`, rpm: '85-90 rpm', desc: 'Esfuerzo sostenido en el FTP.' });
            intervals.push({ label: `Recuperación activa (×${repsTh-1} repeticiones)`, dur: `${recTh} min c/u`, watts: `${pct(0.50)}–${pct(0.55)} W`, rpm: '90+ rpm', desc: 'Recuperación sin parar. Mantén el ritmo.' });
          } else {
            intervals.push({ label: `Intervalo al umbral`, dur: `${workTh} min`, watts: `${pct(0.93)}–${pct(1.03)} W`, rpm: '85-90 rpm', desc: 'Esfuerzo sostenido en el FTP.' });
          }
        } else {
          let repsOU = 3;
          let blockTime = Math.floor((main * 0.75) / repsOU);
          let recTime = Math.floor((main * 0.25) / (repsOU - 1));
          intervals.push({ label: `Over-Unders: 2m al 90% + 1m al 105% (×${repsOU} repeticiones)`, dur: `${blockTime} min c/u`, watts: `${pct(0.90)} / ${pct(1.05)} W`, rpm: '90 rpm', desc: 'Cambios de ritmo (Criss-Cross) para tolerar y limpiar lactato.' });
          intervals.push({ label: `Recuperación activa (×${repsOU-1} repeticiones)`, dur: `${recTime} min c/u`, watts: `${pct(0.50)}–${pct(0.55)} W`, rpm: '90+ rpm', desc: 'Recuperación completa.' });
          let actualMainOU = (repsOU * blockTime) + ((repsOU > 1 ? repsOU - 1 : 0) * recTime);
          cool += (main - actualMainOU);
        }
        intervals.push({ label: 'Vuelta a la calma', dur: `${cool} min`, watts: `< ${pct(0.60)} W`, rpm: 'libre', desc: 'Reducir gradualmente.' });
        break;

      case 'vo2max':
        intervals.push({ label: 'Calentamiento', dur: `${warm} min`, watts: `${pct(0.55)}–${pct(0.70)} W`, rpm: '90 rpm', desc: 'Activación completa. Incluye 2×2 min al 90% FTP.' });
        if (variant === 'main') {
          let repWorkV = 4;
          let repRestV = 4;
          let repsV = Math.floor(main / (repWorkV + repRestV));
          if (repsV < 3 && main >= 15) { repWorkV = 3; repRestV = 3; repsV = Math.floor(main / 6); }
          if (repsV < 2) { repsV = 2; repWorkV = Math.floor(main/4); repRestV = Math.floor(main/4); }
          let actualMainV = repsV * (repWorkV + repRestV);
          cool += (main - actualMainV);
          intervals.push({ label: `Serie VO₂ Max (×${repsV} repeticiones)`, dur: `${repWorkV} min c/u`, watts: `${pct(1.06)}–${pct(1.20)} W`, rpm: '90-100 rpm', desc: 'Esfuerzo muy duro. FC máxima ~90-95%.' });
          intervals.push({ label: `Recuperación activa (×${repsV} repeticiones)`, dur: `${repRestV} min c/u`, watts: `${pct(0.50)}–${pct(0.55)} W`, rpm: '90+ rpm', desc: 'Recuperación activa. No parar, pedalear suave.' });
        } else {
          let blockDur = 8;
          let restDur = 4;
          let repsMicro = Math.floor(main / (blockDur + restDur));
          if (repsMicro < 2) { repsMicro = 2; blockDur = 6; restDur = 3; }
          let actualMainM = repsMicro * (blockDur + restDur);
          cool += (main - actualMainM);
          intervals.push({ label: `Micro-intervalos 40s ON / 20s OFF (×${repsMicro} repeticiones)`, dur: `${blockDur} min c/u`, watts: `${pct(1.15)} / ${pct(0.50)} W`, rpm: '100 / 85 rpm', desc: 'Bloque continuo alternando 40s fuerte y 20s suave.' });
          intervals.push({ label: `Recuperación de bloque (×${repsMicro} repeticiones)`, dur: `${restDur} min c/u`, watts: `${pct(0.45)}–${pct(0.50)} W`, rpm: '90 rpm', desc: 'Limpiar lactato entre bloques.' });
        }
        intervals.push({ label: 'Vuelta a la calma', dur: `${cool} min`, watts: `< ${pct(0.60)} W`, rpm: 'libre', desc: 'Reducción gradual. Hidratación.' });
        break;

      case 'sprint':
        intervals.push({ label: 'Calentamiento extenso', dur: `${warm} min`, watts: `${pct(0.55)}–${pct(0.70)} W`, rpm: '88-95 rpm', desc: 'Activación completa.' });
        if (variant === 'main') {
          let sprintReps = Math.floor(main / 3);
          if (sprintReps < 4) sprintReps = 4;
          if (sprintReps > 12) sprintReps = 12;
          let actualMainS = sprintReps * 3;
          cool += (main - actualMainS);
          intervals.push({ label: `Sprints principales (×${sprintReps} repeticiones)`, dur: '20 s c/u', watts: `${pct(1.50)}–máx`, rpm: '110-130+ rpm', desc: 'MÁXIMO esfuerzo. Power peaking.' });
          intervals.push({ label: `Recuperación (×${sprintReps} repeticiones)`, dur: '2.5 min c/u', watts: `< ${pct(0.55)} W`, rpm: 'libre', desc: 'Recuperación completa entre sprints.' });
        } else {
          let sprintReps = Math.floor(main / 4);
          if (sprintReps < 4) sprintReps = 4;
          if (sprintReps > 10) sprintReps = 10;
          let actualMainS = sprintReps * 4;
          cool += (main - actualMainS);
          intervals.push({ label: `Sprints desde parado (×${sprintReps} repeticiones)`, dur: '12 s c/u', watts: `Máx W`, rpm: 'arranca duro', desc: 'Fuerza máxima absoluta. Arranca casi parado.' });
          intervals.push({ label: `Recuperación (×${sprintReps} repeticiones)`, dur: '3.5 min c/u', watts: `< ${pct(0.55)} W`, rpm: 'libre', desc: 'Recuperación completa y total.' });
        }
        intervals.push({ label: 'Vuelta a la calma', dur: `${cool} min`, watts: `< ${pct(0.55)} W`, rpm: 'libre', desc: 'Limpiar el lactato. Muy importante post-sprints.' });
        break;

      case 'strength':
        intervals.push({ label: 'Calentamiento', dur: `${warm} min`, watts: `${pct(0.55)}–${pct(0.65)} W`, rpm: '85 rpm', desc: 'Calentamiento estándar.' });
        if (variant === 'main') {
          let repsS = 4;
          let workS = Math.floor((main * 0.8) / repsS);
          let recS = Math.floor((main * 0.2) / repsS);
          if (workS < 5) { repsS = 3; workS = Math.floor((main * 0.8) / repsS); recS = Math.floor((main * 0.2) / repsS); }
          let actualMainStr = repsS * (workS + recS);
          cool += (main - actualMainStr);
          intervals.push({ label: `Bloques de fuerza Z3-Z4 (×${repsS} repeticiones)`, dur: `${workS} min c/u`, watts: `${pct(0.80)}–${pct(0.95)} W`, rpm: '50-65 rpm', desc: 'BAJA cadencia clave. Activa fibras de alta potencia.' });
          intervals.push({ label: `Recuperación activa (×${repsS} repeticiones)`, dur: `${recS} min c/u`, watts: `< ${pct(0.55)} W`, rpm: '90+ rpm', desc: 'Cadencia alta para limpiar lactato.' });
        } else {
          let repsS = 6;
          let workS = Math.floor((main * 0.75) / repsS);
          let recS = Math.floor((main * 0.25) / repsS);
          let actualMainStr = repsS * (workS + recS);
          cool += (main - actualMainStr);
          intervals.push({ label: `Fuerza específica Z4 (×${repsS} repeticiones)`, dur: `${workS} min c/u`, watts: `${pct(0.90)}–${pct(1.00)} W`, rpm: '55-60 rpm', desc: 'Fuerza submáxima con cadencia muy baja.' });
          intervals.push({ label: `Recuperación fluida (×${repsS} repeticiones)`, dur: `${recS} min c/u`, watts: `< ${pct(0.55)} W`, rpm: '100+ rpm', desc: 'Mucho molinillo para limpiar lactato.' });
        }
        intervals.push({ label: 'Vuelta a la calma', dur: `${cool} min`, watts: `< ${pct(0.55)} W`, rpm: 'libre', desc: 'Importante: estirar cuádriceps post-sesión.' });
        break;

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
  async parse(file) {
    const text = await file.text();
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'gpx') return this.parseGPX(text, file.name);
    if (ext === 'tcx') return this.parseTCX(text, file.name);
    if (ext === 'csv') return this.parseCSV(text, file.name);
    throw new Error('Formato no soportado. Usa GPX, TCX o CSV.');
  },

  parseGPX(text, name) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');
    const trkpts = Array.from(doc.querySelectorAll('trkpt'));

    if (!trkpts.length) throw new Error('No se encontraron puntos GPS en el GPX.');

    const points = trkpts.map(pt => ({
      lat: parseFloat(pt.getAttribute('lat')),
      lon: parseFloat(pt.getAttribute('lon')),
      ele: parseFloat(pt.querySelector('ele')?.textContent || 0),
      time: new Date(pt.querySelector('time')?.textContent || 0),
      power: parseFloat(pt.querySelector('power')?.textContent || 0) || null,
      hr: parseFloat(pt.querySelector('hr')?.textContent || 0) || null,
      cad: parseFloat(pt.querySelector('cadence')?.textContent || 0) || null,
    }));

    const date = points[0].time.toISOString().substring(0, 10);
    const durationSec = (points[points.length - 1].time - points[0].time) / 1000;
    const distance = this._calcDistance(points);
    const avgPower = points.filter(p => p.power > 0).length
      ? Math.round(points.reduce((s, p) => s + (p.power || 0), 0) / points.filter(p => p.power > 0).length)
      : 0;
    const avgHR = points.filter(p => p.hr > 0).length
      ? Math.round(points.reduce((s, p) => s + (p.hr || 0), 0) / points.filter(p => p.hr > 0).length)
      : 0;

    const activity = {
      id: 'gpx_' + Date.now(),
      name: name.replace('.gpx', '').replace(/_/g, ' '),
      date,
      source: 'GPX',
      duration: Math.round(durationSec),
      distance: Math.round(distance),
      avg_power: avgPower || null,
      np: avgPower ? Math.round(avgPower * 1.05) : null,
      avg_hr: avgHR || null,
      avg_speed: durationSec > 0 ? Math.round((distance / durationSec) * 36) / 10 : null, // km/h
      elevation: this._calcElevation(points),
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

    const powers = [], hrs = [], times = [];
    for (const tp of trackpoints) {
      const time = new Date(tp.querySelector('Time')?.textContent || 0);
      const power = parseFloat(tp.querySelector('Watts')?.textContent || 0);
      const hr = parseFloat(tp.querySelector('Value')?.textContent || 0);
      if (!isNaN(time)) times.push(time);
      if (power > 0) powers.push(power);
      if (hr > 0 && hr < 250) hrs.push(hr);
    }

    const durationSec = times.length >= 2
      ? Math.round((times[times.length - 1] - times[0]) / 1000) : 0;

    const totalDistEl = doc.querySelector('DistanceMeters');
    const distance = parseFloat(totalDistEl?.textContent || 0);
    const avgPower = powers.length ? Math.round(powers.reduce((a, b) => a + b, 0) / powers.length) : 0;
    const avgHR = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : 0;

    return {
      id: 'tcx_' + Date.now(),
      name: name.replace('.tcx', '').replace(/_/g, ' '),
      date,
      source: 'TCX',
      duration: durationSec,
      distance: Math.round(distance),
      avg_power: avgPower || null,
      np: avgPower ? Math.round(avgPower * 1.05) : null,
      avg_hr: avgHR || null,
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
        source: 'CSV',
        duration: Math.round(durSec),
        distance: parseFloat(r[distKey]) * (parseFloat(r[distKey]) < 200 ? 1000 : 1) || null,
        avg_power: parseFloat(r[powerKey]) || null,
        np:        parseFloat(r[powerKey]) ? Math.round(parseFloat(r[powerKey]) * 1.05) : null,
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
      font: { family: 'DM Sans', size: 12 },
    };
  },

  createPMCChart(canvasId, pmcData) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    const labels = pmcData.map(d => d.date.substring(5));
    const ctlData = pmcData.map(d => d.ctl);
    const atlData = pmcData.map(d => d.atl);
    const tsbData = pmcData.map(d => d.tsb);

    return new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'CTL (Fitness)', data: ctlData, borderColor: '#00D4FF', backgroundColor: 'rgba(0,212,255,0.1)', tension: 0.4, pointRadius: 0, borderWidth: 2, fill: true },
          { label: 'ATL (Fatiga)',  data: atlData, borderColor: '#FF6B35', backgroundColor: 'rgba(255,107,53,0.1)', tension: 0.4, pointRadius: 0, borderWidth: 2, fill: true },
          { label: 'TSB (Forma)',   data: tsbData, borderColor: '#00C882', backgroundColor: 'transparent', tension: 0.4, pointRadius: 0, borderWidth: 1.5, fill: false, borderDash: [5, 5] },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#9ca3af', font: { family: 'DM Sans', size: 12 }, usePointStyle: true, pointStyleWidth: 12 } },
          tooltip: {
            backgroundColor: '#1a1d26',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            titleColor: '#f0f2f7',
            bodyColor: '#9ca3af',
            padding: 12,
          },
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6b7280', font: { size: 11 }, maxTicksLimit: 12 } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6b7280', font: { size: 11 } } },
        },
      },
    });
  },

  createTSSHistoryChart(canvasId, activities) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    const last12 = activities.slice(-12);
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: last12.map(a => a.date?.substring(5) || ''),
        datasets: [{
          label: 'TSS',
          data: last12.map(a => a.tss || 0),
          backgroundColor: last12.map(a => {
            const t = a.tss || 0;
            if (t > 150) return 'rgba(255,71,87,0.7)';
            if (t > 100) return 'rgba(255,107,53,0.7)';
            if (t > 60)  return 'rgba(255,217,61,0.7)';
            return 'rgba(59,130,246,0.7)';
          }),
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#6b7280', font: { size: 11 } } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6b7280', font: { size: 11 } } },
        },
      },
    });
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
            ticks: { color: '#6b7280', font: { size: 11 }, callback: v => v + ' kg' },
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
    const dailyGoalAdjust = { perdida_peso: -350, resistencia: 0, ftp: 120, vo2max: 180, sprint: 120, gran_fondo: 220 }[goal] || 0;
    const dailyCalories = Math.max(1500, baseDaily + workoutCals + dailyGoalAdjust);

    // ── Lógica Dinámica de Carbohidratos ──
    // Base de descanso según objetivo
    const baseCarb = { perdida_peso: 2.5, resistencia: 3.5, ftp: 4.0, vo2max: 4.0, sprint: 3.8, gran_fondo: 4.2 }[goal] || 3.5;
    // Plus por intensidad: +1g de CH por cada 50 TSS
    const tssBonus = trainingDay ? (tss / 50) : 0;
    const carbPerKg = baseCarb + tssBonus;

    // ── Lógica Dinámica de Proteína ──
    // Más proteína en días de carga para reparación
    const baseProt = goal === 'perdida_peso' ? 2.0 : 1.6;
    const proteinPerKg = trainingDay ? baseProt + 0.3 : baseProt;

    let carbs_g = Math.round(weight * carbPerKg);
    let protein_g = Math.round(weight * proteinPerKg);
    let fat_g = Math.round((dailyCalories - carbs_g * 4 - protein_g * 4) / 9);
    const minFat = Math.round(weight * 0.7);
    if (fat_g < minFat) {
      fat_g = minFat;
      const kcalLeft = dailyCalories - protein_g * 4 - fat_g * 9;
      carbs_g = Math.max(120, Math.round(kcalLeft / 4));
    }

    // ── Hidratación Dinámica ──
    // Base (35ml/kg) + 300ml fijos + 600ml por cada hora de ejercicio
    const durationH = durationSec / 3600;
    const hydration_ml = Math.round(weight * 35 + 300 + (durationH * 650));

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
      supplements: this._supplements(goal),
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
    }[goal];
    if (goalTip) base.push(goalTip);
    if (!trainingDay) base.push({ icon: '😴', text: 'Dia suave: baja carbohidrato, no bajes proteina.' });
    return base;
  },

  _supplements(goal) {
    const base = [
      { name: 'Maltodextrina + Fructosa (Ratio 1:0.8)', dose: 'Intra-entreno', note: 'La mezcla óptima para absorber hasta 90-120g de carbohidratos por hora sin problemas gástricos.' },
      { name: 'Electrolitos (Sodio/Magnesio)', dose: '500-1000mg/h', note: 'Vital para prevenir calambres y mantener la hidratación en días calurosos o salidas largas.' },
      { name: 'Proteína Whey Isolate', dose: '25-30g post', note: 'Rápida absorción para maximizar la síntesis proteica muscular en la ventana anabólica.' }
    ];
    
    const extras = {
      sprint: [
        { name: 'Creatina Monohidrato', dose: '3-5g/día', note: 'Aumenta las reservas de fosfocreatina. Mejora significativamente la potencia máxima en sprints cortos.' },
        { name: 'Cafeína', dose: '3-6mg/kg', note: 'Mejora el reclutamiento de unidades motoras y reduce la percepción de fatiga.' }
      ],
      vo2max: [
        { name: 'Zumo de Remolacha (Nitratos)', dose: '400mg pre', note: 'Tomar 2h antes. Mejora la eficiencia del oxígeno y el flujo sanguíneo en esfuerzos al límite.' },
        { name: 'Beta-Alanina', dose: '3-6g/día', note: 'Actúa como buffer del ácido láctico. Ayuda a sostener esfuerzos en Z5-Z6 durante más tiempo.' }
      ],
      ftp: [
        { name: 'Beta-Alanina', dose: '3-6g/día', note: 'Retrasa la quemazón muscular, permitiendo empujar los vatios de umbral más tiempo.' }
      ],
      gran_fondo: [
        { name: 'BCAAs / Aminoácidos', dose: '5g intra', note: 'Reduce la fatiga del sistema nervioso central en pruebas de más de 4 horas.' }
      ]
    };
    return [...base, ...(extras[goal] || [])];
  }
};

const ProviderSync = {
  async syncStrava() {
    throw new Error('La sincronización real usa BackendSync.syncStrava() y requiere conectar Strava en Integraciones.');
  },

  async syncGarmin() {
    throw new Error('La sincronización real usa BackendSync.syncGarmin() y requiere conectar Garmin en Integraciones.');
  },
};

/* ══════════════════════════════════════════════════════════════
   DASHBOARD UI — Componentes visuales inyectables
══════════════════════════════════════════════════════════════ */
const DashboardUI = {
  renderWeeklyHighlight(containerId, activities, tssObjetivo = 350) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // 1. Filtrar actividades de esta semana (desde el lunes)
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);

    const weekActs = activities.filter(a => new Date(a.date + 'T00:00:00') >= monday);

    // 2. Calcular totales
    const totalTSS = Math.round(weekActs.reduce((s, a) => s + (a.tss || 0), 0));
    const totalDist = weekActs.reduce((s, a) => s + (a.distance || 0), 0) / 1000;
    const totalSecs = weekActs.reduce((s, a) => s + (a.duration || 0), 0);

    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);

    // 3. Inyectar HTML y CSS (Glassmorphism & Neon)
    container.innerHTML = `
      <style>
        .weekly-highlight-card {
          background: linear-gradient(145deg, #1a1d26 0%, #13151c 100%);
          border: 1px solid rgba(255, 107, 53, 0.3);
          border-radius: 16px;
          padding: 24px;
          position: relative;
          overflow: hidden;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), inset 0 0 20px rgba(255, 107, 53, 0.05);
          font-family: 'DM Sans', sans-serif;
        }
        .weekly-highlight-card::before {
          content: '';
          position: absolute;
          top: -60px;
          right: -60px;
          width: 200px;
          height: 200px;
          background: radial-gradient(circle, rgba(255,107,53,0.3) 0%, rgba(0,0,0,0) 70%);
          border-radius: 50%;
          z-index: 0;
          pointer-events: none;
        }
        .weekly-content {
          position: relative;
          z-index: 1;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 20px;
        }
        .weekly-tss { text-align: center; flex: 1; min-width: 120px; }
        .weekly-tss-val {
          font-size: 4rem; font-family: 'Space Grotesk', sans-serif; font-weight: 800;
          background: linear-gradient(135deg, #FF6B35 0%, #FFB088 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          line-height: 1; margin-bottom: 5px; text-shadow: 0px 4px 15px rgba(255, 107, 53, 0.3);
        }
        .weekly-stats { display: flex; flex-direction: column; gap: 12px; flex: 2; min-width: 180px; }
        .weekly-stat-item {
          display: flex; align-items: center; gap: 15px; background: rgba(255, 255, 255, 0.03);
          padding: 12px 18px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.05);
          transition: transform 0.2s ease, background 0.2s ease;
        }
        .weekly-stat-item:hover { transform: translateX(5px); background: rgba(255, 255, 255, 0.06); }
        .weekly-stat-icon {
          display: flex; align-items: center; justify-content: center; width: 40px; height: 40px;
          border-radius: 10px; background: rgba(0, 212, 255, 0.1); color: #00D4FF; font-size: 1.2rem;
        }
      </style>
      <div class="weekly-highlight-card">
        <h3 style="color: #fff; margin-top: 0; margin-bottom: 20px; font-family: 'Space Grotesk', sans-serif; font-size: 1.3rem; display: flex; align-items: center; gap: 8px;">
          <i class="fas fa-fire" style="color: #FF6B35;"></i> Tu Semana
        </h3>
        <div class="weekly-content">
          <div class="weekly-tss">
            <div class="weekly-tss-val" id="ui-week-tss">0</div>
            <div style="color: #9ca3af; font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px;">TSS Acumulado</div>
          </div>
          <div class="weekly-stats">
            <div class="weekly-stat-item">
              <div class="weekly-stat-icon"><i class="fas fa-route"></i></div>
              <div>
                <div style="color: #9ca3af; font-size: 0.85rem; margin-bottom: 2px;">Distancia</div>
                <div style="color: #fff; font-weight: 700; font-size: 1.2rem;">${totalDist.toFixed(1)} km</div>
              </div>
            </div>
            <div class="weekly-stat-item">
              <div class="weekly-stat-icon" style="background: rgba(16, 185, 129, 0.1); color: #10B981;"><i class="fas fa-stopwatch"></i></div>
              <div>
                <div style="color: #9ca3af; font-size: 0.85rem; margin-bottom: 2px;">Tiempo en movimiento</div>
                <div style="color: #fff; font-weight: 700; font-size: 1.2rem;">${hours}h ${minutes}m</div>
              </div>
            </div>
          </div>
        </div>
        <div style="margin-top: 28px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: #9ca3af; margin-bottom: 8px; font-weight: 500;">
            <span>Progreso objetivo semanal</span>
            <span id="ui-week-progress-text" style="color: #00D4FF;">0%</span>
          </div>
          <div style="width: 100%; height: 10px; background: rgba(255,255,255,0.06); border-radius: 5px; overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);">
            <div id="ui-week-progress-bar" style="height: 100%; width: 0%; background: linear-gradient(90deg, #FF6B35, #00D4FF); border-radius: 5px; transition: width 1.5s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 0 10px rgba(0, 212, 255, 0.5);"></div>
          </div>
        </div>
      </div>
    `;

    // 4. Animar TSS progresivamente (Contador rápido)
    const tssEl = document.getElementById('ui-week-tss');
    let currentTss = 0;
    if (totalTSS > 0) {
      const step = totalTSS / 30; // 30 frames
      const timer = setInterval(() => {
        currentTss += step;
        if (currentTss >= totalTSS) { 
          currentTss = totalTSS; 
          clearInterval(timer); 
        }
        if (tssEl) tssEl.innerText = Math.round(currentTss);
      }, 33);
    }

    // 5. Animar barra de progreso
    setTimeout(() => {
      const pct = Math.min(100, Math.round((totalTSS / tssObjetivo) * 100));
      const bar = document.getElementById('ui-week-progress-bar');
      const txt = document.getElementById('ui-week-progress-text');
      
      if (bar) bar.style.width = pct + '%';
      if (txt) txt.innerText = pct + '%';
      
      if (pct >= 100 && bar && txt) {
        bar.style.background = 'linear-gradient(90deg, #10B981, #00C882)';
        bar.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.5)';
        txt.style.color = '#10B981';
      }
    }, 100);
  }
};

/* Exportar al ámbito global */
window.AppState       = AppState;
window.PMC            = PMC;
window.Utils          = Utils;
window.Charts         = Charts;
window.FileParser     = FileParser;
window.ProviderSync   = ProviderSync;
window.DashboardUI    = DashboardUI;
window.ZONES_COGGAN   = ZONES_COGGAN;
window.WORKOUT_TYPES  = WORKOUT_TYPES;
window.GoalUtils      = GoalUtils;
window.TrainingPlanGenerator = TrainingPlanGenerator;
window.NutritionPlanner = NutritionPlanner;

/* ══════════════════════════════════════════════════════════════
   RESPONSIVE MOBILE ADAPTER (Injected Globally)
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // 1. Inyectar CSS global para móviles
  const mobileStyle = document.createElement('style');
  mobileStyle.innerHTML = `
    @media (max-width: 768px) {
      /* Prevenir desbordamiento de pantalla (scroll horizontal accidental) */
      html, body { overflow-x: hidden !important; width: 100vw !important; }
      * { box-sizing: border-box !important; }

      /* Menú Lateral (Sidebar) Off-Canvas */
      .sidebar {
        position: fixed !important;
        top: 0; left: 0; bottom: 0;
        width: 280px !important;
        transform: translateX(-100%) !important;
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        z-index: 9999 !important;
        background: var(--bg, #0a0b0f) !important;
        border-right: 1px solid var(--border) !important;
        box-shadow: 4px 0 24px rgba(0,0,0,0.5) !important;
        display: flex !important; 
      }
      body.sidebar-open .sidebar { 
        transform: translateX(0) !important; 
      }
      
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
        padding-bottom: 85px !important; /* Espacio extra para que la Bottom Bar no tape contenido */
      }
      .page-header { flex-direction: column; align-items: flex-start !important; gap: 12px; margin-bottom: 20px; width: 100%; }
      
      /* Arreglo de Botones en Cabecera (Para que no se salgan de la pantalla) */
      .header-actions { 
        width: 100% !important; 
        display: grid !important; 
        grid-template-columns: 1fr 1fr; 
        gap: 8px !important; 
      }
      .header-actions .btn, .header-actions button, .header-actions select { 
        width: 100% !important; 
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
      /* Aplica a cualquier fila flex anidada en tarjetas para que no se escapen (Strava/Garmin) */
      .card-body [style*="display: flex"],
      .card-body [style*="display:flex"],
      .card-body [style*="justify-content: space-between"],
      .integration-card {
        flex-direction: column !important;
        align-items: stretch !important;
        gap: 16px !important;
        text-align: center !important;
      }
      /* Forzar que todos los botones en las tarjetas móviles ocupen el 100% */
      .card-body .btn, .card-body button, .card-body a.btn, .integration-card .btn {
        width: 100% !important;
        justify-content: center !important;
        margin: 8px 0 0 0 !important;
        white-space: normal !important;
        height: auto !important;
      }
      .card-body svg, .card-body img { margin: 0 auto; max-width: 100%; }

      /* Arreglo de Tablas para que hagan scroll interno y no rompan la app */
      table, .data-table, div[style*="overflow-x:auto"], div[style*="overflow-x: auto"] {
        display: block !important;
        width: 100% !important;
        max-width: 100vw !important;
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch;
      }
      
      /* Desenrollar Grids rígidos de PC a 1 columna (Móvil) */
      div[style*="grid-template-columns: 1fr 1fr"],
      div[style*="grid-template-columns: 2fr 1fr"],
      div[style*="grid-template-columns: 1fr 1fr 1fr"],
      div[style*="grid-template-columns:repeat(4,1fr)"],
      div[style*="grid-template-columns:repeat(5,1fr)"] {
        display: flex !important; flex-direction: column !important; gap: 12px !important;
        width: 100% !important; max-width: 100% !important;
      }
      
      /* Clases comunes de layout en la app */
      .metrics-grid, .grid-2, #stats-row, .summary-grid, .color-grid, .mod-grid, .calc-row { 
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
      
      /* Ajustar notificaciones flotantes (Toasts) para no chocar con el menú */
      .toast-wrap { bottom: 80px !important; right: 16px !important; }

      /* Ocultar botón hamburguesa superior, ahora usamos la barra inferior */
      .mobile-menu-btn { display: none !important; }

      /* Barra de Navegación Inferior (Estilo Strava) */
      .bottom-nav {
        position: fixed !important;
        bottom: 0; left: 0; right: 0;
        height: 65px;
        background: var(--bg-card, #1a1d26);
        border-top: 1px solid var(--border, rgba(255,255,255,0.08));
        display: flex !important;
        justify-content: space-around;
        align-items: center;
        z-index: 9997;
        padding-bottom: env(safe-area-inset-bottom); /* Ajuste seguro para iPhone Notch */
      }
      body.light-theme .bottom-nav { background: #ffffff !important; }
      .bottom-nav-item {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        color: var(--text-muted, #6b7280); text-decoration: none; font-size: 10px; font-weight: 600;
        gap: 4px; flex: 1; height: 100%; transition: color 0.2s;
      }
      .bottom-nav-item.active { color: var(--primary, #9ED62B); }
      .bottom-nav-item i { font-size: 20px; margin-bottom: 2px; }
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

  // 2. Inyectar Botón de Menú y Overlay automáticamente si existe el Sidebar
  const headerTitle = document.querySelector('.page-header .page-title');
  if (headerTitle && document.querySelector('.sidebar')) {
    const h1 = headerTitle.querySelector('h1');
    const p = headerTitle.querySelector('p');
    
    const btn = document.createElement('button');
    btn.className = 'mobile-menu-btn';
    btn.innerHTML = '<i class="fas fa-bars"></i>';
    btn.onclick = () => document.body.classList.toggle('sidebar-open');
    
    // Autocerrar el menú al tocar cualquier enlace en móviles
    document.querySelectorAll('.sidebar a').forEach(link => {
      link.addEventListener('click', () => document.body.classList.remove('sidebar-open'));
    });
    
    const textWrapper = document.createElement('div');
    if (h1) textWrapper.appendChild(h1);
    if (p) textWrapper.appendChild(p);
    
    headerTitle.innerHTML = '';
    headerTitle.style.display = 'flex';
    headerTitle.style.alignItems = 'center';
    
    headerTitle.appendChild(btn);
    headerTitle.appendChild(textWrapper);

    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.onclick = () => document.body.classList.remove('sidebar-open');
    document.body.appendChild(overlay);

    // 3. Inyectar Bottom Navigation Bar (Experiencia App Nativa)
    const bottomNav = document.createElement('nav');
    bottomNav.className = 'bottom-nav';
    bottomNav.style.display = 'none'; // Oculto en PC, visible solo por CSS en móvil
    
    const currentPath = window.location.pathname;
    const navItems = [
      { name: 'Métricas', icon: 'fa-chart-bar', href: 'analytics.html' },
      { name: 'Mi Plan', icon: 'fa-calendar-check', href: 'training-plan.html' },
      { name: 'Actividades', icon: 'fa-history', href: 'activities.html' },
      { name: 'Garaje', icon: 'fa-warehouse', href: 'garaje.html' },
      { name: 'Menú', icon: 'fa-bars', href: '#', isMenu: true }
    ];
    
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
      document.body.classList.add('sidebar-open'); // Sigue abriendo el resto de opciones
    });
  }
});

/* ══════════════════════════════════════════════════════════════
   THEME ADAPTER (Light / Dark Mode)
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const sidebarNav = document.querySelector('.sidebar-nav');
  if (sidebarNav) {
    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'nav-section-title';
    sectionTitle.textContent = 'Apariencia';
    
    const toggleBtn = document.createElement('a');
    toggleBtn.href = '#';
    toggleBtn.className = 'nav-item theme-toggle';
    
    const updateBtnUI = () => {
      toggleBtn.innerHTML = document.documentElement.getAttribute('data-theme') === 'light' 
        ? '<i class="fas fa-moon"></i> Modo Oscuro' 
        : '<i class="fas fa-sun"></i> Modo Claro';
    };
    
    updateBtnUI();
    
    toggleBtn.onclick = (e) => {
      e.preventDefault();
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      const newTheme = isLight ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', newTheme);
      if (newTheme === 'light') document.documentElement.classList.add('light-theme');
      else document.documentElement.classList.remove('light-theme');
      localStorage.setItem('velomind_theme', newTheme);
      
      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) themeColorMeta.content = newTheme === 'light' ? '#ffffff' : '#0a0b0f';
      
      updateBtnUI();
    };
    
    sidebarNav.appendChild(sectionTitle);
    sidebarNav.appendChild(toggleBtn);
  }

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

  // 2. Inyectar theme-color para la barra de estado del móvil
  if (!document.querySelector('meta[name="theme-color"]')) {
    const themeColor = document.createElement('meta');
    themeColor.name = 'theme-color';
    themeColor.content = document.documentElement.getAttribute('data-theme') === 'light' ? '#ffffff' : '#0a0b0f';
    document.head.appendChild(themeColor);
  }

  // 3. Registrar Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('[PWA] Service Worker registrado', reg.scope))
        .catch(err => console.warn('[PWA] Fallo en Service Worker:', err));
    });
  }
});
