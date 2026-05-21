'use strict';
/**
 * VeloMind – FIT Workout Generator
 *
 * Genera archivos .fit binarios válidos para Garmin Edge/Forerunner/Connect.
 * Basado en la especificación FIT Protocol Rev 2.3 de Garmin.
 *
 * Mensajes incluidos (obligatorios + recomendados):
 *   FILE_ID (global 0)        — tipo, fabricante, producto, timestamp
 *   FILE_CREATOR (global 49)  — versión de software
 *   WORKOUT (global 26)       — deporte, nombre, número de pasos
 *   WORKOUT_STEP (global 27)  — cada paso con potencia objetivo e intensidad
 *
 * Notas de implementación:
 *   - duration_value para tipo TIME se almacena en SEGUNDOS (FIT Protocol §WORKOUT_STEP)
 *   - CRC-16 según algoritmo oficial de Garmin (polinomio 0x1021 / tabla de 16 entradas)
 *   - Strings FIT: nulo-terminadas, rellenas de 0x00 hasta la longitud del campo
 */

// FIT Epoch: 00:00:00 UTC del 31-12-1989 = Unix epoch 631065600
const FIT_EPOCH_OFFSET = 631065600;

// Base types del perfil FIT (FIT Protocol Rev 2.3, §3 Base Types)
const BT = {
  ENUM:    0x00,
  UINT8:   0x02,
  UINT16:  0x84,
  UINT32:  0x86,
  UINT32Z: 0x8C,  // uint32z — valor inválido = 0x00000000 (no 0x8E que es sint64)
  STRING:  0x07,
};

// Intensidades FIT para WORKOUT_STEP (campo 7)
const FIT_INTENSITY = { active: 0, rest: 1, warmup: 2, cooldown: 3 };

// CRC-16 oficial Garmin (FIT Protocol §3)
function fitCRC(buf) {
  const T = [
    0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
    0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
  ];
  let crc = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    let tmp = T[crc & 0xF]; crc = (crc >> 4) ^ tmp ^ T[b & 0xF];
    tmp = T[crc & 0xF];     crc = (crc >> 4) ^ tmp ^ T[(b >> 4) & 0xF];
  }
  return crc & 0xFFFF;
}

// Transliteración a ASCII puro (sin acentos, sin caracteres > 0x7E)
function toAscii(s) {
  return (s || '')
    .replace(/[áàâä]/gi, 'a').replace(/[éèêë]/gi, 'e')
    .replace(/[íìîï]/gi, 'i').replace(/[óòôö]/gi, 'o')
    .replace(/[úùûü]/gi, 'u').replace(/ñ/gi, 'n')
    .replace(/[^\x20-\x7E]/g, '').trim();
}

// Escribe una string FIT de tamaño fijo (nulo-terminada, rellena con 0x00)
function writeStr(buf, offset, s, fieldBytes) {
  const safe = toAscii(s || '').slice(0, fieldBytes - 1);
  for (let i = 0; i < safe.length; i++) buf[offset + i] = safe.charCodeAt(i);
  for (let i = safe.length; i < fieldBytes; i++) buf[offset + i] = 0x00;
  return offset + fieldBytes;
}

class FITBuffer {
  constructor() { this._chunks = []; }

  u8(v)  { const b = Buffer.alloc(1); b[0] = v & 0xFF; this._chunks.push(b); }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v >>> 0, 0); this._chunks.push(b); }
  u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); this._chunks.push(b); }
  str(s, len) {
    const b = Buffer.alloc(len, 0);
    writeStr(b, 0, s, len);
    this._chunks.push(b);
  }

  // Definition message (local type 0-15 → global message num, fields)
  def(localType, globalMsgNum, fields) {
    this.u8(0x40 | (localType & 0xF)); // definition header: bit6=1
    this.u8(0x00);                      // reserved
    this.u8(0x00);                      // architecture: little-endian
    this.u16(globalMsgNum);
    this.u8(fields.length);
    for (const f of fields) { this.u8(f.num); this.u8(f.size); this.u8(f.bt); }
  }

  // Data message header (localType)
  hdr(localType) { this.u8(localType & 0xF); }

  build() { return Buffer.concat(this._chunks); }
}

/**
 * Genera un archivo .fit de workout válido para Garmin.
 *
 * @param {string} workoutName  Nombre del workout (máx 15 chars)
 * @param {Array}  steps        Pasos generados por buildSteps() en el cliente:
 *   { name, sec, intensity, lo, hi, open, isAlert }
 *   intensity: 0=active, 1=rest, 2=warmup, 3=cooldown
 *   lo/hi: vatios objetivo (0 = sin objetivo de potencia)
 *   open:  true = paso abierto (el atleta avanza manualmente)
 * @returns {Buffer} Bytes del archivo .fit listo para descargar
 */
