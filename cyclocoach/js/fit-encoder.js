/* VeloMind — FIT Workout Encoder
 * Generates Garmin-compatible .fit workout files for import into Garmin Connect
 * FIT Protocol v1.0 / Profile 2132
 */
const FITWorkoutEncoder = (() => {
  'use strict';

  function crc16(bytes) {
    const t = [0x0000,0xCC01,0xD801,0x1400,0xF001,0x3C00,0x2800,0xE401,
               0xA001,0x6C00,0x7800,0xB401,0x5000,0x9C01,0x8801,0x4400];
    let crc = 0;
    for (const b of bytes) {
      let tmp = t[crc & 0xF]; crc = (crc >> 4) & 0xFFF; crc ^= tmp ^ t[b & 0xF];
      tmp = t[crc & 0xF]; crc = (crc >> 4) & 0xFFF; crc ^= tmp ^ t[(b >> 4) & 0xF];
    }
    return crc;
  }

  function concat(arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) { out.set(a, off); off += a.length; }
    return out;
  }

  function writeLE(buf, off, val, size) {
    for (let i = 0; i < size; i++) buf[off + i] = (val >>> (i * 8)) & 0xFF;
  }

  function writeStr(buf, off, str, maxLen) {
    const s = (str || '').slice(0, maxLen - 1);
    for (let i = 0; i < maxLen; i++) buf[off + i] = i < s.length ? (s.charCodeAt(i) & 0xFF) : 0;
  }

  // Definition record: local_msg → global_msg with field descriptors
  // fields: [{num, size, baseType}]
  function defMsg(localNum, globalNum, fields) {
    const buf = new Uint8Array(6 + fields.length * 3);
    buf[0] = 0x40 | (localNum & 0xF);
    buf[1] = 0; buf[2] = 0;             // reserved, LE architecture
    buf[3] = globalNum & 0xFF; buf[4] = (globalNum >> 8) & 0xFF;
    buf[5] = fields.length;
    fields.forEach((f, i) => { buf[6+i*3]=f.num; buf[7+i*3]=f.size; buf[8+i*3]=f.baseType; });
    return buf;
  }

  // Data record
  function dataMsg(localNum, fields) {
    const totalSize = fields.reduce((s, f) => s + f.size, 0);
    const buf = new Uint8Array(1 + totalSize);
    buf[0] = localNum & 0xF;
    let off = 1;
    for (const f of fields) {
      if (f.isStr) writeStr(buf, off, f.value, f.size);
      else         writeLE(buf, off, f.value || 0, f.size);
      off += f.size;
    }
    return buf;
  }

  // Build structured workout steps from a TrainingPlanGenerator session
  function buildSteps(session, ftp) {
    if (!ftp || ftp < 50) ftp = 200;
    const w = (lo, hi) => ({ lo: Math.round(ftp * lo), hi: Math.round(ftp * hi) });

    if (session.isRest) {
      return [{ name:'Descanso', open:true, intensity:1, lo:0, hi:0 }];
    }

    const type = session.type || 'endurance';
    const durMin = Math.max(30, session.durationMin || 60);
    const warmMin = Math.min(15, Math.round(durMin * 0.2));
    const coolMin = Math.min(10, Math.round(durMin * 0.15));
    const mainMin = Math.max(20, durMin - warmMin - coolMin);

    const warmup  = (min) => ({ name:'Calentamiento', sec:min*60, intensity:2, ...w(0.50,0.55) });
    const cooldown= (min) => ({ name:'Enfriamiento',  sec:min*60, intensity:3, ...w(0.45,0.55) });
    const rest    = (min) => ({ name:'Recuperacion',  sec:min*60, intensity:1, ...w(0.45,0.55) });

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

  // Encode to FIT binary
  function encode(workoutName, sport, steps) {
    // sport: 2=cycling, 1=running, 0=generic
    const GARMIN_EPOCH = 631065600;
    const timeCreated = Math.floor(Date.now() / 1000) - GARMIN_EPOCH;
    const parts = [];

    // File ID  (local 0, global 0)
    parts.push(defMsg(0, 0, [
      {num:8, size:1, baseType:0x00}, // type (enum)
      {num:2, size:2, baseType:0x84}, // manufacturer (uint16)
      {num:1, size:4, baseType:0x86}, // time_created (uint32)
    ]));
    parts.push(dataMsg(0, [
      {value:5,           size:1}, // workout
      {value:255,         size:2}, // unknown manufacturer
      {value:timeCreated, size:4},
    ]));

    // Workout  (local 1, global 26)
    parts.push(defMsg(1, 26, [
      {num:4, size:1,  baseType:0x00}, // sport
      {num:6, size:2,  baseType:0x84}, // num_valid_steps
      {num:8, size:16, baseType:0x07}, // wkt_name
    ]));
    parts.push(dataMsg(1, [
      {value:sport,       size:1},
      {value:steps.length,size:2},
      {value:workoutName, size:16, isStr:true},
    ]));

    // Workout Step  (local 2, global 27)
    parts.push(defMsg(2, 27, [
      {num:0, size:2,  baseType:0x84}, // message_index
      {num:1, size:16, baseType:0x07}, // wkt_step_name
      {num:2, size:1,  baseType:0x00}, // duration_type
      {num:3, size:4,  baseType:0x86}, // duration_value (ms)
      {num:4, size:1,  baseType:0x00}, // target_type
      {num:5, size:4,  baseType:0x86}, // target_value
      {num:6, size:4,  baseType:0x86}, // custom_target_value_low  (watts)
      {num:7, size:4,  baseType:0x86}, // custom_target_value_high (watts)
    ]));

    steps.forEach((s, i) => {
      const durType  = s.open ? 5 : 0;        // 5=OPEN(lap button), 0=TIME
      const durValue = s.open ? 0 : s.sec * 1000; // ms for TIME type
      const hasPower = (s.lo > 0 || s.hi > 0);
      parts.push(dataMsg(2, [
        {value:i,              size:2},
        {value:s.name||'Paso', size:16, isStr:true},
        {value:durType,        size:1},
        {value:durValue,       size:4},
        {value:hasPower?4:2,   size:1}, // 4=POWER, 2=OPEN
        {value:0,              size:4}, // target_value=0 → custom range
        {value:s.lo||0,        size:4},
        {value:s.hi||0,        size:4},
      ]));
    });

    const data = concat(parts);

    // File header (14 bytes)
    const hdr = new Uint8Array(14);
    hdr[0]=14; hdr[1]=0x10; hdr[2]=0x54; hdr[3]=0x08; // size, protocol, profile 2132 LE
    writeLE(hdr, 4, data.length, 4);
    hdr[8]=0x2E; hdr[9]=0x46; hdr[10]=0x49; hdr[11]=0x54; // ".FIT"
    writeLE(hdr, 12, crc16(hdr.subarray(0, 12)), 2);

    // Data CRC
    const crcBuf = new Uint8Array(2);
    writeLE(crcBuf, 0, crc16(data), 2);

    return concat([hdr, data, crcBuf]);
  }

  // Trigger browser download
  function download(filename, bytes) {
    const blob = new Blob([bytes], {type: 'application/octet-stream'});
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {href:url, download:filename});
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

  // Export a single session to .fit
  function exportSession(session, ftp) {
    if (session.isRest) { alert('Los días de descanso no necesitan exportarse.'); return; }
    const wt = (typeof WORKOUT_TYPES !== 'undefined' && WORKOUT_TYPES[session.type]) || {};
    const sessionLabel = (wt.label || session.name || session.type || 'Entrenamiento').slice(0, 16);
    const filename = `VeloMind_${sanitize(session.day)}_${sanitize(sessionLabel)}.fit`;
    const steps = buildSteps(session, ftp);
    const bytes = encode(sessionLabel, 2, steps);
    download(filename, bytes);
  }

  // Export all non-rest sessions (triggers multiple downloads)
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

  return { buildSteps, encode, download, exportSession, exportWeek };
})();

window.FITWorkoutEncoder = FITWorkoutEncoder;
