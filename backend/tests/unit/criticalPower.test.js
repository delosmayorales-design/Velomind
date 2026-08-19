jest.mock('../../db', () => require('../helpers/mockSupabase'));

const { fitCriticalPower } = require('../../services/criticalPower');

describe('fitCriticalPower', () => {
  test('recupera CP y W\' conocidos a partir de datos sintéticos limpios', () => {
    const CP = 250, W_PRIME = 20000;
    // P = CP + W'/t para t = 180, 300, 600, 1200
    const efforts = {
      180:  CP + W_PRIME / 180,
      300:  CP + W_PRIME / 300,
      600:  CP + W_PRIME / 600,
      1200: CP + W_PRIME / 1200,
    };
    const fit = fitCriticalPower(efforts);
    expect(fit).not.toBeNull();
    expect(fit.cp).toBeGreaterThanOrEqual(CP - 2);
    expect(fit.cp).toBeLessThanOrEqual(CP + 2);
    expect(fit.wPrime).toBeGreaterThanOrEqual(W_PRIME - 200);
    expect(fit.wPrime).toBeLessThanOrEqual(W_PRIME + 200);
    expect(fit.r2).toBeGreaterThan(0.99);
  });

  test('menos de 3 duraciones válidas devuelve null', () => {
    expect(fitCriticalPower({ 180: 400, 300: 350 })).toBeNull();
  });

  test('solo duraciones anaeróbicas (excluidas del ajuste) devuelve null', () => {
    expect(fitCriticalPower({ 5: 1000, 10: 900, 30: 700, 60: 500 })).toBeNull();
  });

  test('objeto vacío o inválido devuelve null sin lanzar', () => {
    expect(fitCriticalPower({})).toBeNull();
    expect(fitCriticalPower(null)).toBeNull();
    expect(fitCriticalPower(undefined)).toBeNull();
  });

  test('datos degenerados/inconsistentes (potencia no decreciente con t) devuelven null', () => {
    // Ruido totalmente inconsistente con el modelo — R² bajo, o pendiente/intercepto no positivos
    const efforts = { 180: 100, 300: 500, 600: 50, 1200: 600 };
    const fit = fitCriticalPower(efforts);
    expect(fit).toBeNull();
  });
});
