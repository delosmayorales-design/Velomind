jest.mock('../../db', () => ({}));
const { buildInsights } = require('../../routes/coach');

const base = { tsb: 0, ctl: 0, ftp: 155, weight: 62, zonePct: [0, 0, 0, 0, 0, 0, 0], avgTSS: 0, avgDurMin: 0, goal: 'resistencia' };

describe('buildInsights', () => {
  test('sin salidas no opina sobre duración, potencia ni nivel', () => {
    const insights = buildInsights({ ...base, acts: [] });
    expect(insights).toHaveLength(1);
    expect(insights[0].text).toMatch(/Todavía no hay salidas/);
  });

  test('con salidas mantiene el diagnóstico habitual', () => {
    const insights = buildInsights({ ...base, ctl: 40, avgDurMin: 30, acts: [{ tss: 50 }] });
    const text = insights.map(i => i.text).join(' ');
    expect(text).toMatch(/nivel intermedio sólido/);
    expect(text).toMatch(/Duración media 30min/);
    expect(text).toMatch(/W\/kg FTP/);
  });
});
