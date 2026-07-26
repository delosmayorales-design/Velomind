/**
 * Extrae y ejecuta el <script> inline de training-plan.html en el contexto jsdom del test,
 * para poder probar su lógica (syncPlanWithReality, _applyWeekTSSExcessScaling,
 * saveAdaptation, etc.) sin duplicar el código a mano en los tests.
 *
 * training-plan.html no es un módulo: es un único <script> clásico con ~150 `function`
 * de nivel superior. En un <script> real de navegador esas declaraciones cuelgan del
 * objeto global (window); aquí replicamos eso con vm.runInThisContext(), que ejecuta el
 * texto como si fuera un <script> más en el mismo realm que ya expone jsdom (mismo truco
 * que "eval indirecto": los `function` de nivel superior quedan en `global`, y como jest
 * jsdom hace `global === window`, quedan accesibles como window.<nombre>).
 *
 * Dos bloques del script se auto-ejecutan al cargar (fuera de cualquier función) y no
 * tienen sentido en un test sin DOM real: la llamada a initTrainingPlan() (haría fetch
 * real y pintaría toda la pantalla) y la IIFE initPlanSidePanel() (referencia elementos
 * del DOM que no existen aquí y lanzaría). Se neutralizan quirúrgicamente por texto — si
 * el marcador exacto no aparece (p.ej. porque alguien renombró la función en el HTML),
 * esto lanza fuerte en vez de fallar en silencio con un harness desincronizado del fuente.
 */
const fs = require('fs');
const path = require('path');

function extractInlineScript(html) {
  const marker = '<script src="js/fit-encoder.js"></script>';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) throw new Error('[loadTrainingPlanInline] marcador previo al <script> inline no encontrado — ¿cambió training-plan.html?');

  const openIdx = html.indexOf('<script>', markerIdx);
  if (openIdx === -1) throw new Error('[loadTrainingPlanInline] no se encontró la apertura del <script> inline tras el marcador');

  const bodyStart = openIdx + '<script>'.length;
  const closeIdx = html.indexOf('</script>', bodyStart);
  if (closeIdx === -1) throw new Error('[loadTrainingPlanInline] no se encontró el cierre del <script> inline');

  return html.slice(bodyStart, closeIdx);
}

function neutralizeAutoRun(scriptText) {
  const initCall = 'initTrainingPlan().catch((e) => {';
  if (!scriptText.includes(initCall)) throw new Error('[loadTrainingPlanInline] no se encontró la llamada automática a initTrainingPlan() a neutralizar');
  let out = scriptText.replace(initCall, 'Promise.resolve().catch((e) => {');

  const sidePanelRe = /\(function initPlanSidePanel\(\) \{[\s\S]*?\n\}\)\(\);/;
  if (!sidePanelRe.test(out)) throw new Error('[loadTrainingPlanInline] no se encontró la IIFE initPlanSidePanel() a neutralizar');
  out = out.replace(sidePanelRe, '');

  return out;
}

function buildExportFooter(scriptText) {
  const names = new Set();
  const fnRe = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = fnRe.exec(scriptText))) names.add(m[1]);

  const exportLines = [...names].map(n => `window.${n} = ${n};`).join('\n');
  return `
${exportLines}
window.__test = {
  getCurrentPlan: () => currentPlan,
  setCurrentPlan: (p) => { currentPlan = p; },
  getAdaptCache: () => _adaptCache,
  // Sustituye por un stub una función de nivel superior DECLARADA dentro de esta misma
  // IIFE (p.ej. renderPlan, silentSavePlan, showToast). No basta con window.foo = stub:
  // como todo el script vive en un único scope de función, otras funciones hermanas
  // (p.ej. syncPlanWithReality llamando a renderPlan(...)) resuelven el identificador
  // "renderPlan" por cadena de scope léxico, NO a través de window -- así que reasignar
  // solo window.renderPlan no las afecta. Un eval DIRECTO (sin la coma indirecta) dentro
  // de esta función sí ve y puede reasignar esa variable local, porque comparte el mismo
  // scope léxico en el que se declaró.
  stub: function(name, fn) { eval(name + ' = fn;'); window[name] = fn; },
};
`;
}

/**
 * Carga (o recarga) el script inline en el contexto global actual del test.
 * Requiere que app.js ya se haya cargado antes (para AppState/WORKOUT_TYPES/TrainingPlanGenerator).
 */
function loadTrainingPlanInline() {
  const htmlPath = path.join(__dirname, '..', '..', 'training-plan.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const rawScript = extractInlineScript(html);
  const neutralized = neutralizeAutoRun(rawScript);
  const footer = buildExportFooter(neutralized);
  // Envuelto en una IIFE: el script tiene ~15 `let`/`const` de nivel superior
  // (currentPlan, _adaptCache, ...). Un eval indirecto SIN envolver los declara en el
  // entorno léxico global del realm, y volver a llamar a loadTrainingPlanInline() en un
  // segundo test (para tener un estado limpio por test) lanzaría "Identifier ... has
  // already been declared". Envolviendo en una función, cada llamada crea su propio
  // scope nuevo -- las redeclaraciones internas no chocan entre llamadas, y las líneas
  // exportadas (window.foo = foo) siguen viendo esos bindings porque están en el mismo scope.
  const fullScript = `(function() {\n${neutralized}\n${footer}\n})();`;

  try {
    // Eval INDIRECTO (la coma con 0 fuerza modo indirecto): se ejecuta como código global
    // real del realm de jsdom, igual que un <script> clásico -- así los `function` de
    // nivel superior (aquí, dentro de la IIFE) pueden publicarse en `window` explícitamente
    // (vm.runInThisContext() NO sirve aquí: el jsdom de jest vive en su propio contexto vm,
    // distinto del "this context" del proceso Node, así que no comparte `global`).
    (0, eval)(fullScript);
  } catch (e) {
    throw new Error(`[loadTrainingPlanInline] error ejecutando el script extraído: ${e.stack || e}`);
  }
}

module.exports = { loadTrainingPlanInline };
