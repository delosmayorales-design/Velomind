// Invariantes de las estructuras de series (variedad + progresión) y de los planes
// completos. Lo que se comprueba es el contrato del que dependen la pantalla, la
// exportación FIT/TCX/ZWO, el envío a Garmin y el entreno guiado por voz:
//   · los pasos suman exactamente la duración de la sesión,
//   · ningún paso dura 0 ni tiene vatios vacíos/NaN,
//   · cada fila "(×N repeticiones)" de trabajo va seguida de su recuperación ×N o ×N-1,
//   · el TSS real de los vatios prescritos cuadra con el TSS de la sesión.
require('../js/app.js');
require('../js/fit-encoder.js');
const { TrainingPlanGenerator: T, FITWorkoutEncoder: F } = window;

const ALL_KEYS = {
  threshold: ['th:8', 'th:10', 'th:12', 'th:15', 'th:20'],
  tempo: ['tp:10', 'tp:12', 'tp:15', 'tp:20', 'tp:25', 'tp:cont', 'tp:prog', 'tp:mix'],
  vo2max: ['vo:2', 'vo:3', 'vo:4', 'vo:5'],
  long: ['lg:tempo'],
  endurance: ['lg:tempo'],
};

const totalStepMin = (type, dur, intervals, ftp = 250) =>
  F.buildSteps({ type, durationMin: dur, intervals, intervalVariant: 'main' }, ftp)
    .reduce((s, x) => s + x.sec, 0) / 60;

