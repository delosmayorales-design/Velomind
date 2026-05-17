// Cálculos de entrenamiento compartidos por todas las rutas

const ZONES = [
  { id: 1, name: 'Z1 Recuperación', min: 0,    max: 0.55, color: '#6B7280' },
  { id: 2, name: 'Z2 Resistencia',  min: 0.55, max: 0.75, color: '#3B82F6' },
  { id: 3, name: 'Z3 Tempo',        min: 0.75, max: 0.90, color: '#10B981' },
  { id: 4, name: 'Z4 Umbral',       min: 0.90, max: 1.05, color: '#F59E0B' },
  { id: 5, name: 'Z5 VO₂Max',       min: 1.05, max: 1.20, color: '#EF4444' },
  { id: 6, name: 'Z6 Anaeróbico',   min: 1.20, max: 1.50, color: '#8B5CF6' },
  { id: 7, name: 'Z7 Neuromuscular',min: 1.50, max: 999,  color: '#EC4899' },
];

function calcIF(np, ftp) {
  if (!np || !ftp) return 0;
  return Math.round((np / ftp) * 100) / 100;
}

function calcTSS(np, durationSec, ftp) {
  if (!np || !durationSec || !ftp) return 0;
  const ifv = calcIF(np, ftp);
  return Math.round((durationSec * np * ifv) / (ftp * 3600) * 100);
}

function calcVI(np, avgPower) {
  if (!np || !avgPower || avgPower <= 0) return 0;
  return Math.round((np / avgPower) * 100) / 100;
}

function getZone(power, ftp) {
  if (!ftp || !power) return null;
  const pct = power / ftp;
  return ZONES.find(z => pct >= z.min && pct < z.max) || ZONES[ZONES.length - 1];
}

function getTSBStatus(tsb) {
  if (tsb > 25)  return { label: 'Muy fresco',     color: '#3B82F6', risk: 'bajo',     advice: 'Puedes atacar una sesión exigente hoy.' };
  if (tsb > 5)   return { label: 'Fresco',          color: '#10B981', risk: 'bajo',     advice: 'Buen momento para entrenar con calidad.' };
  if (tsb > -10) return { label: 'En forma',        color: '#9ED62B', risk: 'bajo',     advice: 'Estás equilibrado: fit y sin exceso de fatiga.' };
  if (tsb > -20) return { label: 'Cansado',         color: '#F59E0B', risk: 'medio',    advice: 'Entrena suave o descansa. La fatiga empieza a notarse.' };
  if (tsb > -30) return { label: 'Fatigado',        color: '#EF4444', risk: 'alto',     advice: 'Reduce la carga. Tu cuerpo necesita recuperación.' };
  return           { label: 'Sobreentrenado',        color: '#8B5CF6', risk: 'muy alto', advice: 'Para. Necesitas descanso activo varios días.' };
}

module.exports = { ZONES, calcIF, calcTSS, calcVI, getZone, getTSBStatus };
