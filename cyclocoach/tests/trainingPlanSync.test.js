/**
 * Batería de QA sobre la lógica de reconciliación/adaptación de training-plan.html:
 * qué pasa cuando el usuario cambia el objetivo, cambia sus días de entreno, adapta una
 * sesión a mano, o simplemente sale a entrenar más (o menos) de lo planificado.
 *
 * Simula a un usuario real de VeloMind interactuando con el plan semanal; cada `describe`
 * cubre una de las funciones centrales de ese flujo. Ver cyclocoach/tests/_helpers/
 * loadTrainingPlanInline.js para cómo se carga el <script> real del HTML en el test.
 */
require('../js/app.js');
const { loadTrainingPlanInline } = require('./_helpers/loadTrainingPlanInline');

// ── Helpers de fecha: misma aritmética (hora LOCAL) que usa el propio script ──────────
function localYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function mondayDate() {
  const d = new Date();
  d.setDate(d.getDate() - (d.getDay() || 7) + 1);
  return d;
}
function todayIdx() {
  return (new Date().getDay() + 6) % 7; // Lunes=0 .. Domingo=6
}
function dateKeyForIdx(idx) {
  const d = mondayDate();
  d.setDate(d.getDate() + idx);
  return localYMD(d);
}
function todayKey() {
  return dateKeyForIdx(todayIdx());
}

// ── Helpers de datos ───────────────────────────────────────────────────────────────────
function session(overrides = {}) {
  return { type: 'endurance', name: 'Resistencia Z2', durationMin: 90, tss: 60, ifTarget: 0.65, day: 'Día', isRest: false, ...overrides };
}
function restSession(overrides = {}) {
  return { isRest: true, type: 'recovery', name: 'Descanso', durationMin: 0, tss: 0, day: 'Día', ...overrides };
}
function weekOf(fn) {
  return Array.from({ length: 7 }, (_, i) => fn(i));
}
function activity(dateKey, overrides = {}) {
  return { date: dateKey, tss: 60, duration: 3600, if_value: 0.65, name: 'Actividad', type: 'ride', ...overrides };
}

beforeEach(() => {
  loadTrainingPlanInline();
  // Aislar del DOM/red real: solo nos interesa la transformación de datos. Estas
  // funciones viven en el mismo scope de función que el resto del script (ver
  // loadTrainingPlanInline.js), así que se sustituyen vía __test.stub, no por simple
  // reasignación de window.<nombre> (que las funciones hermanas no verían).
  window.__test.stub('renderPlan', jest.fn());
  window.__test.stub('silentSavePlan', jest.fn().mockResolvedValue());
  window.__test.stub('showToast', jest.fn());
  window.__test.stub('showModal', jest.fn());
  window.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  window.AppState.activities = [];
  window.AppState.athlete = { ftp: 200, weight: 70, weekly_hours: 8, days_per_week: 5 };
  localStorage.clear();
});