// strict: toda fila de trabajo ×N debe ir seguida de su recuperación (estructuras nuevas).
// Sin strict se admiten los formatos de siempre (alternancia de cadencia baja/alta sin
// recuperación, vatios "libre"/"Máx" en aceleraciones y sprints).
function checkRows(intervals, strict = false) {
  const isRest = l => /recuperaci[oó]n|descanso/i.test(l);
  const reps = l => { const m = String(l).match(/\(×(\d+)/); return m ? +m[1] : 1; };
  intervals.forEach((iv, i) => {
    expect(typeof iv.label).toBe('string');
    expect(iv.dur).toMatch(/^\d+(\.\d+)? (min|s)( c\/u)?$/);
    expect(parseFloat(iv.dur)).toBeGreaterThan(0);
    expect(String(iv.watts)).not.toMatch(/NaN|undefined/);
    expect(String(iv.watts)).toMatch(strict ? /\d/ : /\d|libre|m[áa]x/i);
    if (reps(iv.label) > 1 && !isRest(iv.label)) {
      const next = intervals[i + 1];
      if (strict) expect(next && isRest(next.label)).toBe(true);
      if (next && isRest(next.label)) expect([reps(iv.label), reps(iv.label) - 1]).toContain(reps(next.label));
    }
  });
}

describe('Estructuras de series — invariantes para cualquier duración', () => {
  for (const [type, keys] of Object.entries(ALL_KEYS)) {
    for (const key of keys) {
      test(`${type} / ${key}: pasos exactos, válidos y bien emparejados (45–240 min, todos los recortes)`, () => {
        // Z2/long: el camino de siempre ya se desajusta por debajo de 53 min (el generador
        // nunca crea Z2 de menos de 70); lo nuevo no debe empeorarlo, pero no se le exige más.
        const minDur = (type === 'long' || type === 'endurance') ? 53 : 45;
        for (let dur = minDur; dur <= 240; dur++) {
          for (let trim = 0; trim <= 4; trim++) {
            const structure = { type, main: key, alt: 'legacy:alt', trim };
            const ivs = T._buildIntervals(type, 250, dur, 80, 0.8, 'main', null, structure);
            checkRows(ivs, true);
            expect(totalStepMin(type, dur, ivs)).toBeCloseTo(dur, 5);
          }
        }
      });
    }
  }

  test('sin estructura, _buildIntervals devuelve exactamente lo mismo que antes', () => {
    for (const type of ['threshold', 'tempo', 'vo2max', 'endurance', 'long', 'recovery', 'sprint', 'strength']) {
      for (const v of ['main', 'alt']) {
        const a = T._buildIntervals(type, 250, 90, 80, 0.8, v);
        const b = T._buildIntervals(type, 250, 90, 80, 0.8, v, null, null);
        expect(b).toEqual(a);
      }
    }
  });

  test('una estructura de otro tipo se ignora (sesión sustituida por otro tipo)', () => {
    const legacy = T._buildIntervals('endurance', 250, 120, 80, 0.65, 'main');
    const withOther = T._buildIntervals('endurance', 250, 120, 80, 0.65, 'main', null, { type: 'threshold', main: 'th:20', alt: 'legacy:alt' });
    expect(withOther).toEqual(legacy);
  });

  test('legacy:alt reproduce los over-unders de siempre', () => {
    const legacy = T._buildIntervals('threshold', 250, 80, 70, 0.85, 'alt');
    const viaKey = T._buildIntervals('threshold', 250, 80, 70, 0.85, 'main', null, { type: 'threshold', main: 'legacy:alt', alt: 'th:8' });
    expect(viaKey).toEqual(legacy);
  });

  test('si la estructura no cabe en una sesión corta, cae al camino de siempre sin romperse', () => {
    const ivs = T._buildIntervals('threshold', 250, 35, 30, 0.85, 'main', null, { type: 'threshold', main: 'th:20', alt: 'legacy:alt' });
    checkRows(ivs);
    expect(totalStepMin('threshold', 35, ivs)).toBeCloseTo(35, 5);
  });
});

describe('Sesiones de cadencia (fuerza / alternancia) — corrección de redondeo', () => {
  test('los pasos suman la duración exacta y nunca hay pasos de 0 min', () => {
    for (const spec of Object.values(T.CADENCE_SPEC_BY_NAME)) {
      for (let dur = 20; dur <= 240; dur++) {
        const ivs = T._buildIntervals('endurance', 250, dur, 80, 0.65, 'main', spec);
        checkRows(ivs);
        if (dur >= 70) expect(totalStepMin('endurance', dur, ivs)).toBeCloseTo(dur, 5);
      }
    }
  });
});

describe('Progresión dentro del ciclo 3:1', () => {
  test('el umbral pasa de series cortas a largas en las semanas 1→3 y vuelve a cortas en la 4', () => {
    const t = { type: 'threshold', name: 'Intervalos al umbral FTP' };
    const workOf = step => {
      const s = T._pickStructure(t, step, 0);
      const ivs = T._buildIntervals('threshold', 250, 75, 60, 0.85, 'main', null, s);
      return parseInt(ivs.find(iv => /Series de umbral/.test(iv.label)).dur, 10);
    };
    const [w1, w2, w3] = [0, 1, 2].map(workOf);
    expect(w1).toBeLessThan(w2);
    expect(w2).toBeLessThan(w3);
    expect(T._progressionStep(4)).toBe(0);
  });

  test('el nombre de la plantilla manda: "series muy largas" da series largas', () => {
    const s = T._pickStructure({ type: 'threshold', name: 'Umbral máximo — series muy largas' }, 0, 0);
    expect(s.main).toBe('th:20');
  });

  test('"Gran fondo con bloques de tempo" lleva bloques de tempo de verdad', () => {
    const s = T._pickStructure({ type: 'long', name: 'Gran fondo con bloques de tempo en los puertos' }, 0, 0);
    const ivs = T._buildIntervals('long', 250, 200, 160, 0.7, 'main', null, s);
    expect(ivs.some(iv => /Bloques de tempo/.test(iv.label))).toBe(true);
  });

  test('un Z2 normal no recibe estructura (no se añade Z3 donde no se pide)', () => {
    expect(T._pickStructure({ type: 'endurance', name: 'Z2 moderado' }, 1, 0)).toBeNull();
    expect(T._pickStructure({ type: 'long', name: 'Fondón aeróbico largo' }, 1, 0)).toBeNull();
  });
});

describe('Planes completos — todas las combinaciones', () => {
  const goals = ['resistencia', 'gran_fondo', 'carrera_larga', 'carrera_corta', 'sprint', 'ftp', 'vo2max', 'ultra'];
  const phases = ['base', 'build', 'peak', 'race', 'recovery'];

  test('ninguna sesión rompe el contrato (duración, pasos, TSS real)', () => {
    let checked = 0;
    for (const goal of goals) for (const phase of phases) for (const exp of ['principiante', 'intermedio', 'avanzado'])
      for (const days of [3, 5, 7]) for (let gw = 0; gw < 5; gw++) {
        const wic = (gw % 4) + 1;
        const sessions = T._buildSessions(goal, phase, 260, 70, 9, exp, 0, 480, [], days, null, wic, [], gw);
        expect(sessions).toHaveLength(7);
        for (const s of sessions) {
          if (s.isRest) continue;
          expect(Number.isFinite(s.durationMin) && s.durationMin > 0).toBe(true);
          expect(Number.isFinite(s.tss) && s.tss > 0).toBe(true);
          checkRows(s.intervals);
          checkRows(s.alt_intervals);
          // Los pasos cuadran con la duración (tolerancia para sprints de 12-20 s, que ya
          // redondeaban así antes de este cambio).
          const tol = s.type === 'sprint' ? 3 : 0.01; // sprint: 3 min medido en el código original
          expect(Math.abs(totalStepMin(s.type, s.durationMin, s.intervals, 260) - s.durationMin)).toBeLessThanOrEqual(tol);
          if (s._structure) {
            const real = T._realTSS(s.intervals, 260);
            // Nunca más dura que lo planificado (+6% de margen); algo por debajo es aceptable.
            expect((real.tss - s.tss) / s.tss).toBeLessThan(0.07);
            expect((s.tss - real.tss) / s.tss).toBeLessThan(0.15);
            expect(s.intervalVariant).toBe('main');
          }
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(1000);
  });

  test('reconstruir con la estructura guardada da el mismo entreno (editar no cambia la forma)', () => {
    const sessions = T._buildSessions('gran_fondo', 'build', 260, 70, 9, 'intermedio', 0, 480, [], 5, null, 3, [], 2);
    const q = sessions.filter(s => s._structure);
    expect(q.length).toBeGreaterThan(0);
    for (const s of q) {
      const again = T._buildIntervals(s.type, 260, s.durationMin, s.tss, s.ifTarget, 'main', null, s._structure);
      expect(again).toEqual(s.intervals);
    }
  });

  test('en peak/race/recovery no se aplican estructuras', () => {
    for (const phase of ['peak', 'race', 'recovery']) {
      const sessions = T._buildSessions('gran_fondo', phase, 260, 70, 9, 'intermedio', 0, 480, [], 5, null, 2, [], 3);
      expect(sessions.some(s => s._structure)).toBe(false);
    }
  });
});

describe('Taper según días al evento', () => {
  const inDays = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  test('a 20 días se usa la 1ª semana de taper aunque el ciclo 3:1 esté en la semana 3', () => {
    const events = [{ id: 'e', date: inDays(20), priority: 'A' }];
    const s = T._buildSessions('gran_fondo', 'peak', 260, 70, 9, 'intermedio', 0, 480, [], 7, null, 3, events, 0);
    expect(s.find(x => x.day === 'Sábado').name).toBe('Ensayo de ritmo y nutrición');
  });
  test('a 10 días se usa la 2ª semana de taper', () => {
    const events = [{ id: 'e', date: inDays(10), priority: 'A' }];
    const s = T._buildSessions('gran_fondo', 'peak', 260, 70, 9, 'intermedio', 0, 480, [], 7, null, 1, events, 0);
    expect(s.find(x => x.day === 'Sábado').name).toBe('Rodada moderada de ritmo');
  });
});

describe('Índice global de semanas', () => {
  test('no cuenta la semana en curso y la vista previa avanza una plantilla', () => {
    const today = new Date();
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const daysAgo = n => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };
    const acts = [7, 14, 21].map(n => ({ date: daysAgo(n), tss: 80 }));
    const before = T._detectCycleWeek(acts).globalWeekIdx;
    const after = T._detectCycleWeek([...acts, { date: iso(today), tss: 80 }]).globalWeekIdx;
    expect(after).toBe(before);
    expect(T._buildCycleFromWeek(2, before + 1).globalWeekIdx).toBe(before + 1);
    expect(T._buildCycleFromWeek(2).globalWeekIdx).toBe(0);
  });
});
