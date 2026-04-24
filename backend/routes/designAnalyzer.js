/**
 * Analiza el diseño de la equipación y evalúa su impacto en el rendimiento
 * simulando un motor de IA experto en materiales y aerodinámica.
 */

// Calcula el brillo relativo de un color HEX (0 oscuro - 255 claro)
const calculateBrightness = (hex) => {
  const color = hex.charAt(0) === '#' ? hex.substring(1, 7) : hex;
  const r = parseInt(color.substring(0, 2), 16);
  const g = parseInt(color.substring(2, 4), 16);
  const b = parseInt(color.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
};

export const evaluateDesign = (config) => {
  const { baseColor, sidePanels, fit, season } = config;
  
  const brightness = calculateBrightness(baseColor || '#ffffff');
  const isDark = brightness < 120;

  let thermal = 'Media';
  let breathability = 'Media';
  let aero = 'Media';
  let advice = [];

  // 1. Evaluación Térmica
  if (season === 'summer') {
    thermal = isDark ? 'Baja' : 'Alta';
    if (isDark) advice.push("⚠️ Los colores oscuros absorben más radiación infrarroja. No es el diseño ideal para días de >25ºC.");
    else advice.push("✅ Color claro excelente para reflejar el sol y mantener la temperatura central baja.");
  } else {
    thermal = isDark ? 'Alta' : 'Media';
    if (isDark) advice.push("✅ Color oscuro ideal para retener temperatura en entrenamientos invernales.");
  }

  // 2. Evaluación de Transpirabilidad
  if (sidePanels === 'mesh') {
    breathability = 'Alta';
    advice.push("✅ Paneles laterales de malla maximizan la ventilación en zonas de alta sudoración.");
  } else if (sidePanels === 'solid') {
    breathability = season === 'summer' ? 'Media' : 'Alta';
    if (season === 'summer') advice.push("💡 Considera paneles de malla para mejorar la evaporación del sudor en verano.");
  }

  // 3. Evaluación Aerodinámica
  if (fit === 'aero') {
    aero = 'Alta';
    advice.push("🚀 Ajuste Race/Aero: reduce el drag aerodinámico. Ahorro estimado de ~10-15W a 40km/h frente a cortes relajados.");
  } else if (fit === 'relaxed') {
    aero = 'Baja';
    advice.push("⚖️ Ajuste Club/Relaxed: prioriza la comodidad sobre la velocidad. Ideal para ultra-distancia o gravel tranquilo.");
  }

  return {
    thermal,
    breathability,
    aero,
    advice
  };
};