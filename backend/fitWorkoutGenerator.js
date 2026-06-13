'use strict';
/**
 * VeloMind – FIT Workout Generator
 *
 * Estructura replicada del archivo .fit exportado por Garmin Connect (referencia validada).
 * Todos los mensajes reutilizan local=0, redefiniéndolo antes de cada uso.
 */

const FIT_EPOCH_OFFSET = 631065600; // 1989-12-31 00:00:00 UTC en Unix epoch

const BT = {
  ENUM:    0x00,
  UINT8:   0x02,
  UINT16:  0x84,
  UINT32:  0x86,
  UINT32Z: 0x8C,
  STRING:  0x07,
};

const FIT_INTENSITY = { active: 0, rest: 1, warmup: 2, cooldown: 3 };

// Valores inválidos por tipo (FIT Protocol §3)
const INV = {
  ENUM:    0xFF,
  UINT8:   0xFF,
  UINT16:  0xFFFF,
  UINT32:  0xFFFFFFFF,
  UINT32Z: 0x00000000,
};

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

function toAscii(s) {
  return (s || '')
    .replace(/[áàâä]/gi, 'a').replace(/[éèêë]/gi, 'e')
    .replace(/[íìîï]/gi, 'i').replace(/[óòôö]/gi, 'o')
    .replace(/[úùûü]/gi, 'u').replace(/ñ/gi, 'n')
    .replace(/[^\x20-\x7E]/g, '').trim();
}

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

  // Redefine local=0 con un nuevo mensaje global
  def(globalMsgNum, fields) {
    this.u8(0x40); // definition header para local=0
    this.u8(0x00); // reserved
    this.u8(0x00); // little-endian
    this.u16(globalMsgNum);
    this.u8(fields.length);
    for (const f of fields) { this.u8(f.num); this.u8(f.size); this.u8(f.bt); }
  }

  hdr() { this.u8(0x00); } // data header para local=0

  build() { return Buffer.concat(this._chunks); }
}

