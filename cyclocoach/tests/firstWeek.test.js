require('../js/app.js');
const { TrainingPlanGenerator } = window;

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const rest = i => ({ day: DAYS[i], isRest: true, description: 'Descanso' });
const ride = (i, tss, name = `Sesión ${i}`) => ({ day: DAYS[i], isRest: false, name, type: 'endurance', tss, durationMin: 60 });
const weekWith = trainings => ({
  targetTSS: Object.values(trainings).reduce((a, b) => a + b, 0),
  sessions: DAYS.map((_, i) => (trainings[i] != null ? ride(i, trainings[i]) : rest(i))),
});

describe('TrainingPlanGenerator._detectCycleWeek', () => {
  const activityDaysAgo = (days, tss) => ({
    date: new Date(Date.now() - days * 86400000).toISOString().slice(0, 10),
    tss,
  });

  test('sin actividades empieza en la semana 1, no en una semana de recuperación', () => {
    const c = TrainingPlanGenerator._detectCycleWeek([]);
    expect(c.weekInCycle).toBe(1);
    expect(c.isRecoveryWeek).toBe(false);
    expect(c.loadMultiplier).toBe(1);
  });

  test('una sola semana entrenada no se confunde con tres semanas de carga', () => {
    const c = TrainingPlanGenerator._detectCycleWeek([activityDaysAgo(2, 100)]);
    expect(c.isRecoveryWeek).toBe(false);
  });

  test('sigue programando recuperación tras semanas reales de carga consecutivas', () => {
    const c = TrainingPlanGenerator._detectCycleWeek([
      activityDaysAgo(2, 300), activityDaysAgo(9, 300), activityDaysAgo(16, 300), activityDaysAgo(23, 300),
    ]);
    expect(c.isRecoveryWeek).toBe(true);
    expect(c.weekInCycle).toBe(4);
  });
});

describe('TrainingPlanGenerator.adaptFirstWeek', () => {
  test('no deja sesiones en días anteriores a hoy y conserva las siguientes', () => {
    const plan = weekWith({ 1: 40, 3: 50, 5: 60 });
    TrainingPlanGenerator.adaptFirstWeek(plan, 3);
    expect(plan.sessions[1].isRest).toBe(true);
    expect(plan.sessions[3].tss).toBe(50);
    expect(plan.sessions[5].tss).toBe(60);
  });

  test('el objetivo semanal pasa a ser solo lo que queda por hacer', () => {
    const plan = weekWith({ 1: 40, 3: 50, 5: 60 });
    TrainingPlanGenerator.adaptFirstWeek(plan, 3);
    expect(plan.targetTSS).toBe(110);
    const shares = plan.sessions.filter(s => !s.isRest).reduce((sum, s) => sum + s.tssShare, 0);
    expect(shares).toBeCloseTo(1, 5);
  });

  test('si hoy toca descanso, adelanta la próxima sesión manteniendo el día de cada posición', () => {
    const plan = weekWith({ 5: 60 });
    TrainingPlanGenerator.adaptFirstWeek(plan, 3);
    expect(plan.sessions[3].isRest).toBeFalsy();
    expect(plan.sessions[3].day).toBe('Jueves');
    expect(plan.sessions[3].tss).toBe(60);
    expect(plan.sessions[5].isRest).toBe(true);
    expect(plan.sessions[5].day).toBe('Sábado');
  });

  test('el domingo, sin nada por delante, recupera la última sesión pasada para hoy', () => {
    const plan = weekWith({ 1: 40, 4: 70 });
    TrainingPlanGenerator.adaptFirstWeek(plan, 6);
    expect(plan.sessions[6].tss).toBe(70);
    expect(plan.sessions[6].day).toBe('Domingo');
    expect(plan.sessions.filter(s => !s.isRest)).toHaveLength(1);
    expect(plan.targetTSS).toBe(70);
  });

  test('el lunes con sesión hoy no altera el plan', () => {
    const plan = weekWith({ 0: 40, 3: 50 });
    const before = plan.sessions.map(s => [s.day, s.isRest, s.tss]);
    TrainingPlanGenerator.adaptFirstWeek(plan, 0);
    expect(plan.sessions.map(s => [s.day, s.isRest, s.tss])).toEqual(before);
    expect(plan.targetTSS).toBe(90);
  });

  test('calcula el TSS desde tssShare cuando la sesión no lo trae y no falla sin sesiones', () => {
    const plan = { targetTSS: 100, sessions: [{ day: 'Lunes', tssShare: 0.5 }, rest(1)] };
    TrainingPlanGenerator.adaptFirstWeek(plan, 0);
    expect(plan.sessions[0].tss).toBe(50);
    expect(plan.targetTSS).toBe(50);
    expect(() => TrainingPlanGenerator.adaptFirstWeek({}, 2)).not.toThrow();
  });
});

describe('TrainingPlanGenerator.generate sin historial', () => {
  test('presenta la primera semana sin hablar de semanas de carga previas', () => {
    window.AppState.pmcData = [];
    const plan = TrainingPlanGenerator.generate(
      { ftp: 155, weight: 62, weekly_hours: 6, days_per_week: 4, goal: 'resistencia', experience: 'principiante' },
      []
    );
    expect(plan.cycleInfo.isRecoveryWeek).toBe(false);
    expect(plan.adaptation.title).toBe('Tu primera semana');
  });
});
