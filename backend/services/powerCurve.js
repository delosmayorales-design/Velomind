// Curva de potencia real: mejor potencia media por duración a partir de un
// stream de vatios de Strava (time[] en segundos desde el inicio, watts[]).
//
// Los streams de Strava pueden tener huecos (pausas del dispositivo) — un
// salto grande entre dos muestras consecutivas se trata como una pausa y
// ninguna ventana de cálculo puede "saltarla" como si fuera esfuerzo continuo.

const DEFAULT_DURATIONS = [5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600];
const GAP_THRESHOLD_S = 30;

/**
 * @param {number[]} timeArr  segundos desde el inicio de la actividad
 * @param {number[]} wattsArr vatios instantáneos, mismo índice que timeArr
 * @param {number[]} durations duraciones objetivo en segundos
 * @returns {Object<number, number>} { [durSec]: mejorVatiosMedios }
 */
function extractBestEfforts(timeArr, wattsArr, durations = DEFAULT_DURATIONS) {
  const result = {};
  if (!Array.isArray(timeArr) || !Array.isArray(wattsArr)) return result;

  const n = Math.min(timeArr.length, wattsArr.length);
  const points = [];
  for (let i = 0; i < n; i++) {
    const t = Number(timeArr[i]);
    const w = Number(wattsArr[i]);
    if (!Number.isFinite(t) || !Number.isFinite(w) || w < 0) continue;
    points.push({ t, w });
  }
  if (points.length < 2) return result;

  // Partir en segmentos continuos — un hueco de pausa corta la ventana.
  const segments = [[points[0]]];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].t - points[i - 1].t;
    if (dt > GAP_THRESHOLD_S || dt <= 0) segments.push([]);
    segments[segments.length - 1].push(points[i]);
  }

  for (const dur of durations) {
    let best = 0;
    for (const seg of segments) {
      if (seg.length < 2) continue;
      let left = 0;
      let sum = 0; // watt-segundos acumulados entre seg[left] y el punto actual
      for (let right = 1; right < seg.length; right++) {
        sum += seg[right - 1].w * (seg[right].t - seg[right - 1].t);

        // Encoger por la izquierda mientras el tramo siga cubriendo >= dur
        while (left < right - 1 && (seg[right].t - seg[left + 1].t) >= dur) {
          sum -= seg[left].w * (seg[left + 1].t - seg[left].t);
          left++;
        }

        const span = seg[right].t - seg[left].t;
        if (span >= dur && span > 0) {
          const avg = sum / span;
          if (avg > best) best = avg;
        }
      }
    }
    if (best > 0) result[dur] = Math.round(best);
  }

  return result;
}

module.exports = { extractBestEfforts, DEFAULT_DURATIONS };
