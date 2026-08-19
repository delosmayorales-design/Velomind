const { computeWBal } = require('../../services/wbal');

const CP = 250;
const W_PRIME = 20000;

describe('computeWBal', () => {
  test('potencia constante por debajo de CP — sin agotamiento, se mantiene en W\'', () => {
    const n = 600;
    const time = Array.from({ length: n }, (_, i) => i);
    const watts = Array.from({ length: n }, () => 200);
    const { wbal, minWbal } = computeWBal(time, watts, CP, W_PRIME);
    expect(minWbal).toBe(W_PRIME);
    expect(wbal.every(w => w === W_PRIME)).toBe(true);
  });

  test('potencia constante por encima de CP — agotamiento monótono, nunca <0', () => {
    const n = 400; // a 300W (50W sobre CP) durante 400s se agotarían 20000J exactos
    const time = Array.from({ length: n }, (_, i) => i);
    const watts = Array.from({ length: n }, () => 300);
    const { wbal, minWbal } = computeWBal(time, watts, CP, W_PRIME);
    for (let i = 1; i < wbal.length; i++) {
      expect(wbal[i]).toBeLessThanOrEqual(wbal[i - 1]);
    }
    expect(minWbal).toBeGreaterThanOrEqual(0);
    expect(minWbal).toBeLessThan(W_PRIME);
  });

  test('interválico: agotamiento en trabajo, recuperación parcial en descanso', () => {
    // 60s a 400W (agota), 120s a 100W (recupera), 60s a 400W (agota más)
    const time = [];
    const watts = [];
    for (let i = 0; i < 60; i++) { time.push(i); watts.push(400); }
    for (let i = 60; i < 180; i++) { time.push(i); watts.push(100); }
    for (let i = 180; i < 240; i++) { time.push(i); watts.push(400); }
    const { wbal, minWbal } = computeWBal(time, watts, CP, W_PRIME);

    const afterFirstWork = wbal[59];
    const afterRecovery = wbal[179];
    const afterSecondWork = wbal[239];

    expect(afterFirstWork).toBeLessThan(W_PRIME);
    expect(afterRecovery).toBeGreaterThan(afterFirstWork); // recuperó algo
    expect(afterRecovery).toBeLessThan(W_PRIME); // pero no del todo
    expect(afterSecondWork).toBeLessThan(afterRecovery); // el segundo esfuerzo agota de nuevo
    expect(minWbal).toBeGreaterThanOrEqual(0);
  });

  test('stream vacío o corto no lanza y devuelve serie vacía/mínima', () => {
    expect(computeWBal([], [], CP, W_PRIME)).toEqual({ time: [], wbal: [], minWbal: 0, pctDepleted: 0 });
    const single = computeWBal([0], [300], CP, W_PRIME);
    expect(single.time).toEqual([0]);
    expect(single.wbal).toEqual([W_PRIME]);
  });

  test('cp/wPrime inválidos devuelven serie vacía sin lanzar', () => {
    expect(computeWBal([0, 1, 2], [100, 200, 300], 0, W_PRIME)).toEqual({ time: [], wbal: [], minWbal: 0, pctDepleted: 0 });
    expect(computeWBal([0, 1, 2], [100, 200, 300], CP, -5)).toEqual({ time: [], wbal: [], minWbal: 0, pctDepleted: 0 });
  });
});
