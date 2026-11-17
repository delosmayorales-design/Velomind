// Días de bici elegidos por el atleta (training_days / long_ride_day).
require('../js/app.js');
const { TrainingPlanGenerator: T } = window;

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const GOALS = ['resistencia', 'ftp', 'vo2max', 'sprint', 'gran_fondo', 'carrera_corta', 'carrera_larga', 'ultra', 'perdida_peso'];
const isCycling = s => !s.isRest && !s.isGym && !s.isRunning && !s.isWalking && !s.isOther;
const HARD = new Set(['threshold', 'vo2max', 'sprint', 'strength']);
const ANY  = new Set(['threshold', 'vo2max', 'sprint', 'strength', 'tempo']);

describe('_parseDayPrefs', () => {
  test('sin días → null (reparto automático de siempre)', () => {
    expect(T._parseDayPrefs({})).toBeNull();
    expect(T._parseDayPrefs({ training_days: null })).toBeNull();
    expect(T._parseDayPrefs({ training_days: [] })).toBeNull();
    expect(T._parseDayPrefs({ training_days: 'basura' })).toBeNull();
  });
  test('acepta array o JSON, limpia y ordena; salida larga solo si es un día elegido', () => {
    expect(T._parseDayPrefs({ training_days: '[6,1,3,3,9]', long_ride_day: 6 })).toEqual({ days: [1, 3, 6], longDay: 6 });
    expect(T._parseDayPrefs({ training_days: [1, 3], long_ride_day: 6 })).toEqual({ days: [1, 3], longDay: null });
    expect(T._parseDayPrefs({ training_days: [1, 3], long_ride_day: null })).toEqual({ days: [1, 3], longDay: null });
  });
});

describe('_buildSessions con días elegidos', () => {
  const build = (goal, phase, prefs, weekInCycle = 2, exp = 'intermedio') =>
    T._buildSessions(goal, phase, 250, 70, 8, exp, 0, 450, [], prefs ? prefs.days.length : 5, null, weekInCycle, [], weekInCycle, prefs);

  test('caso Raúl: rodillo martes y jueves, fondo largo el domingo', () => {
    for (const goal of GOALS) {
      for (const phase of ['base', 'build', 'recovery', 'peak']) {
        for (const wic of [1, 2, 3, 4]) {
          const s = build(goal, phase, { days: [1, 3, 6], longDay: 6 }, wic);
          expect(s).toHaveLength(7);
          s.forEach((x, i) => {
            expect(x.day).toBe(DAYS[i]);
            if (![1, 3, 6].includes(i)) expect(x.isRest).toBe(true);
          });
          // En base/build el domingo es la salida larga: un fondo/rodaje, nunca calidad
          if (phase === 'base' || phase === 'build') {
            expect(s[6].isRest).toBeFalsy();
            expect(['long', 'endurance']).toContain(s[6].type);
          }
        }
      }
    }
  });

  test('nunca entrena en un día no elegido y no supera el nº de días', () => {
    const combos = [[0], [2, 4], [0, 2, 4], [1, 2, 3, 4], [0, 1, 2, 3, 4, 5, 6], [5, 6]];
    for (const goal of GOALS) {
      for (const days of combos) {
        for (const phase of ['base', 'build']) {
          const s = build(goal, phase, { days, longDay: days[days.length - 1] });
          const trained = s.map((x, i) => (isCycling(x) ? i : null)).filter(i => i !== null);
          trained.forEach(i => expect(days).toContain(i));
          expect(trained.length).toBeLessThanOrEqual(days.length);
          s.filter(isCycling).forEach(x => {
            expect(x.durationMin).toBeGreaterThan(0);
            expect(Number.isFinite(x.tss)).toBe(true);
          });
        }
      }
    }
  });

  test('evita dos días de calidad seguidos cuando hay forma de repartirlos', () => {
    // Martes, miércoles, jueves y domingo: hay sitio para separar la calidad
    for (const goal of ['ftp', 'vo2max', 'carrera_corta']) {
      const s = build(goal, 'build', { days: [1, 2, 3, 6], longDay: 6 });
      for (let d = 1; d < 7; d++) {
        expect(HARD.has(s[d - 1].type) && ANY.has(s[d].type) && !s[d].isRest && !s[d - 1].isRest).toBe(false);
      }
    }
  });

  test('la semana de carrera ignora los días elegidos (manda la fecha del evento)', () => {
    const race = prefs => T._buildSessions('gran_fondo', 'race', 250, 70, 8, 'intermedio', 0, 450, [], 2, null, 2, [], 2, prefs);
    const a = race(null);
    const b = race({ days: [1, 3], longDay: null });
    expect(b.map(x => [x.day, x.type, x.isRest])).toEqual(a.map(x => [x.day, x.type, x.isRest]));
  });

  test('en base/build la carga semanal se conserva al reducir días', () => {
    const totalShare = prefs => {
      const t = T._getTemplate('resistencia', 'base', 'intermedio', 0, 2, 2, null);
      const r = T._applyDayPreferences(t, prefs.days, prefs.longDay, { recovery: 1, endurance: 2, tempo: 3, threshold: 4, strength: 4, sprint: 5, vo2max: 5, long: 6, race: 7 });
      return r.reduce((s, x) => s + (x.isRest ? 0 : (x.tssShare || 0)), 0);
    };
    const base = T._getTemplate('resistencia', 'base', 'intermedio', 0, 2, 2, null)
      .reduce((s, x) => s + (x.isRest ? 0 : (x.tssShare || 0)), 0);
    expect(totalShare({ days: [1, 3, 6], longDay: 6 })).toBeCloseTo(base, 6);
  });
});

describe('generate con días elegidos y entreno complementario', () => {
  test('gimnasio y caminata van a días sin bici', () => {
    window.AppState.pmcData = [];
    const plan = T.generate({
      ftp: 220, weight: 72, weekly_hours: 7, days_per_week: 5, goal: 'resistencia', experience: 'intermedio',
      training_days: [1, 3, 6], long_ride_day: 6, gym_days: 2, walking_days: 1,
    }, []);
    const s = plan.sessions;
    s.forEach((x, i) => { if (isCycling(x)) expect([1, 3, 6]).toContain(i); });
    s.forEach((x, i) => { if (x.isGym || x.isWalking) expect([1, 3, 6]).not.toContain(i); });
    expect(s.filter(x => x.isGym)).toHaveLength(2);
    expect(s.filter(x => x.isWalking)).toHaveLength(1);
    expect(isCycling(s[6])).toBe(true);
  });

  test('sin training_days el plan es idéntico al de siempre', () => {
    window.AppState.pmcData = [];
    const athlete = { ftp: 220, weight: 72, weekly_hours: 7, days_per_week: 3, goal: 'resistencia', experience: 'intermedio' };
    const a = T.generate(athlete, []);
    const b = T.generate({ ...athlete, training_days: null, long_ride_day: null }, []);
    expect(b.sessions.map(x => [x.day, x.type, x.isRest, x.tss])).toEqual(a.sessions.map(x => [x.day, x.type, x.isRest, x.tss]));
  });
});
