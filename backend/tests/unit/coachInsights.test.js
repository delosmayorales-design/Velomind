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

describe('buildInsights — aviso de Z3/Z4 ("zona gris")', () => {
  const acts = [{ tss: 60 }];
  const pol = ins => ins.find(i => i.type === 'polarization');

  test('con reparto solo estimado no avisa, aunque la Z3 parezca alta', () => {
    const insights = buildInsights({ ...base, ctl: 40, acts, zonePct: [0, 10, 20, 50, 15, 5, 0, 0] });
    expect(pol(insights)).toBeUndefined();
  });

  test('con pocas salidas con datos reales tampoco avisa', () => {
    const zoneQuality = { realCount: 3, realPct: [0, 10, 20, 50, 15, 5, 0, 0] };
    expect(pol(buildInsights({ ...base, ctl: 40, acts, zoneQuality }))).toBeUndefined();
  });

  test('con datos reales y mucha Z3/Z4 avisa sin contradecir al plan', () => {
    const zoneQuality = { realCount: 8, realPct: [0, 10, 25, 45, 15, 5, 0, 0] };
    const p = pol(buildInsights({ ...base, ctl: 40, acts, zoneQuality }));
    expect(p).toBeDefined();
    expect(p.text).toMatch(/60%/);
    expect(p.text).toMatch(/sweet spot/);
    expect(p.text).toMatch(/rodajes suaves/);
    expect(p.text).not.toMatch(/Z5\+/);
    expect(p.text).toMatch(/116 W/); // 75% de un FTP de 155
  });

  test('con datos reales y una distribución razonable no avisa', () => {
    const zoneQuality = { realCount: 8, realPct: [0, 30, 40, 18, 7, 5, 0, 0] };
    expect(pol(buildInsights({ ...base, ctl: 40, acts, zoneQuality }))).toBeUndefined();
  });
});
