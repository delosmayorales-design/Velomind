require('../js/app.js');
const { TrainingPlanGenerator } = window;

describe('TrainingPlanGenerator._getMacrocycleContext', () => {
  test('weeklyTSSTarget divide por el coeficiente de respuesta semanal del CTL (regresión)', () => {
    // Evento a 70 días (10 semanas) de "hoy" -- relativo al reloj real para que el test
    // no caduque con el tiempo.
    const eventDate = new Date(Date.now() + 70 * 86400000).toISOString().split('T')[0];
    const ftp = 280, weight = 70, currentCTL = 50;

    const ctx = TrainingPlanGenerator._getMacrocycleContext(eventDate, currentCTL, ftp, weight);

    // wkg=4 -> targetCTLAtEvent=85 ; ctlGap=35 ; weeksToEvent=10 -> neededRamp=3.5 -> feasibleRamp=3.5
    // weeklyTSSTarget = round((50 + 3.5/0.154) * 7) = 509
    expect(ctx.weeklyTSSTarget).toBe(509);
    // La fórmula vieja (sin dividir por el coeficiente) daba 375 -- confirma que el fix
    // realmente cambió el resultado y no quedó una regresión silenciosa.
    expect(ctx.weeklyTSSTarget).not.toBe(375);
  });

  test('en taper (<=3 semanas) no prescribe carga del macrociclo', () => {
    const eventDate = new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0];
    const ctx = TrainingPlanGenerator._getMacrocycleContext(eventDate, 50, 280, 70);
    expect(ctx.weeklyTSSTarget).toBeNull();
  });

  test('sin fecha de evento, devuelve un contexto vacío sin lanzar error', () => {
    const ctx = TrainingPlanGenerator._getMacrocycleContext(null, 50, 280, 70);
    expect(ctx.weeklyTSSTarget).toBeNull();
  });
});

describe('TrainingPlanGenerator._capAerobicIF', () => {
  test('endurance siempre topa a 0.68', () => {
    expect(TrainingPlanGenerator._capAerobicIF('endurance', 0.72)).toBeCloseTo(0.68, 2);
    expect(TrainingPlanGenerator._capAerobicIF('endurance', 0.60)).toBeCloseTo(0.60, 2);
  });
  test('long respeta hasta 0.72 (regresión: antes se recortaba a 0.68 igual que endurance)', () => {
    expect(TrainingPlanGenerator._capAerobicIF('long', 0.72)).toBeCloseTo(0.72, 2);
    expect(TrainingPlanGenerator._capAerobicIF('long', 0.70)).toBeCloseTo(0.70, 2);
  });
  test('long sigue topando por encima de 0.72', () => {
    expect(TrainingPlanGenerator._capAerobicIF('long', 0.85)).toBeCloseTo(0.72, 2);
  });
  test('tipos de calidad no se tocan aquí (su boost se aplica después)', () => {
    expect(TrainingPlanGenerator._capAerobicIF('threshold', 0.83)).toBeCloseTo(0.83, 2);
  });
});

describe('TrainingPlanGenerator._mainBlockWatts (badge de vatios)', () => {
  test('usa el bloque principal real, no un promedio plano ftp*ifTarget', () => {
    const intervals = [
      { label: 'Calentamiento', dur: '30 min', watts: '110–140 W' },
      { label: 'Series de umbral en una subida (×3 repeticiones)', dur: '24 min c/u', watts: '291–322 W' },
      { label: 'Recuperación activa (×2 repeticiones)', dur: '12 min c/u', watts: '155–170 W' },
      { label: 'Vuelta a la calma', dur: '24 min', watts: '< 186 W' },
    ];
    const watts = TrainingPlanGenerator._mainBlockWatts(intervals, 310, 0.83);
    expect(watts).toBe(Math.round((291 + 322) / 2)); // 307, no round(310*0.83)=257
    expect(watts).not.toBe(Math.round(310 * 0.83));
  });

  test('si no hay intervalos, cae al promedio ftp*ifTarget', () => {
    expect(TrainingPlanGenerator._mainBlockWatts([], 300, 0.7)).toBe(Math.round(300 * 0.7));
    expect(TrainingPlanGenerator._mainBlockWatts(null, 300, 0.7)).toBe(Math.round(300 * 0.7));
  });
});

describe('TrainingPlanGenerator._buildIntervals — calentamiento escalable (regresión)', () => {
  test('sesión de calidad corta (70 min) usa ~15 min de calentamiento, no 30', () => {
    const ivs = TrainingPlanGenerator._buildIntervals('threshold', 250, 70, 55, 0.85, 'main');
    const warm = ivs.find(iv => iv.label.includes('Calentamiento'));
    expect(warm).toBeTruthy();
    expect(parseInt(warm.dur, 10)).toBeLessThan(30);
  });

  test('sesión de calidad larga (150 min, el máximo) sigue llegando a 30 min de calentamiento', () => {
    const ivs = TrainingPlanGenerator._buildIntervals('threshold', 250, 150, 120, 0.85, 'main');
    const warm = ivs.find(iv => iv.label.includes('Calentamiento'));
    expect(parseInt(warm.dur, 10)).toBe(30);
  });
});
