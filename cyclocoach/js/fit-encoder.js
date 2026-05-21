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
    const cooldown = (min) => ({ name:'Enfriamiento',  sec:min*60, intensity:3, ...w(0.55,0.45) });
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
      const tgtType  = hasPow ? 3 : 0;  // 3=power, 0=none
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
