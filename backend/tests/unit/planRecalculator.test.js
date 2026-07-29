// jest.mock necesario incluso para probar solo los métodos estáticos "puros": el propio
// require de planRecalculator.js arrastra ../db, que llama a createClient(SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY) -- sin esas env vars (no seteadas en tests) el cliente real
// lanza al cargarse. Mismo patrón que backend/tests/routes/plans.test.js.
jest.mock('../../db', () => require('../helpers/mockSupabase'));

const PlanRecalculator = require('../../services/planRecalculator');

// ── Helpers de fecha ──────────────────────────────────────────────────────────
// _redistributeSessions calcula "hoy" internamente con `new Date()` real (no es un
// parámetro), así que para probarlo con fiabilidad hace falta anclar el weekStart al
// reloj real, no a fechas fijas -- si no, el test caduca o da falsos negativos según el
// día en que se ejecute. weekStartForTodayIdx(idx) devuelve el lunes tal que "hoy" cae
// exactamente en la posición `idx` (0=lunes..6=domingo) del array de sesiones, usando la
// misma aritmética de fechas (Date#setDate, hora local) que usa el propio código fuente.
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function weekStartForTodayIdx(todayIdx) {
  const d = new Date();
  d.setDate(d.getDate() - todayIdx);
  return ymd(d);
}
function dateForIdx(weekStart, idx) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + idx);
  return ymd(d); // fecha LOCAL -- igual que PlanRecalculator._localDateStr tras el fix
}
const todayReal = () => ymd(new Date());

function makeSession(overrides = {}) {
  return {
    type: 'endurance', name: 'Resistencia Z2', durationMin: 90, tss: 60, ifTarget: 0.65,
    ...overrides,
  };
}
function restSession() {
  return { isRest: true, type: 'recovery', name: 'Descanso', durationMin: 0, tss: 0 };
}

