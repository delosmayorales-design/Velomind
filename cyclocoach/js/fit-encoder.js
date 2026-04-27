/* VeloMind — Workout TCX Encoder
 * Generates Garmin-compatible .tcx workout files for Garmin Connect
 * TCX (Training Center XML) v2 — accepted by Garmin Connect, Zwift, TrainingPeaks
 */
const FITWorkoutEncoder = (() => {
  'use strict';

  function escapeXml(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Build structured workout steps from a TrainingPlanGenerator session
  function buildSteps(session, ftp) {
    if (!ftp || ftp < 50) ftp = 200;
    const w = (lo, hi) => ({ lo: Math.round(ftp * lo), hi: Math.round(ftp * hi) });

    if (session.isRest) {
      return [{ name:'Descanso', open:true, intensity:1, lo:0, hi:0 }];
    }

    const type    = session.type || 'endurance';
    const durMin  = Math.max(30, session.durationMin || 60);
    const warmMin = Math.min(15, Math.round(durMin * 0.2));
    const coolMin = Math.min(10, Math.round(durMin * 0.15));
    const mainMin = Math.max(20, durMin - warmMin - coolMin);

    const warmup   = (min) => ({ name:'Calentamiento', sec:min*60, intensity:2, ...w(0.50,0.55) });
    const cooldown = (min) => ({ name:'Enfriamiento',  sec:min*60, intensity:3, ...w(0.45,0.55) });
    const rest     = (min) => ({ name:'Recuperacion',  sec:min*60, intensity:1, ...w(0.45,0.55) });

    const steps = [];

    if (type === 'recovery') {
      steps.push({ name:'Recuperacion activa', sec:durMin*60, intensity:0, ...w(0.40,0.55) });

    } else if (type === 'endurance' || type === 'long') {
      steps.push(warmup(warmMin));
      steps.push({ name:'Z2 Endurance', sec:mainMin*60, intensity:0, ...w(0.56,0.75) });
      steps.push(cooldown(coolMin));

    } else if (type === 'tempo') {
      const b1 = Math.round(mainMin * 0.6), b2 = mainMin - b1;
      steps.push(warmup(15));
      steps.push({ name:'Sweet Spot',  sec:b1*60, intensity:0, ...w(0.76,0.88) });
      steps.push({ name:'Tempo Z3-Z4', sec:b2*60, intensity:0, ...w(0.88,1.00) });
      steps.push(cooldown(coolMin));

    } else if (type === 'threshold') {
      const numReps = durMin > 70 ? 3 : 2;
      const restMin = 5;
      const workMin = Math.max(10, Math.round((mainMin - numReps * restMin) / numReps));
      steps.push(warmup(15));
      for (let i = 0; i < numReps; i++) {
        steps.push({ name:`Umbral ${i+1}/${numReps}`, sec:workMin*60, intensity:0, ...w(0.93,1.03) });
        if (i < numReps - 1) steps.push(rest(restMin));
      }
      steps.push(cooldown(coolMin));

    } else if (type === 'vo2max') {
      const numReps = 4, workMin = 4, restMin = 4;
      steps.push(warmup(20));
      for (let i = 0; i < numReps; i++) {
        steps.push({ name:`VO2Max ${i+1}/${numReps}`, sec:workMin*60, intensity:0, ...w(1.06,1.20) });
        if (i < numReps - 1) steps.push(rest(restMin));
      }
      steps.push(cooldown(15));

    } else if (type === 'sprint') {
      const numSprints = 6;
      steps.push(warmup(20));
      for (let i = 0; i < numSprints; i++) {
        steps.push({ name:`Sprint ${i+1}/${numSprints}`, sec:20, intensity:0, ...w(1.50,2.00) });
        steps.push(rest(3));
      }
      steps.push(cooldown(20));

    } else if (type === 'strength') {
      const numReps = 4;
      const workMin = Math.max(8, Math.round(mainMin / (numReps * 2)));
      steps.push(warmup(15));
      for (let i = 0; i < numReps; i++) {
        steps.push({ name:`Fuerza ${i+1}/${numReps}`, sec:workMin*60, intensity:0, ...w(0.80,0.95) });
        if (i < numReps - 1) steps.push(rest(Math.round(workMin * 0.6)));
      }
      steps.push(cooldown(15));

    } else if (type === 'race') {
      steps.push({ name:'Activacion', sec:15*60, intensity:2, ...w(0.55,0.65) });
      steps.push({ name:'Agudeza',    sec: 5*60, intensity:0, ...w(0.90,0.95) });
      steps.push(cooldown(10));

    } else {
      steps.push(warmup(warmMin));
      steps.push({ name:'Esfuerzo principal', sec:mainMin*60, intensity:0,
                   lo: Math.round((session.targetWatts||ftp*0.65)*0.95),
                   hi: Math.round((session.targetWatts||ftp*0.65)*1.05) });
      steps.push(cooldown(coolMin));
    }

    return steps;
  }

  // Encode workout steps to TCX XML string
  function encodeTCX(workoutName, steps) {
    const stepXml = steps.map((s, i) => {
      const intensity = s.intensity === 1 ? 'Rest' : 'Active';

      const duration = s.open
        ? '<Duration xsi:type="UserInitiated_t"/>'
        : `<Duration xsi:type="Time_t"><Seconds>${s.sec}</Seconds></Duration>`;

      // Power info en el nombre — CustomPowerZone_t no está en el schema público TCX v2
      const powerSuffix = (s.lo > 0 && s.hi > 0) ? ` ${s.lo}-${s.hi}W` : '';
      const stepName    = escapeXml((s.name || 'Paso') + powerSuffix);

      return `    <Step xsi:type="Step_t">
      <StepId>${i + 1}</StepId>
      <Name>${stepName}</Name>
      ${duration}
      <Intensity>${intensity}</Intensity>
      <Target xsi:type="None_t"/>
    </Step>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">
  <Workouts>
    <Workout Sport="Biking">
      <Name>${escapeXml(workoutName)}</Name>
${stepXml}
    </Workout>
  </Workouts>
</TrainingCenterDatabase>`;
  }

  // Trigger browser download
  function download(filename, content) {
    const blob = new Blob([content], { type: 'application/xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Sanitize string for filename
  function sanitize(str) {
    return (str || 'workout')
      .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
      .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n')
      .replace(/[^a-zA-Z0-9_\-]/g,'_').slice(0, 40);
  }

  // Export a single session to .tcx
  function exportSession(session, ftp) {
    if (session.isRest) { alert('Los días de descanso no necesitan exportarse.'); return; }
    const wt           = (typeof WORKOUT_TYPES !== 'undefined' && WORKOUT_TYPES[session.type]) || {};
    const sessionLabel = (wt.label || session.name || session.type || 'Entrenamiento').slice(0, 40);
    const filename     = `VeloMind_${sanitize(session.day)}_${sanitize(sessionLabel)}.tcx`;
    const steps        = buildSteps(session, ftp);
    const xml          = encodeTCX(sessionLabel, steps);
    download(filename, xml);
  }

  // Export all non-rest sessions
  function exportWeek(sessions, ftp) {
    const trainSessions = sessions.filter(s => !s.isRest);
    if (!trainSessions.length) { alert('No hay sesiones de entrenamiento esta semana.'); return; }
    let i = 0;
    function next() {
      if (i >= trainSessions.length) return;
      exportSession(trainSessions[i++], ftp);
      if (i < trainSessions.length) setTimeout(next, 600);
    }
    next();
  }

  return { buildSteps, encodeTCX, download, exportSession, exportWeek };
})();

window.FITWorkoutEncoder = FITWorkoutEncoder;
