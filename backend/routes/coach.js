const express = require('express');
const supabase = require('../db'); // Ahora db es el cliente de Supabase
const { requireAuth } = require('../middleware/auth');
const { requirePremium } = require('../middleware/subscriptionMiddleware');
const Anthropic = require('@anthropic-ai/sdk'); // Asegúrate de que este paquete esté instalado
const { callAI } = require('../services/ai');
const router = express.Router();
const fs = require('fs');
const multer = require('multer');
const upload = multer({ dest: '/tmp/', limits: { fileSize: 100 * 1024 * 1024 } }); // /tmp siempre existe; 100MB

router.use(requireAuth);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';

// ── Helpers ──────────────────────────────────────────────────

function calcIF(np, ftp) { return ftp ? Math.round(np / ftp * 100) / 100 : 0; }
function calcTSS(np, dur, ftp) {
  if (!np || !dur || !ftp) return 0;
  const ifv = calcIF(np, ftp);
  return Math.round(dur * np * ifv / (ftp * 3600) * 100);
}

// Zona Coggan según % FTP
function powerZone(np, ftp) {
  if (!ftp || !np) return 0;
  const pct = np / ftp;
  if (pct < 0.55) return 1;
  if (pct < 0.75) return 2;
  if (pct < 0.90) return 3;
  if (pct < 1.05) return 4;
  if (pct < 1.20) return 5;
  if (pct < 1.50) return 6;
  return 7;
}

// Estado de forma según TSB
function formState(tsb) {
  if (tsb > 25)  return { label: 'Muy fresco', color: 'blue',   risk: 'bajo' };
  if (tsb > 5)   return { label: 'Fresco',     color: 'green',  risk: 'bajo' };
  if (tsb > -10) return { label: 'En forma',   color: 'lime',   risk: 'bajo' };
  if (tsb > -20) return { label: 'Cansado',    color: 'yellow', risk: 'medio' };
  if (tsb > -30) return { label: 'Fatigado',   color: 'orange', risk: 'alto' };
  return           { label: 'Sobreentrenado',  color: 'red',    risk: 'muy alto' };
}

// Detectar fase de entrenamiento según tendencia CTL
function detectPhase(pmc) {
  if (!pmc || pmc.length < 14) return 'base';
  const recent  = pmc.slice(-7).reduce((s, p) => s + p.ctl, 0) / 7;
  const before  = pmc.slice(-14, -7).reduce((s, p) => s + p.ctl, 0) / 7;
  const ramp    = recent - before;
  const lastTSB = pmc[pmc.length - 1]?.tsb ?? 0;
  if (ramp > 3)       return 'build';
  if (ramp < -3)      return lastTSB < -20 ? 'recovery' : 'peak';
  return 'base';
}

// ── GET /api/coach/recommendations ───────────────────────────
// Analiza últimas 30 salidas y devuelve recomendaciones de entrenamiento + nutrición
router.get('/recommendations', async (req, res) => {
  const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const ftp    = user.ftp    || 200;
  const weight = user.weight || 70;
  const goal   = user.goal   || 'resistencia';

  // Últimas 30 actividades desde Supabase
  const { data: acts, error: actsError } = await supabase.from('activities')
    .select('*')
    .eq('user_id', req.user.id)
    .order('date', { ascending: false })
    .limit(30);
  if (actsError) throw actsError;

  // PMC reciente (últimos 60 días) desde Supabase
  const { data: pmcData, error: pmcError } = await supabase.from('pmc')
    .select('*')
    .eq('user_id', req.user.id)
    .order('date', { ascending: false })
    .limit(60);
  if (pmcError) throw pmcError;
  const pmc = pmcData.reverse();

  let latest = pmc[pmc.length - 1];

  // Fallback: Si la tabla PMC está vacía o tiene valores a 0, calculamos el estado actual al vuelo usando las actividades
  if ((!latest || (latest.ctl === 0 && latest.atl === 0)) && acts && acts.length > 0) {
    let c_ctl = 0, c_atl = 0;
    // Ordenamos cronológicamente para el cálculo de la media móvil
    const sorted = [...acts].sort((a, b) => new Date(a.date) - new Date(b.date));
    sorted.forEach(a => {
      let t = Number(a.tss) || 0;
      // Si el TSS es 0, intentamos estimarlo si hay potencia y duración
      if (t === 0 && ftp && a.duration) {
        const power = Number(a.np || a.avg_power || 0);
        if (power > 0) t = calcTSS(power, a.duration, ftp);
      }
      // Fórmulas de TrainingPeaks (CTL: 42 días, ATL: 7 días)
      c_ctl = c_ctl + (t - c_ctl) / 42;
      c_atl = c_atl + (t - c_atl) / 7;
    });
    latest = { ctl: c_ctl, atl: c_atl, tsb: c_ctl - c_atl };
  }

  if (!latest) latest = { ctl: 0, atl: 0, tsb: 0 };

  // OVERRIDE: Si el frontend (que calcula 1000 actividades) envía el dato preciso, usarlo siempre
  if (!isNaN(req.query.ctl) && Number(req.query.ctl) > 0) {
    latest = { 
      ctl: Number(req.query.ctl), 
      atl: Number(req.query.atl), 
      tsb: Number(req.query.tsb) 
    };
  }

  const ctl = latest.ctl || 0;
  const atl = latest.atl || 0;
  const tsb = latest.tsb || 0;

  // ── Estadísticas de las 30 salidas ──
  const withTSS   = acts.filter(a => a.tss > 0);
  const avgTSS    = withTSS.length ? Math.round(withTSS.reduce((s, a) => s + a.tss, 0) / withTSS.length) : 0;
  const totalTSS  = withTSS.reduce((s, a) => s + a.tss, 0);
  const avgDurMin = acts.length ? Math.round(acts.reduce((s, a) => s + (a.duration || 0), 0) / acts.length / 60) : 0;
  const avgDistKm = acts.length ? Math.round(acts.reduce((s, a) => s + (a.distance || 0), 0) / acts.length / 1000 * 10) / 10 : 0;
  const avgNP     = acts.filter(a => a.np > 0).length
    ? Math.round(acts.filter(a => a.np > 0).reduce((s, a) => s + a.np, 0) / acts.filter(a => a.np > 0).length)
    : 0;

  // Distribución de zonas ponderada por duración (minutos en cada zona)
  const zoneMins = [0, 0, 0, 0, 0, 0, 0, 0]; // índice 1-7
  acts.forEach(a => {
    const power = Number(a.np || a.avg_power || 0);
    const dur   = Number(a.duration || 0) / 60; // minutos
    if (power > 0 && ftp && dur > 0) {
      const z = powerZone(power, ftp);
      if (z >= 1 && z <= 7) zoneMins[z] += dur;
    }
  });
  const totalMins = zoneMins.slice(1).reduce((s, c) => s + c, 0);
  const zonePct = zoneMins.map(c => totalMins ? Math.round(c / totalMins * 100) : 0);

  // Diagnóstico de polarización
  const lowPct = zonePct[1] + zonePct[2]; // Z1+Z2
  const midPct = zonePct[3] + zonePct[4]; // Z3+Z4
  const hiPct  = zonePct[5] + zonePct[6] + zonePct[7]; // Z5+Z6+Z7

  // Tendencia de carga (últimas 2 semanas vs anteriores 2)
  const now = Date.now();
  const recent2w = acts.filter(a => new Date(a.date).getTime() > now - 14 * 86400000);
  const prev2w   = acts.filter(a => {
    const t = new Date(a.date).getTime();
    return t > now - 28 * 86400000 && t <= now - 14 * 86400000;
  });
  const recentAvgTSS = recent2w.length ? Math.round(recent2w.reduce((s, a) => s + (a.tss || 0), 0) / recent2w.length) : 0;
  const prevAvgTSS   = prev2w.length   ? Math.round(prev2w.reduce((s, a) => s + (a.tss || 0), 0) / prev2w.length)   : 0;
  const tssGrowth    = prevAvgTSS ? Math.round((recentAvgTSS - prevAvgTSS) / prevAvgTSS * 100) : 0;

  const phase = detectPhase(pmc);
  const form  = formState(tsb);
  const wkg   = avgNP && weight ? Math.round(avgNP / weight * 100) / 100 : 0;

  // ── Generar recomendación de entrenamiento ──
  const training = buildTrainingRecommendation({ tsb, ctl, atl, ftp, weight, goal, phase, form,
    zonePct, lowPct, midPct, hiPct, tssGrowth, avgTSS, avgDurMin, acts });

  // ── Generar recomendación de nutrición ──
  const nutrition = buildNutritionRecommendation({ ftp, weight, goal, phase, form,
    avgTSS, training, user });

  res.json({
    summary: {
      rides: acts.length,
      avgTSS, totalTSS, avgDurMin, avgDistKm, avgNP, wkg,
      phase, form,
      pmc: { ctl: Math.round(ctl), atl: Math.round(atl), tsb: Math.round(tsb) },
      zones: { z1: zonePct[1], z2: zonePct[2], z3: zonePct[3], z4: zonePct[4], z5: zonePct[5], z6: zonePct[6], z7: zonePct[7] },
      polarization: { low: lowPct, mid: midPct, high: hiPct },
      trend: { tssGrowth, recentAvgTSS, prevAvgTSS },
    },
    training,
    nutrition,
  });
});

// ── GET /api/coach/power-curve ────────────────────────────────
// Devuelve los mejores esfuerzos por duración a partir de actividades
router.get('/power-curve', async (req, res) => {
  const { data: user } = await supabase.from('users').select('ftp, weight').eq('id', req.user.id).single();
  const ftp    = user?.ftp    || 200;
  const weight = user?.weight || 70;

  const days = parseInt(req.query.days) || 0; // 0 = sin filtro (all-time)
  let query = supabase.from('activities')
    .select('np, avg_power, max_power, duration, date, best_efforts')
    .eq('user_id', req.user.id)
    .or('np.gt.0,max_power.gt.0')
    .order('date', { ascending: false })
    .limit(500);

  if (days > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    query = query.gte('date', cutoff.toISOString().split('T')[0]);
  }

  const { data: acts, error: actsError } = await query;
  if (actsError) throw actsError;

  // Duraciones estándar (segundos)
  const durations = [5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600];
  const labels    = ['5s','10s','30s','1min','2min','5min','10min','20min','30min','60min'];

  // Límite fisiológico más realista: evita spikes irreales de potenciómetros
  const powerCap = Math.min(1500, ftp * 5);

  const estimateEfforts = (durSec, avg, np, max) => {
    const base = np > 0 ? np : avg;
    const eff = {};
    if (base <= 0 || durSec <= 0) return eff;
    
    // Descartar max_power si es un spike obvio. Si no hay max, usar un estimado razonable.
    let safeMax = max > 0 && max <= powerCap ? max : 0;
    if (safeMax === 0) safeMax = Math.round(base * 2.8); // Sprint estimado conservador

    durations.forEach(d => {
      if (d <= durSec) {
        if (d === 5) {
          eff[d] = Math.round(safeMax);
        } else if (d === 10) {
          eff[d] = Math.round(safeMax * 0.85 + base * 0.15);
        } else if (d === 30) {
          eff[d] = Math.round(safeMax * 0.45 + base * 0.55);
        } else {
          let est = Math.round(base * Math.pow(durSec / d, 0.09));
          if (safeMax > 0 && est > safeMax) est = safeMax;
          eff[d] = est;
        }
      }
    });
    return eff;
  };

  const curve = durations.map((dur, i) => {
    let best = 0;
    acts.forEach(a => {
      let efforts = a.best_efforts;
      if (!efforts || Object.keys(efforts).length === 0) {
        efforts = estimateEfforts(Number(a.duration||0), Number(a.avg_power||0), Number(a.np||0), Number(a.max_power||0));
      }
      if (efforts && efforts[dur]) {
        // Aplicar límite también a best_efforts ya almacenados
        best = Math.max(best, Math.min(efforts[dur], powerCap));
      }
    });
    return {
      dur, label: labels[i],
      power: best || null,
      wkg: best && weight ? Math.round(best / weight * 100) / 100 : null,
      pctFTP: best && ftp ? Math.round(best / ftp * 100) : null,
    };
  }).filter(p => p.power);

  // Añadir FTP como referencia
  res.json({ curve, ftp, weight, wkg_ftp: Math.round(ftp / weight * 100) / 100 });
});

