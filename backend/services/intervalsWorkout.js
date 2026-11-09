// Convierte los pasos de una sesión de VeloMind (FITWorkoutEncoder.buildSteps) al
// texto de entrenos de intervals.icu, que es lo que acaba llegando al Garmin.
//
// Los pasos van sin nombre a propósito: etiquetas como "Serie 1/5" llevan números
// que el intérprete de intervals.icu podría confundir con duraciones o potencias.
// Los objetivos van en vatios para respetar el FTP de VeloMind.

function formatDuration(totalSec) {
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = Math.round(totalSec % 60);
  return `${hours ? `${hours}h` : ''}${minutes ? `${minutes}m` : ''}${seconds ? `${seconds}s` : ''}`;
}

function formatTarget({ lo, hi }) {
  const low = Math.round(Number(lo) || 0);
  const high = Math.round(Number(hi) || 0);
  if (!low && !high) return '50%'; // paso sin objetivo de potencia: pedaleo suave
  if (!low || !high || low === high) return `${low || high}w`;
  return `${Math.min(low, high)}-${Math.max(low, high)}w`;
}

function stepLine(step) {
  return `- ${formatDuration(step.sec)} ${formatTarget(step)}`;
}

function sameStep(a, b) {
  return Boolean(a && b) && a.sec === b.sec && formatTarget(a) === formatTarget(b);
}

/** Pasos con los bloques trabajo/recuperación agrupados: Garmin limita los pasos por entreno. */
function stepsToIntervalsText(rawSteps) {
  const steps = (Array.isArray(rawSteps) ? rawSteps : [])
    .filter(step => !step?.isAlert && Number(step?.sec) > 0)
    .map(step => ({ ...step, sec: Math.round(Number(step.sec)) }));

  const blocks = [];
  let singles = [];
  const flushSingles = () => {
    if (singles.length) blocks.push(singles.join('\n'));
    singles = [];
  };

  for (let i = 0; i < steps.length;) {
    const work = steps[i];
    const rest = steps[i + 1];
    let reps = 0;
    if (rest && !sameStep(work, rest)) {
      while (sameStep(steps[i + reps * 2], work) && sameStep(steps[i + reps * 2 + 1], rest)) reps++;
    }
    if (reps >= 2) {
      flushSingles();
      blocks.push(`${reps}x\n${stepLine(work)}\n${stepLine(rest)}`);
      i += reps * 2;
    } else {
      singles.push(stepLine(work));
      i++;
    }
  }
  flushSingles();
  return blocks.join('\n\n');
}

module.exports = { stepsToIntervalsText };
