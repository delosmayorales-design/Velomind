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
  // 7. GENERADOR DE RECOMENDACIONES HOLÍSTICO
  //
  //    Un fitter profesional NUNCA evalúa ángulos en aislado.
  //    Esta función:
  //    1. Detecta PATRONES COMBINADOS (causa raíz multi-ángulo)
  //    2. Marca qué ángulos ya quedan explicados por ese patrón
  //    3. Para los restantes, da recomendaciones individuales
  //    4. Garantiza CERO contradicciones entre recomendaciones
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
    const { knee_extension, hip_angle, trunk_angle, elbow_angle, ankle_angle } = evaluatedAngles;

    // Helpers: ¿está el ángulo fuera de rango hacia arriba o abajo?
    const high = a => a && a.status !== 'ok' && a.delta > 0;
    const low  = a => a && a.status !== 'ok' && a.delta < 0;
    const bad  = a => a && a.status !== 'ok';

    // Ángulos ya "explicados" por un patrón combinado (no se repiten)
    const explained = new Set();
    const recs = [];

    // ─────────────────────────────────────────────────────
    // PATRONES COMBINADOS — causa raíz única, dos o más síntomas
    // ─────────────────────────────────────────────────────

    // P1 · KOPS negativo — sillín demasiado retrasado
    //   Síntomas: cadera abierta (torso erguido) + codos bloqueados (brazos estirados al alcanzar el manillar)
    //   La combinación es inequívoca: el ciclista está sentado muy atrás, el cuerpo bascula
    //   hacia atrás y los brazos se tensan al querer llegar al manillar.
    //   NUNCA decir "frame pequeño" Y "acerca el manillar" a la vez — la raíz es el retroceso del sillín.
    if (high(hip_angle) && high(elbow_angle)) {
      explained.add('hip_angle'); explained.add('elbow_angle');
      recs.push({
        angle: 'Sillín (posición)',
        text: `Cadera abierta + codos bloqueados juntos → sillín demasiado retrasado (KOPS negativo). ` +
              `Adelanta el sillín 5–10 mm sobre el eje del pedalier. ` +
              `Esto cerrará el ángulo de cadera y dejará que los codos se flexionen solos, sin tocar el alcance.`,
      });
    }

    // P2 · Sillín demasiado adelantado
    //   Síntomas: cadera cerrada (torso muy horizontal) + codos muy flexionados (encogido)
    //   El ciclista está demasiado encima del pedalier, el tronco cae y los brazos se doblan para no chocar.
    if (low(hip_angle) && low(elbow_angle)) {
      explained.add('hip_angle'); explained.add('elbow_angle');
      recs.push({
        angle: 'Sillín (posición)',
        text: disc === 'triatlon'
          ? `Cadera muy cerrada + codos encogidos → sillín demasiado adelantado o nariz muy alta. ` +
            `Retrasa el sillín 5–10 mm y/o inclínalo ligeramente hacia abajo en la nariz.`
          : `Cadera muy cerrada + codos encogidos → sillín demasiado adelantado (KOPS positivo). ` +
            `Retrasa el sillín 5–10 mm. El tronco se incorporará y los brazos podrán extenderse con naturalidad.`,
      });
    }

    // P3 · Sillín claramente alto
    //   Síntomas: rodilla sobreextendida + tobillo en punta (compensación)
    if (high(knee_extension) && high(ankle_angle)) {
      explained.add('knee_extension'); explained.add('ankle_angle');
      const mtbNote = disc === 'mtb' ? ' Además, con el sillín alto en MTB pierdes control en bajadas.' : '';
      recs.push({
        angle: 'Sillín (altura)',
        text: `Rodilla sobreextendida + pedaleo de punta → sillín demasiado alto. ` +
              `Bájalo 5–8 mm. Resuelve ambos síntomas a la vez.${mtbNote}`,
      });
    }

    // P4 · Sillín claramente bajo
    //   Síntomas: rodilla muy flexionada + talón caído (el pie "busca" el pedal)
    if (low(knee_extension) && low(ankle_angle)) {
      explained.add('knee_extension'); explained.add('ankle_angle');
      recs.push({
        angle: 'Sillín (altura)',
        text: `Rodilla muy flexionada + talón caído → sillín demasiado bajo. ` +
              `Súbelo 5–8 mm. Ambos síntomas se corrigen a la vez. ` +
              `Riesgo de síndrome patelofemoral si se mantiene así.`,
      });
    }

    // P5 · Alcance excesivo puro (sin problema de sillín)
    //   Síntomas: codos bloqueados solo, cadera correcta o ligeramente cerrada
    //   (cadera cerrada + codos bloqueados = el ciclista alcanza bien pero con los brazos tensos)
    if (!explained.has('elbow_angle') && high(elbow_angle) && !high(hip_angle)) {
      explained.add('elbow_angle');
      const fix = disc === 'mtb'
        ? `Codos bloqueados → peligroso en MTB: cada golpe llega directo a muñecas y hombros. ` +
          `Acorta la potencia 1 talla o usa un manillar con más rise. Mantén siempre un ángulo de codo de ~150°.`
        : `Codos bloqueados → alcance demasiado largo. ` +
          `Acorta la potencia (−10 mm) o adelanta ligeramente el sillín (5 mm). ` +
          `No subas el manillar como solución principal: eso abriría más la cadera.`;
      recs.push({ angle: 'Codo', text: fix });
    }

    // P6 · Alcance insuficiente puro
    //   Síntomas: cadera abierta solo, codos correctos o flexionados
    //   (el ciclista está erguido porque no tiene reach, pero los codos no están bloqueados)
    if (!explained.has('hip_angle') && high(hip_angle) && !high(elbow_angle)) {
      explained.add('hip_angle');
      const fix = mode === 'aero'
        ? `Cadera demasiado abierta para posición aero. Baja el manillar o alarga la potencia.`
        : disc === 'mtb'
        ? `Cadera excesivamente abierta para XC. Prueba una potencia más larga (+10 mm) ` +
          `o un manillar con menos rise para inclinar el tronco.`
        : `Cadera excesivamente abierta → el alcance es insuficiente. ` +
          `El cuadro puede ser demasiado pequeño o la potencia muy corta. ` +
          `Prueba con una potencia +10 mm o un cuadro una talla mayor.`;
      recs.push({ angle: 'Cadera', text: fix });
    }

    // P7 · Cadera cerrada aislada (sin codos encogidos)
    if (!explained.has('hip_angle') && low(hip_angle)) {
      explained.add('hip_angle');
      const fix = disc === 'triatlon'
        ? `Cadera muy cerrada incluso para triatlón → riesgo de impingement de cadera y compresión del psoas. ` +
          `Inclina la nariz del sillín hacia abajo o desplaza los aero bars ligeramente hacia atrás.`
        : `Cadera demasiado cerrada → tronco muy horizontal, compresión del psoas. ` +
          `Sube el manillar (añade espaciadores) o acorta la potencia.`;
      recs.push({ angle: 'Cadera', text: fix });
    }

    // ─────────────────────────────────────────────────────
    // ÁNGULOS RESIDUALES — los que no han sido absorbidos
    // ─────────────────────────────────────────────────────

    // Rodilla residual
    if (!explained.has('knee_extension') && bad(knee_extension)) {
      if (knee_extension.delta < 0) {
        recs.push({ angle: 'Rodilla', text: `Rodilla muy flexionada en PMI. Sube el sillín 2–5 mm. Riesgo de síndrome patelofemoral anterior.` });
      } else {
        recs.push({ angle: 'Rodilla', text: disc === 'mtb'
          ? `Sobreextensión de rodilla. Baja el sillín 3–5 mm. En MTB esto también compromete el control en bajadas.`
          : `Sobreextensión de rodilla. Baja el sillín 2–4 mm para evitar balanceo pélvico y tendinitis aquílea.` });
      }
    }

    // Tobillo residual
    if (!explained.has('ankle_angle') && bad(ankle_angle)) {
      if (ankle_angle.delta > 0) {
        recs.push({ angle: 'Tobillo', text: `Pedaleo de "punta" (talón alto). Revisa las calas: si están demasiado atrás, adelántalas 2–3 mm. Si no mejora, baja el sillín ligeramente.` });
      } else {
        recs.push({ angle: 'Tobillo', text: disc === 'triatlon'
          ? `Talón muy caído en TT. Las calas muy adelantadas lo agravan. Revisa la posición de las calas.`
          : `Talón muy caído → pérdida de transferencia de potencia. Adelanta las calas o sube el sillín 2–3 mm. Puede ser hiperflexión plantar crónica.` });
      }
    }

    // Codo residual (solo si no fue absorbido y no entra en ningún patrón)
    if (!explained.has('elbow_angle') && bad(elbow_angle) && low(elbow_angle)) {
      recs.push({ angle: 'Codo', text: `Codos excesivamente flexionados → postura encogida. Alarga la potencia (+10 mm) o desplaza el sillín ligeramente hacia atrás.` });
    }

    // Tronco
    if (bad(trunk_angle)) {
      if (trunk_angle.delta > 0) {
        const fix = mode === 'aero'
          ? `Tronco muy vertical para modo aero (${discLabel}). Reduce espaciadores bajo la potencia o usa una potencia con ángulo negativo.`
          : disc === 'mtb'
          ? `Tronco excesivamente erguido para XC. Potencia más larga o manillar con menos rise.`
          : `Tronco más vertical de lo ideal. Comprueba primero el sillín (KOPS) antes de tocar el manillar.`;
        recs.push({ angle: 'Tronco', text: fix });
      } else {
        const fix = disc === 'mtb'
          ? `Tronco muy horizontal para MTB → pierdes visión y control técnico. Sube el manillar o usa risers más altos.`
          : disc === 'triatlon'
          ? `Tronco muy horizontal incluso para TT. Verifica que esta posición sea sostenible más de 30 min. Riesgo de cervicalgias.`
          : `Tronco muy horizontal → sobrecarga lumbar y cervical. Sube el manillar (espaciadores o potencia con ángulo positivo).`;
        recs.push({ angle: 'Tronco', text: fix });
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