// POST /api/coach/biomechanics
router.post('/biomechanics', async (req, res) => {
  const { photos = [], rider = {}, user_points = {} } = req.body || {};
  if (!Array.isArray(photos) || photos.length < 1) {
    return res.status(400).json({ error: 'Debes enviar al menos 1 foto' });
  }
  if (photos.length > 4) {
    return res.status(400).json({ error: 'Maximo 4 fotos por analisis' });
  }

  const parsedPhotos = [];
  let totalBytes = 0;
  for (const p of photos) {
    const parsed = parseDataUrlImage(p?.dataUrl || '');
    if (!parsed.ok) {
      console.log('[Biomechanics] Photo error:', parsed.error, 'bytes:', parsed.bytes);
      return res.status(400).json({ error: parsed.error });
    }
    totalBytes += parsed.bytes;
    console.log('[Biomechanics] Photo OK, bytes:', parsed.bytes);
    parsedPhotos.push({
      view: sanitizePhotoView(p?.view),
      dataUrl: p.dataUrl,
    });
  }

  if (totalBytes > 9 * 1024 * 1024) {
    return res.status(400).json({ error: 'Las fotos exceden 9MB en total. Comprime o sube menos imagenes.' });
  }

  try {
    console.log('[Biomechanics] Calling analyzeBiomechanicsWithAI with', parsedPhotos.length, 'photos');
    const aiResult = await analyzeBiomechanicsWithAI(parsedPhotos, rider, user_points);
    console.log('[Biomechanics] Result:', aiResult ? 'got result' : 'null');
    
    if (aiResult) {
      // Restaurar los puntos manuales del usuario para que la IA no los mueva en pantalla
      if (user_points && Object.keys(user_points).length > 0) {
        aiResult.points = user_points;
      }
      return res.json({ mode: 'ai', ...aiResult });
    }

    console.log('[Biomechanics] Returning fallback');
    const fallback = buildBiomechanicsFallback(rider, parsedPhotos, user_points);
    return res.json({ mode: 'fallback', ...fallback });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Error analizando biomecanica' });
  }
});

// ── POST /api/coach/biomechanics-video (ANÁLISIS DINÁMICO) ──
router.post('/biomechanics-video', upload.single('video'), async (req, res) => {
  try {
    const file = req.file;
    const googleKey = process.env.GOOGLE_API_KEY || '';

    if (!file) return res.status(400).json({ error: 'Falta el archivo de video (MP4/MOV)' });
    if (!googleKey.startsWith('AIzaSy')) {
      fs.unlinkSync(file.path);
      return res.status(503).json({ error: 'El análisis de video requiere una API Key válida de Google Gemini.' });
    }

    console.log('[BioVideo] Subiendo video a Gemini File API...', file.size, 'bytes');

    // 1. Subir el video a la API de Archivos de Google Gemini
    const fileData = fs.readFileSync(file.path);
    const uploadRes = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${googleKey}`, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'raw',
        'X-Goog-Upload-Command': 'upload',
        'X-Goog-Upload-Header-Content-Length': file.size.toString(),
        'X-Goog-Upload-Header-Content-Type': file.mimetype,
        'Content-Type': file.mimetype
      },
      body: fileData
    });

    const uploadJson = await uploadRes.json();
    fs.unlinkSync(file.path); // Limpiar el archivo temporal del disco

    if (!uploadRes.ok) {
      return res.status(500).json({ error: 'Error subiendo video a Google: ' + (uploadJson.error?.message || 'Desconocido') });
    }

    if (!uploadJson.file) {
      console.error('[BioVideo] Respuesta inesperada de Google Files API:', JSON.stringify(uploadJson).substring(0, 300));
      return res.status(500).json({ error: 'Google Files API no devolvió un archivo válido: ' + (uploadJson.error?.message || JSON.stringify(uploadJson)) });
    }

    const fileUri  = uploadJson.file.uri;
    const fileName = uploadJson.file.name; // "files/abc123..." — recurso completo
    const mimeType = uploadJson.file.mimeType;

    console.log('[BioVideo] Video subido. URI:', fileUri, '| Estado inicial:', uploadJson.file.state);

    // 2. Poll: Esperar a que Gemini termine de indexar el video (ACTIVE)
    // NOTA: La URL correcta es /v1beta/{name} donde name ya incluye "files/"
    let fileState = uploadJson.file.state || 'PROCESSING';
    let attempts = 0;
    while (fileState === 'PROCESSING' && attempts < 20) {
      await new Promise(r => setTimeout(r, 3000));
      const checkRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${googleKey}`);
      const checkData = await checkRes.json();
      fileState = checkData.state || checkData.file?.state || 'ERROR';
      console.log(`[BioVideo] Poll #${attempts + 1}: estado=${fileState}`);
      attempts++;
    }

    if (fileState !== 'ACTIVE') {
      return res.status(500).json({ error: `El video no pudo ser procesado por la IA (estado: ${fileState}). Intenta con un video más corto (menos de 30 segundos).` });
    }

    console.log('[BioVideo] Video listo. Ejecutando análisis dinámico...');

    // 3. Prompt de Análisis de Movimiento
    const prompt = `Eres un Biomecánico de Ciclismo profesional. Analiza el video del ciclista y devuelve ÚNICAMENTE un JSON válido en español. No añadas texto fuera del JSON.

Para cada métrica asigna EXACTAMENTE uno de estos tres valores de "rating": "OK", "Mejorable" o "Problema".
En "detail" describe en máximo 100 caracteres lo que observas objetivamente.

CRITERIOS OBJETIVOS (úsalos como referencia estricta):
- hip_stability: OK=cadera estable sin balanceo lateral visible; Mejorable=ligero balanceo (<2 cm); Problema=balanceo evidente (>2 cm, indica sillín alto)
- knee_tracking: OK=rodillas alineadas sobre los pies durante todo el ciclo; Mejorable=ligera desviación ocasional; Problema=colapso varo o valgo constante
- ankle_technique: OK=tobillo neutro con ligera flexión plantar en PMI; Mejorable=talón muy caído o exceso de puntilla; Problema=movimiento excesivo o muy irregular del tobillo
- pedaling_smoothness: OK=círculo fluido sin puntos muertos visibles; Mejorable=ligero tirón en la fase de recobro; Problema=movimiento claramente a pistón

Formato JSON obligatorio:
{"dynamic_analysis":{"hip_stability":{"rating":"OK","detail":"..."},"knee_tracking":{"rating":"OK","detail":"..."},"ankle_technique":{"rating":"OK","detail":"..."},"pedaling_smoothness":{"rating":"OK","detail":"..."}},"expert_diagnosis":{"summary":"...","red_flags":["..."],"recommended_adjustments":[{"component":"saddle_height","action":"bajar","reason":"..."}]}}`;

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const analyzeRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${googleKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ fileData: { fileUri, mimeType } }, { text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' }
      })
    });

    const analyzeData = await analyzeRes.json();
    const text = analyzeData.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) return res.status(500).json({ error: 'La IA no pudo procesar la respuesta' });

    return res.json({ mode: 'video', ...JSON.parse(text) });

  } catch (e) {
    console.error('[BioVideo] Excepción:', e.message);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(500).json({ error: e.message });
  }
});

function sanitizePhotoView(view) {
  const v = String(view || '').toLowerCase();
  if (['lateral_izq', 'lateral_der', 'frontal', 'trasera'].includes(v)) return v;
  return 'lateral_izq';
}

function parseDataUrlImage(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
  if (!m) return { ok: false, error: 'Formato de imagen no valido. Usa JPG, PNG o WEBP.' };
  const base64 = m[2];
  // Aprox bytes reales del binario.
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes < 10 * 1024) return { ok: false, error: 'Una foto es demasiado pequena para analizar.' };
  if (bytes > 4 * 1024 * 1024) return { ok: false, error: 'Cada foto debe ser menor a 4MB.' };
  return { ok: true, mime: m[1], bytes };
}

