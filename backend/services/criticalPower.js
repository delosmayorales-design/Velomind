const supabase = require('../db');

// Duraciones medio-largas usadas para el ajuste — se excluyen adrede las
// cortas (5s-60s, dominio anaeróbico/neuromuscular, rompen el supuesto
// hiperbólico) y la de 60min (sesgo hacia FTP, aplana el ajuste).
const CP_FIT_DURATIONS = [180, 300, 600, 1200];
const MIN_POINTS = 3;
const MIN_R2 = 0.5;

/**
 * Ajusta el modelo hiperbólico de 2 parámetros P = CP + W'/t mediante
 * regresión lineal de P contra 1/t (x = 1/t, y = P → intercepto = CP, pendiente = W').
 * Solo debe alimentarse con best_efforts REALES (nunca con la heurística de
 * respaldo de coach.js) — ajustar un modelo fisiológico a una estimación de
 * sí misma no tiene sentido.
 *
 * @param {Object<number, number>} effortsByDuration { [durSec]: watts }
 * @returns {{cp:number, wPrime:number, r2:number} | null}
 */
function fitCriticalPower(effortsByDuration) {
  if (!effortsByDuration || typeof effortsByDuration !== 'object') return null;

  const points = [];
  for (const dur of CP_FIT_DURATIONS) {
    const p = Number(effortsByDuration[dur]);
    if (Number.isFinite(p) && p > 0) points.push({ x: 1 / dur, y: p });
  }
  if (points.length < MIN_POINTS) return null;

  const n = points.length;
  const sumX  = points.reduce((s, p) => s + p.x, 0);
  const sumY  = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null; // todas las x iguales — degenerado

  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const cp = intercept;
  const wPrime = slope;
  if (!(cp > 0) || !(wPrime > 0)) return null;

  // R² del ajuste
  const meanY = sumY / n;
  const ssTot = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  const ssRes = points.reduce((s, p) => {
    const pred = intercept + slope * p.x;
    return s + (p.y - pred) ** 2;
  }, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  if (r2 < MIN_R2) return null;

  return {
    cp: Math.round(cp),
    wPrime: Math.round(wPrime),
    r2: Math.round(r2 * 1000) / 1000,
  };
}

/**
 * Recalcula CP/W' de un usuario a partir del histórico real de best_efforts
 * ya guardado en `activities` (no dispara ninguna petición a Strava).
 * Si el ajuste no es posible (datos insuficientes), no toca un valor previo
 * válido — solo actualiza cuando hay un ajuste nuevo y confiable.
 */
async function recalculateCP(userId) {
  try {
    const { data: acts } = await supabase
      .from('activities')
      .select('best_efforts')
      .eq('user_id', userId)
      .not('best_efforts', 'is', null);

    if (!acts || !acts.length) return;

    // Mejor esfuerzo real por duración a través de todo el histórico
    const aggregated = {};
    for (const a of acts) {
      const efforts = a.best_efforts;
      if (!efforts || typeof efforts !== 'object') continue;
      for (const dur of CP_FIT_DURATIONS) {
        const p = Number(efforts[dur]);
        if (Number.isFinite(p) && p > (aggregated[dur] || 0)) aggregated[dur] = p;
      }
    }

    const fit = fitCriticalPower(aggregated);
    if (!fit) return;

    await supabase.from('users').update({
      critical_power: fit.cp,
      w_prime: fit.wPrime,
      cp_updated_at: new Date().toISOString(),
    }).eq('id', userId);
  } catch (e) {
    console.error('[CriticalPower] Error en recalculateCP:', e.message);
  }
}

module.exports = { fitCriticalPower, recalculateCP, CP_FIT_DURATIONS };
