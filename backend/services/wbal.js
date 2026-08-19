// W'balance — modelo diferencial de Skiba (el mismo tipo que usan WKO/intervals.icu).
//
// Por encima de CP: agotamiento lineal.      dW'bal/dt = -(P - CP)
// Por debajo de CP: reconstitución exponencial hacia W', con una constante de
// tiempo τ que depende de cuánto por debajo de CP se está pedaleando (cuanto
// más suave, más rápido se recupera):
//   τ(DCP) = 546 · e^(-0.01·DCP) + 316   donde DCP = CP - P
//
// A diferencia de la curva de potencia (powerCurve.js), aquí un hueco de
// pausa en el stream SÍ debe contar como recuperación real — durante una
// pausa la potencia es efectivamente 0, que es < CP, así que el propio
// modelo de reconstitución ya lo trata correctamente sin necesidad de
// cortar el cálculo en ese punto.

/**
 * @param {number[]} timeArr  segundos desde el inicio de la actividad
 * @param {number[]} wattsArr vatios instantáneos, mismo índice que timeArr
 * @param {number} cp   Potencia Crítica del usuario (W)
 * @param {number} wPrime W' del usuario (julios)
 * @returns {{time:number[], wbal:number[], minWbal:number, pctDepleted:number}}
 */
function computeWBal(timeArr, wattsArr, cp, wPrime) {
  const empty = { time: [], wbal: [], minWbal: 0, pctDepleted: 0 };
  if (!Array.isArray(timeArr) || !Array.isArray(wattsArr)) return empty;
  if (!(Number(cp) > 0) || !(Number(wPrime) > 0)) return empty;

  const n = Math.min(timeArr.length, wattsArr.length);
  if (n === 0) return empty;

  const time = [];
  const wbalSeries = [];

  let wbal = wPrime;
  let prevT = Number(timeArr[0]);
  if (!Number.isFinite(prevT)) return empty;

  time.push(prevT);
  wbalSeries.push(Math.round(wbal));

  for (let i = 1; i < n; i++) {
    const t = Number(timeArr[i]);
    if (!Number.isFinite(t)) continue;
    const dt = t - prevT;
    if (!(dt > 0)) { prevT = t; continue; }

    const rawP = Number(wattsArr[i]);
    const power = Number.isFinite(rawP) ? rawP : 0;

    if (power > cp) {
      wbal -= (power - cp) * dt;
    } else {
      const dcp = cp - power;
      const tau = 546 * Math.exp(-0.01 * dcp) + 316;
      wbal = wPrime - (wPrime - wbal) * Math.exp(-dt / tau);
    }
    wbal = Math.max(0, Math.min(wPrime, wbal));

    prevT = t;
    time.push(t);
    wbalSeries.push(Math.round(wbal));
  }

  const minWbal = Math.min(...wbalSeries);
  const pctDepleted = Math.round((1 - minWbal / wPrime) * 100);
  return { time, wbal: wbalSeries, minWbal, pctDepleted };
}

module.exports = { computeWBal };
