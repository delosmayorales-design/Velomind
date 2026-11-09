const { estimateVo2max } = require('../../services/vo2max');

const now = new Date('2026-11-09T12:00:00Z');
const ride = (date, watts) => ({ date, best_efforts: { 300: watts } });

describe('estimateVo2max', () => {
  test('usa la mejor potencia real de 5 min de los últimos 90 días', () => {
    const result = estimateVo2max({
      activities: [ride('2026-10-01', 280), ride('2026-10-20', 300)],
      ftp: 250, weight: 75, now,
    });
    expect(result.value).toBe(52); // 16.6 + 8.87 × 4 W/kg
    expect(result.method).toBe('power5');
    expect(result.power5).toEqual({ watts: 300, date: '2026-10-20' });
  });

  test('ignora esfuerzos fuera de la ventana de 90 días', () => {
    const result = estimateVo2max({
      activities: [ride('2026-01-10', 400), ride('2026-10-20', 300)],
      ftp: 250, weight: 75, now,
    });
    expect(result.power5.watts).toBe(300);
  });

  test('sin esfuerzo máximo reciente recurre al FTP y lo indica', () => {
    const result = estimateVo2max({
      activities: [ride('2026-10-20', 240)], ftp: 250, weight: 75, now,
    });
    expect(result.method).toBe('ftp');
    expect(result.value).toBe(52); // 250 × 1.2 = 300 W
    expect(result.power5).toBeNull();
    expect(result.history).toEqual([]);
  });

  test('descarta picos imposibles del potenciómetro', () => {
    const result = estimateVo2max({
      activities: [ride('2026-10-20', 900), ride('2026-10-21', 300)],
      ftp: 250, weight: 75, now,
    });
    expect(result.power5.watts).toBe(300);
  });

  test('actividades sin best_efforts no cuentan como esfuerzo real', () => {
    const result = estimateVo2max({
      activities: [{ date: '2026-10-20', best_efforts: null }, { date: '2026-10-21' }],
      ftp: 250, weight: 75, now,
    });
    expect(result.method).toBe('ftp');
  });

  test('sin FTP funciona si hay potencia de 5 min real', () => {
    const result = estimateVo2max({ activities: [ride('2026-10-20', 300)], weight: 75, now });
    expect(result.method).toBe('power5');
  });

  test('sin peso, o sin FTP ni potencia, no inventa un valor', () => {
    expect(estimateVo2max({ activities: [ride('2026-10-20', 300)], ftp: 250, now })).toBeNull();
    expect(estimateVo2max({ activities: [], weight: 75, now })).toBeNull();
    expect(estimateVo2max({ activities: [], ftp: NaN, weight: NaN, now })).toBeNull();
  });

  test('el histórico es una ventana móvil y su último punto coincide con el valor actual', () => {
    const result = estimateVo2max({
      activities: [ride('2026-03-15', 270), ride('2026-10-20', 300)],
      ftp: 250, weight: 75, now,
    });
    const months = result.history.map(p => p.month);
    expect(months).toEqual(expect.arrayContaining(['2026-03', '2026-05', '2026-10', '2026-11']));
    expect(months).not.toContain('2026-07');
    expect(result.history[result.history.length - 1].value).toBe(result.value);
  });
});
