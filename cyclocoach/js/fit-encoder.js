/* VeloMind — Workout Encoder
 * Exporta entrenamientos en TCX (Garmin Connect) y ZWO (Zwift / rodillo inteligente)
 */
const FITWorkoutEncoder = (() => {
  'use strict';

  function escapeXml(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Garmin rejects step names with non-ASCII Unicode (e.g. subscript ₂).
  // This normalises to plain ASCII before writing into the TCX.
  function asciiName(str) {
    return (str || '')
      .replace(/[áàâä]/g,'a').replace(/[éèêë]/g,'e').replace(/[íìîï]/g,'i')
      .replace(/[óòôö]/g,'o').replace(/[úùûü]/g,'u').replace(/ñ/g,'n')
      .replace(/[₀-₉]/g, c => String(c.codePointAt(0) - 0x2080))
      .replace(/[⁰-⁹]/g, c => String(c.codePointAt(0) - 0x2070))
      .replace(/[^\x20-\x7E]/g, '')
      .trim().slice(0, 15);
  }

  function pct(watts, ftp) {
    return (watts / ftp).toFixed(3);
  }

  function sanitize(str) {
    return (str || 'workout')
      .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
      .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n')
      .replace(/[^a-zA-Z0-9_\-]/g,'_').slice(0, 40);
  }

  function download(filename, content) {
    const blob = new Blob([content], { type: 'application/xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Build structured workout steps from a TrainingPlanGenerator session.
  // Replicates the EXACT same duration/rep calculations as _buildIntervals() in app.js
  // so that the exported FIT matches what VeloMind shows on screen.
  function buildSteps(session, ftp) {
    if (!ftp || ftp < 50) ftp = 200;
    const p  = (r) => Math.round(ftp * r);
    const w  = (lo, hi) => ({ lo: p(lo), hi: p(hi) });

    if (session.isRest) {
      return [{ name:'Descanso', open:true, intensity:1, lo:0, hi:0 }];
    }

    const type    = session.type || 'endurance';
    const durMin  = Math.max(30, session.durationMin || 60);
    const variant = session.intervalVariant || 'main';
    const ifTgt   = session.ifTarget || 0.75;

    // Mirror _buildIntervals warm/cool/main calculation
    let warm = Math.max(10, Math.round(durMin * 0.2));
    let cool = Math.max(10, Math.round(durMin * 0.15));
    let main = Math.max(0, durMin - warm - cool);

    if (main < 10 && type !== 'recovery') {
      return [{ name:'Rodaje', sec:durMin*60, intensity:0, ...w(0.55,0.70) }];
    }

    const warmup   = (min) => ({ name:'Calentamiento', sec:min*60, intensity:2, ...w(0.55,0.70) });
    const cooldown = (min) => ({ name:'Enfriamiento',  sec:Math.max(1,min)*60, intensity:3, ...w(0.45,0.60) });
    const rest     = (min) => ({ name:'Recuperacion',  sec:Math.max(1,min)*60, intensity:1, ...w(0.45,0.55) });

    const steps = [];

    switch (type) {

      case 'recovery':
        if (variant === 'main') {
          steps.push({ name:'Pedaleo Z1', sec:durMin*60, intensity:0, ...w(0.45,0.55) });
        } else {
          steps.push({ name:'Pedaleo Z1', sec:Math.max(1,durMin-5)*60, intensity:0, ...w(0.45,0.55) });
          for (let i = 0; i < 3; i++) {
            steps.push({ name:'Aceleracion', sec:10, intensity:0, lo:0, hi:0 });
            steps.push({ name:'Recuperacion', sec:50, intensity:1, ...w(0.40,0.50) });
          }
          steps.push({ name:'Vuelta calma', sec:2*60, intensity:3, ...w(0.40,0.50) });
        }
        break;

      case 'endurance':
      case 'long':
        warm = Math.max(10, Math.round(durMin * 0.15));
        cool = Math.max(10, Math.round(durMin * 0.10));
        main = durMin - warm - cool;
        steps.push(warmup(warm));
        if (ifTgt >= 0.70 && type === 'endurance' && main >= 30) {
          const ssBlock = 10;
          const ssRec   = Math.max(3, Math.round(main * 0.10));
          const z2Block = Math.max(10, main - ssBlock * 2 - ssRec);
          steps.push({ name:'Z2 Aerobico', sec:z2Block*60, intensity:0, ...w(0.60,0.70) });
          for (let i = 0; i < 2; i++) {
            steps.push({ name:'Sweetspot', sec:ssBlock*60, intensity:0, ...w(0.88,0.93) });
            if (i < 1) steps.push({ name:'Rec Z2', sec:ssRec*60, intensity:1, ...w(0.60,0.68) });
          }
        } else if (variant === 'main') {
          steps.push({ name:'Z2 Endurance', sec:main*60, intensity:0, ...w(0.56,0.75) });
        } else {
          const blocks = Math.floor(main / 20);
          if (blocks >= 2) {
            for (let b = 0; b < blocks; b++) {
              steps.push({ name:'Z2 Aerobico', sec:18*60, intensity:0, ...w(0.60,0.70) });
              if (b < blocks - 1) steps.push({ name:'Rec', sec:2*60, intensity:1, ...w(0.50,0.55) });
            }
          } else {
            steps.push({ name:'Z2 Endurance', sec:main*60, intensity:0, ...w(0.56,0.75) });
          }
        }
        steps.push(cooldown(cool));
        break;

      case 'tempo':
        steps.push(warmup(warm));
        if (variant === 'main') {
          if (main >= 25) {
            const blockTime = Math.floor(main / 2.5);
            const recTime   = main - blockTime * 2;
            for (let i = 0; i < 2; i++) {
              steps.push({ name:`Tempo ${i+1}/2`, sec:blockTime*60, intensity:0, ...w(0.76,0.88) });
              if (i < 1) steps.push(rest(recTime));
            }
          } else {
            steps.push({ name:'Sweet Spot', sec:main*60, intensity:0, ...w(0.76,0.88) });
          }
        } else {
          const reps      = 4;
          const blockTime = Math.floor((main * 0.8) / reps);
          const recTime   = Math.floor((main * 0.2) / (reps - 1));
          for (let i = 0; i < reps; i++) {
            steps.push({ name:`Z3 ${i+1}/${reps}`, sec:blockTime*60, intensity:0, ...w(0.80,0.88) });
            if (i < reps - 1) steps.push(rest(recTime));
          }
          cool += main - (reps * blockTime + (reps - 1) * recTime);
        }
        steps.push(cooldown(cool));
        break;

      case 'threshold':
        steps.push(warmup(warm));
        if (variant === 'main') {
          let repsTh = main > 40 ? 3 : 2;
          let workTh = Math.floor((main * 0.75) / repsTh);
          let recTh  = Math.floor((main * 0.25) / (repsTh - 1));
          if (workTh < 8) { repsTh = 1; workTh = main; recTh = 0; }
          cool += main - (repsTh * workTh + (repsTh > 1 ? repsTh - 1 : 0) * recTh);
          for (let i = 0; i < repsTh; i++) {
            steps.push({ name:`Umbral ${i+1}/${repsTh}`, sec:workTh*60, intensity:0, ...w(0.93,1.03) });
            if (i < repsTh - 1) steps.push(rest(recTh));
          }
        } else {
          const repsOU    = 3;
          const blockTime = Math.floor((main * 0.75) / repsOU);
          const recTime   = Math.floor((main * 0.25) / (repsOU - 1));
          cool += main - (repsOU * blockTime + (repsOU - 1) * recTime);
          for (let i = 0; i < repsOU; i++) {
            const ouLow  = Math.round(blockTime * 2 / 3);
            const ouHigh = blockTime - ouLow;
            steps.push({ name:`OU ${i+1}/${repsOU} base`, sec:ouLow*60,  intensity:0, ...w(0.90,0.90) });
            steps.push({ name:`OU ${i+1}/${repsOU} pico`, sec:ouHigh*60, intensity:0, ...w(1.05,1.05) });
            if (i < repsOU - 1) steps.push(rest(recTime));
          }
        }
        steps.push(cooldown(cool));
        break;

      case 'vo2max':
        steps.push(warmup(warm));
        if (variant === 'main') {
          let repWorkV = 4, repRestV = 4;
          let repsV = Math.floor(main / (repWorkV + repRestV));
          if (repsV < 3 && main >= 15) { repWorkV = 3; repRestV = 3; repsV = Math.floor(main / 6); }
          if (repsV < 2) { repsV = 2; repWorkV = Math.floor(main / 4); repRestV = Math.floor(main / 4); }
          cool += main - repsV * (repWorkV + repRestV);
          for (let i = 0; i < repsV; i++) {
            steps.push({ name:`VO2Max ${i+1}/${repsV}`, sec:repWorkV*60, intensity:0, ...w(1.06,1.20) });
            steps.push(rest(repRestV));
          }
        } else {
          // Micro-intervalos: 40s ON @ 115% / 20s OFF @ 50% en bloques de blockDur min
          let blockDur = 8, restDur = 4;
          let repsMicro = Math.floor(main / (blockDur + restDur));
          if (repsMicro < 2) { repsMicro = 2; blockDur = 6; restDur = 3; }
          cool += main - repsMicro * (blockDur + restDur);
          const repsPerBlock = blockDur; // 1 rep = 40s+20s = 60s = 1 min
          for (let i = 0; i < repsMicro; i++) {
            for (let j = 0; j < repsPerBlock; j++) {
              steps.push({ name:'ON 40s',  sec:40, intensity:0, ...w(1.15,1.15) });
              steps.push({ name:'OFF 20s', sec:20, intensity:1, ...w(0.50,0.50) });
            }
            steps.push(rest(restDur));
          }
        }
        steps.push(cooldown(cool));
        break;

      case 'sprint':
        steps.push(warmup(warm));
        if (variant === 'main') {
          let sprintReps = Math.floor(main / 3);
          if (sprintReps < 4)  sprintReps = 4;
          if (sprintReps > 12) sprintReps = 12;
          cool += main - sprintReps * 3;
          for (let i = 0; i < sprintReps; i++) {
            steps.push({ name:`Sprint ${i+1}/${sprintReps}`, sec:20, intensity:0, ...w(1.50,2.00) });
            steps.push({ name:'Recuperacion', sec:160, intensity:1, ...w(0.40,0.55) }); // 2m40s
          }
        } else {
          let sprintReps = Math.floor(main / 4);
          if (sprintReps < 4)  sprintReps = 4;
          if (sprintReps > 10) sprintReps = 10;
          cool += main - sprintReps * 4;
          for (let i = 0; i < sprintReps; i++) {
            steps.push({ name:`Sprint ${i+1}/${sprintReps}`, sec:12, intensity:0, ...w(2.00,2.00) });
            steps.push({ name:'Recuperacion', sec:228, intensity:1, ...w(0.40,0.55) }); // 3m48s
          }
        }
        steps.push(cooldown(cool));
        break;

      case 'strength': {
        steps.push(warmup(warm));
        const repsS = variant === 'main' ? 4 : 3;
        const workS = Math.floor((main * 0.8) / repsS);
        const recS  = Math.floor((main * 0.2) / repsS);
        const loS   = variant === 'main' ? 0.80 : 0.85;
        const hiS   = variant === 'main' ? 0.95 : 1.00;
        for (let i = 0; i < repsS; i++) {
          steps.push({ name:`Fuerza ${i+1}/${repsS}`, sec:workS*60, intensity:0, ...w(loS,hiS) });
          steps.push(rest(recS));
        }
        steps.push(cooldown(cool));
        break;
      }

      case 'race':
        steps.push({ name:'Activacion', sec:15*60, intensity:2, ...w(0.55,0.65) });
        steps.push({ name:'Agudeza',    sec: 5*60, intensity:0, ...w(0.90,0.95) });
        steps.push(cooldown(10));
        break;

      default:
        steps.push(warmup(warm));
        steps.push({ name:'Esfuerzo principal', sec:main*60, intensity:0,
                     lo: Math.round((session.targetWatts || p(0.65)) * 0.95),
                     hi: Math.round((session.targetWatts || p(0.65)) * 1.05) });
        steps.push(cooldown(cool));
    }

    return steps;
  }

  // ── TCX (Garmin Connect) ───────────────────────────────────────────────────

  function encodeTCX(workoutName, steps) {
    const stepXml = steps.map((s, i) => {
      const intensity   = s.intensity === 1 ? 'Rest' : 'Active';
      const duration    = s.open
        ? '<Duration xsi:type="UserInitiated_t"/>'
        : `<Duration xsi:type="Time_t"><Seconds>${s.sec}</Seconds></Duration>`;
      const powerSuffix = (s.lo > 0 && s.hi > 0) ? ` ${s.lo}-${s.hi}W` : '';
      const stepName    = escapeXml(asciiName((s.name || 'Paso') + powerSuffix));
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
      <Name>${escapeXml(asciiName(workoutName))}</Name>
${stepXml}
    </Workout>
  </Workouts>
</TrainingCenterDatabase>`;
  }

  // ── ZWO (Zwift / rodillo inteligente) ─────────────────────────────────────

  function encodeZWO(workoutName, steps, ftp) {
    const stepsXml = steps.map(s => {
      const name = `name="${escapeXml(s.name || 'Paso')}"`;
      if (s.open) {
        return `    <FreeRide Duration="${s.sec || 300}" ${name}/>`;
      }
      if (s.intensity === 2) {
        return `    <Warmup Duration="${s.sec}" PowerLow="${pct(s.lo, ftp)}" PowerHigh="${pct(s.hi, ftp)}" ${name}/>`;
      }
      if (s.intensity === 3) {
        return `    <Cooldown Duration="${s.sec}" PowerLow="${pct(s.lo, ftp)}" PowerHigh="${pct(s.hi, ftp)}" ${name}/>`;
      }
      const mid = pct(Math.round((s.lo + s.hi) / 2), ftp);
      return `    <SteadyState Duration="${s.sec}" Power="${mid}" ${name}/>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="utf-8"?>
<workout_file>
  <author>VeloMind</author>
  <name>${escapeXml(workoutName)}</name>
  <description>FTP referencia: ${ftp}W — generado por VeloMind</description>
  <sportType>bike</sportType>
  <tags/>
  <workout>
${stepsXml}
  </workout>
</workout_file>`;
  }

  // ── GPX (Genérico para tracks, usado como fallback de descripción) ─────────
  function encodeGPX(workoutName, steps) {
    const desc = steps.map(s => `${s.name || 'Paso'}: ${s.sec}s @ ${s.lo}-${s.hi}W`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="VeloMind" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(workoutName)}</name>
    <desc>${escapeXml(desc)}</desc>
  </metadata>
  <trk>
    <name>${escapeXml(workoutName)}</name>
    <desc>${escapeXml(desc)}</desc>
    <trkseg></trkseg>
  </trk>
</gpx>`;
  }

  // ── ERG (Estándar de texto para rodillos inteligentes en lugar de FIT binario) ──
  function encodeERG(workoutName, steps, ftp) {
    let erg = `[COURSE HEADER]\nVERSION = 2\nUNITS = METRIC\nDESCRIPTION = ${workoutName}\nFILE NAME = ${workoutName}.erg\nFTP = ${ftp}\nMINUTES WATTS\n[END COURSE HEADER]\n[COURSE DATA]\n`;
    let currentMin = 0;
    steps.forEach(s => {
      let startMin = currentMin;
      let endMin = currentMin + (s.sec / 60);
      let pwr = Math.round((s.lo + s.hi) / 2);
      erg += `${startMin.toFixed(2)}\t${pwr}\n${endMin.toFixed(2)}\t${pwr}\n`;
      currentMin = endMin;
    });
    erg += `[END COURSE DATA]`;
    return erg;
  }

  // ── Nutrition / hydration alert injection ─────────────────────────────────
  // Splits long active blocks into 20-min segments and inserts 30-second alert
  // steps so the Garmin displays a reminder on screen during the workout.
  function injectNutritionAlerts(steps) {
    const CHUNK_SEC = 20 * 60;
    const result = [];
    let alertCount = 0;

    for (const step of steps) {
      if (step.isAlert || step.open || step.intensity === 1 || !step.sec || step.sec <= CHUNK_SEC) {
        result.push(step);
        continue;
      }
      let remaining = step.sec;
      while (remaining > 0) {
        const seg = Math.min(CHUNK_SEC, remaining);
        result.push({ ...step, sec: seg });
        remaining -= seg;
        if (remaining > 0) {
          alertCount++;
          const isNutrition = alertCount % 2 === 0;
          result.push({
            name: isNutrition ? 'Tomar gel o barrita' : 'Beber 500ml agua',
            sec: 30,
            intensity: 1,
            lo: 0, hi: 0,
            isAlert: true
          });
        }
      }
    }
    return result;
  }

  // ── FIT binary (Garmin native .fit) ──────────────────────────────────────

  // ASCII-safe transliteration (no length limit, unlike asciiName)
  function _toAscii(str) {
    return (str || '')
      .replace(/[áàâä]/gi,'a').replace(/[éèêë]/gi,'e')
      .replace(/[íìîï]/gi,'i').replace(/[óòôö]/gi,'o')
      .replace(/[úùûü]/gi,'u').replace(/ñ/gi,'n')
      .replace(/[^\x20-\x7E]/g,'');
  }

  // CRC-16 per FIT Protocol specification
  function _fitCRC(data) {
    const T = [
      0x0000,0xCC01,0xD801,0x1400,0xF001,0x3C00,0x2800,0xE401,
      0xA001,0x6C00,0x7800,0xB401,0x5000,0x9C01,0x8801,0x4400,
    ];
    let crc = 0;
    for (let i = 0; i < data.length; i++) {
      const b = data[i];
      let tmp = T[crc & 0xF];
      crc = (crc >> 4) ^ tmp ^ T[b & 0xF];
      tmp = T[crc & 0xF];
      crc = (crc >> 4) ^ tmp ^ T[(b >> 4) & 0xF];
    }
    return crc & 0xFFFF;
  }

  // Splits active blocks into 30-min chunks and injects 30-second reminder steps.
  // Uses real nutrition plan data when available, falls back to generic labels.
  function _fitInjectNutrition(steps, nutrition) {
    const CHUNK_SEC = 30 * 60;
    const { pre_workout = '', during_workout = '', post_workout = '' } = nutrition || {};
    const result = [];
    let alertCount = 0;

    steps.forEach((origStep, si) => {
      const step = { ...origStep };

      // Annotate warmup with pre-workout and cooldown with post-workout notes
      if (si === 0 && step.intensity === 2 && pre_workout)
        step.notes = _toAscii(pre_workout).slice(0, 49);
      if (si === steps.length - 1 && step.intensity === 3 && post_workout)
        step.notes = _toAscii('Post: ' + post_workout).slice(0, 49);

      // Only split active main-effort blocks (not warmup/cooldown/rest)
      const isMainWork = !step.isAlert && !step.open
        && step.intensity !== 1 && step.intensity !== 2 && step.intensity !== 3
        && step.sec > CHUNK_SEC;

      if (!isMainWork) { result.push(step); return; }

      let remaining = step.sec;
      while (remaining > 0) {
        const seg = Math.min(CHUNK_SEC, remaining);
        result.push({ ...step, sec: seg });
        remaining -= seg;
        if (remaining > 0) {
          alertCount++;
          const isGel = alertCount % 2 === 1;
          // wkt_step_name shows on device screen (max 15 chars)
          const name  = isGel ? 'GEL/BARRITA' : 'BEBER 500ml';
          // notes shows in Garmin Connect app
          const notes = _toAscii(during_workout || (isGel ? '25-30g carbohidratos' : '500ml agua o isotonica')).slice(0, 49);
          result.push({ name, sec: 30, intensity: 1, lo: 0, hi: 0, isAlert: true, notes });
        }
      }
    });
    return result;
  }

  // Encodes a structured workout to a binary .fit file (Uint8Array).
  // steps: array from buildSteps(); nutrition: object from /api/plans/nutrition (optional)
  function encodeFIT(workoutName, steps, nutrition) {
    const allSteps = nutrition ? _fitInjectNutrition(steps, nutrition) : injectNutritionAlerts(steps);
    const out = [];

    const u8  = v => out.push(v & 0xFF);
    const u16 = v => { out.push(v & 0xFF, (v >> 8) & 0xFF); };
    const u32 = v => { v = v >>> 0; out.push(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF); };
    // Fixed-size null-terminated string (for step/workout names, ASCII only)
    const strN = (s, len) => {
      const b = asciiName(s || '').slice(0, len - 1);
      for (let i = 0; i < b.length; i++) out.push(b.charCodeAt(i));
      for (let i = b.length; i < len; i++) out.push(0);
    };
    // ── Definition + data: FILE_ID (global=0, local=0) ──────────────────────
    out.push(0x40, 0x00, 0x00); u16(0); u8(2);   // def header, reserved, arch, global, nfields
    u8(0); u8(1); u8(0x00);   // field 0: type, 1 byte, enum
    u8(1); u8(2); u8(0x84);   // field 1: manufacturer, 2 bytes, uint16
    out.push(0x00);            // data header local=0
    u8(5); u16(255);           // type=workout, manufacturer=other

    // ── Definition + data: WORKOUT (global=26, local=1) ─────────────────────
    out.push(0x41, 0x00, 0x00); u16(26); u8(3);
    u8(4);  u8(1);  u8(0x00);  // sport: enum
    u8(6);  u8(2);  u8(0x84);  // num_valid_steps: uint16
    u8(8);  u8(16); u8(0x07);  // wkt_name: string[16]
    out.push(0x01);
    u8(2); u16(allSteps.length); strN(workoutName, 16);

    // ── Definition: WORKOUT_STEP (global=27, local=2) ───────────────────────
    // duration_value for Time type is stored in milliseconds (FIT SDK scale=1000, units=s)
    out.push(0x42, 0x00, 0x00); u16(27); u8(8);
    u8(0);   u8(16); u8(0x07);  // wkt_step_name: string[16]
    u8(1);   u8(1);  u8(0x00);  // duration_type: enum
    u8(2);   u8(4);  u8(0x86);  // duration_value: uint32 (milliseconds)
    u8(3);   u8(1);  u8(0x00);  // target_type: enum
    u8(4);   u8(4);  u8(0x86);  // target_value: uint32
    u8(5);   u8(4);  u8(0x86);  // custom_target_value_low: uint32 (watts)
    u8(6);   u8(4);  u8(0x86);  // custom_target_value_high: uint32 (watts)
    u8(7);   u8(1);  u8(0x00);  // intensity: enum

    // ── Data: WORKOUT_STEPs ─────────────────────────────────────────────────
    allSteps.forEach(s => {
      const durType  = s.open ? 5 : 0;
      const durValMs = s.open ? 0 : (s.sec | 0) * 1000; // convert seconds → milliseconds
      const hasPow   = s.lo > 0 || s.hi > 0;
      const tgtType  = hasPow ? 4 : 2;  // 4=power, 2=open/none (FIT WktStepTarget enum)
      const intEnum  = s.intensity === 2 ? 2 : s.intensity === 3 ? 3 : s.intensity === 1 ? 1 : 0;

      out.push(0x02);
      strN(s.name || 'Paso', 16);
      u8(durType); u32(durValMs);
      u8(tgtType); u32(0);
      u32(s.lo || 0);
      u32(s.hi || 0);
      u8(intEnum);
    });

    // ── Build final binary: header + data + CRCs ────────────────────────────
    const dataBytes = new Uint8Array(out);

    const fhdr = new Uint8Array(14);
    fhdr[0]  = 14;   fhdr[1]  = 0x10;  // header size, protocol v1.0
    fhdr[2]  = 0x54; fhdr[3]  = 0x08;  // profile version 2132 (0x0854)
    const dl = dataBytes.length;
    fhdr[4]  = dl & 0xFF; fhdr[5] = (dl >> 8) & 0xFF;
    fhdr[6]  = (dl >> 16) & 0xFF; fhdr[7] = (dl >> 24) & 0xFF;
    fhdr[8]  = 0x2E; fhdr[9] = 0x46; fhdr[10] = 0x49; fhdr[11] = 0x54; // ".FIT"
    const hc = _fitCRC(fhdr.slice(0, 12));
    fhdr[12] = hc & 0xFF; fhdr[13] = (hc >> 8) & 0xFF;

    const fc = _fitCRC(dataBytes); // file CRC covers data records only (not header)
    const result = new Uint8Array(14 + dataBytes.length + 2);
    result.set(fhdr); result.set(dataBytes, 14);
    result[14 + dl] = fc & 0xFF; result[14 + dl + 1] = (fc >> 8) & 0xFF;
    return result;
  }

  // Downloads a binary .fit file for a single session via backend generator.
  async function exportFIT(session, ftp, nutrition) {
    if (session.isRest) { alert('Los días de descanso no necesitan exportarse.'); return; }
    if (!ftp || ftp < 50) ftp = 200;
    const wt     = (typeof WORKOUT_TYPES !== 'undefined' && WORKOUT_TYPES[session.type]) || {};
    const label  = (wt.label || session.name || session.type || 'Entrenamiento').slice(0, 15);
    const durMin = session.durationMin || 60;
    const base   = buildSteps(session, ftp);
    const steps  = (durMin >= 45 && nutrition) ? _fitInjectNutrition(base, nutrition) : base;
    const fname  = `VeloMind_${sanitize(session.day || 'entreno')}_${sanitize(label)}.fit`;

    try {
      const headers = (typeof Auth !== 'undefined' && Auth.getHeaders) ? Auth.getHeaders() : {};
      const apiBase = (typeof window !== 'undefined' && window.API_URL) ? window.API_URL : '/api';
      const resp = await fetch(`${apiBase}/plans/export-fit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body:    JSON.stringify({ name: label, steps }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(err.error || resp.statusText);
      }
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), { href: url, download: fname });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      alert('Error al generar el archivo FIT: ' + e.message);
    }
  }

  // Returns { tcxContent, workoutName } for backend push to Garmin Connect.
  // Always includes nutrition/hydration alerts.
  function buildTCXForPush(session, ftp) {
    if (!ftp || ftp < 50) ftp = 200;
    const wt           = (typeof WORKOUT_TYPES !== 'undefined' && WORKOUT_TYPES[session.type]) || {};
    const sessionLabel = (wt.label || session.name || session.type || 'Entrenamiento').slice(0, 40);
    const baseSteps    = buildSteps(session, ftp);
    const durMin       = session.durationMin || 60;
    const steps        = durMin >= 60 ? injectNutritionAlerts(baseSteps) : baseSteps;
    return { tcxContent: encodeTCX(sessionLabel, steps), workoutName: sessionLabel };
  }

  // ── Export helpers ─────────────────────────────────────────────────────────

  function exportSession(session, ftp, format) {
    if (session.isRest) { alert('Los días de descanso no necesitan exportarse.'); return; }
    if (!ftp || ftp < 50) ftp = 200;
    const wt           = (typeof WORKOUT_TYPES !== 'undefined' && WORKOUT_TYPES[session.type]) || {};
    const sessionLabel = (wt.label || session.name || session.type || 'Entrenamiento').slice(0, 40);
    const baseSteps    = buildSteps(session, ftp);
    const durMin       = session.durationMin || 60;
    if (format === 'zwo') {
      download(`VeloMind_${sanitize(session.day)}_${sanitize(sessionLabel)}.zwo`, encodeZWO(sessionLabel, baseSteps, ftp));
    } else if (format === 'gpx') {
      download(`VeloMind_${sanitize(session.day)}_${sanitize(sessionLabel)}.gpx`, encodeGPX(sessionLabel, baseSteps));
    } else if (format === 'erg' || format === 'fit') {
      download(`VeloMind_${sanitize(session.day)}_${sanitize(sessionLabel)}.erg`, encodeERG(sessionLabel, baseSteps, ftp));
    } else {
      // TCX: inject nutrition alerts for rides >= 60 min
      const steps = durMin >= 60 ? injectNutritionAlerts(baseSteps) : baseSteps;
      download(`VeloMind_${sanitize(session.day)}_${sanitize(sessionLabel)}.tcx`, encodeTCX(sessionLabel, steps));
    }
  }

  function exportWeek(sessions, ftp, format) {
    const trainSessions = sessions.filter(s => !s.isRest);
    if (!trainSessions.length) { alert('No hay sesiones de entrenamiento esta semana.'); return; }
    let i = 0;
    function next() {
      if (i >= trainSessions.length) return;
      exportSession(trainSessions[i++], ftp, format);
      if (i < trainSessions.length) setTimeout(next, 600);
    }
    next();
  }

  return { buildSteps, encodeTCX, encodeZWO, encodeGPX, encodeERG, encodeFIT, exportFIT, download, exportSession, exportWeek, buildTCXForPush, _fitInjectNutrition };
})();

window.FITWorkoutEncoder = FITWorkoutEncoder;