function generateWorkoutFIT(workoutName, steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('Se necesita al menos un paso para generar el workout');
  }

  const fitNow = Math.floor(Date.now() / 1000) - FIT_EPOCH_OFFSET;
  const name   = toAscii(workoutName || 'VeloMind').slice(0, 49);
  const w      = new FITBuffer();

  // ── FILE_ID (global=0) — estructura idéntica a Garmin Connect ───────────
  w.def(0, [
    { num: 3, size: 4, bt: BT.UINT32Z }, // serial_number
    { num: 4, size: 4, bt: BT.UINT32  }, // time_created
    { num: 7, size: 4, bt: BT.UINT32  }, // unknown field (Garmin export includes it)
    { num: 1, size: 2, bt: BT.UINT16  }, // manufacturer
    { num: 2, size: 2, bt: BT.UINT16  }, // product
    { num: 5, size: 2, bt: BT.UINT16  }, // garmin_product
    { num: 0, size: 1, bt: BT.ENUM    }, // type
  ]);
  w.hdr();
  w.u32(0);           // serial_number = 0
  w.u32(fitNow);      // time_created
  w.u32(INV.UINT32);  // field 7 = invalid
  w.u16(1);           // manufacturer = 1 (Garmin)
  w.u16(65534);       // product = 65534 (Garmin Connect)
  w.u16(INV.UINT16);  // garmin_product = invalid
  w.u8(5);            // type = 5 (workout)

  // ── FILE_CREATOR (global=49) ─────────────────────────────────────────────
  w.def(49, [
    { num: 2, size: 20, bt: BT.STRING }, // app_name
    { num: 0, size: 2,  bt: BT.UINT16 }, // software_version
    { num: 1, size: 1,  bt: BT.UINT8  }, // hardware_version
  ]);
  w.hdr();
  w.str('', 20);   // app_name = empty
  w.u16(100);      // software_version
  w.u8(INV.UINT8); // hardware_version = invalid

  // ── WORKOUT (global=26) ──────────────────────────────────────────────────
  w.def(26, [
    { num: 5,  size: 4,  bt: BT.UINT32Z }, // capabilities
    { num: 10, size: 4,  bt: BT.UINT32  }, // pool_length (invalid for cycling)
    { num: 6,  size: 2,  bt: BT.UINT16  }, // num_valid_steps
    { num: 7,  size: 2,  bt: BT.UINT16  }, // unknown field
    { num: 12, size: 2,  bt: BT.UINT16  }, // unknown field
    { num: 14, size: 2,  bt: BT.UINT16  }, // unknown field
    { num: 4,  size: 1,  bt: BT.ENUM    }, // sport
    { num: 8,  size: 50, bt: BT.STRING  }, // wkt_name (50 bytes, como Garmin)
    { num: 9,  size: 1,  bt: BT.ENUM    }, // sub_sport
    { num: 11, size: 1,  bt: BT.ENUM    }, // unknown field
    { num: 13, size: 1,  bt: BT.ENUM    }, // unknown field
    { num: 15, size: 1,  bt: BT.ENUM    }, // unknown field
  ]);
  w.hdr();
  w.u32(INV.UINT32Z); // capabilities = 0 (invalid para UINT32Z)
  w.u32(INV.UINT32);  // pool_length = invalid
  w.u16(steps.length);// num_valid_steps
  w.u16(INV.UINT16);  // field 7 = invalid
  w.u16(INV.UINT16);  // field 12 = invalid
  w.u16(INV.UINT16);  // field 14 = invalid
  w.u8(2);            // sport = 2 (cycling)
  w.str(name, 50);    // wkt_name
  w.u8(INV.ENUM);     // sub_sport = invalid (255), igual que Garmin Connect
  w.u8(INV.UINT8);    // field 11 = invalid
  w.u8(INV.ENUM);     // field 13 = invalid
  w.u8(INV.ENUM);     // field 15 = invalid

  // ── WORKOUT_STEP (global=27) — estructura idéntica a Garmin Connect ──────
  // Orden de campos replicado exactamente del archivo de referencia:
  //   nombre, dur_val, tgt_val, tgt_low, tgt_high, notes(200), msg_idx,
  //   campos extra UINT16, dur_type, tgt_type, intensity, campos extra UINT8
  w.def(27, [
    { num: 0,   size: 16,  bt: BT.STRING }, // wkt_step_name
    { num: 2,   size: 4,   bt: BT.UINT32 }, // duration_value (ms para type=TIME)
    { num: 4,   size: 4,   bt: BT.UINT32 }, // target_value (0 = custom range)
    { num: 5,   size: 4,   bt: BT.UINT32 }, // custom_target_value_low (watts)
    { num: 6,   size: 4,   bt: BT.UINT32 }, // custom_target_value_high (watts)
    { num: 8,   size: 200, bt: BT.STRING }, // notes (vacío pero presente)
    { num: 254, size: 2,   bt: BT.UINT16 }, // message_index
    { num: 10,  size: 2,   bt: BT.UINT16 }, // exercise_category
    { num: 11,  size: 2,   bt: BT.UINT16 }, // exercise_name
    { num: 12,  size: 2,   bt: BT.UINT16 }, // exercise_weight
    { num: 13,  size: 2,   bt: BT.UINT16 }, // weight_display_unit
    { num: 14,  size: 2,   bt: BT.UINT16 }, // secondary_target_value
    { num: 1,   size: 1,   bt: BT.ENUM   }, // duration_type: 0=time, 5=open
    { num: 3,   size: 1,   bt: BT.ENUM   }, // target_type: 2=open, 4=power
    { num: 7,   size: 1,   bt: BT.ENUM   }, // intensity
    { num: 9,   size: 1,   bt: BT.ENUM   }, // equipment
    { num: 15,  size: 1,   bt: BT.UINT8  }, // unknown
    { num: 16,  size: 1,   bt: BT.UINT8  }, // unknown
    { num: 17,  size: 1,   bt: BT.ENUM   }, // unknown
    { num: 18,  size: 1,   bt: BT.ENUM   }, // unknown
  ]);

  steps.forEach((s, i) => {
    const durType = s.open ? 5 : 0;
    const durMs   = s.open ? 0 : Math.max(0, s.sec | 0) * 1000;
    const hasPow  = (s.lo > 0 || s.hi > 0);
    const tgtType = hasPow ? 4 : 2;
    const intKey  = s.intensity === 2 ? 'warmup'
                  : s.intensity === 3 ? 'cooldown'
                  : s.intensity === 1 ? 'rest'
                  : 'active';
    // FIT protocol: potencia absoluta (W) = valor + 1000. Sin este offset el dispositivo
    // interpreta los valores como %FTP en lugar de vatios.
    const loW = hasPow ? (s.lo || 0) + 1000 : 0;
    const hiW = hasPow ? (s.hi || 0) + 1000 : 0;

    w.hdr();
    w.str(toAscii(s.name || 'Paso').slice(0, 15), 16);
    w.u32(durMs);
    w.u32(0);              // target_value = 0 (custom range)
    w.u32(loW);            // custom_target_value_low
    w.u32(hiW);            // custom_target_value_high
    w.str('', 200);        // notes = vacío
    w.u16(i);              // message_index
    w.u16(INV.UINT16);     // exercise_category = invalid
    w.u16(INV.UINT16);     // exercise_name = invalid
    w.u16(INV.UINT16);     // exercise_weight = invalid
    w.u16(INV.UINT16);     // weight_display_unit = invalid
    w.u16(INV.UINT16);     // secondary_target_value = invalid
    w.u8(durType);
    w.u8(tgtType);
    w.u8(FIT_INTENSITY[intKey]);
    w.u8(INV.UINT8);       // equipment = invalid
    w.u8(INV.UINT8);       // unknown = invalid
    w.u8(INV.UINT8);       // unknown = invalid
    w.u8(INV.ENUM);        // unknown = invalid
    w.u8(INV.ENUM);        // unknown = invalid
  });

  // ── Ensamblar: cabecera 14 bytes + datos + CRC ───────────────────────────
  const data = w.build();

  const header = Buffer.alloc(14);
  header[0] = 14;
  header[1] = 0x10;                         // protocol_version 1.0
  header.writeUInt16LE(2195, 2);            // profile_version = 2195 (igual que Garmin)
  header.writeUInt32LE(data.length, 4);
  header.write('.FIT', 8, 'ascii');
  header.writeUInt16LE(fitCRC(header.slice(0, 12)), 12);

  const crcBuf = Buffer.alloc(2);
  crcBuf.writeUInt16LE(fitCRC(data), 0);

  return Buffer.concat([header, data, crcBuf]);
}

module.exports = { generateWorkoutFIT, toAscii };