function compactText(val, max = 240) {
  return String(val || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

const BIOMECHANICS_SYSTEM_PROMPT = `Eres un Experto en Biomecánica de Ciclismo y Fisioterapeuta Deportivo con más de 15 años de experiencia en Bike Fitting profesional. Tu expertise incluye análisis de movimiento, prevención de lesiones y optimización del rendimiento ciclistas.

TU TAREA: Realizar un análisis técnico riguroso de la postura del ciclista en la imagen adjunta, basándote en principios de Bike Fitting profesional.

═══════════════════════════════════════════════════════════════
1. ESTIMACIÓN DE ÁNGULOS ARTICULARES CLAVE
═══════════════════════════════════════════════════════════════
Estima los siguientes ángulos basándote en la posición de la imagen. Prioriza los puntos de usuario si se proporcionan. Asume posición en las manetas (hoods) para ruta/gravel a menos que se indique lo contrario:

• Extensión de Rodilla (Knee Extension): Medido en el Punto Muerto Inferior (PMI, biela a las 6). Rango ideal: 140°-150°.
• Ángulo de Cadera (Hip Angle): Ángulo interior hombro-cadera-rodilla. Rango ideal en PMI: 100°-115°.
• Ángulo del Tobillo (Ankle Angle): Ángulo interior rodilla-tobillo-pie. Rango ideal en PMI: 100°-120°.
• Ángulo del Tronco (Trunk Angle): Respecto a la horizontal. Ruta: 40-50°, Gran Fondo: 45-55°, Triatlón: 20-30°.
• Ángulo de Codo: Interior hombro-codo-muñeca. Rango ideal: 150°-165°.
• Retroceso de Rodilla (KOPS): Posición de la rodilla respecto al eje del pedal (3 en punto).

═══════════════════════════════════════════════════════════════
2. EVALUACIÓN DE POSTURA
═══════════════════════════════════════════════════════════════
Evalúa:

• Columna Vertebral: ¿Cifosis excesiva? ¿Hiperextensión lumbar? ¿Inestabilidad?
• Hombros: ¿Relajados o tensionados? ¿Elevados?
• Codos: ¿Bloqueados o ligeramente flexionados?
• Alineación de Cadera: ¿Nivelada o inclinada?

═══════════════════════════════════════════════════════════════
3. IDENTIFICACIÓN DE "PUNTOS ROJOS" (Riesgos Biomecánicos)
═══════════════════════════════════════════════════════════════
Señala desviaciones que pueden causar:
- Dolor lumbar (asociado a sillín alto o alcance excesivo)
- Entumecimiento de manos (asociado a excesiva carga frontal o caída de manillar)
- Dolor de rodilla anterior (asociado a sillín bajo o muy adelantado)
- Dolor de rodilla posterior (asociado a sillín muy alto)
- Síndrome del túnel carpiano
- Cervicalgias

═══════════════════════════════════════════════════════════════
4. COORDENADAS NORMALIZADAS (Obligatorio 0.00 - 1.00)
═══════════════════════════════════════════════════════════════
Devuelve los puntos articulares en proporción estricta de 0.00 a 1.00.
- El punto {"x": 0.0, "y": 0.0} es la esquina superior izquierda de la foto.
- El punto {"x": 1.0, "y": 1.0} es la esquina inferior derecha de la foto.
Puntos requeridos: shoulder, elbow, wrist, hip, knee, ankle, foot_tip.

═══════════════════════════════════════════════════════════════
5. FORMATO DE SALIDA OBLIGATORIO (JSON exacto)
═══════════════════════════════════════════════════════════════
IMPORTANTE: Si se proporcionan "PUNTOS DEL USUARIO", úsalos obligatoriamente para calcular los ángulos y el diagnóstico, ya que son la verdad de terreno corregida por el humano.

{
  "metadata": {
    "detected_side": "left|right|unknown",
    "image_quality": "good|fair|poor",
    "analysis_confidence": 0.0,
    "photo_notes": ["observaciones sobre la imagen"]
  },
  "keypoints_normalized": {
    "shoulder": {"x": 0.0, "y": 0.0},
    "elbow": {"x": 0.0, "y": 0.0},
    "wrist": {"x": 0.0, "y": 0.0},
    "hip": {"x": 0.0, "y": 0.0},
    "knee": {"x": 0.0, "y": 0.0},
    "ankle": {"x": 0.0, "y": 0.0},
    "foot_tip": {"x": 0.0, "y": 0.0}
  },
  "biomechanical_angles": {
    "knee_extension_pmi": {"value": 0, "unit": "degrees", "optimal_range": [140, 150], "status": "low|optimal|high"},
    "hip_angle_pmi": {"value": 0, "unit": "degrees", "optimal_range": [100, 115], "status": "low|optimal|high"},
    "ankle_angle_pmi": {"value": 0, "unit": "degrees", "optimal_range": [100, 120], "status": "low|optimal|high"},
    "trunk_angle": {"value": 0, "unit": "degrees", "optimal_range": [35, 55], "status": "low|optimal|high"},
    "elbow_angle": {"value": 0, "unit": "degrees", "optimal_range": [145, 160], "status": "low|optimal|high"}
  },
  "posture_evaluation": {
    "spine": {"observation": "", "status": "optimal|acceptable|issue"},
    "shoulders": {"observation": "", "status": "relaxed|tensioned|elevated"},
    "hips": {"observation": "", "status": "level|uneven"},
    "elbows": {"observation": "", "status": "relaxed|slightly_bent|locked"}
  },
  "expert_diagnosis": {
    "summary": "Resumen del análisis biomecánico",
    "red_flags": ["riesgo identificado 1", "riesgo identificado 2"],
    "potential_issues": ["problema potencial 1"],
    "recommended_adjustments": [
      {"component": "saddle_height", "action": "raise|lower", "amount_mm": 0, "reason": "razón técnica específica"}
    ]
  }
}

IMPORTANTE: Si la calidad de imagen no permite estimación precisa, indícalo en "image_quality": "poor" y no especules. Es mejor admitir limitaciones que dar información incorrecta.`;

async function analyzeBiomechanicsWithAI(photos, rider, userPoints = {}) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
  const openaiKey    = process.env.OPENAI_API_KEY    || '';
  const googleKey    = process.env.GOOGLE_API_KEY    || '';
  const groqKey      = process.env.GROQ_API_KEY      || '';
  const hasAnthropic = anthropicKey.startsWith('sk-ant-');
  const hasOpenAI    = openaiKey.length > 20;
  const hasGoogle    = googleKey.startsWith('AIzaSy');
  const hasGroq      = groqKey.startsWith('gsk_');

  console.log('[Bio] providers — Gemini:', hasGoogle, '| Groq:', hasGroq, '| Anthropic:', hasAnthropic, '| OpenAI:', hasOpenAI);

  const riderCtx = `Disciplina: ${rider.discipline||'ruta'} | Objetivo: ${rider.objective||'rendimiento'}${rider.pain ? ' | Dolor reportado: '+rider.pain : ''}`;
  
  // Añadir contexto de puntos del usuario si existen
  const userPointsCtx = Object.keys(userPoints).length > 0 
    ? `\n\nPUNTOS DEL USUARIO (ajustados manualmente): ` + JSON.stringify(userPoints)
    : '';

  const geminiModels = [...new Set([
    (process.env.GEMINI_MODEL || '').trim(),
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite-preview-02-05',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-pro-vision'
  ])].filter(Boolean);

  // ── 1. Google Gemini (primero — mejor visión, más fiable) ──
  if (hasGoogle) {
    for (const model of geminiModels) {
      console.log(`[Bio] Intentando Gemini (${model})...`);
      const parts = [
        { text: BIOMECHANICS_SYSTEM_PROMPT + '\n\nContexto del atleta: ' + riderCtx + userPointsCtx + '\n\nAnaliza la imagen y devuelve SOLO el JSON, sin texto adicional.' },
        ...photos.flatMap(p => {
          const [header, b64] = p.dataUrl.split(';base64,');
          return [
            { text: `VISTA DE LA FOTO: ${p.view}` },
            { inlineData: { mimeType: header.split(':')[1], data: b64 } },
          ];
        }),
      ];
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': googleKey },
            body: JSON.stringify({
              contents: [{ role: 'user', parts }],
              generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
            }),
          }
        );
        console.log('[Bio] Gemini status:', resp.status);
        const data = await resp.json();
        if (resp.status === 404) {
          console.log(`[Bio] Modelo ${model} no encontrado, probando siguiente...`);
          continue;
        }
        if (data.error) {
          console.log('[Bio] Gemini error:', JSON.stringify(data.error));
          continue;
        }
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          console.log('[Bio] Gemini raw (400):', text.slice(0, 400));
          const parsed = extractJSON(text);
          if (parsed) {
            const kp = parsed?.keypoints_normalized || parsed?.points;
            console.log('[Bio] Gemini keypoints:', JSON.stringify(kp).slice(0, 300));
            if (!isFakeResponse(parsed)) return normalizeBiomechanicsResult(parsed);
            console.log(`[Bio] Modelo ${model} devolvió valores vacíos. Probando siguiente...`);
          } else {
            console.log(`[Bio] Modelo ${model} devolvió JSON inválido. Probando siguiente...`);
          }
          continue;
        } else {
          console.log(`[Bio] Modelo ${model} no devolvió texto (posible bloqueo). Probando siguiente...`);
          continue;
        }
      } catch (e) {
        console.log(`[Bio] Gemini exception en ${model}:`, e.message);
        continue;
      }
    }
  }

  // ── 2. OpenAI GPT-4o ──
  if (hasOpenAI) {
    console.log('[Bio] Intentando OpenAI...');
    try {
      const oaiMessages = [
        { role: 'system', content: BIOMECHANICS_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Contexto del atleta: ' + riderCtx + userPointsCtx },
            ...photos.flatMap(p => [
              { type: 'text', text: `VISTA: ${p.view}` },
              { type: 'image_url', image_url: { url: p.dataUrl, detail: 'high' } },
            ]),
          ],
        },
      ];
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: 'gpt-4o', messages: oaiMessages, max_tokens: 4096, response_format: { type: 'json_object' } }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) {
          const parsed = extractJSON(text);
          if (parsed && !isFakeResponse(parsed)) return normalizeBiomechanicsResult(parsed);
          if (parsed) console.log('[Bio] OpenAI returned placeholder values, trying next provider');
        }
      }
    } catch (e) {
      console.log('[Bio] OpenAI exception:', e.message);
    }
  }

  // ── 3. Anthropic Claude ──
  if (hasAnthropic) {
    console.log('[Bio] Intentando Anthropic...');
    try {
      const client = new Anthropic({ apiKey: anthropicKey });
      const content = [
        { type: 'text', text: 'Contexto del atleta: ' + riderCtx + userPointsCtx },
        ...photos.flatMap(p => {
          const [header, b64] = p.dataUrl.split(';base64,');
          return [
            { type: 'text', text: `VISTA: ${p.view}` },
            { type: 'image', source: { type: 'base64', media_type: header.split(':')[1], data: b64 } },
          ];
        }),
      ];
      const response = await client.messages.create({
        model: 'claude-3-5-sonnet-latest',
        max_tokens: 4096,
        system: BIOMECHANICS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      });
      const text = response.content.find(c => c.type === 'text')?.text;
      if (text) {
        const parsed = extractJSON(text);
        if (parsed && !isFakeResponse(parsed)) return normalizeBiomechanicsResult(parsed);
        if (parsed) console.log('[Bio] Anthropic returned placeholder values, trying next provider');
      }
    } catch (e) {
      console.log('[Bio] Anthropic exception:', e.message);
    }
  }

  // ── 4. Groq Vision ──
  if (hasGroq) {
    const groqVisionModels = [
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'meta-llama/llama-4-maverick-17b-128e-instruct',
    ];
    for (const groqModel of groqVisionModels) {
      console.log(`[Bio] Intentando Groq Vision (${groqModel})...`);
      try {
        // Groq Llama 3.2 Vision solo soporta 1 imagen por petición
        const groqPhotos = photos.slice(0, 1);
        const oaiMessages = [
          { role: 'system', content: BIOMECHANICS_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Contexto del atleta: ' + riderCtx + userPointsCtx },
              ...groqPhotos.flatMap(p => [
                { type: 'text', text: `VISTA: ${p.view}` },
                { type: 'image_url', image_url: { url: p.dataUrl } },
              ]),
            ],
          },
        ];
        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
          body: JSON.stringify({ model: groqModel, messages: oaiMessages, max_tokens: 4096, temperature: 0.05 }),
        });
        if (resp.ok) {
          const data = await resp.json();
          const text = data.choices?.[0]?.message?.content;
          if (text) {
            const parsed = extractJSON(text);
            if (parsed && !isFakeResponse(parsed)) return normalizeBiomechanicsResult(parsed);
          }
          break;
        } else {
          const errData = await resp.json().catch(()=>({}));
          console.log(`[Bio] Groq status (${groqModel}):`, resp.status, JSON.stringify(errData));
          if (resp.status === 404 || errData?.error?.code === 'model_decommissioned' || errData?.error?.message?.includes('decommissioned')) {
            continue; // Intentar con el siguiente modelo de Groq
          }
          break;
        }
      } catch (e) {
        console.log(`[Bio] Groq exception (${groqModel}):`, e.message);
        break;
      }
    }
  }

  console.log('[Bio] Todos los proveedores fallaron, usando fallback');
  return null;
}

function extractJSON(text) {
  const clean = (str) => {
    let s = str.replace(/,\s*([\}\]])/g, '$1'); // Corrige comas sobrantes al final de arrays u objetos
    s = s.replace(/[\n\r\t]+/g, ' '); // Elimina saltos de línea crudos que rompen JSON.parse dentro de los strings
    s = s.replace(/\\"/g, "'"); // Evita roturas por comillas mal escapadas
    return s;
  };

  const tryParse = (str) => {
    try { return JSON.parse(str); } catch {}
    try { return JSON.parse(clean(str)); } catch {}
    // Reparador de emergencia para respuestas truncadas por la IA
    try { return JSON.parse(clean(str) + '}'); } catch {}
    try { return JSON.parse(clean(str) + '}}'); } catch {}
    try { return JSON.parse(clean(str) + '}}}'); } catch {}
    return null;
  };

  let parsed = tryParse(text);
  if (parsed) return parsed;

  const m = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (m) { parsed = tryParse(m[1]); if (parsed) return parsed; }
  const m2 = text.match(/\{[\s\S]*\}/);
  if (m2) { parsed = tryParse(m2[0]); if (parsed) return parsed; }
  
  console.log('[Bio] Error de parseo JSON. Texto truncado recibido:', text.substring(0, 1500));
  return null;
}

function isFakeResponse(parsed) {
  const keypoints = parsed?.keypoints_normalized || parsed?.points;

  if (!keypoints || Object.keys(keypoints).length === 0) return true;
  
  if (keypoints && typeof keypoints === 'object') {
    const coords = Object.values(keypoints).flatMap(p => {
      if (!p) return [];
      if (Array.isArray(p)) return [Number(p[0]), Number(p[1])];
      return [Number(p.x ?? p.X), Number(p.y ?? p.Y)];
    });
    if (coords.length === 0 || coords.every(v => v === 0 || isNaN(v))) return true;
  }
  return false;
}

function normalizeBiomechanicsResult(raw) {
  let points = raw?.keypoints_normalized || raw?.points || raw || {};
  if (Array.isArray(points)) points = {};
  
  const normalized = {};
  let maxVal = 0;

  const keyMap = {
    "hombro": "shoulder", "codo": "elbow", "muñeca": "wrist", "muneca": "wrist",
    "cadera": "hip", "rodilla": "knee", "tobillo": "ankle", "pie": "foot_tip", 
    "punta_pie": "foot_tip", "foot": "foot_tip"
  };

  // 1. Extraer los puntos y buscar el valor máximo para determinar la escala real
  for (const key in points) {
    const pt = points[key];
    if (!pt) continue;

    let x, y;
    if (Array.isArray(pt) && pt.length >= 2) {
      x = Number(pt[0]);
      y = Number(pt[1]);
    } else {
      x = Number(pt.x ?? pt.X);
      y = Number(pt.y ?? pt.Y);
    }

    if (!isNaN(x) && !isNaN(y)) {
      const standardKey = keyMap[key.toLowerCase()] || key.toLowerCase();
      normalized[standardKey] = { x, y };
      maxVal = Math.max(maxVal, Math.abs(x), Math.abs(y));
    }
  }
  
  // 2. Normalizar coordenadas a rango 0-1
  // Si maxVal > 1, la IA devolvió píxeles en vez de proporciones.
  // Calcular maxX y maxY por separado para no distorsionar la relación de aspecto.
  if (maxVal > 1) {
    let maxX = 0, maxY = 0;
    for (const k in normalized) {
      maxX = Math.max(maxX, Math.abs(normalized[k].x));
      maxY = Math.max(maxY, Math.abs(normalized[k].y));
    }
    // Escala separada por eje: si la IA usó p.ej. 0-100 en ambos ejes, dividir por 100 en ambos
    // Si usó píxeles reales (distintos por eje), dividir por el máximo de cada eje.
    const scaleX = maxX > 1 ? maxX : 1;
    const scaleY = maxY > 1 ? maxY : 1;
    for (const key in normalized) {
      normalized[key].x = Math.max(0, Math.min(1, normalized[key].x / scaleX));
      normalized[key].y = Math.max(0, Math.min(1, normalized[key].y / scaleY));
    }
  }

  return {
    points: normalized,
    biomechanical_angles: raw?.biomechanical_angles || {},
    posture_evaluation: raw?.posture_evaluation || {},
    expert_diagnosis: raw?.expert_diagnosis || {},
    metadata: raw?.metadata || {}
  };
}