// ════════════════════════════════════════════════════════════════════════════
// _computeDeltas — comparación planificado vs real por día
// ════════════════════════════════════════════════════════════════════════════
describe('PlanRecalculator._computeDeltas', () => {
  const weekStart = '2026-01-05'; // lunes fijo -- aquí "today" es un parámetro, no toca el reloj real
  const sessions = [
    makeSession({ tss: 100 }), // lunes
    makeSession({ tss: 80 }),  // martes
    makeSession({ tss: 60 }),  // miércoles (hoy)
    makeSession({ tss: 90 }),  // jueves (futuro)
    makeSession({ tss: 90 }),  // viernes
    makeSession({ tss: 150 }), // sábado
    restSession(),             // domingo
  ];
  const today = '2026-01-07'; // miércoles

  test('un día con mucho más TSS real del planificado entra en exceedingDays', () => {
    const real = { '2026-01-05': 100, '2026-01-06': 200, '2026-01-07': 60 }; // martes se disparó
    const d = PlanRecalculator._computeDeltas(sessions, real, weekStart, today);
    expect(d.exceedingDays).toEqual(expect.arrayContaining([expect.objectContaining({ date: '2026-01-06', delta: 120 })]));
    expect(d.reason).toBe('exceeded_target');
  });

  test('un día pasado sin ninguna actividad entra en missingDays', () => {
    const real = { '2026-01-05': 100, '2026-01-06': 0, '2026-01-07': 60 };
    const d = PlanRecalculator._computeDeltas(sessions, real, weekStart, today);
    expect(d.missingDays).toEqual(expect.arrayContaining([expect.objectContaining({ date: '2026-01-06' })]));
    expect(d.reason).toBe('missed_sessions');
  });

  test('hoy sin actividad TODAVÍA (real=0) se omite del cálculo -- no cuenta como perdida', () => {
    const real = { '2026-01-05': 100, '2026-01-06': 80 }; // hoy (miércoles) sin registrar aún
    const d = PlanRecalculator._computeDeltas(sessions, real, weekStart, today);
    expect(d.byDay['2026-01-07']).toBeUndefined();
    expect(d.missingDays.find(m => m.date === '2026-01-07')).toBeUndefined();
  });

  test('sin excesos ni sesiones perdidas pero con desviación total >30 -> significant_deviation', () => {
    // Todos los días por DEBAJO de lo planificado (pero sin llegar a 0, así no cuentan
    // como "missingDays") y ningún día individual por encima (así no cuentan como
    // "exceedingDays") -- solo el acumulado (-55) dispara la desviación significativa.
    const real = { '2026-01-05': 80, '2026-01-06': 60, '2026-01-07': 45 };
    const d = PlanRecalculator._computeDeltas(sessions, real, weekStart, today);
    expect(d.exceedingDays).toHaveLength(0);
    expect(d.missingDays).toHaveLength(0);
    expect(d.reason).toBe('significant_deviation');
  });

  test('todo dentro de tolerancia -> on_track', () => {
    const real = { '2026-01-05': 100, '2026-01-06': 80, '2026-01-07': 60 };
    const d = PlanRecalculator._computeDeltas(sessions, real, weekStart, today);
    expect(d.reason).toBe('on_track');
    expect(d.totalDelta).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// _shouldAdapt — cuándo dispara la recalculación automática
// ════════════════════════════════════════════════════════════════════════════
describe('PlanRecalculator._shouldAdapt', () => {
  const base = { exceedingDays: [], missingDays: [], totalDelta: 0 };

  test('exceso de +40 en un día dispara recalculo', () => {
    expect(PlanRecalculator._shouldAdapt({ ...base, exceedingDays: [{ date: 'x', delta: 45 }] }, {})).toBe(true);
  });
  test('exceso de +40 exacto NO dispara (umbral estrictamente mayor)', () => {
    expect(PlanRecalculator._shouldAdapt({ ...base, exceedingDays: [{ date: 'x', delta: 40 }] }, {})).toBe(false);
  });
  test('sesión perdida de más de 50 TSS dispara recalculo', () => {
    expect(PlanRecalculator._shouldAdapt({ ...base, missingDays: [{ date: 'x', delta: -60 }] }, {})).toBe(true);
  });
  test('desviación total de más de 50 dispara recalculo aunque ningún día individual la supere', () => {
    expect(PlanRecalculator._shouldAdapt({ ...base, totalDelta: 55 }, {})).toBe(true);
  });
  test('TSB < -20 (fatiga acumulada) dispara recalculo aunque no haya ninguna desviación', () => {
    expect(PlanRecalculator._shouldAdapt(base, { tsb: -21 })).toBe(true);
  });
  test('TSB exactamente -20 NO dispara (umbral estrictamente menor)', () => {
    expect(PlanRecalculator._shouldAdapt(base, { tsb: -20 })).toBe(false);
  });
  test('TSB -25 dispara recalculo -- zona que antes (umbral -30) el plan ignoraba pese al aviso de fatiga del dashboard', () => {
    expect(PlanRecalculator._shouldAdapt(base, { tsb: -25 })).toBe(true);
  });
  test('todo dentro de umbrales -> no recalcula', () => {
    expect(PlanRecalculator._shouldAdapt({ ...base, exceedingDays: [{ date: 'x', delta: 10 }], totalDelta: 20 }, { tsb: 5 })).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// _hasCapacityViolation — auto-detección de sesiones/semana corruptas por un bug previo
// ════════════════════════════════════════════════════════════════════════════
describe('PlanRecalculator._hasCapacityViolation', () => {
  const weekStart = '2026-01-05';
  const today = '2026-01-07'; // miércoles (idx 2)

  test('una sesión futura por encima de su tope físico (×1.1) es violación', () => {
    const sessions = [makeSession(), makeSession(), makeSession(), makeSession({ type: 'threshold', tss: 140 }), makeSession(), makeSession(), restSession()];
    // threshold cap=115 -> 140 > 115*1.1=126.5
    expect(PlanRecalculator._hasCapacityViolation(sessions, today, weekStart, 400)).toBe(true);
  });

  test('una caminata inflada a más del doble de su duración por defecto es violación', () => {
    const sessions = [makeSession(), makeSession(), makeSession(), { type: 'walking', durationMin: 149, tss: 60 }, makeSession(), makeSession(), restSession()];
    expect(PlanRecalculator._hasCapacityViolation(sessions, today, weekStart, 400)).toBe(true);
  });

  test('la suma semanal desviada >15% del objetivo declarado es violación aunque cada sesión sea razonable', () => {
    const sessions = Array(7).fill(null).map(() => makeSession({ tss: 100 })); // 700 TSS
    expect(PlanRecalculator._hasCapacityViolation(sessions, today, weekStart, 400)).toBe(true); // 700 vs 400 -> +75%
  });

  test('semana normal, ninguna sesión ni el total fuera de rango -> no hay violación', () => {
    const sessions = [makeSession({ tss: 60 }), makeSession({ tss: 60 }), makeSession({ tss: 60 }), makeSession({ tss: 60 }), makeSession({ tss: 60 }), makeSession({ tss: 100 }), restSession()];
    expect(PlanRecalculator._hasCapacityViolation(sessions, today, weekStart, 400)).toBe(false);
  });

  test('una sesión de un día PASADO con exceso NO cuenta como violación (no se tocan días ya vividos)', () => {
    const sessions = [makeSession({ type: 'threshold', tss: 999 }), makeSession(), makeSession(), makeSession(), makeSession(), makeSession(), restSession()];
    // idx 0 (lunes) es pasado respecto a today=miércoles. weeklyTarget=0 desactiva a
    // propósito el chequeo de "suma semanal desviada" para aislar solo la regla de
    // "días pasados no cuentan" (si no, el 999 también dispararía esa otra regla).
    expect(PlanRecalculator._hasCapacityViolation(sessions, today, weekStart, 0)).toBe(false);
  });

  test('una sesión YA COMPLETADA con exceso no cuenta como violación (no se reescribe lo ya hecho)', () => {
    const sessions = [makeSession(), makeSession(), makeSession(), makeSession({ type: 'threshold', tss: 999, completed: true }), makeSession(), makeSession(), restSession()];
    expect(PlanRecalculator._hasCapacityViolation(sessions, today, weekStart, 0)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// _sanitizeStoredSessions — reparación de sesiones corruptas por un bug previo de reparto
// ════════════════════════════════════════════════════════════════════════════
describe('PlanRecalculator._sanitizeStoredSessions', () => {
  test('repara una sesión de umbral con TSS muy por encima de su tope (115) de forma coherente con su duración', () => {
    const sessions = [makeSession({ type: 'threshold', tss: 172, durationMin: 150, ifTarget: 0.83 })];
    const { sessions: fixed, changed } = PlanRecalculator._sanitizeStoredSessions(sessions);
    expect(changed).toBe(true);
    expect(fixed[0].tss).toBeLessThanOrEqual(115 * 1.1);
    // El TSS final debe corresponder matemáticamente a la duración final (mismo IF), no quedar desacoplado
    const expectedTSS = Math.round((fixed[0].durationMin / 60) * Math.pow(0.83, 2) * 100);
    expect(fixed[0].tss).toBe(expectedTSS);
  });

  test('repara una caminata inflada a su duración/TSS por defecto', () => {
    const sessions = [{ type: 'walking', durationMin: 149, tss: 90 }];
    const { sessions: fixed, changed } = PlanRecalculator._sanitizeStoredSessions(sessions);
    expect(changed).toBe(true);
    expect(fixed[0].durationMin).toBe(40);
    expect(fixed[0].tss).toBe(15);
  });

  test('elimina flags "zombie" _tssExcess/_excessOrig que nunca deberían persistir en el backend', () => {
    const sessions = [makeSession({ _tssExcess: true, _excessOrig: { tss: 999 } })];
    const { sessions: fixed, changed } = PlanRecalculator._sanitizeStoredSessions(sessions);
    expect(changed).toBe(true);
    expect(fixed[0]._tssExcess).toBeUndefined();
    expect(fixed[0]._excessOrig).toBeUndefined();
  });

  test('una sesión normal sin problemas no se toca', () => {
    const sessions = [makeSession({ tss: 60 }), restSession()];
    const { sessions: fixed, changed } = PlanRecalculator._sanitizeStoredSessions(sessions);
    expect(changed).toBe(false);
    expect(fixed).toEqual(sessions);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// _redistributeSessions — reparto de TSS restante en los días futuros
// (usa el reloj real internamente, por eso el weekStart se ancla al día de hoy)
// ════════════════════════════════════════════════════════════════════════════
describe('PlanRecalculator._redistributeSessions', () => {
  // Reloj fijado a mediodía hora local: _redistributeSessions calcula "hoy" con
  // `new Date().toISOString()...` (SIEMPRE en UTC), mientras que el resto de fechas de
  // este mismo archivo se construyen en hora LOCAL -- correr estos tests sin fijar el
  // reloj era intermitente (fallaban de madrugada, ~00:00-02:00 hora de Madrid en
  // verano, justo cuando el día UTC todavía va por "ayer"). Ver también el test de
  // "HALLAZGO QA" al final de este describe, que documenta ese mismo desajuste como un
  // bug real de la app, no solo un problema de los tests.
  beforeEach(() => { jest.useFakeTimers({ advanceTimers: false }).setSystemTime(new Date(2026, 2, 11, 12, 0, 0)); });
  afterEach(() => { jest.useRealTimers(); });

  test('usuario por DEBAJO del objetivo (sesiones perdidas): los días futuros se escalan AL ALZA', async () => {
    const todayIdx = 3; // jueves
    const weekStart = weekStartForTodayIdx(todayIdx);
    const sessions = Array(7).fill(null).map(() => makeSession({ tss: 60, durationMin: 90 }));
    // Lunes-miércoles: solo se hicieron 30 de los 60 planificados cada día (mitad) -> vamos muy por detrás
    const real = {};
    for (let i = 0; i < todayIdx; i++) real[dateForIdx(weekStart, i)] = 30;

    const weeklyTarget = 420; // 7 días x 60
    const result = await PlanRecalculator._redistributeSessions(sessions, real, weekStart, {}, weeklyTarget);

    // doneTSS = 90 (3 dias x 30). Restante = 420-90=330 repartido entre jueves..domingo (4 días
    // ciclistas). No pinchamos un número exacto (hay redondeos por sesión al recalcular
    // TSS desde duración×IF²), solo la dirección e intención: debe acercarse al objetivo
    // restante, no quedarse en el plan original (4x60=240) ni dispararse muy por encima.
    const futureTSS = result.slice(todayIdx).reduce((s, x) => s + (x.tss || 0), 0);
    expect(futureTSS).toBeGreaterThan(240); // más que si se mantuviera el plan original: confirma que SÍ compensa al alza
    expect(futureTSS).toBeGreaterThan(300);
    expect(futureTSS).toBeLessThan(370);
  });

  test('usuario por ENCIMA del objetivo: los días futuros se recortan, nunca por debajo de 70 min', async () => {
    const todayIdx = 3;
    const weekStart = weekStartForTodayIdx(todayIdx);
    const sessions = Array(7).fill(null).map(() => makeSession({ tss: 60, durationMin: 90 }));
    const real = {};
    for (let i = 0; i < todayIdx; i++) real[dateForIdx(weekStart, i)] = 100;

    const weeklyTarget = 420;
    const result = await PlanRecalculator._redistributeSessions(sessions, real, weekStart, {}, weeklyTarget);

    const futureSessions = result.slice(todayIdx);
    futureSessions.forEach(s => expect(s.durationMin).toBeGreaterThanOrEqual(70));
    const futureTSS = futureSessions.reduce((s, x) => s + (x.tss || 0), 0);
    expect(futureTSS).toBeLessThan(240); // se recorta respecto al plan original
  });

  test('FIX: objetivo restante EXACTAMENTE agotado (remainingTarget=0) también recorta los días futuros al mínimo, no los deja intactos', async () => {
    // Antes: cyclingTarget=0 desactivaba el reparto entero (guard `cyclingTarget > 0`) y
    // los días futuros se quedaban con su tamaño original sin recortar -- un salto brusco
    // justo en ese punto (con 1 TSS de margen sí se recortaba hasta el mínimo; con 0 TSS
    // de margen, nada se tocaba). Ahora el mismo caso cae por el camino normal de recorte.
    const todayIdx = 3;
    const weekStart = weekStartForTodayIdx(todayIdx);
    const weeklyTarget = 420;
    const sessions = Array(7).fill(null).map(() => makeSession({ tss: 60, durationMin: 90 }));
    const real = {};
    // Ya se hizo EXACTAMENTE el objetivo semanal completo antes de llegar a los días futuros.
    real[dateForIdx(weekStart, 0)] = weeklyTarget;

    const result = await PlanRecalculator._redistributeSessions(sessions, real, weekStart, {}, weeklyTarget);

    const futureSessions = result.slice(todayIdx);
    futureSessions.forEach(s => {
      expect(s.durationMin).toBe(70); // recortadas al suelo, no dejadas en su tamaño original (90 min)
      expect(s.tss).toBeLessThan(60);
    });
  });

  test('REGRESIÓN: si hoy YA tiene actividad real registrada, la sesión de hoy no se toca ni se convierte en descanso', async () => {
    const todayIdx = 6; // domingo -- mismo día de la semana que el bug reportado
    const weekStart = weekStartForTodayIdx(todayIdx);
    const sessions = Array(7).fill(null).map(() => makeSession({ tss: 60, durationMin: 90, name: 'Resistencia Z2' }));
    const real = { [dateForIdx(weekStart, todayIdx)]: 135 }; // hoy ya se hicieron 3.2h reales (~135 TSS), muy por encima de lo planificado

    const result = await PlanRecalculator._redistributeSessions(sessions, real, weekStart, {}, 420);

    // La sesión de "hoy" en el resultado debe ser EXACTAMENTE la misma que se pasó de entrada:
    // el backend nunca debe pintarla como "Descanso" ni tocar su contenido solo porque ya hay
    // TSS real -- esa reconciliación (mostrar lo que realmente se hizo) es responsabilidad del
    // frontend (syncPlanWithReality); el backend solo debe respetar que ese día "ya pasó".
    expect(result[todayIdx]).toEqual(sessions[todayIdx]);
    expect(result[todayIdx].isRest).not.toBe(true);
  });

  test('el cross-training futuro (gimnasio) mantiene su TSS fijo, no se re-escala con el factor ciclista', async () => {
    const todayIdx = 2;
    const weekStart = weekStartForTodayIdx(todayIdx);
    const sessions = Array(7).fill(null).map((_, i) =>
      i === 4 ? { type: 'gym', isGym: true, durationMin: 60, tss: 45 } : makeSession({ tss: 60, durationMin: 90 })
    );
    const real = {};
    for (let i = 0; i < todayIdx; i++) real[dateForIdx(weekStart, i)] = 0; // se saltó todo, por detrás del objetivo

    const result = await PlanRecalculator._redistributeSessions(sessions, real, weekStart, {}, 420);
    expect(result[4].tss).toBe(45);
    expect(result[4].durationMin).toBe(60);
  });

  test('fatiga acumulada (TSB < -20) reduce un 30% las sesiones futuras EXCEPTO recovery/descanso', async () => {
    const todayIdx = 2;
    const weekStart = weekStartForTodayIdx(todayIdx);
    const sessions = Array(7).fill(null).map((_, i) =>
      i === 5 ? { type: 'recovery', durationMin: 40, tss: 20, ifTarget: 0.6 } : makeSession({ tss: 100, durationMin: 100 })
    );
    const real = {};
    // weeklyTarget = suma exacta de lo ya planificado a futuro, INCLUYENDO hoy (idx
    // todayIdx): si hoy aún no tiene actividad real (real=0) el propio código lo trata
    // como "remaining", no como "ya vivido" -- se cuenta aquí también para que el factor
    // de reparto por objetivo dé exactamente 1 (no-op) y el test aísle limpiamente el
    // efecto de la regla de fatiga, sin mezclarlo con el reparto por objetivo (que aplica
    // el MISMO factor a TODAS las sesiones futuras, incluida la de recovery, y por tanto
    // puede inflarla o recortarla también -- eso se cubre en el test de "hallazgo" de abajo).
    const weeklyTarget = 100 /* hoy, idx2 */ + 100 + 100 + 20 + 100;

    const result = await PlanRecalculator._redistributeSessions(sessions, real, weekStart, { tsb: -21 }, weeklyTarget);

    // Sesión futura normal: reducida al 70%
    const normalFutureIdx = todayIdx + 1 === 5 ? todayIdx + 2 : todayIdx + 1;
    expect(result[normalFutureIdx].tss).toBe(Math.round(100 * 0.7));
    // Sesión de recovery: NO se reduce por la regla de fatiga
    expect(result[5].tss).toBe(20);
  });

  test('TSB -25 también reduce las sesiones futuras -- zona que con el umbral anterior (-30) el plan dejaba intacta', async () => {
    const todayIdx = 2;
    const weekStart = weekStartForTodayIdx(todayIdx);
    const sessions = Array(7).fill(null).map(() => makeSession({ tss: 100, durationMin: 100 }));
    const weeklyTarget = 100 * 5; // hoy + 4 futuros, factor de reparto neutro (no-op)

    const result = await PlanRecalculator._redistributeSessions(sessions, {}, weekStart, { tsb: -25 }, weeklyTarget);

    expect(result[todayIdx + 1].tss).toBe(Math.round(100 * 0.7));
  });

  test('TSB -15 NO reduce las sesiones futuras (dentro del umbral, igual que antes)', async () => {
    const todayIdx = 2;
    const weekStart = weekStartForTodayIdx(todayIdx);
    const sessions = Array(7).fill(null).map(() => makeSession({ tss: 100, durationMin: 100 }));
    const weeklyTarget = 100 * 5;

    const result = await PlanRecalculator._redistributeSessions(sessions, {}, weekStart, { tsb: -15 }, weeklyTarget);

    expect(result[todayIdx + 1].tss).toBe(100);
  });

  test('FIX: la fatiga acumulada (TSB < -20) NO toca los días ya PASADOS de la semana', async () => {
    // Antes: el recorte del 30% por fatiga iteraba sobre newSessions COMPLETO (los 7
    // días), incluidos los ya vividos -- su TSS/duración ya son un hecho consumado y
    // ninguna otra regla de este archivo se permite reescribirlos. Ahora solo toca los
    // días futuros/ajustables (el mismo conjunto que puede tocar el reparto por objetivo).
    const todayIdx = 3;
    const weekStart = weekStartForTodayIdx(todayIdx);
    const sessions = Array(7).fill(null).map(() => makeSession({ tss: 100, durationMin: 100 }));
    const real = {};
    for (let i = 0; i < todayIdx; i++) real[dateForIdx(weekStart, i)] = 80; // días ya vividos, con su TSS real

    const result = await PlanRecalculator._redistributeSessions(sessions, real, weekStart, { tsb: -35 }, 700);

    for (let i = 0; i < todayIdx; i++) {
      expect(result[i]).toEqual(sessions[i]); // intactos, pese a la fatiga crítica
    }
  });

  test('FIX: una sesión de recovery futura NUNCA se infla por el reparto de objetivo semanal, ni siquiera con mucho margen y TSB en fatiga', async () => {
    // Antes: la exención de recovery/descanso solo aplicaba al recorte del 30% por
    // fatiga, NO al reparto por objetivo semanal (que usaba el mismo factor para toda
    // sesión no-cross-training sin distinguir tipo) -- con margen de sobra en el
    // objetivo, una sesión de recovery pasaba de 40 a más de una hora el mismo día en que
    // el atleta estaba en fatiga. Ahora recovery/descanso se tratan como "fijos"
    // (igual que el cross-training) en AMBOS pasos, no solo en el de fatiga.
    const todayIdx = 2;
    const weekStart = weekStartForTodayIdx(todayIdx);
    const sessions = Array(7).fill(null).map((_, i) =>
      i === 5 ? { type: 'recovery', durationMin: 40, tss: 20, ifTarget: 0.6 } : makeSession({ tss: 100, durationMin: 100 })
    );
    const result = await PlanRecalculator._redistributeSessions(sessions, {}, weekStart, { tsb: -35 }, 700);
    expect(result[5].durationMin).toBe(40);
    expect(result[5].tss).toBe(20);
  });

  test('FIX: justo después de medianoche hora local (huso adelantado a UTC), el backend ya no cree que sigue siendo "ayer"', async () => {
    // Antes: _redistributeSessions calculaba "hoy" con
    // `new Date().toISOString().split('T')[0]` -- SIEMPRE en UTC -- mientras que las
    // fechas de cada sesión se derivaban sumando días a weekStart con aritmética LOCAL.
    // En un huso horario adelantado a UTC (p.ej. Europe/Madrid, UTC+2 en verano), entre
    // las 00:00 y la 02:00 hora local el reloj UTC todavía marcaba el día anterior, así
    // que la sesión de HOY (con actividad real ya registrada) se trataba como si aún no
    // hubiera llegado y podía tocarse. Se descubrió de forma orgánica: esta batería
    // empezó a fallar de madrugada real, sin tocar el código, hasta fijar el reloj.
    // Ahora todo el archivo usa PlanRecalculator._localDateStr (calendario local) de
    // forma consistente, así que esta hora ya no debería producir ningún desajuste.
    jest.setSystemTime(new Date(2026, 2, 11, 0, 30, 0)); // 11 marzo 00:30 hora local
    const todayIdx = 6; // domingo
    const weekStart = weekStartForTodayIdx(todayIdx);
    const sessions = Array(7).fill(null).map(() => makeSession({ tss: 60, durationMin: 90 }));
    const real = { [dateForIdx(weekStart, todayIdx)]: 135 }; // "hoy" (local) ya se hizo una salida real

    const result = await PlanRecalculator._redistributeSessions(sessions, real, weekStart, {}, 420);

    expect(result[todayIdx]).toEqual(sessions[todayIdx]); // intacta, igual que a cualquier otra hora del día
  });

  test('objetivo restante agotado (ya se hizo más que el objetivo semanal): no rompe ni produce NaN/negativos', async () => {
    const todayIdx = 1;
    const weekStart = weekStartForTodayIdx(todayIdx);
    const sessions = Array(7).fill(null).map(() => makeSession({ tss: 60, durationMin: 90 }));
    const real = { [dateForIdx(weekStart, 0)]: 500 }; // un solo día ya supera todo el objetivo semanal

    const result = await PlanRecalculator._redistributeSessions(sessions, real, weekStart, {}, 420);

    result.forEach(s => {
      expect(Number.isNaN(s.tss)).toBe(false);
      expect(s.tss).toBeGreaterThanOrEqual(0);
      if (typeof s.durationMin === 'number') expect(s.durationMin).toBeGreaterThanOrEqual(0);
    });
  });
});
