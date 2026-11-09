// Estimación de VO2max a partir de potencia.
//
// Ecuación: VO2max = 16.6 + 8.87 × (potencia de 5 min en W/kg)
// Sitko et al., Int J Sports Physiol Perform, 2022. Una validación externa
// posterior (2024) encontró que puede quedarse corta, así que el valor se
// presenta siempre como estimación.
//
// Solo se usan best_efforts reales (streams de potencia). La potencia de 5 min
// "estimada" de /power-curve sale de la NP de la salida y aquí falsearía el dato.

const FIVE_MIN_KEY = 300;
const WINDOW_DAYS = 90;
const HISTORY_MONTHS = 12;
const LOOKBACK_MONTHS = HISTORY_MONTHS + 3;
const DAY_MS = 86400000;

// Por encima de esto es un fallo del potenciómetro, no un esfuerzo real.
const MAX_FIVE_MIN_WKG = 9;
const MAX_FIVE_MIN_FTP_RATIO = 2;

// Un esfuerzo de 5 min máximo está claramente por encima del FTP. Si el mejor
// de la ventana no llega, no hubo esfuerzo máximo y subestimaría el VO2max.
const MIN_MAXIMAL_FTP_RATIO = 1.05;

// Sin esfuerzo máximo reciente: el FTP suele rondar el 80-85 % de la potencia de 5 min.
const FTP_TO_FIVE_MIN = 1.2;

function vo2FromFiveMin(watts, weight) {
  return 16.6 + 8.87 * (watts / weight);
}

function dayMs(date) {
  return Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`);
}

function bestFiveMin(activities, { fromMs, toMs, weight, ftp }) {
  let best = null;
  for (const activity of activities) {
    const watts = Number(activity.best_efforts?.[FIVE_MIN_KEY]);
    if (!(watts > 0) || watts / weight > MAX_FIVE_MIN_WKG) continue;
    if (ftp > 0 && watts > ftp * MAX_FIVE_MIN_FTP_RATIO) continue;
    const ms = dayMs(activity.date);
    if (!(ms >= fromMs && ms <= toMs)) continue;
    if (!best || watts > best.watts) {
      best = { watts: Math.round(watts), date: String(activity.date).slice(0, 10) };
    }
  }
  return best;
}

function buildHistory(activities, { now, weight, ftp }) {
  const history = [];
  for (let i = HISTORY_MONTHS - 1; i >= 0; i--) {
    const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0, 23, 59, 59);
    const toMs = i === 0 ? now.getTime() : monthEnd;
    const best = bestFiveMin(activities, { fromMs: toMs - WINDOW_DAYS * DAY_MS, toMs, weight, ftp });
    if (best) {
      history.push({
        month: new Date(toMs).toISOString().slice(0, 7),
        value: Math.round(vo2FromFiveMin(best.watts, weight)),
      });
    }
  }
  return history;
}

/**
 * @returns {null|{value:number, method:'power5'|'ftp', power5:null|{watts:number,date:string},
 *                 weight:number, history:{month:string,value:number}[]}}
 */
function estimateVo2max({ activities = [], ftp, weight, now = new Date() }) {
  if (!(weight > 0)) return null;
  const safeFtp = ftp > 0 ? ftp : 0;
  const toMs = now.getTime();
  const best = bestFiveMin(activities, {
    fromMs: toMs - WINDOW_DAYS * DAY_MS, toMs, weight, ftp: safeFtp,
  });

  if (best && best.watts >= safeFtp * MIN_MAXIMAL_FTP_RATIO) {
    return {
      value: Math.round(vo2FromFiveMin(best.watts, weight)),
      method: 'power5',
      power5: best,
      weight,
      history: buildHistory(activities, { now, weight, ftp: safeFtp }),
    };
  }

  if (safeFtp > 0) {
    return {
      value: Math.round(vo2FromFiveMin(safeFtp * FTP_TO_FIVE_MIN, weight)),
      method: 'ftp',
      power5: null,
      weight,
      history: [],
    };
  }

  return null;
}

module.exports = { estimateVo2max, LOOKBACK_MONTHS };
