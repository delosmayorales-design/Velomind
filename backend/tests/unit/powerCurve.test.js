const { extractBestEfforts } = require('../../services/powerCurve');

describe('extractBestEfforts', () => {
  test('arrays vacíos devuelven {}', () => {
    expect(extractBestEfforts([], [])).toEqual({});
  });

  test('watts todo null devuelve {}', () => {
    const time = Array.from({ length: 100 }, (_, i) => i);
    const watts = Array.from({ length: 100 }, () => null);
    expect(extractBestEfforts(time, watts)).toEqual({});
  });

  test('sin clave watts (no-ciclismo) no lanza y devuelve {}', () => {
    expect(extractBestEfforts([0, 1, 2], undefined)).toEqual({});
    expect(extractBestEfforts(undefined, undefined)).toEqual({});
  });

  test('stream más corto que toda duración objetivo devuelve {}', () => {
    const time = [0, 1, 2, 3];
    const watts = [200, 210, 220, 230];
    expect(extractBestEfforts(time, watts, [60, 300])).toEqual({});
  });

  test('potencia constante conocida — todas las duraciones cubiertas reportan ese valor', () => {
    const time = Array.from({ length: 1801 }, (_, i) => i);
    const watts = Array.from({ length: 1801 }, () => 250);
    const efforts = extractBestEfforts(time, watts, [5, 60, 300, 1800]);
    expect(efforts[5]).toBe(250);
    expect(efforts[60]).toBe(250);
    expect(efforts[300]).toBe(250);
    expect(efforts[1800]).toBe(250);
  });

  test('pico corto embebido: el slot de 5s lo recoge, el de 300s no se infla', () => {
    const total = 400;
    const time = Array.from({ length: total }, (_, i) => i);
    const watts = Array.from({ length: total }, (_, i) =>
      (i >= 200 && i < 205) ? 1000 : 300
    );
    const efforts = extractBestEfforts(time, watts, [5, 300]);
    expect(efforts[5]).toBeGreaterThanOrEqual(950);
    // 300s de ventana diluye el pico de 5s muchísimo: cerca de la base, lejos del pico
    expect(efforts[300]).toBeLessThan(400);
    expect(efforts[300]).toBeGreaterThanOrEqual(300);
  });

  test('hueco de pausa: ninguna ventana lo cruza como esfuerzo continuo', () => {
    // 300s a 300W, salto de pausa de 600s (sin muestras), luego 300s más a 300W.
    // Si el hueco se tratara como esfuerzo continuo, un "sprint" fabricado de
    // 900s podría aparecer; con el corte de segmento, el máximo real sigue siendo 300W.
    const time = [
      ...Array.from({ length: 301 }, (_, i) => i),
      ...Array.from({ length: 301 }, (_, i) => 900 + i),
    ];
    const watts = Array.from({ length: 602 }, () => 300);
    const efforts = extractBestEfforts(time, watts, [5, 60, 300]);
    expect(efforts[5]).toBe(300);
    expect(efforts[60]).toBe(300);
    expect(efforts[300]).toBe(300);
  });

  test('no lanza con arrays de distinta longitud', () => {
    expect(() => extractBestEfforts([0, 1, 2], [100, 200])).not.toThrow();
  });
});