function buildBiomechanicsFallback(rider, photos, userPoints = {}) {
  return {
    points: userPoints,
    biomechanical_angles: {},
    posture_evaluation: {},
    expert_diagnosis: { summary: "Modo manual activado sin diagnóstico IA." }
  };
}

// ── Builders ─────────────────────────────────────────────────

function buildTrainingRecommendation({ tsb, ctl, ftp, weight, goal, phase, form,
  zonePct, lowPct, midPct, hiPct, tssGrowth, avgTSS, avgDurMin, acts }) {

  // Semana objetivo según estado de forma + fase
  let weekTarget, sessions, focus, alerts = [];

  if (form.risk === 'muy alto' || tsb < -30) {
    weekTarget = Math.round(ctl * 0.5);
    focus = 'Recuperación total';
    sessions = buildRecoveryWeek(ftp);
    alerts.push('⚠️ Estás en sobreentrenamiento. Prioriza el descanso y el sueño.');
  } else if (form.risk === 'alto' || tsb < -20) {
    weekTarget = Math.round(ctl * 0.65);
    focus = 'Semana de descarga';
    sessions = buildDeloadWeek(ftp, goal);
    alerts.push('⚠️ Alta fatiga acumulada. Reduce el volumen esta semana.');
  } else if (phase === 'recovery') {
    weekTarget = Math.round(ctl * 0.70);
    focus = 'Recuperación activa';
    sessions = buildDeloadWeek(ftp, goal);
  } else if (phase === 'peak') {
    weekTarget = Math.round(ctl * 0.85);
    focus = 'Puesta a punto';
    sessions = buildPeakWeek(ftp, goal);
  } else if (phase === 'build') {
    weekTarget = Math.round(ctl * 1.08);
    focus = 'Bloque de carga — ' + goalLabel(goal);
    sessions = buildBuildWeek(ftp, goal, weight);
    if (tssGrowth > 15) alerts.push('📈 Estás aumentando la carga muy rápido. Limita el incremento a +5-8% semanal.');
  } else {
    weekTarget = Math.round(ctl * 1.05);
    focus = 'Bloque base — ' + goalLabel(goal);
    sessions = buildBaseWeek(ftp, goal, weight);
  }

  const keySession = sessions.find(s => s.key);

  return {
    phase, focus, weekTarget,
    sessions, alerts, keySession,
    insights: buildInsights({ tsb, ctl, ftp, weight, zonePct, avgTSS, avgDurMin, acts, goal }),
  };
}

function goalLabel(goal) {
  return { resistencia: 'Resistencia', ftp: 'Umbral FTP', vo2max: 'VO₂Máx', sprint: 'Sprint', gran_fondo: 'Gran Fondo' }[goal] || goal;
}

function buildBaseWeek(ftp, goal, weight) {
  return [
    { day: 'Lunes',     type: 'Descanso',    duration: 0,   tss: 0,   description: 'Recuperación completa o movilidad 20min' },
    { day: 'Martes',    type: 'Z2 Endurance', duration: 60,  tss: 55,  key: false,
      description: `Z2 continuo 60min. Target: ${Math.round(ftp*0.65)}-${Math.round(ftp*0.75)}W. Cadencia 85-95rpm. Conversación posible.` },
    { day: 'Miércoles', type: 'Sweet Spot',   duration: 75,  tss: 80,  key: false,
      description: `3×10min a ${Math.round(ftp*0.88)}-${Math.round(ftp*0.93)}W (88-93% FTP). Rec: 5min Z1 entre series.` },
    { day: 'Jueves',    type: 'Recuperación', duration: 45,  tss: 30,  key: false,
      description: `45min Z1/Z2 suave. Max ${Math.round(ftp*0.72)}W. No superes 75% FTP.` },
    { day: 'Viernes',   type: 'Descanso',     duration: 0,   tss: 0,   description: 'Descanso o stretching' },
    { day: 'Sábado',    type: 'Long Ride',    duration: 120, tss: 110, key: true,
      description: `Fondón 2h en Z2. Target ${Math.round(ftp*0.65)}-${Math.round(ftp*0.75)}W. Nutrición: 60g carbos/h desde min 30.` },
    { day: 'Domingo',   type: 'Activación',   duration: 50,  tss: 40,  key: false,
      description: `50min Z2 con 3×1min sprints finales a max potencia. Recuperación activa.` },
  ];
}

function buildBuildWeek(ftp, goal, weight) {
  const goalSessions = {
    ftp: [
      { day: 'Martes', type: 'Umbral FTP', duration: 70, tss: 85, key: false,
        description: `2×20min a ${Math.round(ftp*0.95)}-${Math.round(ftp*1.00)}W (95-100% FTP). Rec: 10min fácil entre series.` },
      { day: 'Jueves', type: 'Progresivo', duration: 80, tss: 90, key: false,
        description: `20min Z2 + 20min Z3 + 20min Z4 + 10min Z2 cooldown. Progresión de intensidad.` },
      { day: 'Sábado', type: 'Over-Under', duration: 90, tss: 105, key: true,
        description: `4×(8min a ${Math.round(ftp*1.05)}W + 4min a ${Math.round(ftp*0.88)}W). "Over-unders" para FTP. Rec: 5min entre bloques.` },
    ],
    vo2max: [
      { day: 'Martes', type: 'VO₂Max Corto', duration: 65, tss: 88, key: false,
        description: `8×3min a ${Math.round(ftp*1.12)}-${Math.round(ftp*1.18)}W (110-118% FTP). Rec: 3min fácil. Cadencia libre.` },
      { day: 'Jueves', type: 'Threshold',    duration: 70, tss: 82, key: false,
        description: `3×12min a ${Math.round(ftp*0.96)}W. Mantener potencia estable. No mates el primero.` },
      { day: 'Sábado', type: 'VO₂Max Largo', duration: 85, tss: 110, key: true,
        description: `5×5min a ${Math.round(ftp*1.10)}-${Math.round(ftp*1.15)}W. Series más largas para maximizar tiempo >VO₂Max.` },
    ],
    resistencia: [
      { day: 'Martes', type: 'Tempo Suave', duration: 75, tss: 75, key: false,
        description: `60min continuos a ${Math.round(ftp*0.80)}-${Math.round(ftp*0.85)}W. Ritmo Tempo controlado.` },
      { day: 'Jueves', type: 'Endurance+',  duration: 80, tss: 70, key: false,
        description: `Z2 largo con 4×5min a ${Math.round(ftp*0.88)}W intercalados. Mantenimiento de base.` },
      { day: 'Sábado', type: 'Gran Fondo',  duration: 150, tss: 130, key: true,
        description: `2.5h Z2 + los últimos 30min a ritmo Sweet Spot. Nutrición obligatoria cada 20min.` },
    ],
    sprint: [
      { day: 'Martes', type: 'Velocidad', duration: 60, tss: 70, key: false,
        description: `10×10s sprint máx con 5min rec. Cadencia alta >110rpm. Potencia máxima absoluta.` },
      { day: 'Jueves', type: 'Fuerza',    duration: 70, tss: 75, key: false,
        description: `6×3min en Z4-Z5 con cadencia baja (60-65rpm) para fuerza específica de piernas.` },
      { day: 'Sábado', type: 'Race Sim',  duration: 90, tss: 100, key: true,
        description: `Simulacro de carrera: Z2 con 8 sprints de 30s máximos. Practica salida y reacción.` },
    ],
    gran_fondo: [
      { day: 'Martes', type: 'Sweet Spot', duration: 80, tss: 90, key: false,
        description: `3×15min a ${Math.round(ftp*0.90)}W (90% FTP). Específico para sostenibilidad en gran fondo.` },
      { day: 'Jueves', type: 'Threshold',  duration: 70, tss: 85, key: false,
        description: `2×20min a ${Math.round(ftp*0.95)}W. Tolerar la acidez muscular en largas distancias.` },
      { day: 'Sábado', type: 'Gran Fondo', duration: 180, tss: 150, key: true,
        description: `3h Z2 con últimas 45min a ritmo SS. Practica tu estrategia de nutrición real.` },
    ],
  };

  const mid = goalSessions[goal] || goalSessions.resistencia;
  return [
    { day: 'Lunes',     type: 'Descanso',    duration: 0,  tss: 0,  description: 'Descanso total. Sueño 8h.' },
    mid[0],
    { day: 'Miércoles', type: 'Recuperación', duration: 45, tss: 28, description: `Z1/Z2 suave, 45min. Max ${Math.round(ftp*0.72)}W.` },
    mid[1],
    { day: 'Viernes',   type: 'Activación',  duration: 40, tss: 30, description: 'Pre-carga: 40min con 3 sprints cortos. Piernas listas para el sábado.' },
    mid[2],
    { day: 'Domingo',   type: 'Recuperación', duration: 50, tss: 35, description: `Paseo suave 50min Z1. No superes ${Math.round(ftp*0.70)}W.` },
  ];
}

function buildDeloadWeek(ftp, goal) {
  return [
    { day: 'Lunes',     type: 'Descanso',    duration: 0,  tss: 0,  description: 'Descanso total' },
    { day: 'Martes',    type: 'Z1 Suave',    duration: 40, tss: 22, description: `Z1 muy suave 40min. Max ${Math.round(ftp*0.60)}W. Spin ligero.` },
    { day: 'Miércoles', type: 'Descanso',    duration: 0,  tss: 0,  description: 'Recuperación activa: caminar, nadar, yoga' },
    { day: 'Jueves',    type: 'Activación',  duration: 50, tss: 35, description: `50min Z1/Z2 con 2×5min a ${Math.round(ftp*0.85)}W para no perder adaptaciones.` },
    { day: 'Viernes',   type: 'Descanso',    duration: 0,  tss: 0,  description: 'Descanso' },
    { day: 'Sábado',    type: 'Z2 Corto',    duration: 60, tss: 45, description: `60min Z2 agradable. Sin presión de potencia.` },
    { day: 'Domingo',   type: 'Descanso',    duration: 0,  tss: 0,  description: 'Descanso completo' },
  ];
}

function buildPeakWeek(ftp, goal) {
  return [
    { day: 'Lunes',     type: 'Descanso',    duration: 0,  tss: 0,  description: 'Descanso' },
    { day: 'Martes',    type: 'Activación',  duration: 60, tss: 55, key: true,
      description: `60min con 2×8min a ${Math.round(ftp*0.97)}W. Mantener calidad, reducir volumen.` },
    { day: 'Miércoles', type: 'Suave',       duration: 40, tss: 25, description: `Z1/Z2, 40min. Piernas activas sin fatiga.` },
    { day: 'Jueves',    type: 'Velocidad',   duration: 50, tss: 45, description: `6×30s sprints a potencia máxima. Rec: 5min. Sentir las piernas explosivas.` },
    { day: 'Viernes',   type: 'Descanso',    duration: 0,  tss: 0,  description: 'Descanso total o rodillo 20min Z1' },
    { day: 'Sábado',    type: 'Pre-evento',  duration: 45, tss: 35, description: `45min Z1/Z2 con 3×1min al 110% FTP. Activar sin vaciar.` },
    { day: 'Domingo',   type: 'COMPETICIÓN', duration: 0,  tss: 0,  description: '🏆 Día de competición o rodada objetivo.' },
  ];
}

function buildRecoveryWeek(ftp) {
  return [
    { day: 'Lunes',     type: 'Descanso',   duration: 0,  tss: 0, description: 'Descanso total. Sin bici.' },
    { day: 'Martes',    type: 'Descanso',   duration: 0,  tss: 0, description: 'Descanso. Sueño prioritario.' },
    { day: 'Miércoles', type: 'Z1 Spin',    duration: 30, tss: 15, description: `Rodillo 30min Z1. Max ${Math.round(ftp*0.55)}W. Solo para mover las piernas.` },
    { day: 'Jueves',    type: 'Descanso',   duration: 0,  tss: 0, description: 'Descanso' },
    { day: 'Viernes',   type: 'Z1 Spin',    duration: 40, tss: 20, description: `40min Z1. Sin intensidad. Cadencia libre.` },
    { day: 'Sábado',    type: 'Z2 Suave',   duration: 60, tss: 40, description: `60min Z2 agradable. Escucha tu cuerpo.` },
    { day: 'Domingo',   type: 'Descanso',   duration: 0,  tss: 0, description: 'Descanso o actividad no ciclista' },
  ];
}

