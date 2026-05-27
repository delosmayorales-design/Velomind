/**
 * js/biomechanicsUtils.js — VeloMind
 * Motor biomecánico profesional.
 * Diferencia disciplina (carretera / gravel / mtb / triatlon)
 * × objetivo (rendimiento / confort / aero).
 * 100% agnóstico de la UI.
 */

const BiomechanicsUtils = (() => {
  const DEBUG_BIOMECHANICS = false;

  // ══════════════════════════════════════════════════════════
  // 1. RANGOS BIOMECÁNICOS PROFESIONALES
  //    Estructura: BIKE_FIT_RANGES[disciplina][objetivo]
  //    Fuente: BikeFit Institute, RETÜL, Lemond/Holmes protocols,
  //            INBF standards y literatura de fisiología ciclista.
  // ══════════════════════════════════════════════════════════
  const BIKE_FIT_RANGES = {

    // ── CARRETERA ─────────────────────────────────────────
    carretera: {
      rendimiento: {
        // Posición de potencia en manetas. Equilibrio eficiencia / lesión.
        knee_extension: { min: 140, max: 150, optimal: 145 },
        hip_angle:      { min:  90, max: 105, optimal:  98 },
        trunk_angle:    { min:  35, max:  47, optimal:  41 },
        elbow_angle:    { min: 150, max: 162, optimal: 156 },
        ankle_angle:    { min:  95, max: 115, optimal: 105 },
      },
      confort:      {
        // Manillar alto, alcance corto. Gran fondo / cicloturismo.
        knee_extension: { min: 135, max: 147, optimal: 141 },
        hip_angle:      { min:  98, max: 113, optimal: 106 },
        trunk_angle:    { min:  46, max:  58, optimal:  52 },
        elbow_angle:    { min: 148, max: 163, optimal: 156 },
        ankle_angle:    { min:  90, max: 110, optimal: 100 },
      },
      aero:         {
        // Posición TT / escapada. Prioriza aerodinámica sobre confort.
        knee_extension: { min: 142, max: 153, optimal: 148 },
        hip_angle:      { min:  83, max:  98, optimal:  91 },
        trunk_angle:    { min:  18, max:  33, optimal:  25 },
        elbow_angle:    { min: 138, max: 153, optimal: 146 },
        ankle_angle:    { min: 100, max: 122, optimal: 111 },
      },
    },

    // ── GRAVEL ────────────────────────────────────────────
    gravel: {
      rendimiento: {
        // Posición dinámica: potencia con algo más de control que carretera.
        knee_extension: { min: 138, max: 149, optimal: 143 },
        hip_angle:      { min:  94, max: 110, optimal: 102 },
        trunk_angle:    { min:  42, max:  55, optimal:  48 },
        elbow_angle:    { min: 148, max: 161, optimal: 155 },
        ankle_angle:    { min:  90, max: 112, optimal: 101 },
      },
      confort:      {
        // Largas distancias en terreno mixto. Postura erguida.
        knee_extension: { min: 133, max: 145, optimal: 139 },
        hip_angle:      { min: 100, max: 116, optimal: 108 },
        trunk_angle:    { min:  50, max:  63, optimal:  56 },
        elbow_angle:    { min: 150, max: 165, optimal: 158 },
        ankle_angle:    { min:  87, max: 108, optimal:  97 },
      },
      aero:         {
        // Gravel race / bikepacking rápido. Semi-agresivo.
        knee_extension: { min: 140, max: 151, optimal: 146 },
        hip_angle:      { min:  88, max: 104, optimal:  96 },
        trunk_angle:    { min:  28, max:  43, optimal:  35 },
        elbow_angle:    { min: 142, max: 156, optimal: 149 },
        ankle_angle:    { min:  95, max: 117, optimal: 106 },
      },
    },

    // ── MTB ───────────────────────────────────────────────
    mtb: {
      rendimiento: {
        // XC / Trail. Tronco más vertical para control técnico.
        knee_extension: { min: 135, max: 147, optimal: 141 },
        hip_angle:      { min: 100, max: 118, optimal: 109 },
        trunk_angle:    { min:  50, max:  65, optimal:  57 },
        elbow_angle:    { min: 145, max: 161, optimal: 153 },
        ankle_angle:    { min:  85, max: 107, optimal:  96 },
      },
      confort:      {
        // Enduro / All-Mountain. Postura neutral, máxima visibilidad.
        knee_extension: { min: 130, max: 143, optimal: 137 },
        hip_angle:      { min: 107, max: 124, optimal: 115 },
        trunk_angle:    { min:  58, max:  73, optimal:  65 },
        elbow_angle:    { min: 148, max: 165, optimal: 157 },
        ankle_angle:    { min:  82, max: 104, optimal:  93 },
      },
      aero:         {
        // XC Race. Tan agresivo como permite el terreno técnico.
        knee_extension: { min: 137, max: 149, optimal: 143 },
        hip_angle:      { min:  95, max: 113, optimal: 104 },
        trunk_angle:    { min:  43, max:  58, optimal:  50 },
        elbow_angle:    { min: 142, max: 158, optimal: 150 },
        ankle_angle:    { min:  88, max: 110, optimal:  99 },
      },
    },

    // ── TRIATLÓN / TT ─────────────────────────────────────
    triatlon: {
      rendimiento: {
        // Aero bars, posición aerodinámica sostenible en IM/70.3.
        knee_extension: { min: 142, max: 153, optimal: 147 },
        hip_angle:      { min:  82, max:  97, optimal:  90 },
        trunk_angle:    { min:  14, max:  29, optimal:  21 },
        elbow_angle:    { min: 135, max: 150, optimal: 143 },
        ankle_angle:    { min: 102, max: 124, optimal: 113 },
      },
      confort:      {
        // Triatlón de larga distancia con prioridad en preservar piernas.
        knee_extension: { min: 138, max: 149, optimal: 143 },
        hip_angle:      { min:  88, max: 103, optimal:  96 },
        trunk_angle:    { min:  24, max:  38, optimal:  31 },
        elbow_angle:    { min: 140, max: 155, optimal: 148 },
        ankle_angle:    { min:  97, max: 119, optimal: 108 },
      },
      aero:         {
        // TT puro / Sprint. Máxima agresividad aerodinámica.
        knee_extension: { min: 144, max: 155, optimal: 150 },
        hip_angle:      { min:  77, max:  92, optimal:  84 },
        trunk_angle:    { min:   7, max:  20, optimal:  14 },
        elbow_angle:    { min: 130, max: 145, optimal: 137 },
        ankle_angle:    { min: 107, max: 129, optimal: 118 },
      },
    },
  };

  // Alias retrocompatible: si se llama con modo antiguo (sin disciplina)
  // mantiene el comportamiento previo usando carretera como base.
  const LEGACY_MODE_MAP = {
    rendimiento: 'rendimiento',
    confort:     'confort',
    aero:        'aero',
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
  function validatePoints(points, debug = DEBUG_BIOMECHANICS) {
    const required = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'foot_tip'];
    const errors   = [];
    const warnings = [];

    for (const p of required) {
      if (!points[p] || typeof points[p].x !== 'number' || typeof points[p].y !== 'number') {
        errors.push(`Falta el punto articular: ${p}`);
      }
    }
    if (errors.length > 0) return { isValid: false, errors, warnings };

    if (points.shoulder.y > points.hip.y)   warnings.push('Hombro detectado por debajo de la cadera.');
    if (points.hip.y     > points.knee.y)   warnings.push('Cadera detectada por debajo de la rodilla.');
    if (points.knee.y    > points.ankle.y)  warnings.push('Rodilla detectada por debajo del tobillo.');

    return { isValid: true, errors, warnings };
  }

  // ══════════════════════════════════════════════════════════
  // 4. EVALUACIÓN DE TOLERANCIAS
  // ══════════════════════════════════════════════════════════
  function evaluateAngle(angle, range) {
    if (angle === null || !range) return { status: 'unknown', delta: 0 };
    const delta     = angle - range.optimal;
    const TOLERANCE = 3; // margen de gracia en grados
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
  //    discipline: 'carretera' | 'gravel' | 'mtb' | 'triatlon'
  //    mode:       'rendimiento' | 'confort' | 'aero'
  // ══════════════════════════════════════════════════════════
  function processBiomechanics(points, mode = 'rendimiento', discipline = 'carretera') {
    const validation = validatePoints(points);
    if (!validation.isValid) {
      return { isValid: false, errors: validation.errors };
    }

    const rawAngles = {
      knee_extension: calculateAngle(points.hip,      points.knee,   points.ankle),
      hip_angle:      calculateAngle(points.shoulder,  points.hip,    points.knee),
      elbow_angle:    calculateAngle(points.shoulder,  points.elbow,  points.wrist),
      ankle_angle:    calculateAngle(points.knee,      points.ankle,  points.foot_tip),
      trunk_angle:    calculateTrunkAngle(points.shoulder, points.hip),
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
      isValid: true,
      warnings: validation.warnings,
      angles: evaluated,
      mode,
      discipline,
      ranges: currentRanges,   // ← expuesto para que la UI pueda leerlo directamente
    };
  }

  // ══════════════════════════════════════════════════════════
  // 7. GENERADOR DE RECOMENDACIONES (disciplina-aware)
  // ══════════════════════════════════════════════════════════
  const DISC_LABELS = {
    carretera: 'carretera',
    gravel:    'gravel',
    mtb:       'MTB',
    triatlon:  'triatlón/TT',
  };

  function getRecommendations(evaluatedAngles, mode, discipline = 'carretera') {
    if (!evaluatedAngles) return [];
    const recs = [];
    const disc = discipline || 'carretera';
    const discLabel = DISC_LABELS[disc] || disc;
    const { knee_extension, hip_angle, trunk_angle, elbow_angle, ankle_angle } = evaluatedAngles;

    // ── Rodilla ────────────────────────────────────────────
    if (knee_extension?.status !== 'ok') {
      if (knee_extension.delta < 0) {
        recs.push({ angle: 'Rodilla', text: 'Rodilla muy flexionada en PMI. Sube el sillín 2–5 mm o retrásalo ligeramente. Riesgo de síndrome patelofemoral anterior.' });
      } else {
        const extra = disc === 'mtb'
          ? 'En MTB un sillín alto también compromete el control en descensos. Bájalo 3–5 mm.'
          : 'Excesiva extensión de rodilla. Baja el sillín para evitar balanceo pélvico y dolor en tendón de Aquiles.';
        recs.push({ angle: 'Rodilla', text: extra });
      }
    }

    // ── Cadera ─────────────────────────────────────────────
    if (hip_angle?.status !== 'ok') {
      if (hip_angle.delta < 0) {
        const fix = disc === 'triatlon'
          ? 'Cadera muy cerrada incluso para triatlón. Considera un sillín con nariz más baja (tilted) o ajustar la posición de los aero bars hacia atrás.'
          : 'Ángulo de cadera muy cerrado → compresión del psoas e impingement de cadera. Acorta el alcance (potencia más corta) o eleva el manillar.';
        recs.push({ angle: 'Cadera', text: fix });
      } else {
        const fix = disc === 'mtb'
          ? 'Cadera excesivamente abierta. Normal en MTB de confort; si buscas rendimiento XC, cierra ligeramente bajando el sillín o acortando el reach.'
          : mode === 'aero'
          ? 'Cadera demasiado abierta para posición aero. Baja el manillar o alarga la potencia.'
          : 'Cadera excesivamente abierta. Revisa si el cuadro es demasiado pequeño o la potencia demasiado corta.';
        recs.push({ angle: 'Cadera', text: fix });
      }
    }

    // ── Tronco ─────────────────────────────────────────────
    if (trunk_angle?.status !== 'ok') {
      if (trunk_angle.delta > 0) {
        // tronco más vertical de lo ideal
        const fix = mode === 'aero'
          ? `Tronco muy vertical para posición aero (${discLabel}). Reduce espaciadores bajo el potaje o usa una potencia con ángulo negativo.`
          : disc === 'mtb'
          ? 'Tronco excesivamente erguido. Prueba un manillar con menos rise o una potencia más larga para ganar estabilidad en bajadas técnicas.'
          : 'Tronco demasiado erguido. El cuadro puede ser demasiado pequeño o la potencia muy corta. Revisa el reach del cuadro.';
        recs.push({ angle: 'Tronco', text: fix });
      } else {
        // tronco más horizontal de lo ideal
        const fix = disc === 'mtb'
          ? 'Tronco muy horizontal para MTB → pérdida de control en singletrack. Sube el manillar o usa risers más altos.'
          : disc === 'triatlon'
          ? 'Tronco muy horizontal incluso para TT. Verifica que la posición de aero bars sea sostenible más de 30 min. Riesgo de cervicalgias.'
          : 'Tronco muy horizontal → sobrecarga lumbar y cervical. Sube el manillar (más espaciadores o potencia positiva).';
        recs.push({ angle: 'Tronco', text: fix });
      }
    }

    // ── Codo ───────────────────────────────────────────────
    if (elbow_angle?.status !== 'ok') {
      if (elbow_angle.delta > 0) {
        const fix = disc === 'mtb'
          ? 'Codos bloqueados: peligroso en MTB, absorbes cada golpe con las muñecas y hombros. Acerca el manillar o usa risers. Mantén siempre codos ligeramente flexionados.'
          : 'Codos bloqueados → ninguna absorción de vibración, carga en hombros y cuello. Acerca el manillar (potencia más corta o sillín ligeramente hacia adelante).';
        recs.push({ angle: 'Codo', text: fix });
      } else {
        recs.push({ angle: 'Codo', text: 'Codos excesivamente flexionados → postura encogida. Alarga la potencia o desplaza el sillín ligeramente hacia atrás.' });
      }
    }

    // ── Tobillo ────────────────────────────────────────────
    if (ankle_angle?.status !== 'ok') {
      if (ankle_angle.delta > 0) {
        recs.push({ angle: 'Tobillo', text: 'Pedaleo de "punta" (talón muy alto). Casi siempre indica sillín demasiado alto. Bájalo 2–3 mm. También revisa la posición de las calas (pueden estar demasiado atrás).' });
      } else {
        const fix = disc === 'triatlon'
          ? 'Talón muy caído en TT. Las calas en posición muy adelantada lo agravan. Adelanta las calas o ajusta el sillín.'
          : 'Talón muy caído → pérdida de transferencia de potencia. Adelanta las calas o sube el sillín 2–3 mm. También puede ser una hiperflexión plantar crónica.';
        recs.push({ angle: 'Tobillo', text: fix });
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
  };
})();

window.BiomechanicsUtils = BiomechanicsUtils;
