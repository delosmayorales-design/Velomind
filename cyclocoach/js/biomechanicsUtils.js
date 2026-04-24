/**
 * js/biomechanicsUtils.js — VeloMind
 * Módulo de servicio para análisis biomecánico.
 * 100% agnóstico de la UI.
 */

const BiomechanicsUtils = (() => {
  const DEBUG_BIOMECHANICS = false;

  // 1. RANGOS BIOMECÁNICOS (CENTRALIZADOS)
  const BIKE_FIT_RANGES = {
    confort: {
      knee_extension: { min: 135, max: 145, optimal: 140 },
      hip_angle:      { min: 95,  max: 110, optimal: 105 }, 
      trunk_angle:    { min: 45,  max: 55,  optimal: 50  }, 
      elbow_angle:    { min: 150, max: 165, optimal: 155 },
      ankle_angle:    { min: 90,  max: 110, optimal: 100 }
    },
    rendimiento: {
      knee_extension: { min: 140, max: 150, optimal: 145 },
      hip_angle:      { min: 90,  max: 105, optimal: 100 },
      trunk_angle:    { min: 35,  max: 45,  optimal: 40  },
      elbow_angle:    { min: 150, max: 160, optimal: 155 },
      ankle_angle:    { min: 95,  max: 115, optimal: 105 }
    },
    aero: {
      knee_extension: { min: 142, max: 152, optimal: 148 },
      hip_angle:      { min: 85,  max: 100, optimal: 95  },
      trunk_angle:    { min: 20,  max: 35,  optimal: 25  },
      elbow_angle:    { min: 140, max: 155, optimal: 145 },
      ankle_angle:    { min: 100, max: 120, optimal: 110 }
    }
  };

  // 2. CÁLCULO DE ÁNGULOS (VECTORES ROBUSTOS)
  function calculateAngle(A, B, C) {
    if (!A || !B || !C) return null;

    const BA = { x: A.x - B.x, y: A.y - B.y };
    const BC = { x: C.x - B.x, y: C.y - B.y };

    const dot = BA.x * BC.x + BA.y * BC.y;
    const magBA = Math.sqrt(BA.x * BA.x + BA.y * BA.y);
    const magBC = Math.sqrt(BC.x * BC.x + BC.y * BC.y);

    if (magBA === 0 || magBC === 0) return 0;

    let cosAngle = dot / (magBA * magBC);
    cosAngle = Math.max(-1, Math.min(1, cosAngle)); // Prevención de NaN

    return Math.acos(cosAngle) * (180 / Math.PI);
  }

  function calculateTrunkAngle(shoulder, hip) {
    if (!shoulder || !hip) return null;
    const dx = shoulder.x - hip.x;
    const dy = hip.y - shoulder.y; // Invertido porque en Canvas Y crece hacia abajo
    const angleRad = Math.atan2(dy, Math.abs(dx));
    return angleRad * (180 / Math.PI);
  }

  // 3. VALIDACIÓN DE PUNTOS
  function validatePoints(points, debug = DEBUG_BIOMECHANICS) {
    const required = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'foot_tip'];
    const errors = [];
    const warnings = [];

    for (const p of required) {
      if (!points[p] || typeof points[p].x !== 'number' || typeof points[p].y !== 'number') {
        errors.push(`Falta el punto articular: ${p}`);
      }
    }

    if (errors.length > 0) return { isValid: false, errors, warnings };

    if (points.shoulder.y > points.hip.y) warnings.push("Hombro detectado por debajo de la cadera.");
    if (points.hip.y > points.knee.y) warnings.push("Cadera detectada por debajo de la rodilla.");
    if (points.knee.y > points.ankle.y) warnings.push("Rodilla detectada por debajo del tobillo.");

    return { isValid: true, errors, warnings };
  }

  // 4. EVALUACIÓN DE TOLERANCIAS
  function evaluateAngle(angle, range) {
    if (angle === null || !range) return { status: 'unknown', delta: 0 };

    const delta = angle - range.optimal;
    let status = 'ok';
    const TOLERANCE = 3; 

    if (angle < range.min) {
      status = (range.min - angle <= TOLERANCE) ? 'warning' : 'bad';
    } else if (angle > range.max) {
      status = (angle - range.max <= TOLERANCE) ? 'warning' : 'bad';
    }

    return { status, delta };
  }

  // 5. PROCESADOR PRINCIPAL
  function processBiomechanics(points, mode = 'rendimiento') {
    const validation = validatePoints(points);
    if (!validation.isValid) {
      return { isValid: false, errors: validation.errors };
    }

    const rawAngles = {
      knee_extension: calculateAngle(points.hip, points.knee, points.ankle),
      hip_angle:      calculateAngle(points.shoulder, points.hip, points.knee),
      elbow_angle:    calculateAngle(points.shoulder, points.elbow, points.wrist),
      ankle_angle:    calculateAngle(points.knee, points.ankle, points.foot_tip),
      trunk_angle:    calculateTrunkAngle(points.shoulder, points.hip)
    };

    const currentRanges = BIKE_FIT_RANGES[mode] || BIKE_FIT_RANGES.rendimiento;
    const evaluated = {};

    for (const [key, angleVal] of Object.entries(rawAngles)) {
      evaluated[key] = {
        value: angleVal,
        ...evaluateAngle(angleVal, currentRanges[key])
      };
    }

    return { isValid: true, warnings: validation.warnings, angles: evaluated, mode };
  }

  // 6. GENERADOR DE RECOMENDACIONES
  function getRecommendations(evaluatedAngles, mode) {
    if (!evaluatedAngles) return [];
    const recs = [];
    const { knee_extension, hip_angle, trunk_angle, elbow_angle, ankle_angle } = evaluatedAngles;

    if (knee_extension?.status !== 'ok') {
      recs.push({ angle: 'Rodilla', text: knee_extension.delta < 0 ? "Rodilla muy flexionada. Sube ligeramente el sillín (2-5mm) o retrásalo." : "Excesiva extensión de rodilla. Baja el sillín para evitar balanceo pélvico." });
    }
    if (hip_angle?.status !== 'ok') {
      recs.push({ angle: 'Cadera', text: hip_angle.delta < 0 ? "Ángulo de cadera muy cerrado. Acorta el alcance (reach) o eleva el manillar." : "Cadera excesivamente abierta. Si buscas aerodinámica, baja el manillar." });
    }
    if (trunk_angle?.status !== 'ok') {
      if (trunk_angle.delta > 0) recs.push({ angle: 'Tronco', text: mode === 'aero' ? "Tronco muy vertical para modo aero. Reduce espaciadores." : "Posición demasiado erguida. Revisa si el cuadro te queda corto." });
      else recs.push({ angle: 'Tronco', text: "Tronco muy horizontal. Riesgo de sobrecarga lumbar. Sube el manillar." });
    }
    if (elbow_angle?.status !== 'ok') {
      recs.push({ angle: 'Codo', text: elbow_angle.delta > 0 ? "Codos bloqueados. Acerca el manillar para relajar hombros." : "Codos excesivamente flexionados. Alarga la potencia." });
    }
    if (ankle_angle?.status !== 'ok') {
      recs.push({ angle: 'Tobillo', text: ankle_angle.delta > 0 ? "Pedaleo de 'punta' (talón muy alto). Suele compensar un sillín demasiado alto. Bájalo 2-3mm." : "Talón muy caído. Adelanta las calas o sube el sillín." });
    }

    if (recs.length === 0) recs.push({ angle: 'General', text: `¡Posición óptima! Ángulos dentro de los márgenes recomendados para modo ${mode}.` });
    return recs;
  }

  return {
    BIKE_FIT_RANGES,
    processBiomechanics,
    getRecommendations
  };
})();

window.BiomechanicsUtils = BiomechanicsUtils;