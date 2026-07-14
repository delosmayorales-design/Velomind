require('../js/app.js');
require('../js/fit-encoder.js');
const { FITWorkoutEncoder } = window;

describe('FITWorkoutEncoder.buildSteps — consume session.intervals (regresión anti-duplicación)', () => {
  test('intercala reps y recuperación igual que se ve en pantalla, y el total coincide con durationMin', () => {
    const session = {
      type: 'threshold',
      durationMin: 150,
      intervalVariant: 'main',
      intervals: [
        { label: 'Calentamiento', dur: '30 min', watts: '110–140 W' },
        { label: 'Series de umbral en una subida de ~24 min (×3 repeticiones)', dur: '24 min c/u', watts: '291–322 W' },
        { label: 'Recuperación activa (×2 repeticiones)', dur: '12 min c/u', watts: '155–170 W' },
        { label: 'Vuelta a la calma', dur: '24 min', watts: '< 186 W' },
      ],
    };

    const steps = FITWorkoutEncoder.buildSteps(session, 310);

    // 1 calentamiento + 3 reps de trabajo + 2 recuperaciones + 1 vuelta a la calma
    expect(steps).toHaveLength(7);
    expect(steps.filter(s => s.intensity === 0)).toHaveLength(3); // 3 reps de trabajo
    expect(steps.filter(s => s.name === 'Recuperacion')).toHaveLength(2);

    const totalMin = steps.reduce((sum, s) => sum + s.sec, 0) / 60;
    expect(totalMin).toBe(150);

    // Los nombres de los pasos de trabajo conservan el índice de repetición.
    const workNames = steps.filter(s => s.intensity === 0).map(s => s.name);
    expect(workNames[0]).toMatch(/1\/3$/);
    expect(workNames[2]).toMatch(/3\/3$/);
  });

  test('respeta los vatios reales de cada intervalo (no un valor plano de ftp*ifTarget)', () => {
    const session = {
      type: 'threshold', durationMin: 70, intervalVariant: 'main',
      intervals: [
        { label: 'Calentamiento', dur: '20 min', watts: '110–140 W' },
        { label: 'Intervalo al umbral en una subida', dur: '40 min', watts: '279–309 W' },
        { label: 'Vuelta a la calma', dur: '10 min', watts: '< 155 W' },
      ],
    };
    const steps = FITWorkoutEncoder.buildSteps(session, 310);
    const work = steps.find(s => s.intensity === 0);
    expect(work.lo).toBe(279);
    expect(work.hi).toBe(309);
  });

  test('sin session.intervals, cae al fallback simulado (no rompe la exportación)', () => {
    const session = { type: 'threshold', durationMin: 90, intervalVariant: 'main' };
    const steps = FITWorkoutEncoder.buildSteps(session, 250);
    expect(steps.length).toBeGreaterThan(0);
    const totalMin = steps.reduce((sum, s) => sum + s.sec, 0) / 60;
    expect(totalMin).toBe(90);
  });

  test('un día de descanso exporta un único paso abierto', () => {
    const steps = FITWorkoutEncoder.buildSteps({ isRest: true }, 250);
    expect(steps).toHaveLength(1);
    expect(steps[0].open).toBe(true);
  });
});