function buildInsights({ tsb, ctl, ftp, weight, zonePct, avgTSS, avgDurMin, acts, goal }) {
  const insights = [];

  if (ctl > 0) {
    if (ctl < 30)  insights.push({ type: 'fitness', level: 'info',    text: `Tu CTL (${Math.round(ctl)}) indica nivel principiante-intermedio. Enfócate en consistencia y volumen gradual.` });
    if (ctl >= 30 && ctl < 60) insights.push({ type: 'fitness', level: 'info', text: `CTL ${Math.round(ctl)}: nivel intermedio sólido. Puedes empezar a añadir intensidad estructurada.` });
    if (ctl >= 60) insights.push({ type: 'fitness', level: 'success', text: `CTL ${Math.round(ctl)}: excelente base de forma. Tus 30 salidas reflejan consistencia real.` });
  }

  if (zonePct[3] + zonePct[4] > 40) {
    insights.push({ type: 'polarization', level: 'warning',
      text: `${zonePct[3] + zonePct[4]}% de tus salidas están en Z3/Z4. Esta "zona gris" acumula fatiga sin el estímulo óptimo. Mueve las sesiones fáciles a Z1/Z2 y las duras a Z5+.` });
  }

  if (ftp && weight) {
    const wkg = ftp / weight;
    if (wkg < 2.5)  insights.push({ type: 'power', level: 'info',    text: `W/kg FTP: ${Math.round(wkg*100)/100}. Nivel principiante. Prioriza volumen Z2 para construir motor aeróbico.` });
    if (wkg >= 2.5 && wkg < 3.5) insights.push({ type: 'power', level: 'info', text: `W/kg FTP: ${Math.round(wkg*100)/100}. Nivel intermedio. Añade Sweet Spot y umbrales para subir.` });
    if (wkg >= 3.5 && wkg < 4.5) insights.push({ type: 'power', level: 'success', text: `W/kg FTP: ${Math.round(wkg*100)/100}. Nivel avanzado. Enfócate en VO₂Max y economía de pedaleo.` });
    if (wkg >= 4.5) insights.push({ type: 'power', level: 'success', text: `W/kg FTP: ${Math.round(wkg*100)/100}. Nivel élite/sub-élite. El margen de mejora está en la táctica y la recuperación.` });
  }

  if (avgDurMin < 45) {
    insights.push({ type: 'volume', level: 'warning', text: `Duración media ${avgDurMin}min. Sesiones muy cortas limitan las adaptaciones aeróbicas. Apunta a al menos 60-75min por salida.` });
  }

  if (acts.filter(a => a.tss > 0).length === 0) {
    insights.push({ type: 'data', level: 'info', text: 'No tienes datos de potencia. Considera un medidor de vatios o usa la estimación por HR para análisis más precisos.' });
  }

  return insights;
}

function buildNutritionRecommendation({ ftp, weight, goal, phase, form, avgTSS, training, user }) {
  const age    = user.age    || 30;
  const sex    = user.sex    || 'M';

  // Metabolismo basal (Mifflin-St Jeor)
  const height = user.height || 175;
  const bmr = sex === 'M'
    ? 10 * weight + 6.25 * height - 5 * age + 5
    : 10 * weight + 6.25 * height - 5 * age - 161;

  const tdee = Math.round(bmr * 1.55); // Factor actividad moderada

  // Gasto calórico estimado por TSS (aprox 1 TSS ≈ 1 kcal/kg * factor)
  const dailyTSS   = avgTSS || 60;
  const trainCal   = Math.round(dailyTSS * weight * 0.012);

  // Ajuste según objetivo
  const goalCalAdj = { resistencia: 0, ftp: 100, vo2max: 150, sprint: 50, gran_fondo: 200 }[goal] || 0;

  // Día de entrenamiento vs descanso
  const trainDayTotal = tdee + trainCal + goalCalAdj;
  const restDayTotal  = tdee - 150;

  // Macros día entrenamiento
  const carbsG_train   = Math.round((trainDayTotal * 0.58) / 4);
  const proteinG_train = Math.round((trainDayTotal * 0.18) / 4);
  const fatG_train     = Math.round((trainDayTotal * 0.24) / 9);

  // Macros día descanso
  const carbsG_rest    = Math.round((restDayTotal * 0.45) / 4);
  const proteinG_rest  = Math.round((restDayTotal * 0.22) / 4);
  const fatG_rest      = Math.round((restDayTotal * 0.33) / 9);

  // Hidratación
  const hydration = Math.round(weight * 35 + (dailyTSS > 60 ? 500 : 0));
  const inRideCarbs = avgTSS > 80 ? Math.round(avgTSS * 0.6) : 0; // g de carbos en carrera

  // Timing de nutrición según duración
  const avgDurH = training?.sessions?.find(s => s.key)?.duration ? training.sessions.find(s => s.key).duration / 60 : 1.5;

  const timing = {
    pre: `${Math.round(weight * 0.5)}-${Math.round(weight * 0.8)}g carbos, 2-3h antes. Ejemplo: avena + plátano + café.`,
    during: avgDurH > 1
      ? `${Math.round(60 * Math.min(avgDurH, 3) * 0.9)}-${Math.round(75 * Math.min(avgDurH, 3))}g carbos totales. Cada 20min: gel (25g) o plátano. Beber 500-750ml/h.`
      : 'Duración <60min: agua sola es suficiente. Solo añadir carbos si la intensidad es muy alta.',
    post: `${Math.round(weight * 0.3)}g proteína + ${Math.round(weight * 1.0)}g carbos en los primeros 30min. Ejemplo: arroz + pollo + fruta.`,
  };

  // Recomendaciones según fase
  const phaseAdvice = {
    base:     'Periodización nutricional: entrena algunas sesiones Z2 en ayunas (sin carbos antes) para mejorar la oxidación de grasas.',
    build:    'Aumenta carbos en días de sesiones clave. Periodización alta en carbos los días de carga, reducción en descanso.',
    peak:     'Semana de tapering: mantén proteína alta, reduce carbos hasta 2-3 días antes del evento cuando haces carga.',
    recovery: 'Foco en proteína (1.8-2.2g/kg) para reparar músculo. Inflamación: cúrcuma, omega-3, cerezas ácidas.',
  }[phase] || '';

  return {
    trainDay:  { calories: trainDayTotal, carbsG: carbsG_train, proteinG: proteinG_train, fatG: fatG_train },
    restDay:   { calories: restDayTotal,  carbsG: carbsG_rest,  proteinG: proteinG_rest,  fatG: fatG_rest  },
    hydration, inRideCarbs, timing, phaseAdvice,
    supplements: buildSupplements(goal, phase),
    meals: buildMealPlan(carbsG_train, proteinG_train, fatG_train),
  };
}

function buildSupplements(goal, phase) {
  const base = [
    { name: 'Vitamina D3', dose: '2000-4000 UI/día', note: 'Esencial para inmunidad y función muscular. Test anual recomendado.' },
    { name: 'Magnesio glicinato', dose: '300-400mg noche', note: 'Mejora sueño, reduce calambres.' },
    { name: 'Omega-3', dose: '2-3g EPA+DHA/día', note: 'Antiinflamatorio, recuperación muscular.' },
  ];
  const goalExtras = {
    ftp:      [{ name: 'Beta-Alanina', dose: '3.2-6.4g/día', note: 'Buffer de ácido láctico. Puede causar hormigueo (normal).' }],
    vo2max:   [{ name: 'Beetroot/Nitrato', dose: '500mg 2-3h antes', note: 'Aumenta eficiencia O₂. Muy efectivo para VO₂Max.' }],
    sprint:   [{ name: 'Creatina monohidrato', dose: '3-5g/día', note: 'Para sprints y fuerza. Cargar 20g/día 5 días, luego mantener.' }],
    resistencia: [{ name: 'Cafeína', dose: '3-6mg/kg, 60min antes', note: 'Mejora rendimiento aeróbico y reduce percepción de esfuerzo.' }],
    gran_fondo:  [{ name: 'Cafeína + Beetroot', dose: 'Protocolo combinado', note: 'Cafeína 3mg/kg + nitrato 500mg para eventos >3h.' }],
  };
  return [...base, ...(goalExtras[goal] || [])];
}

function buildMealPlan(carbsG, proteinG, fatG) {
  return [
    { time: '07:00', meal: 'Desayuno', description: `Avena (80g) + leche/bebida vegetal + plátano + 2 huevos. ~${Math.round(carbsG * 0.25)}g carbos.` },
    { time: '10:00', meal: 'Media mañana', description: `Fruta + yogur griego + nueces. ~${Math.round(carbsG * 0.10)}g carbos.` },
    { time: '13:00', meal: 'Almuerzo', description: `Arroz/pasta (100g seco) + pollo/pescado (150g) + verduras + AOVE. ~${Math.round(carbsG * 0.35)}g carbos.` },
    { time: '18:30', meal: 'Merienda / Pre-entrenamiento', description: `Pan integral + mermelada/miel + café. 1.5-2h antes del entrenamiento. ~${Math.round(carbsG * 0.15)}g carbos.` },
    { time: '21:30', meal: 'Cena post-entrenamiento', description: `Proteína (130g pescado/carne) + boniato/patata + ensalada. ~${Math.round(carbsG * 0.15)}g carbos, ${Math.round(proteinG * 0.35)}g proteína.` },
  ];
}

