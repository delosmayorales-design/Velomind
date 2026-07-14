/**
 * js/biomechanicsUtils.js — VeloMind
 * Motor biomecánico profesional.
 * Diferencia disciplina (carretera / gravel / mtb / triatlon)
 * × objetivo (rendimiento / confort / aero).
 * 100% agnóstico de la UI.
 *
 * Fuentes: BikeFit Institute, RETÜL, Holmes Protocol,
 *          INBF standards, Lemond formula, Steve Hogg.
 */

const BiomechanicsUtils = (() => {
  // ══════════════════════════════════════════════════════════
  // 1. RANGOS BIOMECÁNICOS PROFESIONALES
  //    Estructura: BIKE_FIT_RANGES[disciplina][objetivo]
  //    shoulder_angle = hip → shoulder → elbow
  //      (ángulo en el hombro entre la línea del tronco y el brazo;
  //       valores menores = posición más agresiva/aero)
  // ══════════════════════════════════════════════════════════
  const BIKE_FIT_RANGES = {

    // ── CARRETERA ─────────────────────────────────────────
    carretera: {
      rendimiento: {
        knee_extension:  { min: 140, max: 150, optimal: 145 },
        hip_angle:       { min:  90, max: 105, optimal:  98 },
        trunk_angle:     { min:  35, max:  47, optimal:  41 },
        elbow_angle:     { min: 150, max: 162, optimal: 156 },
        ankle_angle:     { min:  95, max: 115, optimal: 105 },
        shoulder_angle:  { min:  82, max:  98, optimal:  90 },
      },
      confort: {
        knee_extension:  { min: 135, max: 147, optimal: 141 },
        hip_angle:       { min:  98, max: 113, optimal: 106 },
        trunk_angle:     { min:  46, max:  58, optimal:  52 },
        elbow_angle:     { min: 148, max: 163, optimal: 156 },
        ankle_angle:     { min:  90, max: 110, optimal: 100 },
        shoulder_angle:  { min:  88, max: 104, optimal:  96 },
      },
      aero: {
        knee_extension:  { min: 142, max: 153, optimal: 148 },
        hip_angle:       { min:  83, max:  98, optimal:  91 },
        trunk_angle:     { min:  18, max:  33, optimal:  25 },
        elbow_angle:     { min: 138, max: 153, optimal: 146 },
        ankle_angle:     { min: 100, max: 122, optimal: 111 },
        shoulder_angle:  { min:  70, max:  86, optimal:  78 },
      },
    },

    // ── GRAVEL ────────────────────────────────────────────
    gravel: {
      rendimiento: {
        knee_extension:  { min: 138, max: 149, optimal: 143 },
        hip_angle:       { min:  94, max: 110, optimal: 102 },
        trunk_angle:     { min:  42, max:  55, optimal:  48 },
        elbow_angle:     { min: 148, max: 161, optimal: 155 },
        ankle_angle:     { min:  90, max: 112, optimal: 101 },
        shoulder_angle:  { min:  85, max: 102, optimal:  93 },
      },
      confort: {
        knee_extension:  { min: 133, max: 145, optimal: 139 },
        hip_angle:       { min: 100, max: 116, optimal: 108 },
        trunk_angle:     { min:  50, max:  63, optimal:  56 },
        elbow_angle:     { min: 150, max: 165, optimal: 158 },
        ankle_angle:     { min:  87, max: 108, optimal:  97 },
        shoulder_angle:  { min:  90, max: 107, optimal:  98 },
      },
      aero: {
        knee_extension:  { min: 140, max: 151, optimal: 146 },
        hip_angle:       { min:  88, max: 104, optimal:  96 },
        trunk_angle:     { min:  28, max:  43, optimal:  35 },
        elbow_angle:     { min: 142, max: 156, optimal: 149 },
        ankle_angle:     { min:  95, max: 117, optimal: 106 },
        shoulder_angle:  { min:  76, max:  93, optimal:  84 },
      },
    },

    // ── MTB ───────────────────────────────────────────────
    mtb: {
      rendimiento: {
        knee_extension:  { min: 135, max: 147, optimal: 141 },
        hip_angle:       { min: 100, max: 118, optimal: 109 },
        trunk_angle:     { min:  50, max:  65, optimal:  57 },
        elbow_angle:     { min: 145, max: 161, optimal: 153 },
        ankle_angle:     { min:  85, max: 107, optimal:  96 },
        shoulder_angle:  { min:  88, max: 108, optimal:  98 },
      },
      confort: {
        knee_extension:  { min: 130, max: 143, optimal: 137 },
        hip_angle:       { min: 107, max: 124, optimal: 115 },
        trunk_angle:     { min:  58, max:  73, optimal:  65 },
        elbow_angle:     { min: 148, max: 165, optimal: 157 },
        ankle_angle:     { min:  82, max: 104, optimal:  93 },
        shoulder_angle:  { min:  93, max: 113, optimal: 103 },
      },
      aero: {
        knee_extension:  { min: 137, max: 149, optimal: 143 },
        hip_angle:       { min:  95, max: 113, optimal: 104 },
        trunk_angle:     { min:  43, max:  58, optimal:  50 },
        elbow_angle:     { min: 142, max: 158, optimal: 150 },
        ankle_angle:     { min:  88, max: 110, optimal:  99 },
        shoulder_angle:  { min:  83, max: 100, optimal:  91 },
      },
    },

    // ── TRIATLÓN / TT ─────────────────────────────────────
    triatlon: {
      rendimiento: {
        knee_extension:  { min: 142, max: 153, optimal: 147 },
        hip_angle:       { min:  82, max:  97, optimal:  90 },
        trunk_angle:     { min:  14, max:  29, optimal:  21 },
        elbow_angle:     { min: 135, max: 150, optimal: 143 },
        ankle_angle:     { min: 102, max: 124, optimal: 113 },
        shoulder_angle:  { min:  68, max:  85, optimal:  76 },
      },
      confort: {
        knee_extension:  { min: 138, max: 149, optimal: 143 },
        hip_angle:       { min:  88, max: 103, optimal:  96 },
        trunk_angle:     { min:  24, max:  38, optimal:  31 },
        elbow_angle:     { min: 140, max: 155, optimal: 148 },
        ankle_angle:     { min:  97, max: 119, optimal: 108 },
        shoulder_angle:  { min:  74, max:  91, optimal:  82 },
      },
      aero: {
        knee_extension:  { min: 144, max: 155, optimal: 150 },
        hip_angle:       { min:  77, max:  92, optimal:  84 },
        trunk_angle:     { min:   7, max:  20, optimal:  14 },
        elbow_angle:     { min: 130, max: 145, optimal: 137 },
        ankle_angle:     { min: 107, max: 129, optimal: 118 },
        shoulder_angle:  { min:  60, max:  77, optimal:  68 },
      },
    },
  };

  // ══════════════════════════════════════════════════════════
  // 2. CÁLCULO DE ÁNGULOS (VECTORES ROBUSTOS)
  // ══════════════════════════════════════════════════════════
  function calculateAngle(A, B, C) {
    if (!A || !B || !C) return null;
    const BA = { x: A.x - B.x, y: A.y - B.y };
    const BC = { x: C.x - B.x, y: C.y - B.y };
    const dot   = BA.x * BC.x + BA.y * BC.y;
    const magBA = Math.sqrt(BA.x * BA.x + BA.y * BA.y);
    const magBC = Math.sqrt(BC.x * BC.x + BC.y * BC.y);
    if (magBA === 0 || magBC === 0) return 0;
    let cosAngle = dot / (magBA * magBC);
    cosAngle = Math.max(-1, Math.min(1, cosAngle));
    return Math.acos(cosAngle) * (180 / Math.PI);
  }

  function calculateTrunkAngle(shoulder, hip) {
    if (!shoulder || !hip) return null;
    const dx = shoulder.x - hip.x;
    const dy = hip.y - shoulder.y; // Canvas: Y crece hacia abajo
    const angleRad = Math.atan2(dy, Math.abs(dx));
    return angleRad * (180 / Math.PI);
  }

  // ══════════════════════════════════════════════════════════
  // 3. VALIDACIÓN DE PUNTOS
  // ══════════════════════════════════════════════════════════
  function validatePoints(points) {
    const required = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'foot_tip'];
    const errors   = [];
    const warnings = [];
    for (const p of required) {
      if (!points[p] || typeof points[p].x !== 'number' || typeof points[p].y !== 'number') {
        errors.push(`Falta el punto articular: ${p}`);
      }
    }
    if (errors.length > 0) return { isValid: false, errors, warnings };
    if (points.shoulder.y > points.hip.y)  warnings.push('Hombro detectado por debajo de la cadera.');
    if (points.hip.y     > points.knee.y)  warnings.push('Cadera detectada por debajo de la rodilla.');
    if (points.knee.y    > points.ankle.y) warnings.push('Rodilla detectada por debajo del tobillo.');
    return { isValid: true, errors, warnings };
  }

  // ══════════════════════════════════════════════════════════
  // 4. EVALUACIÓN DE TOLERANCIAS
  // ══════════════════════════════════════════════════════════
  function evaluateAngle(angle, range) {
    if (angle === null || !range) return { status: 'unknown', delta: 0 };
    const delta     = angle - range.optimal;
    const TOLERANCE = 3;
    let status = 'ok';
    if (angle < range.min) {
      status = (range.min - angle <= TOLERANCE) ? 'warning' : 'bad';
    } else if (angle > range.max) {
      status = (angle - range.max <= TOLERANCE) ? 'warning' : 'bad';
    }
    return { status, delta };
  }

  // ══════════════════════════════════════════════════════════
  // 5. RESOLUCIÓN DE RANGOS (disciplina × objetivo)
  // ══════════════════════════════════════════════════════════
  function resolveRanges(discipline, mode) {
    const disc = BIKE_FIT_RANGES[discipline] || BIKE_FIT_RANGES.carretera;
    return disc[mode] || disc.rendimiento;
  }

  // ══════════════════════════════════════════════════════════
  // 6. PROCESADOR PRINCIPAL
  //    processBiomechanics(points, mode, discipline)
  // ══════════════════════════════════════════════════════════
  function processBiomechanics(points, mode = 'rendimiento', discipline = 'carretera') {
    const validation = validatePoints(points);
    if (!validation.isValid) return { isValid: false, errors: validation.errors };

    const rawAngles = {
      knee_extension:  calculateAngle(points.hip,       points.knee,      points.ankle),
      hip_angle:       calculateAngle(points.shoulder,   points.hip,       points.knee),
      elbow_angle:     calculateAngle(points.shoulder,   points.elbow,     points.wrist),
      ankle_angle:     calculateAngle(points.knee,       points.ankle,     points.foot_tip),
      trunk_angle:     calculateTrunkAngle(points.shoulder, points.hip),
      shoulder_angle:  calculateAngle(points.hip,        points.shoulder,  points.elbow),
    };

    const currentRanges = resolveRanges(discipline, mode);
    const evaluated = {};
    for (const [key, angleVal] of Object.entries(rawAngles)) {
      evaluated[key] = {
        value: angleVal,
        ...evaluateAngle(angleVal, currentRanges[key]),
      };
    }

    return {
      isValid:    true,
      warnings:   validation.warnings,
      angles:     evaluated,
      mode,
      discipline,
      ranges:     currentRanges,
    };
  }

  // ══════════════════════════════════════════════════════════
  // 7. FIT SCORE GLOBAL (0–100)
  //    ok=100 · warning=70 · bad=30
  //    Representa qué % de ángulos están dentro de rango.
  // ══════════════════════════════════════════════════════════
  function getFitScore(angles) {
    if (!angles) return 0;
    const W = { ok: 100, warning: 70, bad: 30, unknown: 50 };
    const vals = Object.values(angles)
      .filter(a => a && a.status !== 'unknown')
      .map(a => W[a.status] ?? 50);
    if (!vals.length) return 0;
    return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  }

  // ══════════════════════════════════════════════════════════
  // 8. RECOMENDACIÓN DE LONGITUD DE BIELAS
  //    Derivada de: inseam_mm × 0.216 (BikeFit Institute)
  //    con inseam ≈ tibia × 2 (ratio anatómico promedio).
  //    Resultado: tibia_mm × 0.432 = tibia_cm × 4.32
  //    Redondeado a la talla estándar más cercana.
  // ══════════════════════════════════════════════════════════
  const CRANK_SIZES = [155, 160, 162.5, 165, 167.5, 170, 172.5, 175, 177.5, 180];

  function recommendCrankLength(tibiaCm) {
    if (!tibiaCm || tibiaCm < 25 || tibiaCm > 60) return null;
    // tibia_cm × 4.1 → longitud de bielas en mm
    // Calibrado para: 38cm→155, 40cm→165, 42cm→172.5, 44cm→180
    const raw = tibiaCm * 4.1;
    const nearest = CRANK_SIZES.reduce((a, b) => Math.abs(b - raw) < Math.abs(a - raw) ? b : a);
    return { raw: Math.round(raw * 10) / 10, recommended: nearest };
  }

  // ══════════════════════════════════════════════════════════
  // 9. VEREDICTO FINAL HOLÍSTICO
  //    Devuelve: { verdict, summary, adjustments[] }
  //    Cada ajuste: { priority, icon, action, reason }
  //    En lugar de ángulo por ángulo → diagnóstico único
  //    como lo haría un bike fitter profesional.
  // ══════════════════════════════════════════════════════════
  const DISC_LABELS = {
    carretera: 'carretera',
    gravel:    'gravel',
    mtb:       'MTB',
    triatlon:  'triatlón/TT',
  };

  function getRecommendations(evaluatedAngles, mode, discipline = 'carretera') {
    if (!evaluatedAngles) return { verdict: 'optimal', summary: '', adjustments: [] };

    const disc      = discipline || 'carretera';
    const discLabel = DISC_LABELS[disc] || disc;
    const { knee_extension, hip_angle, trunk_angle, elbow_angle, ankle_angle, shoulder_angle } = evaluatedAngles;

    const high = a => a && a.status !== 'ok' && a.delta > 0;
    const low  = a => a && a.status !== 'ok' && a.delta < 0;
    const bad  = a => a && a.status !== 'ok';

    const explained   = new Set();
    const adjustments = [];

    // ── PATRONES COMBINADOS (causa raíz única) ─────────────

    // P1 · KOPS negativo — sillín retrasado
    if (high(hip_angle) && high(elbow_angle)) {
      explained.add('hip_angle'); explained.add('elbow_angle');
      adjustments.push({
        priority: 1, icon: '↔️',
        action: 'Adelanta el sillín 5–10 mm',
        reason: disc === 'mtb'
          ? 'Cadera abierta + codos bloqueados → sillín retrasado (KOPS negativo). Al mover el sillín, ambos ángulos se corrigen a la vez sin tocar el alcance.'
          : 'La cadera está abierta y los codos se bloquean para alcanzar el manillar — señal clásica de KOPS negativo. Un solo movimiento resuelve los dos síntomas.',
      });
    }

    // P2 · Sillín adelantado
    if (low(hip_angle) && low(elbow_angle)) {
      explained.add('hip_angle'); explained.add('elbow_angle');
      adjustments.push({
        priority: 1, icon: '↔️',
        action: disc === 'triatlon'
          ? 'Retrasa el sillín 5–10 mm e inclina la nariz hacia abajo'
          : 'Retrasa el sillín 5–10 mm',
        reason: 'Cadera muy cerrada + codos encogidos → sillín adelantado (KOPS positivo). Retrasar el sillín abrirá la cadera y dará espacio a los brazos.',
      });
    }

    // P3 · Sillín alto
    if (high(knee_extension) && high(ankle_angle)) {
      explained.add('knee_extension'); explained.add('ankle_angle');
      adjustments.push({
        priority: 1, icon: '⬇️',
        action: 'Baja el sillín 5–8 mm',
        reason: disc === 'mtb'
          ? 'Rodilla sobreextendida + pedaleo de punta → sillín demasiado alto. También comprometes el control en bajadas técnicas.'
          : 'Rodilla sobreextendida + pedaleo de punta → sillín demasiado alto. Bajarlo resuelve los dos síntomas a la vez.',
      });
    }

    // P4 · Sillín bajo
    if (low(knee_extension) && low(ankle_angle)) {
      explained.add('knee_extension'); explained.add('ankle_angle');
      adjustments.push({
        priority: 1, icon: '⬆️',
        action: 'Sube el sillín 5–8 mm',
        reason: 'Rodilla muy flexionada + talón caído → sillín demasiado bajo. Riesgo de síndrome patelofemoral si no se corrige.',
      });
    }

    // P5 · Codos bloqueados aislados (alcance largo)
    if (!explained.has('elbow_angle') && high(elbow_angle)) {
      explained.add('elbow_angle');
      adjustments.push({
        priority: 2, icon: '📏',
        action: disc === 'mtb'
          ? 'Acorta la potencia 1 talla o monta manillar con más rise'
          : 'Acorta la potencia 10 mm (o monta la potencia con ángulo positivo)',
        reason: disc === 'mtb'
          ? 'Codos bloqueados en MTB → peligroso en bajadas y terreno técnico. El ángulo de codo debe rondar siempre los 150°.'
          : 'Los codos están bloqueados porque el alcance es excesivo. Evita subir el manillar como solución: abriría más la cadera.',
      });
    }

    // P5b · Cadera abierta + hombros hundidos (señales opuestas sobre potencia)
    //       → causa raíz: sillín retrasado, no problema de alcance
    //       Se evalúa ANTES de P6 y del bloque de hombro para evitar consejos contradictorios.
    if (!explained.has('hip_angle') && high(hip_angle) && shoulder_angle && low(shoulder_angle)) {
      explained.add('hip_angle');
      explained.add('shoulder_angle');
      adjustments.push({
        priority: 2, icon: '↔️',
        action: 'Adelanta el sillín 5–10 mm y reevalúa antes de cambiar la potencia',
        reason: 'Cadera abierta + hombros hundidos al mismo tiempo apuntan al sillín retrasado: el cuerpo se sienta erguido (cadera) pero los hombros compensan alcanzando el manillar. Ajusta el sillín primero — si persiste, entonces valora la potencia.',
      });
    }

    // P6 · Cadera abierta aislada (alcance corto, sin hombros hundidos)
    if (!explained.has('hip_angle') && high(hip_angle)) {
      explained.add('hip_angle');
      adjustments.push({
        priority: 2, icon: '📏',
        action: mode === 'aero'
          ? 'Baja el manillar o alarga la potencia 10 mm'
          : disc === 'mtb'
            ? 'Alarga la potencia 10 mm o usa manillar con menos rise'
            : 'Alarga la potencia 10 mm',
        reason: mode === 'aero'
          ? 'La cadera está demasiado abierta para una posición aerodinámica — el alcance es corto.'
          : 'La cadera está abierta porque el alcance es insuficiente. Alargar la potencia mejora el ángulo sin tocar la altura del sillín.',
      });
    }

    // P7 · Cadera cerrada aislada
    if (!explained.has('hip_angle') && low(hip_angle)) {
      explained.add('hip_angle');
      adjustments.push({
        priority: 2, icon: '📏',
        action: disc === 'triatlon'
          ? 'Inclina la nariz del sillín o retrocede los aero bars'
          : 'Sube el manillar (añade 1 espaciador) o acorta la potencia 10 mm',
        reason: disc === 'triatlon'
          ? 'Cadera muy cerrada → impingement de cadera y compresión del psoas en posición TT.'
          : 'La cadera está demasiado cerrada. Subir el manillar reduce el alcance efectivo y libera ligeramente la cadera.',
      });
    }

    // ── ÁNGULOS RESIDUALES ─────────────────────────────────

    if (!explained.has('knee_extension') && bad(knee_extension)) {
      adjustments.push({
        priority: 2,
        icon: knee_extension.delta < 0 ? '⬆️' : '⬇️',
        action: knee_extension.delta < 0
          ? 'Sube el sillín 2–5 mm'
          : disc === 'mtb' ? 'Baja el sillín 3–5 mm' : 'Baja el sillín 2–4 mm',
        reason: knee_extension.delta < 0
          ? 'Rodilla muy flexionada en el punto muerto inferior → riesgo de síndrome patelofemoral anterior.'
          : disc === 'mtb'
            ? 'Sobreextensión de rodilla — también compromete el control en bajadas.'
            : 'Sobreextensión de rodilla → favorece el balanceo pélvico y la tendinitis aquílea.',
      });
    }

    if (!explained.has('ankle_angle') && bad(ankle_angle)) {
      adjustments.push({
        priority: 3, icon: '👟',
        action: ankle_angle.delta > 0
          ? 'Adelanta las calas 2–3 mm'
          : 'Revisa la posición de las calas (posiblemente demasiado adelantadas)',
        reason: ankle_angle.delta > 0
          ? 'Pedaleas de punta (tobillo muy alto) → posible tendinitis aquílea. Si tras ajustar las calas persiste, baja el sillín.'
          : disc === 'triatlon'
            ? 'Talón muy caído en TT — las calas demasiado adelantadas pueden agravarlo.'
            : 'Talón muy caído → pérdida de potencia de transmisión. Revisa también la altura del sillín.',
      });
    }

    if (!explained.has('elbow_angle') && bad(elbow_angle) && low(elbow_angle)) {
      adjustments.push({
        priority: 3, icon: '📏',
        action: 'Alarga la potencia 10 mm o retrasa el sillín',
        reason: 'Codos excesivamente flexionados → postura encogida que limita la respiración y la eficiencia.',
      });
    }

    if (bad(trunk_angle)) {
      adjustments.push({
        priority: trunk_angle.status === 'bad' ? 2 : 3,
        icon: '🎯',
        action: trunk_angle.delta > 0
          ? mode === 'aero'
            ? 'Reduce 1–2 espaciadores o monta potencia de ángulo negativo'
            : disc === 'mtb'
              ? 'Alarga la potencia o usa manillar con menos rise'
              : 'Comprueba primero el KOPS — si está bien, baja el manillar 1 espaciador'
          : disc === 'mtb'
            ? 'Sube el manillar o monta risers más altos'
            : disc === 'triatlon'
              ? 'Sube ligeramente los aero pads y confirma sostenibilidad >30 min'
              : 'Sube el manillar (añade 1 espaciador)',
        reason: trunk_angle.delta > 0
          ? mode === 'aero'
            ? `Tronco demasiado vertical para aero (${discLabel}). Perdes potencia aerodinámica.`
            : disc === 'mtb'
              ? 'Tronco muy erguido para XC → menos eficiencia y control.'
              : 'Tronco más vertical de lo óptimo. Asegúrate de que el KOPS sea correcto antes de bajar el manillar.'
          : disc === 'mtb'
            ? 'Tronco muy horizontal para MTB → pierdes visibilidad y control en bajadas técnicas.'
            : disc === 'triatlon'
              ? 'Tronco muy horizontal. Confirma que sea sostenible más de 30 min — riesgo de cervicalgias.'
              : 'Tronco muy horizontal → sobrecarga lumbar y cervical.',
      });
    }

    if (shoulder_angle && bad(shoulder_angle) && !explained.has('shoulder_angle')) {
      adjustments.push({
        priority: 3, icon: '🙆',
        action: shoulder_angle.delta > 0
          ? disc === 'mtb'
            ? 'Relaja el agarre — deja que los codos absorban los impactos'
            : 'Relaja los trapecios y comprueba que el manillar no esté demasiado alto'
          : disc === 'triatlon'
            ? 'Ajusta los aero pads para que soporten el peso del tronco correctamente'
            : 'Acorta la potencia o sube el manillar para reducir el alcance',
        reason: shoulder_angle.delta > 0
          ? disc === 'mtb'
            ? 'Hombros elevados y tensos — los codos deben ser el punto de amortiguación en MTB, no los hombros.'
            : 'Hombros elevados o brazo demasiado vertical respecto al tronco. Relaja los trapecios al pedalear.'
          : disc === 'triatlon'
            ? 'Hombros muy cerrados/hundidos en TT — los aero pads deben soportar correctamente el peso del tronco.'
            : 'Hombros hundidos hacia adelante (cifosis activa) → riesgo de compresión cervical y entumecimiento de manos.',
      });
    }

    // ── CONSTRUIR VEREDICTO ────────────────────────────────
    adjustments.sort((a, b) => a.priority - b.priority);

    const n = adjustments.length;
    let verdict, summary;

    if (n === 0) {
      verdict = 'optimal';
      summary = `Posición perfecta para ${discLabel} en modo ${mode}. Todos los ángulos articulares están dentro de los márgenes de un bike fitting profesional.`;
    } else if (n === 1) {
      verdict = 'good';
      summary = `Tu posición en ${discLabel} (${mode}) es buena — solo hay 1 ajuste a realizar:`;
    } else if (n <= 3) {
      verdict = 'needs_work';
      summary = `Tu posición en ${discLabel} (${mode}) tiene ${n} ajustes a realizar. Por orden de importancia:`;
    } else {
      verdict = 'critical';
      summary = `Tu posición en ${discLabel} (${mode}) necesita varios ajustes. Por orden de prioridad:`;
    }

    return { verdict, summary, adjustments };
  }

  // ══════════════════════════════════════════════════════════
  // API PÚBLICA
  // ══════════════════════════════════════════════════════════
  return {
    BIKE_FIT_RANGES,
    resolveRanges,
    processBiomechanics,
    getRecommendations,
    getFitScore,
    recommendCrankLength,
  };
})();

window.BiomechanicsUtils = BiomechanicsUtils;