function generateWorkoutFIT(workoutName, steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('Se necesita al menos un paso para generar el workout');
  }

  const fitNow = Math.floor(Date.now() / 1000) - FIT_EPOCH_OFFSET;
  const name   = toAscii(workoutName || 'VeloMind').slice(0, 15);
  const w      = new FITBuffer();

  // ── FILE_ID (global=0, local=0) ─────────────────────────────────────────
  // Campos obligatorios para que el dispositivo reconozca el archivo
  w.def(0, 0, [
    { num: 0, size: 1, bt: BT.ENUM    }, // type
    { num: 1, size: 2, bt: BT.UINT16  }, // manufacturer
    { num: 2, size: 2, bt: BT.UINT16  }, // product (garmin_product)
    { num: 3, size: 4, bt: BT.UINT32Z }, // serial_number
    { num: 4, size: 4, bt: BT.UINT32  }, // time_created
  ]);
  w.hdr(0);
  w.u8(5);        // type=5 (workout)
  w.u16(1);       // manufacturer=1 (Garmin)
  w.u16(65534);   // product=65534 (Garmin Connect)
  w.u32(0);       // serial_number=0 (no físico)
  w.u32(fitNow);  // time_created: timestamp FIT actual

  // ── FILE_CREATOR (global=49, local=1) ────────────────────────────────────
  // Recomendado: algunos dispositivos lo requieren para confiar en el archivo
  w.def(1, 49, [
    { num: 0, size: 2, bt: BT.UINT16 }, // software_version
    { num: 1, size: 1, bt: BT.UINT8  }, // hardware_version
  ]);
  w.hdr(1);
  w.u16(100);  // software_version
  w.u8(0xFF);  // hardware_version (0xFF = no aplicable)

  // ── WORKOUT (global=26, local=2) ─────────────────────────────────────────
  w.def(2, 26, [
    { num: 4, size: 1,  bt: BT.ENUM    }, // sport
    { num: 5, size: 4,  bt: BT.UINT32Z }, // capabilities (field 5, no field 1)
    { num: 6, size: 2,  bt: BT.UINT16  }, // num_valid_steps
    { num: 8, size: 16, bt: BT.STRING  }, // wkt_name
  ]);
  w.hdr(2);
  w.u8(2);             // sport=2 (cycling)
  w.u32(0);            // capabilities=0
  w.u16(steps.length); // num_valid_steps
  w.str(name, 16);     // wkt_name

  // ── WORKOUT_STEP (global=27, local=3) ────────────────────────────────────
  // duration_value para TIME: valor RAW en milisegundos (Profile scale=1000, units=s)
  w.def(3, 27, [
    { num: 254, size: 2,  bt: BT.UINT16 }, // message_index (orden del paso)
    { num: 0,   size: 16, bt: BT.STRING }, // wkt_step_name
    { num: 1,   size: 1,  bt: BT.ENUM   }, // duration_type: 0=time, 5=open
    { num: 2,   size: 4,  bt: BT.UINT32 }, // duration_value (segundos si type=time)
    { num: 3,   size: 1,  bt: BT.ENUM   }, // target_type: 0=none, 3=power
    { num: 4,   size: 4,  bt: BT.UINT32 }, // target_value (0=custom, >0=zona)
    { num: 5,   size: 4,  bt: BT.UINT32 }, // custom_target_value_low (vatios)
    { num: 6,   size: 4,  bt: BT.UINT32 }, // custom_target_value_high (vatios)
    { num: 7,   size: 1,  bt: BT.ENUM   }, // intensity
  ]);

  steps.forEach((s, i) => {
    const durType = s.open ? 5 : 0;
    const durMs   = s.open ? 0 : Math.max(0, s.sec | 0) * 1000; // ms (Profile scale=1000)
    const hasPow  = (s.lo > 0 || s.hi > 0);
    const tgtType = hasPow ? 3 : 0; // 3=power, 0=sin objetivo
    const intKey  = s.intensity === 2 ? 'warmup'
                  : s.intensity === 3 ? 'cooldown'
                  : s.intensity === 1 ? 'rest'
                  : 'active';

    w.hdr(3);
    w.u16(i);
    w.str(toAscii(s.name || 'Paso').slice(0, 15), 16);
    w.u8(durType);
    w.u32(durMs);
    w.u8(tgtType);
    w.u32(0);               // target_value=0 → usar rango personalizado
    w.u32(s.lo || 0);       // custom_target_value_low
    w.u32(s.hi || 0);       // custom_target_value_high
    w.u8(FIT_INTENSITY[intKey]);
  });

  // ── Ensamblar archivo: cabecera 14 bytes + datos + CRC final ─────────────
  const data = w.build();

  const header = Buffer.alloc(14);
  header[0] = 14;    // header_size
  header[1] = 0x10;  // protocol_version 1.0
  header.writeUInt16LE(2132, 2); // profile_version 2132 (0x0854)
  header.writeUInt32LE(data.length, 4); // data_size
  header.write('.FIT', 8, 'ascii'); // data_type signature
  const hdrCRC = fitCRC(header.slice(0, 12));
  header.writeUInt16LE(hdrCRC, 12);

  // El CRC del archivo cubre solo los registros de datos (NO la cabecera)
  const dataCRC = fitCRC(data);
  const crcBuf  = Buffer.alloc(2);
  crcBuf.writeUInt16LE(dataCRC, 0);

  return Buffer.concat([header, data, crcBuf]);
}

module.exports = { generateWorkoutFIT, toAscii };