// ── POST /api/coach/ai-analysis ──────────────────────────────
router.post('/ai-analysis', async (req, res) => {
  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
    const openaiKey    = process.env.OPENAI_API_KEY    || '';
    const googleKey    = process.env.GOOGLE_API_KEY    || '';
    const groqKey      = process.env.GROQ_API_KEY      || '';
    const hasAnthropic = anthropicKey && anthropicKey !== 'YOUR_ANTHROPIC_API_KEY' && anthropicKey.startsWith('sk-ant-');
    const hasOpenAI    = openaiKey && openaiKey !== 'YOUR_OPENAI_API_KEY' && openaiKey.length > 20;
    const hasGoogle    = googleKey && googleKey.startsWith('AIzaSy') && googleKey.length >= 30;
    const hasGroq      = groqKey && groqKey.startsWith('gsk_');
    const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

    if (!hasAnthropic && !hasOpenAI && !hasGoogle && !hasGroq) {
      return res.status(503).json({ error: 'No se han configurado API Keys válidas en el archivo .env del servidor.' });
    }

    console.log('[AI-Analysis] Proveedores:', { anthropic: hasAnthropic, openai: hasOpenAI, google: hasGoogle, groq: hasGroq });

    const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Goal: from request body (program selector) or user profile
    const requestedGoal  = req.body?.goal;
    const effectiveGoal  = requestedGoal || user.goal || 'resistencia';
    const estadoUsuario  = req.body?.estado_usuario || {};

    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { data: activities, error: actsError } = await supabase.from('activities')
      .select('date, duration, distance, tss, np, avg_power, max_power, avg_hr, max_hr, elevation, type, name, if_value, source, avg_cadence, calories')
      .eq('user_id', req.user.id)
      .gte('date', since90)
      .order('date', { ascending: false })
      .limit(60);
    if (actsError) throw actsError;

    const { data: pmcData, error: pmcError } = await supabase.from('pmc')
      .select('date, ctl, atl, tsb')
      .eq('user_id', req.user.id)
      .order('date', { ascending: false })
      .limit(60);
    if (pmcError) throw pmcError;
    const pmc = pmcData.reverse();

    const latestPMC = pmc[pmc.length - 1] || { ctl: 0, atl: 0, tsb: 0 };

    // Compute zone distribution weighted by duration
    const ftp = user.ftp || 200;
    const zoneMins2 = [0, 0, 0, 0, 0, 0, 0, 0];
    activities.forEach(a => {
      const p   = Number(a.np || a.avg_power || 0);
      const dur = Number(a.duration || 0) / 60;
      if (p > 0 && ftp && dur > 0) {
        const z = powerZone(p, ftp);
        if (z >= 1 && z <= 7) zoneMins2[z] += dur;
      }
    });
    const totalMins2 = zoneMins2.slice(1).reduce((s, c) => s + c, 0);
    const zonePct = zoneMins2.map(c => totalMins2 ? Math.round(c / totalMins2 * 100) : 0);

    // Bests for context
    const maxNP  = Math.max(...activities.map(a => a.np || 0));
    const maxTSS = Math.max(...activities.map(a => a.tss || 0));
    const avgDurMin = activities.length
      ? Math.round(activities.reduce((s, a) => s + (a.duration || 0), 0) / activities.length / 60)
      : 0;
    const hasPower = activities.some(a => (a.avg_power || 0) > 0);

    const athleteProfile = {
      ftp,
      weight:   user.weight || 70,
      age:      user.age    || 30,
      height:   user.height || 175,
      sex:      user.sex    || 'M',
      goal:     effectiveGoal,
      name:     user.name   || 'Atleta',
      ctl:      Math.round(latestPMC.ctl || 0),
      atl:      Math.round(latestPMC.atl || 0),
      tsb:      Math.round(latestPMC.tsb || 0),
      wkg:      ftp && (user.weight || 70) ? Math.round(ftp / (user.weight || 70) * 100) / 100 : null,
      has_power_meter: hasPower,
      zona_distribucion: { z1: zonePct[1], z2: zonePct[2], z3: zonePct[3], z4: zonePct[4], z5: zonePct[5], z6: zonePct[6], z7: zonePct[7] },
      avg_session_min: avgDurMin,
      best_np_w: maxNP || null,
      best_tss:  maxTSS || null,
    };

    const GOAL_INSTRUCTIONS = {
      vo2max: `OBJETIVO SELECCIONADO: VO2MAX
- Prescribe 2 sesiones VO2Max/semana con intervalos 3-8min al 108-120% FTP
- Ejemplo sesión: 5×4min @ ${Math.round(ftp * 1.12)}-${Math.round(ftp * 1.18)}W (rec: igual tiempo Z1)
- Sesión clave: 6×4min o 5×5min al 110-115% FTP
- Nutrición: sin déficit calórico, carbos 7-9g/kg días duros, hidratación alta
- Detecta si el atleta tiene base aeróbica suficiente (CTL>30) para aguantar VO2Max`,

      perdida_peso: `OBJETIVO SELECCIONADO: COMPOSICIÓN CORPORAL / PÉRDIDA DE PESO
- Prescribe 2-3 sesiones FatMax Z2 largas (90-150min) a ${Math.round(ftp * 0.62)}-${Math.round(ftp * 0.72)}W
- Máximo 1 sesión de alta intensidad (Z4+) por semana
- Incluir 1 sesión en ayunas (Z2, <75min) para optimizar oxidación de grasa
- NUTRICIÓN CRÍTICA: calcular déficit 10-15% en días descanso/Z2; NUNCA déficit en días de alta intensidad
- Calcula: calorías_mantenimiento_descanso × 0.87 = objetivo día recuperación
- Proteína alta siempre: 1.8-2.2g/kg para preservar masa muscular con déficit
- No prescribas sesiones >Z3 más de 1 vez por semana`,

      gran_fondo: `OBJETIVO SELECCIONADO: GRAN FONDO / RESISTENCIA LARGA
- Sesión ultra-larga obligatoria fin de semana: 2.5-4h Z2 (${Math.round(ftp * 0.65)}-${Math.round(ftp * 0.75)}W)
- Incluir 2 sesiones Sweet Spot semana: 3×15min al 88-93% FTP
- Carga de carbos (150-200g extra) la noche anterior a sesiones >2.5h
- Simular nutrición de carrera en sesión larga: gel cada 20-25min desde min 40
- Gestión de fatiga: no superar ramp rate >5% CTL/semana`,

      resistencia: `OBJETIVO SELECCIONADO: RESISTENCIA / FTP
- Mix equilibrado: 2 sesiones de calidad (umbral/Sweet Spot) + volumen Z2
- Sesión clave: 2×20min al 93-97% FTP o Over-Unders`,

      ftp: `OBJETIVO SELECCIONADO: MEJORA FTP / UMBRAL
- Prescribe Over-Unders: 4×(8min @105% + 4min @88% FTP)
- Threshold Intervals: 2×20min al 95-100% FTP
- Sweet Spot como base: 3×15min al 90% FTP`,

      sprint: `OBJETIVO SELECCIONADO: VELOCIDAD / SPRINT
- 2 sesiones de sprints por semana: 8-12×10-15s potencia máxima (rec: 5min)
- Fuerza específica: 6×3min Z4-Z5 en cadencia baja 60rpm
- Mantener base aeróbica Z2 para recuperación entre sprints`,
    };

    const goalInstructions = GOAL_INSTRUCTIONS[effectiveGoal] || GOAL_INSTRUCTIONS.resistencia;

    // Build estado_usuario block
    const CHIP_LABELS = {
      cansado:        'Atleta CANSADO con piernas pesadas — reduce intensidad y volumen total esta semana.',
      mal_sueno:      'Atleta ha dormido poco — prioriza recuperación, evita sesiones de alta intensidad hoy.',
      estres_trabajo:'Día duro de trabajo/estrés mental — el estrés acumulado cuenta como carga; ajusta a sesión suave.',
      poco_tiempo:    `Poco tiempo disponible hoy${estadoUsuario.minutos_disponibles ? ` (máximo ${estadoUsuario.minutos_disponibles} min)` : ''} — propón sesión corta y efectiva que quepa en ese tiempo.`,
      lesion_leve:    'Atleta tiene una molestia o lesión leve — evita cualquier carga sobre esa zona, adapta el plan.',
      fresco:         'Atleta se siente fresco y bien recuperado — puedes proponer la sesión de calidad prevista.',
      motivado:       'Atleta con alta motivación — si la forma lo permite, aprovecha para sesión exigente.',
    };

    const chips = Array.isArray(estadoUsuario.chips) ? estadoUsuario.chips : [];
    const estadoLines = chips.map(k => CHIP_LABELS[k]).filter(Boolean);
    if (estadoUsuario.minutos_disponibles && !chips.includes('poco_tiempo')) {
      estadoLines.push(`Tiempo máximo disponible hoy: ${estadoUsuario.minutos_disponibles} minutos.`);
    }
    if (estadoUsuario.contexto_libre) {
      estadoLines.push(`Contexto adicional del atleta: "${estadoUsuario.contexto_libre}"`);
    }

    const estadoBlock = estadoLines.length
      ? `\nESTADO ACTUAL DEL ATLETA (HOY) — ADAPTA EL PLAN A ESTO:\n${estadoLines.map(l => `- ${l}`).join('\n')}\n
INSTRUCCIÓN: Basándote en el estado anterior, modifica el plan semanal y la nutrición de esta semana.
Si está cansado/con poco sueño: sustituye sesiones duras por Z2 o recuperación.
Si tiene poco tiempo: recorta duración sin quitar calidad clave.
Si está fresco/motivado y la forma lo permite: mantén o sube ligeramente la sesión de calidad.
Explica brevemente en estado_forma.resumen cómo has adaptado el plan.`
      : '';

    const userMessage = `
PERFIL DEL ATLETA:
${JSON.stringify(athleteProfile, null, 2)}

${goalInstructions}
${estadoBlock}
ACTIVIDADES ÚLTIMOS 90 DÍAS (${activities.length} salidas — usar para calcular bests reales):
${JSON.stringify(activities.slice(0, 30), null, 2)}

PMC ÚLTIMOS 60 DÍAS (tendencia CTL/ATL/TSB):
${JSON.stringify(pmc.slice(-20), null, 2)}

INSTRUCCIÓN ADICIONAL SOBRE PUNTOS DÉBILES:
Compara la distribución de zonas real del atleta con los rangos óptimos para su objetivo y nivel.
Identifica los 2-3 puntos débiles más impactantes con datos específicos (ej: "Z2 solo ${zonePct[2]}%, recomendado >45%").
Sé técnico pero motivador, como un coach de TrainingPeaks.

Genera el análisis completo en formato JSON estrictamente válido.`;

    // El payload para Groq es más pequeño para no exceder el límite de tokens del tier gratuito.
    // Si se usa un proveedor de pago, se puede usar el `userMessage` completo.
    const isGroq = !hasAnthropic && !hasOpenAI && !hasGoogle && hasGroq;
    let finalUserMessage = userMessage;
    let finalModel = 'AI Cascade';

    if (isGroq) {
      console.log('[AI] Usando payload reducido para Groq...');
      finalModel = 'llama-3.1-70b-versatile';
      const groqActs = activities.slice(0, 10).map(a => ({
        date: a.date, duration: Math.round((a.duration||0)/60) + 'min',
        distance: a.distance ? Math.round(a.distance/1000) + 'km' : null,
        tss: a.tss, np: a.np || a.avg_power, avg_hr: a.avg_hr,
      }));
      const groqPMC  = pmc.slice(-10).map(p => ({ date: p.date, ctl: Math.round(p.ctl), atl: Math.round(p.atl), tsb: Math.round(p.tsb) }));
      finalUserMessage = `PERFIL ATLETA: ${JSON.stringify(athleteProfile)}
${goalInstructions}
${estadoBlock}
ACTIVIDADES (10 últimas): ${JSON.stringify(groqActs)}
PMC (10 días): ${JSON.stringify(groqPMC)}

Devuelve EXACTAMENTE este JSON (sin markdown, sin texto extra):
{
  "estado_forma": { "label":"string","color":"green|yellow|orange|red","ctl":N,"atl":N,"tsb":N,"fase":"string","resumen":"string" },
  "diagnostico": {
    "puntos_fuertes": ["string"],
    "puntos_debiles": [{"titulo":"string","detalle":"string","impacto":"string"}],
    "alertas": ["string"],
    "tendencia_ctl": "subiendo|estable|bajando",
    "consistencia": "alta|media|baja",
    "wkg": N
  },
  "plan_semanal": [
    { "dia":"Lunes","tipo":"Z2 Resistencia","duracion_min":90,"tss_objetivo":65,"potencia_objetivo":"160-185W","descripcion":"string","key":false,"emoji":"🚴" },
    { "dia":"Martes","tipo":"Descanso","duracion_min":0,"tss_objetivo":0,"potencia_objetivo":"","descripcion":"Recuperación activa","key":false,"emoji":"😴" }
  ],
  "nutricion": {
    "dia_entrenamiento": {"calorias":N,"carbos_g":N,"proteina_g":N,"grasa_g":N},
    "dia_descanso":      {"calorias":N,"carbos_g":N,"proteina_g":N,"grasa_g":N},
    "hidratacion_ml": N,
    "timing": {"pre":"string","durante":"string","post":"string"}
  },
  "recomendaciones": [{"prioridad":"alta|media|baja","titulo":"string","detalle":"string"}]
}
Incluye los 7 días de la semana en plan_semanal. Para días de entreno duracion_min DEBE ser > 0.`;
    }

    const parsed = await callAI(CYCLING_COACH_SYSTEM_PROMPT, finalUserMessage, { max_tokens: 8000, temperature: 0.2, groqModel: finalModel });
    return res.json({ ok: true, analysis: parsed, meta: { activities: activities.length, model: finalModel } });
  } catch (e) {
    console.error('[AI Coach]', e.message);
    res.status(500).json({ error: e.message || 'Error en análisis IA' });
  }
});