// ════════════════════════════════════════════════════════════════════════════
// syncPlanWithReality — la actividad real siempre debe prevalecer
// ════════════════════════════════════════════════════════════════════════════
describe('syncPlanWithReality: la actividad real manda sobre cualquier "Descanso"', () => {
  test('REGRESIÓN (caso reportado): hoy se adaptó a mano a "Descanso" y luego el usuario sale a rodar 3.2h -> debe reflejar la actividad real, no seguir en Descanso', () => {
    const plan = {
      targetTSS: 400,
      sessions: weekOf(i => i === todayIdx()
        ? restSession({ _manualAdaptDay: todayIdx() }) // "descanso" fijado a mano (p.ej. vía IA aceptada)
        : session()),
    };
    window.__test.setCurrentPlan(plan);
    window.AppState.activities = [activity(todayKey(), { tss: 135, duration: 192 * 60, name: 'Rodaje largo' })];

    window.syncPlanWithReality();

    const today = window.__test.getCurrentPlan().sessions[todayIdx()];
    expect(today.isRest).toBe(false);
    expect(today.completed).toBe(true);
    expect(today.tss).toBe(135);
    expect(today.durationMin).toBe(192);
  });

  test('día de descanso ORIGINAL (no adaptado a mano) con actividad real hoy -> mismo resultado', () => {
    const plan = { targetTSS: 400, sessions: weekOf(i => (i === todayIdx() ? restSession() : session())) };
    window.__test.setCurrentPlan(plan);
    window.AppState.activities = [activity(todayKey(), { tss: 80, duration: 60 * 60 })];

    window.syncPlanWithReality();

    const today = window.__test.getCurrentPlan().sessions[todayIdx()];
    expect(today.isRest).toBe(false);
    expect(today.tss).toBe(80);
  });

  test('sesión de hoy cumplida dentro de tolerancia (diff TSS <=15) se marca completada sin generar aviso de desviación', () => {
    const plan = { targetTSS: 400, sessions: weekOf(i => (i === todayIdx() ? session({ tss: 60, type: 'endurance' }) : session())) };
    window.__test.setCurrentPlan(plan);
    window.AppState.activities = [activity(todayKey(), { tss: 65, if_value: 0.6 })]; // dentro de +-15

    window.syncPlanWithReality();

    const today = window.__test.getCurrentPlan().sessions[todayIdx()];
    expect(today.completed).toBe(true);
    expect(today.advice || '').not.toMatch(/Planificado:/);
  });

  test('sesión de un día PASADO sin ninguna actividad registrada se marca como perdida (_missed), no se inventa que se hizo', () => {
    const pastIdx = todayIdx() === 0 ? null : 0; // lunes, solo tiene sentido si hoy no es lunes
    if (pastIdx === null) return; // evitar falso negativo si el test corre en lunes
    const plan = { targetTSS: 400, sessions: weekOf(i => session()) };
    window.__test.setCurrentPlan(plan);
    window.AppState.activities = []; // nada registrado ningún día

    window.syncPlanWithReality();

    const past = window.__test.getCurrentPlan().sessions[pastIdx];
    expect(past._missed).toBe(true);
    expect(past.completed).toBe(false);
  });

  test('actividad complementaria (running) registrada en vez de la sesión de bici planificada hoy actualiza el tipo/nombre a lo real', () => {
    const plan = { targetTSS: 400, sessions: weekOf(i => (i === todayIdx() ? session({ type: 'threshold', name: 'Series de umbral' }) : session())) };
    window.__test.setCurrentPlan(plan);
    window.AppState.activities = [activity(todayKey(), { tss: 40, if_value: 0, type: 'running', name: 'Carrera matutina' })];

    window.syncPlanWithReality();

    const today = window.__test.getCurrentPlan().sessions[todayIdx()];
    expect(today.type).toBe('running');
    expect(today.name).toMatch(/Carrera matutina/);
  });

  test('hoy con actividad todavía muy por debajo del mínimo esperado no se toca (se espera a que termine)', () => {
    const plan = { targetTSS: 400, sessions: weekOf(i => (i === todayIdx() ? session({ durationMin: 90 }) : session())) };
    window.__test.setCurrentPlan(plan);
    window.AppState.activities = [activity(todayKey(), { tss: 3, duration: 5 * 60 })]; // 5 min de una sesión de 90

    window.syncPlanWithReality();

    const today = window.__test.getCurrentPlan().sessions[todayIdx()];
    expect(today.completed).toBeFalsy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// _applyWeekTSSExcessScaling — auto-recorte por exceso de carga semanal
// ════════════════════════════════════════════════════════════════════════════
describe('_applyWeekTSSExcessScaling: recorte automático por exceso, y su límite', () => {
  function weekWithExcess(devPct, todaySessOverrides = {}) {
    const targetTSS = 400;
    const actualTSS = Math.round(targetTSS * (1 + devPct / 100));
    window.AppState.activities = [activity(dateKeyForIdx(0), { tss: actualTSS })]; // toda la desviación de golpe el lunes
    return { targetTSS, sessions: weekOf(i => (i === todayIdx() ? session({ durationMin: 77, tss: 55, ...todaySessOverrides }) : session())) };
  }

  test('exceso >20%: la sesión de hoy (sin lock manual, sin completar) se convierte en Descanso', () => {
    const plan = weekWithExcess(25);
    const changed = window._applyWeekTSSExcessScaling(plan, todayIdx(), 200);
    expect(changed).toBe(true);
    expect(plan.sessions[todayIdx()].isRest).toBe(true);
  });

  test('REGRESIÓN: exceso >20% pero la sesión de hoy fue fijada a mano (_manualAdaptDay) -> NO se toca', () => {
    const plan = weekWithExcess(25, { _manualAdaptDay: todayIdx() });
    const before = { ...plan.sessions[todayIdx()] };
    window._applyWeekTSSExcessScaling(plan, todayIdx(), 200);
    expect(plan.sessions[todayIdx()]).toEqual(before);
  });

  test('sesión de hoy ya completada, con exceso >20% -> tampoco se toca', () => {
    const plan = weekWithExcess(25, { completed: true });
    const before = { ...plan.sessions[todayIdx()] };
    window._applyWeekTSSExcessScaling(plan, todayIdx(), 200);
    expect(plan.sessions[todayIdx()]).toEqual(before);
  });

  test('exceso entre 10% y 20%: se rebaja a "Recuperación activa", no a descanso total', () => {
    const plan = weekWithExcess(15);
    window._applyWeekTSSExcessScaling(plan, todayIdx(), 200);
    const today = plan.sessions[todayIdx()];
    expect(today.isRest).not.toBe(true);
    expect(today.type).toBe('recovery');
    expect(today.durationMin).toBeLessThanOrEqual(45);
  });

  test('sin exceso relevante (<=5%) no cambia nada', () => {
    const plan = weekWithExcess(3);
    const changed = window._applyWeekTSSExcessScaling(plan, todayIdx(), 200);
    expect(changed).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// saveAdaptation — aceptar una sugerencia de la IA / editar la sesión a mano
// ════════════════════════════════════════════════════════════════════════════
describe('saveAdaptation: "quiero hacer 3 horas" y otras decisiones manuales del usuario', () => {
  function setupAdaptCache(idx, t) {
    // saveAdaptation lee window.__test no expone _adaptCache como setter directo por
    // índice; se usa el objeto real devuelto por getAdaptCache().
    window.__test.getAdaptCache()[idx] = t;
  }

  test('el usuario pide "quiero hacer 3 horas" -> la sesión refleja esa duración y queda protegida (_manualAdaptDay)', async () => {
    const idx = todayIdx();
    const plan = { targetTSS: 400, sessions: weekOf(i => session()) };
    window.__test.setCurrentPlan(plan);
    setupAdaptCache(idx, { titulo: 'Rodaje largo', razon: 'A petición del usuario', duracion_min: 180, if_estimado: 0.65, tss_estimado: 130, recomendacion: 'aumentar', intensidad: 'z2' });

    await window.saveAdaptation(idx);

    const sess = window.__test.getCurrentPlan().sessions[idx];
    expect(sess.durationMin).toBe(180);
    expect(sess._manualAdaptDay).toBe(idx);
  });

  test('REGRESIÓN: tras guardar esa adaptación manual, un exceso semanal >20% ya NO puede recortarla', async () => {
    const idx = todayIdx();
    const plan = { targetTSS: 400, sessions: weekOf(i => session()) };
    window.__test.setCurrentPlan(plan);
    setupAdaptCache(idx, { titulo: 'Rodaje largo', razon: 'A petición del usuario', duracion_min: 180, if_estimado: 0.65, tss_estimado: 130, recomendacion: 'aumentar', intensidad: 'z2' });
    await window.saveAdaptation(idx);

    window.AppState.activities = [activity(dateKeyForIdx(0), { tss: 600 })]; // exceso brutal (>20%)
    window._applyWeekTSSExcessScaling(window.__test.getCurrentPlan(), todayIdx(), 200);

    const sess = window.__test.getCurrentPlan().sessions[idx];
    expect(sess.durationMin).toBe(180); // intacta
    expect(sess.isRest).not.toBe(true);
  });

  test('CADENA COMPLETA: aceptar "descanso" de la IA para HOY, y luego el usuario entrena de todos modos -> la actividad real prevalece', async () => {
    const idx = todayIdx();
    const plan = { targetTSS: 400, sessions: weekOf(i => session()) };
    window.__test.setCurrentPlan(plan);
    setupAdaptCache(idx, { titulo: 'Descanso', razon: 'Fatiga alta', recomendacion: 'descanso' });

    await window.saveAdaptation(idx);
    expect(window.__test.getCurrentPlan().sessions[idx].isRest).toBe(true);
    expect(window.__test.getCurrentPlan().sessions[idx]._manualAdaptDay).toBe(idx);

    // El usuario sale a entrenar de todos modos.
    window.AppState.activities = [activity(todayKey(), { tss: 135, duration: 192 * 60 })];
    window.syncPlanWithReality();

    const today = window.__test.getCurrentPlan().sessions[idx];
    expect(today.isRest).toBe(false);
    expect(today.tss).toBe(135);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// _applyActivitySubstitution — "voy a caminar / correr" en vez de la sesión de bici
// ════════════════════════════════════════════════════════════════════════════
describe('_applyActivitySubstitution: sustituir una sesión por otra actividad declarada', () => {
  test('sustituir una sesión ciclista futura por una caminata declarada de antemano queda protegida del auto-recorte', async () => {
    const futureIdx = todayIdx() < 6 ? todayIdx() + 1 : null;
    if (futureIdx === null) return; // hoy domingo, no hay día futuro esta semana
    const plan = { targetTSS: 400, sessions: weekOf(i => session()) };
    window.__test.setCurrentPlan(plan);

    const sub = { type: 'walking', isWalking: true, emoji: '🚶', name: 'Caminata activa', ifRef: 0.5, maxDur: 90, cycling: false };
    await window._applyActivitySubstitution(futureIdx, sub, 'mañana voy a caminar 40 min', true, null, null);

    const sess = window.__test.getCurrentPlan().sessions[futureIdx];
    expect(sess.isWalking).toBe(true);
    expect(sess._manualAdaptDay).toBe(futureIdx);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// overrideToRest / undoOverrideRest — marcar un día como descanso a mano
// ════════════════════════════════════════════════════════════════════════════
describe('overrideToRest / undoOverrideRest', () => {
  test('CASO EXACTO REPORTADO: el usuario marca HOY como descanso a mano y luego sale a rodar 3.2h -> debe verse la actividad real', () => {
    const idx = todayIdx();
    const plan = { targetTSS: 400, sessions: weekOf(i => session()) };
    window.__test.setCurrentPlan(plan);

    window.overrideToRest(idx);
    expect(window.__test.getCurrentPlan().sessions[idx].isRest).toBe(true);

    window.AppState.activities = [activity(todayKey(), { tss: 135, duration: 192 * 60 })];
    window.syncPlanWithReality();

    const today = window.__test.getCurrentPlan().sessions[idx];
    expect(today.isRest).toBe(false);
    expect(today.tss).toBe(135);
  });

  test('undoOverrideRest recupera exactamente la sesión original', () => {
    const idx = todayIdx();
    const original = session({ type: 'threshold', name: 'Series de umbral', tss: 90, durationMin: 75 });
    const plan = { targetTSS: 400, sessions: weekOf(i => (i === idx ? original : session())) };
    window.__test.setCurrentPlan(plan);

    window.overrideToRest(idx);
    window.undoOverrideRest(idx);

    const restored = window.__test.getCurrentPlan().sessions[idx];
    expect(restored.type).toBe('threshold');
    expect(restored.tss).toBe(90);
    expect(restored.durationMin).toBe(75);
    expect(restored.isRest).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// _regeneratePlanRespectingProgress / _rescaleRemainingSessions — cambiar objetivo o días
// ════════════════════════════════════════════════════════════════════════════
describe('_regeneratePlanRespectingProgress: cambiar el objetivo semanal o los días de entreno a mitad de semana', () => {
  test('REGRESIÓN: cambiar el objetivo con actividad real de HOY ya registrada (pero completed aún sin marcar) no sobrescribe el día de hoy', () => {
    const idx = todayIdx();
    const plan = { targetTSS: 400, sessions: weekOf(i => session({ name: `Sesión original ${i}` })) };
    window.__test.setCurrentPlan(plan);
    // Actividad real de hoy ya registrada, pero `completed` todavía no se marcó (el
    // escenario exacto del bug: una reconciliación pendiente no debe abrir la puerta a
    // que el generador reescriba hoy desde cero).
    window.AppState.activities = [activity(todayKey(), { tss: 135, duration: 192 * 60 })];

    window._regeneratePlanRespectingProgress(true);

    const today = window.__test.getCurrentPlan().sessions[idx];
    expect(today.name).toBe(`Sesión original ${idx}`); // intacta, no la reescribió el motor
  });

  test('sin actividad real hoy todavía, cambiar el objetivo SÍ puede regenerar la sesión de hoy (no roto por el fix)', () => {
    const idx = todayIdx();
    const plan = { targetTSS: 400, sessions: weekOf(i => session({ name: `Sesión original ${i}` })) };
    window.__test.setCurrentPlan(plan);
    window.AppState.activities = []; // nada hecho todavía hoy

    window._regeneratePlanRespectingProgress(true);

    const today = window.__test.getCurrentPlan().sessions[idx];
    expect(today.name).not.toBe(`Sesión original ${idx}`); // el motor la regeneró, como se espera
  });

  test('los días ya PASADOS de la semana nunca se tocan al regenerar, tengan o no completed', () => {
    const idx = todayIdx();
    if (idx === 0) return; // hace falta al menos un día pasado (no aplica en lunes)
    const plan = { targetTSS: 400, sessions: weekOf(i => session({ name: `Sesión original ${i}` })) };
    window.__test.setCurrentPlan(plan);
    window.AppState.activities = [];

    window._regeneratePlanRespectingProgress(true);

    for (let i = 0; i < idx; i++) {
      expect(window.__test.getCurrentPlan().sessions[i].name).toBe(`Sesión original ${i}`);
    }
  });
});

describe('_rescaleRemainingSessions: reparto del TSS restante entre los días futuros', () => {
  test('reparte (objetivo - hecho) entre los días futuros y nunca baja de 70 min por sesión', () => {
    const fromIdx = 3;
    const plan = { sessions: weekOf(() => session({ durationMin: 90, tss: 60 })) };
    const achieved = window._rescaleRemainingSessions(plan, fromIdx, 100 /* objetivo restante muy bajo */, 200);

    plan.sessions.slice(fromIdx).forEach(s => expect(s.durationMin).toBeGreaterThanOrEqual(70));
    expect(achieved).toBeLessThan(4 * 60); // menos que el plan original (4 días x 60 TSS)
  });
});
