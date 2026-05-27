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
  const DEBUG_BIOMECHANICS = false;

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
  // 9. GENERADOR DE RECOMENDACIONES HOLÍSTICO
  // ══════════════════════════════════════════════════════════
  const DISC_LABELS = {
    carretera: 'carretera',
    gravel:    'gravel',
    mtb:       'MTB',
    triatlon:  'triatlón/TT',
  };

  function getRecommendations(evaluatedAngles, mode, discipline = 'carretera') {
    if (!evaluatedAngles) return [];

    const disc      = discipline || 'carretera';
    const discLabel = DISC_LABELS[disc] || disc;
    const { knee_extension, hip_angle, trunk_angle, elbow_angle, ankle_angle, shoulder_angle } = evaluatedAngles;

    const high = a => a && a.status !== 'ok' && a.delta > 0;
    const low  = a => a && a.status !== 'ok' && a.delta < 0;
    const bad  = a => a && a.status !== 'ok';

    const explained = new Set();
    const recs = [];

    // ── PATRONES COMBINADOS (causa raíz única) ─────────────

    // P1 · KOPS negativo — sillín demasiado retrasado
    if (high(hip_angle) && high(elbow_angle)) {
      explained.add('hip_angle'); explained.add('elbow_angle');
      recs.push({
        angle: 'Sillín (posición)',
        text: `Cadera abierta + codos bloqueados → sillín demasiado retrasado (KOPS negativo). ` +
              `Adelanta el sillín 5–10 mm. Cerrará la cadera y dejará que los codos se flexionen solos sin tocar el alcance.`,
      });
    }

    // P2 · Sillín demasiado adelantado
    if (low(hip_angle) && low(elbow_angle)) {
      explained.add('hip_angle'); explained.add('elbow_angle');
      recs.push({
        angle: 'Sillín (posición)',
        text: disc === 'triatlon'
          ? `Cadera muy cerrada + codos encogidos → sillín adelantado o nariz alta. Retrasa 5–10 mm e inclina la nariz.`
          : `Cadera cerrada + codos encogidos → sillín demasiado adelantado (KOPS positivo). Retrásalo 5–10 mm.`,
      });
    }

    // P3 · Sillín claramente alto
    if (high(knee_extension) && high(ankle_angle)) {
      explained.add('knee_extension'); explained.add('ankle_angle');
      recs.push({
        angle: 'Sillín (altura)',
        text: `Rodilla sobreextendida + pedaleo de punta → sillín demasiado alto. ` +
              `Bájalo 5–8 mm. Resuelve ambos síntomas a la vez.` +
              (disc === 'mtb' ? ' Además perderás control en bajadas.' : ''),
      });
    }

    // P4 · Sillín claramente bajo
    if (low(knee_extension) && low(ankle_angle)) {
      explained.add('knee_extension'); explained.add('ankle_angle');
      recs.push({
        angle: 'Sillín (altura)',
        text: `Rodilla muy flexionada + talón caído → sillín demasiado bajo. Súbelo 5–8 mm. Riesgo de síndrome patelofemoral.`,
      });
    }

    // P5 · Codos bloqueados aislado (alcance largo)
    if (!explained.has('elbow_angle') && high(elbow_angle) && !high(hip_angle)) {
      explained.add('elbow_angle');
      recs.push({
        angle: 'Codo',
        text: disc === 'mtb'
          ? `Codos bloqueados → peligroso en MTB. Acorta la potencia 1 talla o usa manillar con más rise. Ángulo de codo ~150° siempre.`
          : `Codos bloqueados → alcance excesivo. Acorta la potencia (−10 mm) o adelanta ligeramente el sillín. No subas el manillar: abriría más la cadera.`,
      });
    }

    // P6 · Cadera abierta aislada (alcance corto)
    if (!explained.has('hip_angle') && high(hip_angle) && !high(elbow_angle)) {
      explained.add('hip_angle');
      recs.push({
        angle: 'Cadera',
        text: mode === 'aero'
          ? `Cadera demasiado abierta para aero. Baja el manillar o alarga la potencia.`
          : disc === 'mtb'
          ? `Cadera abierta para XC. Potencia +10 mm o manillar con menos rise.`
          : `Alcance insuficiente → cadera abierta. Potencia +10 mm o cuadro una talla mayor.`,
      });
    }

    // P7 · Cadera cerrada aislada
    if (!explained.has('hip_angle') && low(hip_angle)) {
      explained.add('hip_angle');
      recs.push({
        angle: 'Cadera',
        text: disc === 'triatlon'
          ? `Cadera muy cerrada → impingement y compresión del psoas. Inclina la nariz del sillín o retrocede los aero bars.`
          : `Cadera demasiado cerrada. Sube el manillar (espaciadores) o acorta la potencia.`,
      });
    }

    // ── ÁNGULOS RESIDUALES ─────────────────────────────────

    if (!explained.has('knee_extension') && bad(knee_extension)) {
      recs.push({ angle: 'Rodilla', text: knee_extension.delta < 0
        ? `Rodilla muy flexionada en PMI. Sube el sillín 2–5 mm. Riesgo de síndrome patelofemoral anterior.`
        : disc === 'mtb'
          ? `Sobreextensión de rodilla. Baja el sillín 3–5 mm. Compromete también el control en bajadas.`
          : `Sobreextensión de rodilla. Baja el sillín 2–4 mm. Previene balanceo pélvico y tendinitis aquílea.`,
      });
    }

    if (!explained.has('ankle_angle') && bad(ankle_angle)) {
      recs.push({ angle: 'Tobillo', text: ankle_angle.delta > 0
        ? `Pedaleo de "punta" (talón alto). Revisa las calas: si están muy atrás, adelántalas 2–3 mm. Si no mejora, baja el sillín.`
        : disc === 'triatlon'
          ? `Talón muy caído en TT. Calas muy adelantadas lo agravan. Revísalas.`
          : `Talón muy caído → pérdida de potencia. Adelanta las calas o sube el sillín 2–3 mm.`,
      });
    }

    if (!explained.has('elbow_angle') && bad(elbow_angle) && low(elbow_angle)) {
      recs.push({ angle: 'Codo', text: `Codos excesivamente flexionados → postura encogida. Alarga la potencia (+10 mm) o retrasa el sillín.` });
    }

    if (bad(trunk_angle)) {
      recs.push({ angle: 'Tronco', text: trunk_angle.delta > 0
        ? mode === 'aero'
          ? `Tronco muy vertical para aero (${discLabel}). Reduce espaciadores o usa potencia de ángulo negativo.`
          : disc === 'mtb'
            ? `Tronco muy erguido para XC. Potencia más larga o manillar con menos rise.`
            : `Tronco más vertical de lo ideal. Comprueba primero el KOPS antes de tocar el manillar.`
        : disc === 'mtb'
          ? `Tronco muy horizontal para MTB → pierdes visión y control. Sube el manillar o usa risers más altos.`
          : disc === 'triatlon'
            ? `Tronco muy horizontal para TT. Verifica que sea sostenible >30 min. Riesgo de cervicalgias.`
            : `Tronco muy horizontal → sobrecarga lumbar y cervical. Sube el manillar.`,
      });
    }

    // ── HOMBRO ────────────────────────────────────────────
    if (shoulder_angle && bad(shoulder_angle)) {
      if (shoulder_angle.delta > 0) {
        // Ángulo muy abierto = brazo "detrás" del tronco o hombros elevados
        recs.push({
          angle: 'Hombro',
          text: disc === 'mtb'
            ? `Hombros muy elevados/tensos. Baja el manillar ligeramente o relaja el agarre del manillar. Codos deben absolver impactos, no hombros.`
            : `Hombros elevados o brazo demasiado vertical respecto al tronco. ` +
              `Verifica que el manillar no esté demasiado alto. Relaja los trapecios al pedalear.`,
        });
      } else {
        // Ángulo muy cerrado = hombros hundidos, cifosis o alcance excesivo
        recs.push({
          angle: 'Hombro',
          text: disc === 'triatlon'
            ? `Hombros muy cerrados/hundidos en TT. Asegúrate de que los aero pads soporten el peso del tronco correctamente.`
            : `Hombros hundidos hacia adelante (cifosis activa). Riesgo de compresión cervical y entumecimiento de manos. ` +
              `Acorta la potencia o sube el manillar para reducir el alcance.`,
        });
      }
    }

    if (recs.length === 0) {
      recs.push({ angle: 'General', text: `✅ ¡Posición óptima para ${discLabel} en modo ${mode}! Todos los ángulos articulares están dentro de los márgenes de un bike fitting profesional.` });
    }
    return recs;
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