// ── POST /api/coach/today-adaptation ─────────────────────────
// Devuelve solo la recomendación para HOY en base al estado del atleta
router.post('/today-adaptation', async (req, res) => {
  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
    const openaiKey    = process.env.OPENAI_API_KEY    || '';
    const googleKey    = process.env.GOOGLE_API_KEY    || '';
    const groqKey      = process.env.GROQ_API_KEY      || '';
    const hasAnthropic = anthropicKey.startsWith('sk-ant-');
    const hasOpenAI    = openaiKey.length > 20 && openaiKey !== 'YOUR_OPENAI_API_KEY';
    const hasGoogle    = googleKey.startsWith('AIzaSy') && googleKey.length >= 30;
    const hasGroq      = groqKey.startsWith('gsk_');
    const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

    if (!hasAnthropic && !hasOpenAI && !hasGoogle && !hasGroq)
      return res.status(503).json({ error: 'No hay API Keys configuradas.' });

    const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const estadoUsuario  = req.body?.estado_usuario  || {};
    const sesionOriginal = req.body?.sesion_original  || null;
    const esManana       = req.body?.es_manana        || false;
    const ftp = user.ftp || 200;

    // Últimas 7 actividades para contexto de carga reciente
    const { data: acts } = await supabase.from('activities')
      .select('date, duration, distance, tss, np, avg_power, avg_hr, type')
      .eq('user_id', req.user.id)
      .order('date', { ascending: false })
      .limit(7);

    // PMC: últimos 3 días para estado de forma
    const { data: pmcRows } = await supabase.from('pmc')
      .select('date, ctl, atl, tsb')
      .eq('user_id', req.user.id)
      .order('date', { ascending: false })
      .limit(3);

    // Si el cliente envía sus métricas precisas en el body, prevalecen
    const latestPMC = req.body?.metrics || pmcRows?.[0] || { ctl: 0, atl: 0, tsb: 0 };

    const contexto = estadoUsuario.contexto_libre || '';

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const recentActs = (acts || []).filter(a => a.date >= sevenDaysAgo);
    const recentHours = recentActs.reduce((acc, a) => acc + (a.duration || 0), 0) / 3600;
    const recentTSS = Math.round(recentActs.reduce((acc, a) => acc + (a.tss || 0), 0));

    const actsCompact = (acts || []).map(a => ({
      fecha: a.date, tipo: a.type,
      min: Math.round((a.duration || 0) / 60), tss: a.tss,
      np: a.np || a.avg_power,
    }));

    const diaRef = esManana ? 'MAÑANA' : 'HOY';
    const hoy    = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

    const sesionBlock = sesionOriginal ? `
Sesión planificada para ${diaRef}:
- Nombre: ${sesionOriginal.name}
- Tipo: ${sesionOriginal.type}
- Duración: ${sesionOriginal.durationMin} min
- IF objetivo: ${sesionOriginal.ifTarget || 'N/A'}
- Vatios objetivo: ${sesionOriginal.targetWatts || 'N/A'}W
- TSS previsto: ${sesionOriginal.tss || 'N/A'}
- Descripción: ${sesionOriginal.description}
` : `Sin sesión específica planificada para ${diaRef}.`;

    const systemPrompt = 'Eres un coach de ciclismo experto. Responde SOLO con JSON válido, sin markdown, sin texto extra.';
    const userMsg = `Atleta: FTP ${ftp}W, peso ${user.weight || 70}kg, objetivo: ${user.goal || 'resistencia'}.
CTL ${Math.round(latestPMC.ctl)} / ATL ${Math.round(latestPMC.atl)} / TSB ${Math.round(latestPMC.tsb)}.
Hoy es ${hoy}.
${sesionBlock}
Comentario / Intención del atleta: "${contexto || 'no especificado'}".
Carga real en los últimos 7 días: ${recentHours.toFixed(1)} horas, ${recentTSS} TSS en ${recentActs.length} sesiones.
Historial de últimas actividades registradas: ${JSON.stringify(actsCompact)}.

Analiza si el atleta debe mantener, reducir, sustituir o descansar la sesión de ${diaRef}. REGLAS DE DECISIÓN (por orden de prioridad):
1. ¡CRÍTICO!: Si el atleta dice que NO PUEDE entrenar (evento personal, viaje, trabajo, compromiso, no puede salir) → recomendacion SIEMPRE debe ser 'descanso', duracion_min: 0, tss_estimado: 0, if_estimado: 0. Nunca propongas ningún entrenamiento en este caso.
2. ¡CRÍTICO!: Si el atleta especifica un tipo de entrenamiento que QUIERE hacer (ej: "quiero hacer series en Z3", "voy a hacer intervalos", "quiero hacer tempo") → RESPETA ESA PREFERENCIA. Diseña exactamente ese tipo de sesión adaptando duración e intensidad según su TSB actual, pero NO lo sustituyas por otra cosa completamente diferente.
3. Si el atleta está cansado, con poco sueño o estresado, prioriza 'reducir' la sesión (menos repeticiones o duración) antes que 'sustituir' por una sesión completamente diferente, a menos que la fatiga sea extrema (ej: "estoy muerto", "no puedo ni moverme"). En ese caso, 'descanso' o 'sustituir' por Z1 es correcto.
4. Si el atleta indica que hará una salida en grupo (grupeta), ruta larga libre o carrera, IGNORA los intervalos estructurados. Evalúa su fatiga y dale consejos tácticos para esa salida.
Sé específico: usa los vatios reales del FTP (${ftp}W) si propones una alternativa.
Responde con este JSON exacto:
{
  "recomendacion": "mantener" | "reducir" | "sustituir" | "descanso" | "adaptado",
  "titulo": "string corto (ej: Intervalos reducidos 60 min)",
  "duracion_min": number,
  "tss_estimado": number,
  "if_estimado": number,
  "intensidad": "string (ej: Z2 130-145W, Umbral 260W, recuperación activa)",
  "descripcion": "string (2-3 frases concretas: qué hacer, cómo, con vatios reales)",
  "razon": "string (1 frase: por qué esta adaptación dado el estado del atleta)",
  "nutricion": "string (1 frase: qué comer/beber ${diaRef.toLowerCase()})"
}`;
    
    const result = await callAI(systemPrompt, userMsg, { max_tokens: 700, temperature: 0.4 });

    // La IA puede devolver el objeto anidado, lo extraemos si es necesario.
    if (!result || !result.recomendacion) {
      const nested = result ? Object.values(result).find(v => v && typeof v === 'object' && v.recomendacion) : null;
      if (nested) {
        console.log('[Today Adaptation] result:', JSON.stringify(nested));
        return res.json({ ok: true, today: nested });
      }
      return res.status(500).json({ error: 'La IA no devolvió una recomendación válida.' });
    }
    
    console.log('[Today Adaptation] result:', JSON.stringify(result));
    return res.json({ ok: true, today: result });

  } catch (e) {
    console.error('[Today Adaptation]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/coach/daily-menus ──────────────────────────────
router.post('/daily-menus', async (req, res) => {
  const { weight, experience, preferences, likes, dislikes, calories, carbs, protein, fat } = req.body;
  if (!calories || !carbs || !protein || !fat)
    return res.status(400).json({ error: 'calories, carbs, protein y fat son obligatorios' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
  const openaiKey    = process.env.OPENAI_API_KEY    || '';
  const googleKey    = process.env.GOOGLE_API_KEY    || '';
  const groqKey      = process.env.GROQ_API_KEY      || '';
  const hasAnthropic = anthropicKey.startsWith('sk-ant-');
  const hasOpenAI    = openaiKey.length > 20 && openaiKey !== 'YOUR_OPENAI_API_KEY';
  const hasGoogle    = googleKey.startsWith('AIzaSy') && googleKey.length >= 30;
  const hasGroq      = groqKey.startsWith('gsk_');
  const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  if (!hasAnthropic && !hasOpenAI && !hasGoogle && !hasGroq)
    return res.status(503).json({ error: 'No hay API Keys de IA configuradas en el servidor.' });

  const likesLine    = likes?.trim()    ? `* Alimentos que le gustan: ${likes}`       : '';
  const dislikesLine = dislikes?.trim() ? `* Alimentos que NO le gustan: ${dislikes}` : '';
  const optional     = [likesLine, dislikesLine].filter(Boolean).join('\n');

  const systemPrompt = 'Eres un nutricionista deportivo experto en ciclismo. Devuelve SOLO JSON válido, sin markdown ni texto adicional.';
  const userMsg = `Genera 3 menús diarios para un ciclista con estos datos:

USUARIO:
* Peso: ${weight || 70} kg
* Nivel: ${experience || 'intermedio'}
* Tipo de alimentación: ${preferences || 'normal'} (opciones: "come de todo", "normal", "muy selectivo")
${optional ? `\nOPCIONAL:\n${optional}\n` : ''}
OBJETIVO NUTRICIONAL DEL DÍA:
* Calorías: ${calories} kcal
* Carbohidratos: ${carbs} g
* Proteína: ${protein} g
* Grasas: ${fat} g

REGLAS IMPORTANTES:
- "muy selectivo": usa SOLO arroz, pasta, pollo, huevos, pan, yogur, plátano, jamón, queso, leche. Nada raro.
- "normal": variedad moderada sin ingredientes exóticos.
- "come de todo": variedad libre incluyendo pescado y verduras.
- Comida española/mediterránea, fácil de comprar en supermercado.
- Cantidades concretas en g, ml o unidades. Sin recetas elaboradas.
- Macros aproximados (±10% válido).
- Leche o bebida vegetal: máximo 200ml por toma (un vaso normal). Nunca 500ml.
- Yogur: máximo 1 unidad (125-150g) por toma.
- Aceite de oliva: máximo 1 cucharada (10ml) por toma.
- Queso: máximo 30-40g por toma.

FORMATO DE RESPUESTA (JSON estricto):
{"menus":[{"name":"Menú 1 · Simple","meals":{"desayuno":[{"food":"Nombre alimento","amount":"cantidad"}],"comida":[...],"cena":[...],"snacks":[...]},"totals":{"calories":0,"carbs":0,"protein":0,"fat":0}}, ...]}`;

  const result = await callAI(systemPrompt, userMsg, { max_tokens: 2000, temperature: 0.3 });
  if (!result?.menus?.length) return res.status(500).json({ error: 'La IA no devolvió menús válidos.' });
  return res.json(result);
});

// ── System prompt del coach IA ────────────────────────────────
const CYCLING_COACH_SYSTEM_PROMPT = `Eres un Head Coach de ciclismo y triatlón de élite con 20 años de experiencia a nivel UCI, combinado con expertise en nutrición deportiva y periodización. Analizas datos REALES de entrenamiento de Strava/Garmin y generas planes personalizados con el nivel técnico de TrainingPeaks y WKO5.

══════════════════════════════════════════════════════
MÓDULO 1 — DIAGNÓSTICO DE RENDIMIENTO (siempre primero)
══════════════════════════════════════════════════════
1. Estado de forma TSB: >25 Muy fresco | 5-25 Fresco | -10 a 5 En forma | -20 a -10 Cansado | -30 a -20 Fatigado | <-30 Sobreentrenado
2. Análisis de polarización (Modelo Seiler):
   - Óptimo: 75-80% baja intensidad (Z1/Z2) + 15-20% alta intensidad (Z5+) + <10% zona media
   - Si Z3+Z4 > 40%: PROBLEMA — zona gris acumula fatiga sin estímulo óptimo
   - Si Z2 < 40%: base aeróbica insuficiente
3. DIAGNÓSTICO DE PUNTOS DÉBILES (obligatorio, basado en datos reales):
   - Compara distribución de zonas real vs óptima para el objetivo
   - Compara W/kg con estándares UCI por nivel (principiante <2.5, intermedio 2.5-3.5, avanzado 3.5-4.5, élite >4.5)
   - Identifica si la sesión media es demasiado corta (<60min = sin estímulo aeróbico real)
   - Señala inconsistencias: frecuencia errática, ausencia de sesión larga semanal, TSS muy variable
   - Sé específico con números: "Tu Z2 es solo X%, el óptimo es >45% — estás perdiendo adaptaciones aeróbicas"
   - Identifica si hay potencia anaeróbica insuficiente (Z5+ <8%)

══════════════════════════════════════════════════════
MÓDULO 2 — PLAN SEMANAL ESPECÍFICO POR OBJETIVO
══════════════════════════════════════════════════════
REGLAS GENERALES:
- Adapta el volumen al historial REAL del atleta (no propongas 15h si entrena 5h)
- Lunes = descanso siempre
- Máximo 2 sesiones alta intensidad (Z4+) por semana
- Sesión clave (key:true) el sábado o domingo
- Incluye intervalos con potencia EXACTA calculada desde el FTP del atleta

PARA VO2MAX: Intervalos 3-8min al 108-120% FTP, recuperación igual al intervalo.
  Progresión: empezar con series cortas si CTL<40, series largas si CTL>60.
PARA PÉRDIDA DE PESO / COMPOSICIÓN CORPORAL:
  - 2-3 sesiones FatMax Z2 (62-72% FTP): una de ellas en ayunas (<75min)
  - MÁXIMO 1 sesión Z4+ por semana
  - Sesión larga fin de semana: 90-120min Z2 puro
PARA GRAN FONDO: 1 sesión >2.5h Z2 + 2 Sweet Spot (3×15min @90% FTP) + nutrición simulada en sesión larga.

══════════════════════════════════════════════════════
MÓDULO 3 — NUTRICIÓN PERIODIZADA (adaptar al objetivo)
══════════════════════════════════════════════════════
FÓRMULAS:
- BMR Mifflin-St Jeor: hombre = 10×peso + 6.25×altura - 5×edad + 5 | mujer = -161
- TDEE = BMR × 1.55 (actividad moderada)
- Gasto entrenamiento ≈ TSS × peso × 0.012 kcal

PARA OBJETIVO PÉRDIDA DE PESO (OBLIGATORIO):
  - Día descanso/Z2: TDEE × 0.87 (déficit ~13%)
  - Día alta intensidad: SIN déficit (TDEE + gasto entreno)
  - Proteína: 1.8-2.2g/kg SIEMPRE (preservar músculo)
  - Día descanso: reducir carbos (3-4g/kg), aumentar grasas saludables (1-1.2g/kg)
  - Día entreno duro: carbos 6-8g/kg, proteína 1.8g/kg, grasa moderada

PARA OBJETIVO VO2MAX/FTP:
  - Sin déficit calórico nunca — el rendimiento es prioritario
  - Días duros: carbos 8-10g/kg pre-post-sesión
  - Carga de glucógeno la noche anterior a sesión clave

PARA GRAN FONDO:
  - Carga de carbos (150-200g extra) la noche anterior a sesión ultra-larga
  - Simular nutrición de carrera en sesión larga: 60-90g carbos/h desde min 30-40

Incluye timing pre/durante/post con alimentos concretos y cantidades en gramos.

══════════════════════════════════════════════════════
MÓDULO 4 — RECOMENDACIONES TÉCNICAS + SUPLEMENTACIÓN
══════════════════════════════════════════════════════
Top 3 prioridades ordenadas por impacto en rendimiento.
Suplementación basada en evidencia (no especulativa).

FORMATO DE RESPUESTA OBLIGATORIO:
Devuelve ÚNICAMENTE JSON válido con esta estructura exacta:

{
  "estado_forma": {
    "label": "string",
    "color": "green|yellow|orange|red|blue",
    "ctl": number,
    "atl": number,
    "tsb": number,
    "fase": "base|build|peak|recovery",
    "resumen": "string (2-3 frases técnicas sobre el estado actual)"
  },
  "diagnostico": {
    "puntos_fuertes": ["string con dato específico", "string con dato específico"],
    "puntos_debiles": [
      { "titulo": "string conciso", "detalle": "string técnico con % o W/kg reales", "impacto": "alto|medio|bajo" }
    ],
    "alertas": ["string"],
    "distribucion_zonas": {
      "z1_pct": number, "z2_pct": number, "z3_pct": number, "z4_pct": number,
      "z5_pct": number, "z6_pct": number, "z7_pct": number,
      "comentario_polarizacion": "string con diagnóstico de polarización"
    },
    "tendencia_ctl": "subiendo|estable|bajando",
    "consistencia": "alta|media|baja",
    "wkg": number,
    "nivel_estimado": "principiante|intermedio|avanzado|élite"
  },
  "plan_semanal": [
    {
      "dia": "Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo",
      "tipo": "string",
      "duracion_min": number,
      "tss_objetivo": number,
      "potencia_objetivo": "string (ej: '220-240W / 88-93% FTP')",
      "descripcion": "string detallada con intervalos específicos si aplica",
      "key": boolean,
      "emoji": "string"
    }
  ],
  "nutricion": {
    "objetivo_calorico_tipo": "superavit|mantenimiento|deficit",
    "dia_entrenamiento": { "calorias": number, "carbos_g": number, "proteina_g": number, "grasa_g": number, "nota": "string" },
    "dia_descanso": { "calorias": number, "carbos_g": number, "proteina_g": number, "grasa_g": number, "nota": "string" },
    "hidratacion_ml": number,
    "timing": {
      "pre": "string con alimentos y cantidades concretas",
      "durante": "string con pauta de carbos/h y bebidas",
      "post": "string con ventana anabólica"
    },
    "consejo_fase": "string con periodización nutricional específica al objetivo",
    "suplementos": [
      { "nombre": "string", "dosis": "string", "momento": "string", "evidencia": "alta|media|baja" }
    ]
  },
  "recomendaciones": [
    { "prioridad": "alta|media|baja", "titulo": "string", "detalle": "string técnico y accionable" }
  ]
}`;

// ── POST /api/coach/recalculate-week ─────────────────────────
router.post('/recalculate-week', async (req, res) => {
  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
    const openaiKey    = process.env.OPENAI_API_KEY    || '';
    const googleKey    = process.env.GOOGLE_API_KEY    || '';
    const groqKey      = process.env.GROQ_API_KEY      || '';

    if (!anthropicKey && !openaiKey && !googleKey && !groqKey)
      return res.status(503).json({ error: 'No hay API Keys configuradas.' });

    const { plan, todayIdx, feedback } = req.body;

    // Resumimos el plan para no saturar los tokens de la IA (quitamos intervals y descripciones largas)
    const planResumido = plan.sessions.map((s, i) => ({
      dayIndex: i,
      day: s.day,
      type: s.type,
      durationMin: s.durationMin,
      targetWatts: s.targetWatts,
      tss: s.tss,
      advice: s.advice
    }));

    const ayerIdx = todayIdx === 0 ? "anterior (fuera de esta semana)" : todayIdx - 1;
    const mananaIdx = todayIdx === 6 ? "siguiente (fuera de esta semana)" : todayIdx + 1;

    const systemPrompt = 'Eres un coach ciclista experto y nutricionista. Responde SOLO con JSON válido, sin markdown ni texto extra.';
    const userMsg = `El atleta tiene esta planificación para la semana:
${JSON.stringify(planResumido, null, 2)}

HOY es el índice ${todayIdx} (0=Lunes, 6=Domingo).
AYER es el índice ${ayerIdx}.
MAÑANA es el índice ${mananaIdx}.

El atleta reporta el siguiente feedback: "${feedback}"

Tu tarea:
1. MAPEO EXACTO DE DÍAS (dayIndex): Determina de qué días habla el atleta usando la referencia de índices de arriba.
2. 🛑 REGLA ABSOLUTA — DÍAS BLOQUEADOS: NUNCA modifiques HOY (índice ${todayIdx}) ni ningún día anterior. HOY ya ha ocurrido o está en curso. Solo puedes modificar días FUTUROS (índice > ${todayIdx}).
3. APLICA LOS CAMBIOS ÚNICAMENTE EN DÍAS FUTUROS (dayIndex > ${todayIdx}):
   - IMPORTANTE: Si programas una sesión activa ("isRest": false), el "type" DEBE ser exactamente uno de: "recovery", "endurance", "tempo", "threshold", "vo2max", "sprint", "long", "race", "strength". Además, incluye obligatoriamente un "name" y un "emoji" (ej: "🔵", "🚴").
   - ⚠️ ¡TÍTULOS OBLIGATORIOS!: Siempre que modifiques una sesión, DEBES enviar el campo "name" con el nuevo título descriptivo de la sesión. Si la cambias a descanso, pon "name": "Descanso". Si la cambias a rodaje suave, pon "name": "Rodaje Z2", etc.
4. RECALCULA EL RESTO DE LA SEMANA (solo días futuros):
   - ⚠️ REASIGNACIÓN: Si el atleta no pudo hacer una sesión dura, muévela a un día futuro disponible (índice > ${todayIdx}).
   - 📉 COMPENSACIÓN: Si hará muchas horas de grupeta, asegúrate de que el día siguiente sea suave o descanso.

Devuelve EXACTAMENTE este JSON:
{
  "mensaje_coach": "Frase de entrenador explicando los cambios realizados en la semana.",
  "modifications": [
    {
      "dayIndex": 0,
      "changes": { "isRest": true, "name": "Descanso", "type": "recovery", "durationMin": 0, "tss": 0, "advice": "Descanso registrado." }
    },
    {
      "dayIndex": 3,
      "changes": { "isRest": false, "type": "endurance", "name": "Rodillo Z2", "emoji": "🔵", "durationMin": 60, "tss": 45, "description": "Sesión constante en rodillo.", "advice": "He adaptado tu entrenamiento a rodillo." }
    }
  ]
}
NOTA: 'modifications' DEBE contener las alteraciones exactas para los índices reportados. Asegúrate de que los dayIndex devueltos estén entre 0 y 6.`;

    const result = await callAI(systemPrompt, userMsg, { max_tokens: 1500, temperature: 0.3 });
    if (!result || !Array.isArray(result.modifications)) return res.status(500).json({ error: 'La IA no devolvió un plan válido.' });

    // Aplicar modificaciones solo a días futuros (hoy y anteriores están bloqueados)
    const newSessions = [...plan.sessions];
    for (const mod of result.modifications) {
      const idx = Number(mod.dayIndex);
      if (idx > todayIdx && idx < 7 && mod.changes) {
        newSessions[idx] = { ...newSessions[idx], ...mod.changes };
      }
    }

    return res.json({ ok: true, newPlan: { mensaje_coach: result.mensaje_coach, sessions: newSessions } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/coach/design-kit-ai
router.post('/design-kit-ai', async (req, res) => {
  try {
    const { prompt, currentDesign } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Se necesita un prompt para generar el diseño.' });
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
    const openaiKey    = process.env.OPENAI_API_KEY    || '';
    const googleKey    = process.env.GOOGLE_API_KEY    || '';
    const groqKey      = process.env.GROQ_API_KEY      || '';
    const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

    if (!anthropicKey && !openaiKey && !googleKey && !groqKey) {
      return res.status(503).json({ error: 'No hay API Keys de IA configuradas en el servidor.' });
    }

    const systemPrompt = `Eres un asistente de IA que modifica parámetros de diseño. Responde SÓLO con JSON válido.`;

    const userMsg = `Diseño actual:
${JSON.stringify(currentDesign || {}, null, 2)}

Petición del usuario: "${prompt}"

Identifica qué partes del diseño quiere cambiar el usuario.
Devuelve un JSON con la clave "changes" que contenga SÓLO las propiedades que deben cambiar y sus nuevos valores HEX, y una clave "reasoning".

Propiedades permitidas en "changes": bodyColor (pecho), sleeveColor (mangas), sideColor (laterales), detailColor (cuello), accentColor (logos), bibsColor (culote), gripperColor (banda culote), style (solid, gradient, stripes, panels, camo).

IMPORTANTE: Si el usuario pide estilo "camuflaje", "militar" o "ejército", asigna SIEMPRE \`"style": "camo"\` en los cambios e inventa una paleta de colores tierra/verdes coherente.

Ejemplo si pide "mangas rojas":
{
  "changes": {
    "sleeveColor": "#FF0000"
  },
  "reasoning": "He cambiado las mangas a rojo."
}

Si pide un rediseño completo con una temática (ej: "modelo militar", "estilo retro"), inventa una paleta de colores HEX adecuada para esa temática e incluye TODAS las propiedades necesarias en "changes".`;

    const result = await callAI(systemPrompt, userMsg, { max_tokens: 1024, temperature: 0.3 });
    if (!result || (!result.changes && !result.design)) return res.status(500).json({ error: 'La IA no devolvió un diseño válido.' });
    
    const finalDesign = { ...(currentDesign || {}), ...(result.changes || result.design || {}) };
    return res.json({ ok: true, design: finalDesign, reasoning: result.reasoning });

  } catch (e) {
    console.error('[AI Design]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/coach/mechanic-ai
router.post('/mechanic-ai', async (req, res) => {
  try {
    const { prompt, component } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Describe el problema mecánico.' });
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
    const openaiKey    = process.env.OPENAI_API_KEY    || '';
    const googleKey    = process.env.GOOGLE_API_KEY    || '';
    const groqKey      = process.env.GROQ_API_KEY      || '';

    if (!anthropicKey && !openaiKey && !googleKey && !groqKey) {
      return res.status(503).json({ error: 'No hay API Keys de IA configuradas en el servidor.' });
    }

    const systemPrompt = `Eres un asistente de Inteligencia Artificial experto en mecánica de bicicletas de nivel World Tour (Ruta, MTB, Gravel).
Tu objetivo es responder CUALQUIER duda mecánica, teórica o práctica que tenga el usuario, comportándote como una IA conversacional avanzada (tipo ChatGPT/Claude) pero especializada ÚNICAMENTE en ciclismo.

REGLAS DE COMPORTAMIENTO:
1. Eres un experto absoluto en bicicletas. Si la pregunta es vaga, llévala siempre al contexto ciclista.
2. Si describen una avería: diagnostica con lógica escalonada. Menciona fallos conocidos (ej. holguras en AXS, purgado de frenos, contaminación). NUNCA inventes herramientas (como "prensa de rueda") ni piezas de motos.
3. Si hacen una pregunta general, teórica o de compatibilidad (ej. "diferencias entre cera y aceite", "qué es el B-gap", "¿puedo mezclar Shimano y SRAM?"): actúa como un divulgador experto, comparando opciones y dando datos técnicos precisos.
4. Incluye métricas reales cuando aplique (pares de apriete en Nm, distancias en mm, presiones en PSI/Bar).
5. RESPONDE SOLO EN JSON VÁLIDO EN ESPAÑOL.`;

    const userMsg = `Consulta del ciclista en la sección de ${component || 'mecánica'}:
"${prompt}"

Analiza la consulta a nivel de mecánico jefe y adapta tu respuesta al siguiente JSON:
- Si es una AVERÍA: usa "diagnosis" para la causa, "tools_needed" para herramientas necesarias, y "solution_steps" para los pasos de reparación reales.
- Si es una PREGUNTA GENERAL O TEÓRICA: usa "diagnosis" para la explicación principal, "tools_needed" para listar conceptos, componentes o materiales relacionados (o pon "N/A" si no aplica), y "solution_steps" para desglosar los detalles, pros/contras o explicaciones adicionales.

Devuelve un JSON con esta estructura exacta:
{
  "diagnosis": "Diagnóstico claro o explicación detallada a la pregunta.",
  "difficulty": "baja|media|alta|teórica",
  "tools_needed": ["Herramienta/Concepto 1", "Herramienta/Concepto 2"],
  "solution_steps": ["Paso/Explicación 1: ...", "Paso/Explicación 2: ..."],
  "pro_tip": "Un súper consejo o curiosidad técnica relacionada con la consulta."
}`;

    const result = await callAI(systemPrompt, userMsg, { max_tokens: 1024, temperature: 0.3 });
    return res.json({ ok: true, ...result });

  } catch (e) {
    console.error('[AI Mechanic]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
