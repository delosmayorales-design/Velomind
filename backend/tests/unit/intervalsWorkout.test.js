const { stepsToIntervalsText } = require('../../services/intervalsWorkout');

const warm = { name: 'Calentamiento', sec: 600, intensity: 2, lo: 140, hi: 175 };
const work = (n) => ({ name: `Serie ${n}/3`, sec: 300, intensity: 0, lo: 265, hi: 290 });
const rest = { name: 'Recuperacion', sec: 180, intensity: 1, lo: 110, hi: 130 };
const cool = { name: 'Enfriamiento', sec: 600, intensity: 3, lo: 115, hi: 150 };

describe('stepsToIntervalsText', () => {
  test('agrupa series y recuperaciones, sin colar los números de las etiquetas', () => {
    const text = stepsToIntervalsText([warm, work(1), rest, work(2), rest, work(3), cool]);
    expect(text).toBe([
      '- 10m 140-175w',
      '2x\n- 5m 265-290w\n- 3m 110-130w',
      '- 5m 265-290w\n- 10m 115-150w',
    ].join('\n\n'));
  });

  test('formatea horas, minutos y segundos', () => {
    expect(stepsToIntervalsText([{ sec: 5400, lo: 180, hi: 200 }])).toBe('- 1h30m 180-200w');
    expect(stepsToIntervalsText([{ sec: 90, lo: 300, hi: 300 }])).toBe('- 1m30s 300w');
  });

  test('descarta alertas de nutrición y pasos sin duración', () => {
    const text = stepsToIntervalsText([
      warm,
      { name: 'GEL/BARRITA', sec: 30, lo: 0, hi: 0, isAlert: true },
      { name: 'Abierto', open: true, lo: 0, hi: 0 },
    ]);
    expect(text).toBe('- 10m 140-175w');
  });

  test('un rodaje continuo queda como un solo paso y una entrada vacía no genera texto', () => {
    expect(stepsToIntervalsText([{ sec: 3600, lo: 150, hi: 180 }])).toBe('- 1h 150-180w');
    expect(stepsToIntervalsText([])).toBe('');
    expect(stepsToIntervalsText(undefined)).toBe('');
  });
});
