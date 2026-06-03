const express = require('express');
const supabase = require('../db'); // Ahora db es el cliente de Supabase
const { requireAuth } = require('../middleware/auth');
const { requirePremium } = require('../middleware/subscriptionMiddleware');
const Anthropic = require('@anthropic-ai/sdk');
const { callAI } = require('../services/ai');
const { calcIF, calcTSS, getZone, getTSBStatus } = require('../utils/training');
const router = express.Router();
const fs = require('fs');
const multer = require('multer');
const upload = multer({ dest: '/tmp/', limits: { fileSize: 100 * 1024 * 1024 } }); // /tmp siempre existe; 100MB

router.use(requireAuth);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';

// powerZone y formState son alias locales de los utils centralizados
const powerZone = (np, ftp) => getZone(np, ftp)?.id || 0;
const formState = getTSBStatus;

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

  // Fallback: Si la tabla PMC está vacía o tiene valores a 0, calculamos el estado actual al vuelo
  // CRÍTICO: la fórmula EWMA debe iterar DÍA A DÍA (incluyendo días sin entrenamiento con TSS=0)
  // para que el decaimiento de CTL/ATL sea correcto. Iterar solo por actividades produce CTL inflado.
  if ((!latest || (latest.ctl === 0 && latest.atl === 0)) && acts && acts.length > 0) {
    // Construir mapa fecha → TSS total del día
    const tssByDay = {};
    const sorted = [...acts].sort((a, b) => new Date(a.date) - new Date(b.date));
    sorted.forEach(a => {
      const dateKey = String(a.date || '').substring(0, 10);
      if (!dateKey) return;
      let t = Number(a.tss) || 0;
      if (t === 0 && ftp && a.duration) {
        const power = Number(a.np || a.avg_power || 0);
        if (power > 0) t = calcTSS(power, a.duration, ftp);
      }
      tssByDay[dateKey] = (tssByDay[dateKey] || 0) + t;
    });

    const allDates = Object.keys(tssByDay).sort();
    if (allDates.length > 0) {
      let c_ctl = 0, c_atl = 0;
      const startDate = new Date(allDates[0]);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().substring(0, 10);
        const t = tssByDay[key] || 0;
        c_ctl = c_ctl + (t - c_ctl) / 42;
        c_atl = c_atl + (t - c_atl) / 7;
      }
      latest = { ctl: c_ctl, atl: c_atl, tsb: c_ctl - c_atl };
    }
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

  // Distribución de zonas: usa zone_times reales cuando existen (datos de streams Strava/Garmin)
  // Fallback: clasifica por avg_power de la actividad completa (aproximación menos precisa)
  const zoneMins = [0, 0, 0, 0, 0, 0, 0, 0]; // índice 1-7
  let realZoneCount = 0, estimZoneCount = 0;
  acts.forEach(a => {
    if (a.zone_times) {
      // Datos reales segundo a segundo — distribución exacta por zona
      const zt = typeof a.zone_times === 'string' ? JSON.parse(a.zone_times) : a.zone_times;
      for (let i = 1; i <= 7; i++) {
        zoneMins[i] += (zt[`z${i}`] || 0) / 60; // convertir segundos a minutos
      }
      realZoneCount++;
    } else {
      // Fallback: toda la duración va a la zona del avg_power (impreciso pero mejor que nada)
      const power = Number(a.np || a.avg_power || 0);
      const dur   = Number(a.duration || 0) / 60;
      if (power > 0 && ftp && dur > 0) {
        const z = powerZone(power, ftp);
        if (z >= 1 && z <= 7) zoneMins[z] += dur;
        estimZoneCount++;
      }
    }
  });
  const totalMins = zoneMins.slice(1).reduce((s, c) => s + c, 0);
  const zonePct = zoneMins.map(c => totalMins ? Math.round(c / totalMins * 100) : 0);
  const zoneDataQuality = realZoneCount > estimZoneCount ? 'real' : 'estimated';

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
      zones: { z1: zonePct[1], z2: zonePct[2], z3: zonePct[3], z4: zonePct[4], z5: zonePct[5], z6: zonePct[6], z7: zonePct[7], data_quality: zoneDataQuality },
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

  const daysParam = String(req.query.days || '').trim().toLowerCase();
  let query = supabase.from('activities')
    .select('np, avg_power, max_power, duration, date, best_efforts')
    .eq('user_id', req.user.id)
    .or('np.gt.0,max_power.gt.0')
    .order('date', { ascending: false })
    .limit(500);

  if (daysParam === 'ytd') {
    const cutoff = new Date();
    cutoff.setMonth(0, 1);
    cutoff.setHours(0, 0, 0, 0);
    query = query.gte('date', cutoff.toISOString().split('T')[0]);
  } else {
    const days = parseInt(daysParam, 10) || 0; // 0 = sin filtro (all-time)
    if (days > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      query = query.gte('date', cutoff.toISOString().split('T')[0]);
    }
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

    // 3. Contexto de disciplina/objetivo enviado desde el frontend
    const videoDiscipline = (req.body?.discipline || 'carretera').toLowerCase();
    const videoObjective  = (req.body?.objective  || 'rendimiento').toLowerCase();

    // Criterios específicos por disciplina para el análisis dinámico
    const discCriteria = {
      carretera: {
        hip_stability: 'Cadera sin balanceo lateral (aceptable <1 cm). El balanceo >2 cm indica sillín alto.',
        knee_tracking: 'Rodillas alineadas sobre el pie durante todo el ciclo. Colapso valgo = problema serio.',
        ankle_technique: 'Tobillo neutro con ligera flexión plantar en PMI (6 en punto). Talón caído = sillín bajo.',
        pedaling_smoothness: 'Círculo de pedaleo fluido sin puntos muertos visibles. Movimiento a pistón = ineficiencia.',
      },
      gravel: {
        hip_stability: 'Cadera puede moverse ligeramente más que en carretera por el terreno. Balanceo >3 cm = sillín alto.',
        knee_tracking: 'Rodillas alineadas. Importante para largas distancias en terreno mixto.',
        ankle_technique: 'Tobillo ligeramente más neutro que en carretera. Adaptación al terreno.',
        pedaling_smoothness: 'Pedaleo fluido. En gravel es normal cierta variación por el terreno.',
      },
      mtb: {
        hip_stability: 'Cadera puede moverse más que en carretera. Lo crítico es que los codos NUNCA estén bloqueados. Codos flexionados = absorción de impactos.',
        knee_tracking: 'Rodillas alineadas. El colapso valgo repetitivo es señal de debilidad de glúteos o sillín mal posicionado.',
        ankle_technique: 'Mayor variación aceptable en el tobillo para MTB. Controla que no haya talón muy elevado de forma constante.',
        pedaling_smoothness: 'En MTB hay más variación natural. Busca fluidez en las secciones técnicas más que cadencia pura.',
      },
      triatlon: {
        hip_stability: 'En posición de aero bars la cadera tiene tendencia a bascular. Balanceo >1 cm indica posición insostenible.',
        knee_tracking: 'Rodillas alineadas críticamente en posición agresiva. El valgo en TT daña la rodilla.',
        ankle_technique: 'Tobillo con mayor flexión plantar en TT. Talón muy caído = sillín bajo o bielas largas.',
        pedaling_smoothness: 'El pedaleo suave en triatlón es fundamental para llegar bien a la carrera a pie.',
      },
    };

    const criteria = discCriteria[videoDiscipline] || discCriteria.carretera;
    const discLabel = { carretera:'Carretera', gravel:'Gravel', mtb:'MTB', triatlon:'Triatlón/TT' }[videoDiscipline] || videoDiscipline;

    const prompt = `Eres un Biomecánico de Ciclismo profesional especializado en ${discLabel}. Analiza el video del ciclista y devuelve ÚNICAMENTE un JSON válido en español. No añadas texto fuera del JSON.

DISCIPLINA DEL ATLETA: ${discLabel} | OBJETIVO: ${videoObjective}

Para cada métrica asigna EXACTAMENTE uno de estos tres valores de "rating": "OK", "Mejorable" o "Problema".
Sé crítico y objetivo: si ves cualquier desviación, asigna "Mejorable" o "Problema". Solo asigna "OK" si la técnica es claramente correcta para esta disciplina.
En "detail" describe en máximo 100 caracteres lo que observas, mencionando siempre el defecto o confirmando la técnica correcta.

CRITERIOS ESPECÍFICOS PARA ${discLabel.toUpperCase()} (úsalos como referencia estricta):
- hip_stability: ${criteria.hip_stability}
- knee_tracking: ${criteria.knee_tracking}
- ankle_technique: ${criteria.ankle_technique}
- pedaling_smoothness: ${criteria.pedaling_smoothness}

${videoDiscipline === 'mtb' ? 'IMPORTANTE MTB: Marca como "Problema" si los codos están bloqueados (riesgo de lesión en caída).\n\n' : ''}Si la calidad del video no permite evaluar una métrica con certeza, asigna "Mejorable" con detail="Calidad de video insuficiente para evaluar con precisión".

Formato JSON obligatorio (sustituye RATING por el valor real):
{"dynamic_analysis":{"hip_stability":{"rating":"RATING","detail":"descripción objetiva"},"knee_tracking":{"rating":"RATING","detail":"descripción objetiva"},"ankle_technique":{"rating":"RATING","detail":"descripción objetiva"},"pedaling_smoothness":{"rating":"RATING","detail":"descripción objetiva"}},"expert_diagnosis":{"summary":"resumen adaptado a ${discLabel} ${videoObjective}","red_flags":["alerta si la hay"],"recommended_adjustments":[{"component":"componente","action":"acción","reason":"motivo específico para ${discLabel}"}]}}`;

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

const BIOMECHANICS_SYSTEM_PROMPT = `Eres un Experto en Biomecánica de Ciclismo y Fisioterapeuta Deportivo certificado (BikeFit Institute, IBFI, RETÜL) con más de 15 años de experiencia en Bike Fitting profesional. Tu diagnóstico debe ser tan preciso como el de un fitter de WorldTour.

TU TAREA: Analizar la postura del ciclista en la imagen con rigor profesional, aplicando los rangos correctos según la DISCIPLINA y el OBJETIVO declarados por el atleta.

═══════════════════════════════════════════════════════════════
1. RANGOS BIOMECÁNICOS POR DISCIPLINA × OBJETIVO
   Aplica ESTRICTAMENTE los rangos de la disciplina+objetivo recibidos.
   Todos los ángulos se miden en el Punto Muerto Inferior (PMI, biela a las 6).
═══════════════════════════════════════════════════════════════

CARRETERA – Rendimiento  → Rodilla 140-150° | Cadera 90-105° | Tronco 35-47° | Codo 150-162° | Tobillo 95-115°
CARRETERA – Confort      → Rodilla 135-147° | Cadera 98-113° | Tronco 46-58° | Codo 148-163° | Tobillo 90-110°
CARRETERA – Aero         → Rodilla 142-153° | Cadera 83-98°  | Tronco 18-33° | Codo 138-153° | Tobillo 100-122°

GRAVEL – Rendimiento     → Rodilla 138-149° | Cadera 94-110° | Tronco 42-55° | Codo 148-161° | Tobillo 90-112°
GRAVEL – Confort         → Rodilla 133-145° | Cadera 100-116°| Tronco 50-63° | Codo 150-165° | Tobillo 87-108°
GRAVEL – Aero            → Rodilla 140-151° | Cadera 88-104° | Tronco 28-43° | Codo 142-156° | Tobillo 95-117°

MTB – Rendimiento (XC/Trail) → Rodilla 135-147° | Cadera 100-118° | Tronco 50-65° | Codo 145-161° | Tobillo 85-107°
MTB – Confort (Enduro/AM)    → Rodilla 130-143° | Cadera 107-124° | Tronco 58-73° | Codo 148-165° | Tobillo 82-104°
MTB – Aero (XC Race)         → Rodilla 137-149° | Cadera 95-113°  | Tronco 43-58° | Codo 142-158° | Tobillo 88-110°

TRIATLÓN – Rendimiento   → Rodilla 142-153° | Cadera 82-97°  | Tronco 14-29° | Codo 135-150° | Tobillo 102-124°
TRIATLÓN – Confort       → Rodilla 138-149° | Cadera 88-103° | Tronco 24-38° | Codo 140-155° | Tobillo 97-119°
TRIATLÓN – Aero (TT puro)→ Rodilla 144-155° | Cadera 77-92°  | Tronco  7-20° | Codo 130-145° | Tobillo 107-129°

NOTAS TÉCNICAS CLAVE:
• Carretera aero: posición en los cuernos, codos sobre el manillar; tronco muy horizontal.
• Gravel: manillar más ancho, posición ligeramente más erguida que carretera para control offroad.
• MTB: tronco vertical para visión y control técnico; cadera abierta es normal y deseable.
  En MTB los codos NUNCA deben estar bloqueados (absorben impactos). Marcar como red_flag si lo están.
• Triatlón/TT: posición en aero bars. El ángulo de cadera muy cerrado puede coexistir si
  el ciclista usa un sillín rotado o de triatlón (nariz hacia abajo).

═══════════════════════════════════════════════════════════════
2. EVALUACIÓN POSTURAL COMPLETA
═══════════════════════════════════════════════════════════════
Evalúa en función de la disciplina:
• Columna: ¿cifosis activa (pedaleo) o pasiva (colapso lumbar)? ¿lordosis excesiva?
• Hombros: ¿elevados, encorvados, asimétricos?
• Codos: ¿bloqueados (peligroso en MTB), ligeramente flexionados (ideal), muy cerrados?
• Cadera: ¿nivelada o inclinada (diferencia de longitud de pierna)? ¿balanceo lateral?
• Cabeza/cuello: ¿hiperextensión cervical? Relevante en aero/triatlón.

═══════════════════════════════════════════════════════════════
3. RED FLAGS — RIESGOS BIOMECÁNICOS ESPECÍFICOS
═══════════════════════════════════════════════════════════════
Señala desviaciones por disciplina:
TODOS:
  - Dolor lumbar → sillín alto, alcance excesivo, cifosis pasiva
  - Rodilla anterior → sillín bajo o muy adelantado (KOPS negativo)
  - Rodilla posterior → sillín muy alto (sobreextensión)
  - Entumecimiento de manos → excesiva carga frontal, codos bloqueados
  - Cervicalgias → hiperextensión cervical por manillar bajo

ESPECÍFICOS MTB:
  - Codos bloqueados → riesgo de fractura de muñeca/clavícula en caída
  - Manillar muy bajo → visión de pista reducida, peligro técnico
  - Sillín muy alto → no puede apoyar pie en parada → caída

ESPECÍFICOS TRIATLÓN/TT:
  - Ángulo de cadera < 75° → impingement de cadera, lesión del psoas
  - Tronco < 10° → cervicalgia severa por hiperextensión > 30 min
  - Posición insostenible para carrera a pie post-bike (Ironman)

═══════════════════════════════════════════════════════════════
4. COORDENADAS NORMALIZADAS (0.00 – 1.00, obligatorio)
═══════════════════════════════════════════════════════════════
Devuelve puntos articulares en proporción de la imagen completa.
- {"x": 0.0, "y": 0.0} = esquina superior izquierda.
- {"x": 1.0, "y": 1.0} = esquina inferior derecha.
Puntos requeridos: shoulder, elbow, wrist, hip, knee, ankle, foot_tip.
Si se proporcionan PUNTOS DEL USUARIO, úsalos como verdad de terreno para los ángulos.

═══════════════════════════════════════════════════════════════
5. FORMATO DE SALIDA OBLIGATORIO (JSON puro, sin markdown)
═══════════════════════════════════════════════════════════════

{
  "metadata": {
    "detected_side": "left|right|unknown",
    "image_quality": "good|fair|poor",
    "analysis_confidence": 0.0,
    "discipline_applied": "carretera|gravel|mtb|triatlon",
    "objective_applied": "rendimiento|confort|aero",
    "photo_notes": ["observaciones técnicas sobre la imagen"]
  },
  "keypoints_normalized": {
    "shoulder": {"x": 0.0, "y": 0.0},
    "elbow":    {"x": 0.0, "y": 0.0},
    "wrist":    {"x": 0.0, "y": 0.0},
    "hip":      {"x": 0.0, "y": 0.0},
    "knee":     {"x": 0.0, "y": 0.0},
    "ankle":    {"x": 0.0, "y": 0.0},
    "foot_tip": {"x": 0.0, "y": 0.0}
  },
  "biomechanical_angles": {
    "knee_extension_pmi": {"value": 0, "unit": "degrees", "optimal_range": [0, 0], "status": "low|optimal|high"},
    "hip_angle_pmi":      {"value": 0, "unit": "degrees", "optimal_range": [0, 0], "status": "low|optimal|high"},
    "ankle_angle_pmi":    {"value": 0, "unit": "degrees", "optimal_range": [0, 0], "status": "low|optimal|high"},
    "trunk_angle":        {"value": 0, "unit": "degrees", "optimal_range": [0, 0], "status": "low|optimal|high"},
    "elbow_angle":        {"value": 0, "unit": "degrees", "optimal_range": [0, 0], "status": "low|optimal|high"}
  },
  "posture_evaluation": {
    "spine":     {"observation": "", "status": "optimal|acceptable|issue"},
    "shoulders": {"observation": "", "status": "relaxed|tensioned|elevated"},
    "hips":      {"observation": "", "status": "level|uneven"},
    "elbows":    {"observation": "", "status": "relaxed|slightly_bent|locked"},
    "neck":      {"observation": "", "status": "neutral|hyperextended|compressed"}
  },
  "expert_diagnosis": {
    "summary": "Resumen del análisis biomecánico adaptado a la disciplina y objetivo",
    "red_flags": ["riesgo específico 1"],
    "potential_issues": ["problema potencial 1"],
    "recommended_adjustments": [
      {"component": "saddle_height|saddle_setback|handlebar_height|stem_length|cleat_position|crank_length", "action": "raise|lower|forward|back|shorten|lengthen", "amount_mm": 0, "reason": "justificación técnica específica para esta disciplina"}
    ]
  }
}

CRÍTICO: Adapta los optimal_range del JSON a la disciplina+objetivo exactos recibidos en el contexto del atleta. No uses rangos genéricos.
Si la imagen no permite estimación precisa, pon "image_quality": "poor" y no especules con ángulos. Precisión > cantidad.`;

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

  // Rangos de referencia por disciplina × objetivo (espejados desde BiomechanicsUtils)
  const RANGES_BY_DISC = {
    carretera: {
      rendimiento: 'Rodilla 140-150° | Cadera 90-105° | Tronco 35-47° | Codo 150-162° | Tobillo 95-115°',
      confort:     'Rodilla 135-147° | Cadera 98-113° | Tronco 46-58° | Codo 148-163° | Tobillo 90-110°',
      aero:        'Rodilla 142-153° | Cadera 83-98°  | Tronco 18-33° | Codo 138-153° | Tobillo 100-122°',
    },
    gravel: {
      rendimiento: 'Rodilla 138-149° | Cadera 94-110° | Tronco 42-55° | Codo 148-161° | Tobillo 90-112°',
      confort:     'Rodilla 133-145° | Cadera 100-116°| Tronco 50-63° | Codo 150-165° | Tobillo 87-108°',
      aero:        'Rodilla 140-151° | Cadera 88-104° | Tronco 28-43° | Codo 142-156° | Tobillo 95-117°',
    },
    mtb: {
      rendimiento: 'Rodilla 135-147° | Cadera 100-118°| Tronco 50-65° | Codo 145-161° | Tobillo 85-107°',
      confort:     'Rodilla 130-143° | Cadera 107-124°| Tronco 58-73° | Codo 148-165° | Tobillo 82-104°',
      aero:        'Rodilla 137-149° | Cadera 95-113° | Tronco 43-58° | Codo 142-158° | Tobillo 88-110°',
    },
    triatlon: {
      rendimiento: 'Rodilla 142-153° | Cadera 82-97°  | Tronco 14-29° | Codo 135-150° | Tobillo 102-124°',
      confort:     'Rodilla 138-149° | Cadera 88-103° | Tronco 24-38° | Codo 140-155° | Tobillo 97-119°',
      aero:        'Rodilla 144-155° | Cadera 77-92°  | Tronco  7-20° | Codo 130-145° | Tobillo 107-129°',
    },
  };
  const disc = (rider.discipline || 'carretera').toLowerCase().replace('carretera','carretera');
  const obj  = (rider.objective  || 'rendimiento').toLowerCase();
  const discRanges = (RANGES_BY_DISC[disc] || RANGES_BY_DISC.carretera)[obj]
    || RANGES_BY_DISC.carretera.rendimiento;

  const riderCtx = `DISCIPLINA: ${rider.discipline||'carretera'} | OBJETIVO: ${rider.objective||'rendimiento'}` +
    `${rider.heightCm ? ' | Altura: '+rider.heightCm+' cm' : ''}` +
    `${rider.inseamCm ? ' | Entrepierna: '+rider.inseamCm+' mm' : ''}` +
    `${rider.pain ? ' | Dolor reportado: '+rider.pain : ''}` +
    `\n\nRANGOS A APLICAR PARA ESTA DISCIPLINA+OBJETIVO: ${discRanges}` +
    `\n\nUSA ESTOS RANGOS para rellenar optimal_range en el JSON de salida y para evaluar el status de cada ángulo.`;

  // Añadir contexto de puntos del usuario si existen
  const userPointsCtx = Object.keys(userPoints).length > 0
    ? `\n\nPUNTOS DEL USUARIO (ajustados manualmente, son la verdad de terreno): ` + JSON.stringify(userPoints)
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
              generationConfig: { temperature: 0, maxOutputTokens: 4096 },
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
            { type: 'text', text: 'Contexto del atleta: ' + riderCtx + userPointsCtx + '\n\nAnaliza la imagen y devuelve SOLO el JSON, sin texto adicional.' },
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
        body: JSON.stringify({ model: 'gpt-4o', messages: oaiMessages, max_tokens: 4096, temperature: 0, response_format: { type: 'json_object' } }),
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
        { type: 'text', text: 'Contexto del atleta: ' + riderCtx + userPointsCtx + '\n\nAnaliza la imagen y devuelve SOLO el JSON, sin texto adicional.' },
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
              { type: 'text', text: 'Contexto del atleta: ' + riderCtx + userPointsCtx + '\n\nAnaliza la imagen y devuelve SOLO el JSON, sin texto adicional.' },
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

  // CTL mínimo para atletas nuevos sin historial: 25 TSS/día base
  const ctlBase = Math.max(ctl, 25);

  if (form.risk === 'muy alto' || tsb < -30) {
    weekTarget = Math.round(ctlBase * 0.5);
    focus = 'Recuperación total';
    sessions = buildRecoveryWeek(ftp);
    alerts.push('⚠️ Estás en sobreentrenamiento. Prioriza el descanso y el sueño.');
  } else if (form.risk === 'alto' || tsb < -20) {
    weekTarget = Math.round(ctlBase * 0.65);
    focus = 'Semana de descarga';
    sessions = buildDeloadWeek(ftp, goal);
    alerts.push('⚠️ Alta fatiga acumulada. Reduce el volumen esta semana.');
  } else if (phase === 'recovery') {
    weekTarget = Math.round(ctlBase * 0.70);
    focus = 'Recuperación activa';
    sessions = buildDeloadWeek(ftp, goal);
  } else if (phase === 'peak') {
    weekTarget = Math.round(ctlBase * 0.85);
    focus = 'Puesta a punto';
    sessions = buildPeakWeek(ftp, goal);
  } else if (phase === 'build') {
    weekTarget = Math.round(ctlBase * 1.08);
    focus = 'Bloque de carga — ' + goalLabel(goal);
    sessions = buildBuildWeek(ftp, goal, weight);
    if (tssGrowth > 15) alerts.push('📈 Estás aumentando la carga muy rápido. Limita el incremento a +5-8% semanal.');
  } else {
    weekTarget = Math.round(ctlBase * 1.05);
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
    { day: 'Miércoles', type: 'Descanso',    duration: 0,  tss: 0,  description: 'Recuperación activa: movilidad de cadera, yoga, foam roller.' },
    { day: 'Jueves',    type: 'Activación',  duration: 50, tss: 35, description: `50min Z1/Z2 con 2×5min a ${Math.round(ftp*0.85)}W para no perder adaptaciones.` },
    { day: 'Viernes',   type: 'Descanso',    duration: 0,  tss: 0,  description: 'Descanso' },
    { day: 'Sábado',    type: 'Z2 Corto',    duration: 60, tss: 45, description: `60min Z2 agradable. Sin presión de potencia.` },
    { day: 'Domingo',   type: 'Descanso',    duration: 0,  tss: 0,  description: 'Descanso completo' },
  ];
}

function buildPeakWeek(ftp, goal) {
  return [
    { day: 'Lunes',     type: 'Descanso',   duration: 0,  tss: 0, description: 'Descanso' },
    { day: 'Martes',    type: 'Activación',  duration: 60, tss: 55, key: true,
      description: `60min con 2×8min a ${Math.round(ftp*0.97)}W. Mantener calidad, reducir volumen.` },
    { day: 'Miércoles', type: 'Suave',       duration: 40, tss: 25, description: `Z1/Z2, 40min. Piernas activas sin fatiga.` },
    { day: 'Jueves',    type: 'Velocidad',   duration: 50, tss: 45, description: `6×30s sprints a potencia máxima. Rec: 5min. Sentir las piernas explosivas.` },
    { day: 'Viernes',   type: 'Descanso',    duration: 0,  tss: 0, description: 'Descanso total o rodillo 20min Z1' },
    { day: 'Sábado',    type: 'Pre-evento',  duration: 45, tss: 35, description: `45min Z1/Z2 con 3×1min al 110% FTP. Activar sin vaciar.` },
    { day: 'Domingo',   type: 'COMPETICIÓN', duration: 0,  tss: 0, description: '🏆 Día de competición o rodada objetivo.' },
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

  // Gasto calórico del entrenamiento: fórmula basada en trabajo mecánico real
  // Trabajo externo (kJ) ≈ TSS × FTP × 36 / 1000 (para IF promedio típico)
  // Gasto metabólico ≈ trabajo_externo / eficiencia(22%) → en kcal ÷ 4.184
  // Simplificado: trainCal ≈ TSS × FTP × 0.039
  const dailyTSS   = avgTSS || 60;
  const trainCal   = Math.round(dailyTSS * ftp * 0.039);

  // Periodización nutricional por fase: carbos más altos en build, más bajos en base/recovery
  const phaseNutritionFactor = { base: 1.0, build: 1.10, peak: 0.95, recovery: 0.85 }[phase] || 1.0;

  // Ajuste calórico por objetivo (carbos extra para resistencia larga, deficit para pérdida peso)
  const goalCalAdj = { resistencia: 0, ftp: 80, vo2max: 120, sprint: 50, gran_fondo: 200, perdida_peso: -200 }[goal] || 0;

  // Día de entrenamiento vs descanso
  const trainDayTotal = Math.round((tdee + trainCal + goalCalAdj) * phaseNutritionFactor);
  const restDayTotal  = goal === 'perdida_peso'
    ? Math.round(tdee * 0.85) // déficit controlado del 15% en días descanso si objetivo es composición
    : tdee - 150;

  // ── Macros periodizados por fase ──
  // Build: más carbos para sostener alta intensidad
  // Base: mix equilibrado
  // Recovery: más proteína, menos carbos
  const phaseMacros = {
    base:     { cT: 0.55, pT: 0.20, fT: 0.25,  cR: 0.45, pR: 0.22, fR: 0.33 },
    build:    { cT: 0.60, pT: 0.18, fT: 0.22,  cR: 0.48, pR: 0.22, fR: 0.30 },
    peak:     { cT: 0.58, pT: 0.20, fT: 0.22,  cR: 0.42, pR: 0.25, fR: 0.33 },
    recovery: { cT: 0.50, pT: 0.25, fT: 0.25,  cR: 0.40, pR: 0.28, fR: 0.32 },
  };
  const pm = phaseMacros[phase] || phaseMacros.base;

  const carbsG_train_calc   = Math.round((trainDayTotal * pm.cT) / 4);
  const proteinG_train_calc = Math.round((trainDayTotal * pm.pT) / 4);
  const fatG_train     = Math.round((trainDayTotal * pm.fT) / 9);

  const carbsG_rest_calc    = Math.round((restDayTotal * pm.cR) / 4);
  const proteinG_rest_calc  = Math.round((restDayTotal * pm.pR) / 4);
  const fatG_rest      = Math.round((restDayTotal * pm.fR) / 9);

  // Proteína mínima por kg de peso corporal (no puede caer por debajo del umbral fisiológico)
  const proteinMinTrain = Math.round(weight * (goal === 'perdida_peso' ? 2.0 : 1.6));
  const proteinMinRest  = Math.round(weight * (goal === 'perdida_peso' ? 2.2 : 1.8));
  const proteinG_train = Math.max(proteinG_train_calc, proteinMinTrain);
  const proteinG_rest  = Math.max(proteinG_rest_calc,  proteinMinRest);

  // Si la proteína forzó un incremento, ajustar carbos para compensar (no aumentar calorías)
  const proteinAdjTrain = (proteinG_train - proteinG_train_calc) * 4; // kcal extra de proteína
  const proteinAdjRest  = (proteinG_rest  - proteinG_rest_calc)  * 4;
  const carbsG_train = Math.max(30, carbsG_train_calc - Math.round(proteinAdjTrain / 4));
  const carbsG_rest  = Math.max(30, carbsG_rest_calc  - Math.round(proteinAdjRest  / 4));

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
    const { data: rawActivities, error: actsError } = await supabase.from('activities')
      .select('date, duration, distance, tss, np, avg_power, max_power, avg_hr, max_hr, elevation, type, name, if_value, source, avg_cadence, calories')
      .eq('user_id', req.user.id)
      .gte('date', since90)
      .order('date', { ascending: false })
      .limit(100);
    if (actsError) throw actsError;

    const validTypes = ['Ride', 'VirtualRide', 'cycling', 'EBikeRide', 'GravelRide', 'MountainBikeRide'];
    const activities = rawActivities.filter(a => !a.type || validTypes.includes(a.type)).slice(0, 60);

    const { data: pmcData, error: pmcError } = await supabase.from('pmc')
      .select('date, ctl, atl, tsb')
      .eq('user_id', req.user.id)
      .order('date', { ascending: false })
      .limit(60);
    if (pmcError) throw pmcError;
    const pmc = pmcData.reverse();

    const latestPMC = pmc[pmc.length - 1] || { ctl: 0, atl: 0, tsb: 0 };

    // Distribución de zonas: usa zone_times reales cuando disponibles
    const ftp = user.ftp || 200;
    const zoneMins2 = [0, 0, 0, 0, 0, 0, 0, 0];
    activities.forEach(a => {
      if (a.zone_times) {
        const zt = typeof a.zone_times === 'string' ? JSON.parse(a.zone_times) : a.zone_times;
        for (let i = 1; i <= 7; i++) zoneMins2[i] += (zt[`z${i}`] || 0) / 60;
      } else {
        const p   = Number(a.np || a.avg_power || 0);
        const dur = Number(a.duration || 0) / 60;
        if (p > 0 && ftp && dur > 0) {
          const z = powerZone(p, ftp);
          if (z >= 1 && z <= 7) zoneMins2[z] += dur;
        }
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
    { "dia":"Lunes","tipo":"Z2 Resistencia","duracion_min":90,"tss_objetivo":65,"potencia_objetivo":"160-185W","descripcion":"string","key":false,"emoji":"🚴" },
    { "dia":"Martes","tipo":"Descanso","duracion_min":0,"tss_objetivo":0,"potencia_objetivo":"","descripcion":"Recuperación activa","key":false,"emoji":"😴" }
  ],
  "nutricion": {
    "dia_entrenamiento": {"calorias":N,"carbos_g":N,"proteína_g":N,"grasa_g":N},
    "dia_descanso":      {"calorias":N,"carbos_g":N,"proteína_g":N,"grasa_g":N},
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

    const estadoUsuario    = req.body?.estado_usuario    || {};
    const sesionOriginal   = req.body?.sesion_original   || null;
    const proximaSesion    = req.body?.proxima_sesion    || null;
    const esManana         = req.body?.es_manana         || false;
    const sesionPerdidaAyer = req.body?.sesion_perdida_ayer || null;
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

    const proximaBlock = proximaSesion ? `
Sesión de MAÑANA:
- Tipo: ${proximaSesion.type}
- TSS: ${proximaSesion.tss}
` : '';

    const tssOrig = sesionOriginal?.tss || 50;
    const tssMax  = Math.round(tssOrig * 1.25);
    const tssMin  = Math.round(tssOrig * 0.75);
    const tipoSesion = sesionOriginal?.type || 'endurance';
    const ctxLow = contexto.toLowerCase();

    // ── Detección determinista antes de llamar a la IA ─────────────────
    const KW_IMPEDIMENTO = [
      'no puedo salir', 'no podré salir', 'no podre salir', 'no saldré', 'no saldre',
      'tengo evento', 'hay evento', 'un evento', 'tengo un compromiso', 'tengo compromiso',
      'tengo viaje', 'estoy de viaje', 'viajo', 'me voy de viaje',
      'no puedo entrenar', 'no entreno', 'no puedo ir', 'no voy a poder',
      'trabajo hoy', 'tengo trabajo', 'no tengo tiempo', 'sin tiempo',
      'día libre forzado', 'dia libre forzado'
    ];
    const KW_FATIGA_EXTREMA = [
      'estoy muerto', 'estoy muy mal', 'no puedo moverme', 'no me puedo mover',
      'fiebre', 'estoy enfermo', 'me encuentro muy mal', 'lesionado', 'lesión grave'
    ];

    if (KW_IMPEDIMENTO.some(k => ctxLow.includes(k))) {
      return res.json({ ok: true, today: {
        recomendacion: 'descanso', titulo: 'Descanso',
        duracion_min: 0, tss_estimado: 0, if_estimado: 0, intensidad: '',
        descripcion: 'Día de descanso por imposibilidad de entrenar.',
        razon: 'El atleta no puede salir a entrenar.',
        nutricion: 'Mantén la hidratación y una dieta equilibrada en el día de descanso.'
      }});
    }
    if (KW_FATIGA_EXTREMA.some(k => ctxLow.includes(k))) {
      return res.json({ ok: true, today: {
        recomendacion: 'descanso', titulo: 'Descanso por fatiga extrema',
        duracion_min: 0, tss_estimado: 0, if_estimado: 0, intensidad: '',
        descripcion: 'Descanso total. El cuerpo necesita recuperación completa.',
        razon: 'Fatiga o malestar extremo reportado. Prioridad: recuperación.',
        nutricion: 'Prioriza alimentos antiinflamatorios e hidratación.'
      }});
    }
    // ───────────────────────────────────────────────────────────────────

    const systemPrompt = 'Eres un coach de ciclismo experto. Esta app es EXCLUSIVAMENTE de ciclismo — todas las descripciones y consejos son sobre bicicleta en carretera, MTB o rodillo. NUNCA menciones: running, correr, trotar, tierra compacta, hierba, rodillas, caderas, impacto articular, kilómetro de carrera, asfalto para correr, ni ningún concepto ajeno al ciclismo. Usa solo vocabulario ciclista: vatios, cadencia, pedaleo, subidas, descensos, rodillo, carretera. Responde SOLO con JSON válido, sin markdown, sin texto extra.';
    const perdidaBlock = sesionPerdidaAyer
      ? `\nSESIÓN PERDIDA AYER (no se realizó): tipo="${sesionPerdidaAyer.type}", nombre="${sesionPerdidaAyer.name || sesionPerdidaAyer.type}", ${sesionPerdidaAyer.durationMin} min, TSS=${sesionPerdidaAyer.tss}, IF=${sesionPerdidaAyer.ifTarget}.`
      : '';

    const userMsg = `Atleta: FTP ${ftp}W, objetivo: ${user.goal || 'resistencia'}.
CTL ${Math.round(latestPMC.ctl)} / ATL ${Math.round(latestPMC.atl)} / TSB ${Math.round(latestPMC.tsb)}.
Sesión planificada para ${diaRef}: tipo="${tipoSesion}", ${sesionOriginal?.durationMin || 0} min, TSS=${tssOrig}, IF=${sesionOriginal?.ifTarget || 0}.
${proximaBlock}${perdidaBlock}
Input del atleta: "${contexto || 'no especificado'}".
Carga últimos 7 días: ${recentHours.toFixed(1)}h, ${recentTSS} TSS.
HISTORIAL RECIENTE:
- Ayer: ${actsCompact[0] ? `TSS ${actsCompact[0].tss}, NP ${actsCompact[0].np}, Tipo ${actsCompact[0].tipo}` : 'descanso (sin actividad registrada)'}
- Hace 2 días: ${actsCompact[1] ? `TSS ${actsCompact[1].tss}, NP ${actsCompact[1].np}` : 'descanso'}

REGLAS DE SEGURIDAD OBLIGATORIAS:
1. ANÁLISIS DE FATIGA: Si el TSS de ayer fue > (CTL + 15) O si los últimos 2 días suman > (CTL * 2), hoy DEBES denegar intensidad. Si el usuario pide salir, recomienda SOLO Z1/Z2 suave (Endurance) max 60 min.
2. PREVENCIÓN BACK-TO-BACK: Si mañana hay sesión de calidad (VO2, Threshold, Tempo), hoy NO puedes hacer calidad. Máximo Z2 suave.
3. SI HOY ES DESCANSO Y EL USUARIO PIDE SALIR: Debes proponer una sesión para HOY que sea compatible con la fatiga acumulada de ayer y el entreno de mañana. No cambies el de mañana en este endpoint, céntrate en HOY.
4. SESIÓN PERDIDA AYER: Si hay sesión perdida ayer de calidad (threshold, vo2max, tempo) y el atleta quiere salir hoy con energía positiva (sin fatiga reportada), y TSB > -20, propón realizar esa sesión perdida hoy en lugar de la planificada. Ajusta volumen si hace falta. recomendacion:"adaptado".

APLICA LA PRIMERA REGLA QUE COINCIDA CON EL INPUT:

❌ IMPEDIMENTO ("no puedo salir", "evento", "viaje", "trabajo", "compromiso", "no entreno"):
   → recomendacion:"descanso", duracion_min:0, tss_estimado:0, if_estimado:0.

🚫 FATIGA EXTREMA ("estoy muerto", "no puedo", "muy mal", "no me puedo mover", "fiebre"):
   → recomendacion:"descanso", duracion_min:0, tss_estimado:0, if_estimado:0.

🔴 FATIGA MODERADA ("cansado", "mal dormido", "dolor de cabeza", "piernas pesadas", "no me encuentro bien", "poco sueño"):
   → tipo vo2max o threshold → sustituir por endurance Z2 (IF 0.68-0.72, misma duración). recomendacion:"sustituir".
   → tipo tempo o sweet_spot → reducir duración 25% y bajar IF a 0.78-0.82. recomendacion:"reducir".
   → tipo endurance/Z2 → reducir duración 20-25%. recomendacion:"reducir".
   → tss_estimado mínimo: ${tssMin} TSS.

🟢 ENERGÍA / QUIERO MÁS ("fuerte", "bien", "con ganas", "fresco", "quiero series", "quiero más carga"):
   → tipo endurance/Z2 → convertir a tempo/sweet_spot (IF 0.84-0.88, misma duración). NUNCA subir a vo2max directamente. recomendacion:"sustituir".
   → tipo tempo/sweet_spot/threshold → añadir 10-15% más de duración + bloque sweet_spot 2×12 min a ${Math.round(ftp * 0.90)}-${Math.round(ftp * 0.93)}W. recomendacion:"adaptado".
   → tipo vo2max → añadir 1 repetición extra (misma duración de intervalo). recomendacion:"adaptado".
   → tss_estimado máximo: ${tssMax} TSS. No aumentar intensidad y volumen a la vez.

🚴 SALIDA LIBRE ("grupeta", "ruta larga", "salida libre", "carrera"):
   → Ignora intervalos. Consejos tácticos para esa salida según TSB=${Math.round(latestPMC.tsb)}. recomendacion:"adaptado".

⚙️ ESPECIFICIDAD ("quiero hacer Z3", "quiero series de umbral", "prefiero rodillo"):
   → Diseña exactamente ese tipo. Respeta FTP=${ftp}W.
   → Si es rodillo: REDUCE la duración (ej: de 180 a 60-90 min) y el TSS. La descripción DEBE ser para rodillo (cadencia, ventilación).
   → PROHIBICIÓN ABSOLUTA: No puedes usar los minutos de la sesión original (ej: no uses 172 min si la nueva duración es 87).
   → REGLA MATEMÁTICA OBLIGATORIA: Los bloques detallados en la 'descripcion' DEBEN sumar EXACTAMENTE 'duracion_min'.
   → EJEMPLO: Si duracion_min=87, escribe "15m Calentamiento + 60m Z2 + 12m Vuelta a la calma".

Devuelve SOLO este JSON (sin texto adicional):
{
  "recomendacion": "mantener" | "reducir" | "sustituir" | "descanso" | "adaptado",
  "titulo": "string corto descriptivo",
  "duracion_min": number,
  "tss_estimado": number,
  "if_estimado": number,
  "intensidad": "ej: Z2 ${Math.round(ftp*0.65)}-${Math.round(ftp*0.75)}W o Umbral ${Math.round(ftp*0.95)}W",
  "descripcion": "2-3 frases sobre ciclismo (vatios, cadencia, pedaleo en carretera o rodillo). El desglose de minutos DEBE sumar exactamente el valor de duracion_min. PROHIBIDO mencionar: tierra, hierba, running, correr, rodillas, impacto, carrera a pie.",
  "razon": "1 frase explicando el cambio según el estado del atleta",
  "nutricion": "1 frase sobre qué comer/beber ${diaRef.toLowerCase()}"
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
    
    // Capping determinista ±25% TSS — la IA no puede sobrepasar este límite
    if (result.recomendacion !== 'descanso') {
      if (result.tss_estimado > tssMax) result.tss_estimado = tssMax;
      if (result.tss_estimado > 0 && result.tss_estimado < tssMin) result.tss_estimado = tssMin;
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
const CYCLING_COACH_SYSTEM_PROMPT = `Eres un Head Coach de ciclismo de élite con 20 años de experiencia a nivel UCI, combinado con expertise en nutrición deportiva y periodización para ciclistas. Analizas datos REALES de entrenamiento de Strava/Garmin y generas planes personalizados con el nivel técnico de TrainingPeaks y WKO5. IMPORTANTE: Esta app es EXCLUSIVAMENTE de ciclismo. Todas las sesiones, descripciones y recomendaciones son sobre bicicleta (carretera, MTB o rodillo). NUNCA menciones running, natación, correr, trotar ni ningún deporte que no sea ciclismo.

══════════════════════════════════════════════════════
MÓDULO 1 — DIAGNÓSTICO DE RENDIMIENTO (siempre primero)
══════════════════════════════════════════════════════
1. Estado de forma TSB: >25 Muy fresco | 5-25 Fresco | -10 a 5 En forma | -20 a -10 Cansado | -30 a -20 Fatigado | <-30 Sobreentrenado
2. Análisis de polarización (Modelo Seiler):
   - Óptimo: 75-80% baja intensidad (Z1/Z2) + 15-20% alta intensidad (Z5+) + <10% zona media
   - Si Z3+Z4 > 40%: PROBLEMA — zona gris acumula fatiga sin el estímulo óptimo
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
      "descripcion": "string detallada con intervalos específicos en bicicleta (vatios, cadencia, carretera o rodillo). NUNCA menciones running, correr, tierra, hierba, rodillas ni ningún deporte que no sea ciclismo.",
      "key": boolean,
      "emoji": "string"
    }
  ],
  "nutricion": {
    "objetivo_calorico_tipo": "superavit|mantenimiento|deficit",
    "dia_entrenamiento": { "calorias": number, "carbos_g": number, "proteína_g": number, "grasa_g": number, "nota": "string" },
    "dia_descanso": { "calorias": number, "carbos_g": number, "proteína_g": number, "grasa_g": number, "nota": "string" },
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

    const { plan, todayIdx, targetIdx, feedback, allowToday = false, cancelledIdx = -1, cancelledType = '', replanContext = null } = req.body;

    const activeIdx = targetIdx !== undefined ? targetIdx : todayIdx;

    // Resumimos el plan (sin intervals ni descripciones largas)
    const planResumido = plan.sessions.map((s, i) => ({
      dayIndex: i, day: s.day, type: s.type,
      isRest: s.isRest || false, durationMin: s.durationMin,
      tss: s.tss
    }));

    const totalTrainingDays = plan.sessions.filter(s => !s.isRest).length;
    const contextDays = Array.isArray(replanContext?.days)
      ? replanContext.days
      : planResumido
        .filter(d => d.dayIndex >= activeIdx - 2 && d.dayIndex <= activeIdx + 1)
        .map(d => ({
          dayIndex: d.dayIndex,
          relation: d.dayIndex === activeIdx ? 'dia_objetivo' : d.dayIndex === activeIdx - 1 ? 'previo' : d.dayIndex === activeIdx - 2 ? 'previo_2' : 'siguiente',
          day: d.day,
          planned: { isRest: d.isRest, type: d.type, durationMin: d.durationMin, tss: d.tss },
          actual: { hasActivity: false, durationMin: 0, tss: 0, maxIF: 0, tssDelta: 0 }
        }));
    const neighborhoodContext = {
      window: 'entorno-dia-modificado',
      targetDayIndex: activeIdx,
      recentTssDelta: Number(replanContext?.recentTssDelta || 0),
      tomorrow: replanContext?.tomorrow || contextDays.find(d => d.dayIndex === activeIdx + 1) || null,
      days: contextDays
    };
    const todayContext = contextDays.find(d => d.dayIndex === activeIdx);
    const yesterdayContext = contextDays.find(d => d.dayIndex === activeIdx - 1);
    const tomorrowContext = contextDays.find(d => d.dayIndex === activeIdx + 1);
    const tomorrowIsQuality = !!tomorrowContext && ['threshold', 'vo2max', 'sprint', 'race'].includes(tomorrowContext.planned?.type);
    const nearWindowHint = todayContext?.planned?.isRest && (yesterdayContext?.actual?.tssDelta || 0) > 20 && tomorrowIsQuality
      ? `\nCASO CRITICO DETECTADO: el día a modificar estaba planificado como descanso, el día previo hubo exceso de carga, y al día siguiente hay calidad (${tomorrowContext.planned.type}). Adapta con cuidado.`
      : '';

    // ── Escenario 1: sesión tempo/threshold cancelada + siguiente día = long ──────
    const INTENSAS = ['tempo', 'threshold', 'sweet_spot'];
    const nextDayIdx = cancelledIdx + 1;
    const scenario1 = cancelledIdx >= 0
      && INTENSAS.includes(cancelledType)
      && nextDayIdx < 7
      && !plan.sessions[nextDayIdx]?.isRest
      && plan.sessions[nextDayIdx]?.type === 'long';

    const cancelledTSS = cancelledIdx >= 0 ? (plan.sessions[cancelledIdx]?.tss || 0) : 0;
    const scenario1Hint = scenario1
      ? `\n⚠️ ESCENARIO ESPECIAL: la sesión cancelada (dayIndex ${cancelledIdx}) era "${cancelledType}" con ${cancelledTSS} TSS, y el día siguiente (dayIndex ${nextDayIdx}) es un FONDO LARGO. En este caso: NO sustituyas el fondo largo por intervalos FTP. En su lugar, amplía el fondo largo añadiendo 2×15 min de bloques Sweet Spot (0.88-0.92 FTP) y aumenta su TSS en ${Math.round(cancelledTSS * 0.6)} TSS. Pon name="Fondo largo + bloques Sweet Spot".`
      : '';

    const hoyRegla = (activeIdx === todayIdx) 
      ? (allowToday 
        ? `DÍA OBJETIVO (índice ${activeIdx}) PUEDE ser modificado. NO modifiques índices anteriores a ${todayIdx}.` 
        : `🛑 NUNCA modifiques HOY (índice ${todayIdx}) ni días anteriores. Solo días FUTUROS (índice > ${todayIdx}).`)
      : `Estás modificando un día futuro (índice ${activeIdx}). Puedes adaptarlo libremente, pero NO modifiques días pasados ni HOY (índice < ${todayIdx}).`;

    const systemPrompt = 'Actúa como un entrenador experto en ciclismo basado en métricas (TSS, CTL, ATL, TSB, IF, FTP) y planificación tipo TrainingPeaks/WKO. Esta app es EXCLUSIVAMENTE de ciclismo — todos los nombres, descripciones y consejos deben ser sobre bicicleta, nunca sobre running, natación ni otros deportes. Responde SOLO con JSON válido, sin markdown ni texto extra.';
    const userMsg = `INPUT:
* Semana actual:
${JSON.stringify(planResumido, null, 2)}

    * Ventana obligatoria de contexto alrededor del día a modificar:
${JSON.stringify(neighborhoodContext, null, 2)}

"* Día modificado por el usuario (Índice Objetivo = ${activeIdx}):
"${feedback}"${scenario1Hint}${nearWindowHint}

OBJETIVO:
Recalcular la semana optimizando rendimiento (NO solo fatiga), manteniendo estímulos fisiológicos clave y una distribución realista de carga.

════════════════════════════════════
CONSTRAINTS DUROS (OBLIGATORIOS)
════════════════════════════════════
1. COMPENSACIÓN HOY: Si el usuario entrena HOY (índice ${todayIdx}) en un día que era de descanso, busca un día de entrenamiento FUTURO y conviértelo en descanso para no superar el total de días planificados. SOLO aplica a HOY, NO a días futuros.
   ⚠ EXCEPCIÓN DÍAS FUTUROS: Si el día objetivo es un día FUTURO (índice > ${todayIdx}) y el usuario pide explícitamente entrenar en ese día (aunque fuera descanso), DEBES respetar su petición y convertirlo en entrenamiento. El usuario tiene autonomía sobre sus días futuros. Solo ajusta la carga de días adyacentes si es necesario por fisiología.
2. PROTECCIÓN DE CALIDAD: No permitas dos sesiones de alta intensidad (Z4, Z5, Z6) en días consecutivos. Si el usuario añade una hoy, la de mañana debe pasar a ser Z2 o descanso.
   * 1 sesión VO2max o alta intensidad
   * 1 sesión threshold/tempo/sweetspot
   * 1 sesión endurance o long
3. PROHIBIDO 2 días consecutivos de descanso. Si añades un descanso para compensar, asegúrate de que no caiga pegado a otro.
4. PROHIBIDO 2 días consecutivos de alta intensidad (vo2max, threshold, sprint, race).
5. Mantener alternancia carga–recuperación (estructura realista de ciclista).
6. NO eliminar sesiones clave salvo fatiga extrema (TSB < -30).
7. CONTEXTO CERCANO OBLIGATORIO: evalua SIEMPRE anteayer, ayer, hoy y manana antes de modificar. Usa TSS real, IF real y desviacion real de esos dias.
8. Si ayer o anteayer hubo exceso de carga y hoy era descanso, cualquier salida propuesta hoy debe ser recovery/endurance corta. Si manana hay threshold, vo2max, sprint o race, reduce manana a Z2/descanso o mueve esa calidad a otro dia futuro viable.

════════════════════════════════════
REGLAS DE ENTRENAMIENTO (CRÍTICAS)
════════════════════════════════════
1. Priorizar calidad sobre cantidad:
   * NO reducir intensidad de sesiones clave
   * SI reducir volumen si hay fatiga
2. Si el usuario añade carga (ej: entrenar en día de descanso):
   * NO compensar con descansos en bloque
   * Ajustar reduciendo TSS en 2–3 días cercanos (−10% a −25%)
3. Resolver fatiga SIEMPRE con micro-ajustes:
   ✔ reducir duración
   ✔ reducir TSS
   ❌ NO eliminar días completos
4. El día previo a VO2max o threshold:
   * debe ser descanso o Z2 suave
   * si el usuario sale ese dia pese a estar marcado descanso, la sesion de VO2max/threshold del dia siguiente NO puede mantenerse intacta
5. Identificar automáticamente sesiones clave:
   * VO2max
   * Threshold / Sweetspot
   * Long ride
   → Estas sesiones deben PROTEGERSE

════════════════════════════════════
LÓGICA DE REPLANIFICACIÓN
════════════════════════════════════
* Pensar como un entrenador real, no como un optimizador matemático.
* Penalizar soluciones con:
  * descansos consecutivos
  * pérdida de frecuencia semanal
  * eliminación de sesiones importantes
* Favorecer:
  * distribución homogénea
  * consistencia semanal
  * estímulo fisiológico correcto
  * coherencia con la fatiga acumulada (TSB/CTL/ATL) y los días disponibles para entrenar.
* Si hay conflicto:
  → ajustar volumen antes que eliminar sesiones

════════════════════════════════════
REGLAS DE LA APP (IMPORTANTES)
════════════════════════════════════
* ${hoyRegla}
* LÍMITE DE DÍAS (solo para HOY, índice ${todayIdx}): Si el usuario entrena HOY en un día de descanso, no superes ${totalTrainingDays} días de entrenamiento en total y convierte otro día futuro en descanso. Para días FUTUROS (índice > ${todayIdx}): el usuario puede cambiar un descanso a entrenamiento sin necesidad estricta de compensar, salvo que el total exceda ${totalTrainingDays + 1} días (margen de 1 extra permitido).
* Mantener tipos válidos: "recovery","endurance","tempo","threshold","vo2max","sprint","long","race","strength"

════════════════════════════════════
OUTPUT (JSON EXACTO)
════════════════════════════════════
{
  "mensaje_coach": "Explicación clara y directa de los cambios (por qué y para qué). Enfocado a rendimiento real.",
  "modifications": [
    {
      "dayIndex": number,
      "changes": {
        "isRest": boolean,
        "type": "string",
        "name": "string",
        "emoji": "string",
        "durationMin": number,
        "tss": number,
        "ifTarget": number,
        "advice": "string breve sobre ciclismo (vatios, cadencia, carretera, rodillo). NUNCA menciones running, correr, tierra, rodillas ni nada ajeno al ciclismo."
      }
    }
  ]
}

Si el plan ya es óptimo → devolver "modifications": []`;

    const result = await callAI(systemPrompt, userMsg, { max_tokens: 1500, temperature: 0.3 });
    if (!result || !Array.isArray(result.modifications)) return res.status(500).json({ error: 'La IA no devolvió un plan válido.' });

    // Aplicar modificaciones respetando los días bloqueados
    const newSessions = [...plan.sessions];
    for (const mod of result.modifications) {
      const idx = Number(mod.dayIndex);
      // Si el objetivo es un día futuro, la IA NO puede tocar HOY ni el pasado
      const allowed = activeIdx === todayIdx ? idx >= todayIdx : idx > todayIdx;
      if (allowed && idx < 7 && mod.changes) {
        // Nunca propagar flags de UI como 'completed' desde la IA
        const { completed: _c, ...safeChanges } = mod.changes;
        newSessions[idx] = { ...newSessions[idx], ...safeChanges };
      }
    }

    // ── Fallback determinista Límite de Días ──────────────
    // Salvaguarda determinista: descanso roto + exceso reciente + calidad manana.
    const normFeedback = String(feedback || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const wantsRideToday = /\b(salir|salgo|rodar|rodaje|bici|entrenar|entreno|hacer algo|suave|grupeta|grupo|ruta|fondo|marcha|peloton)\b/.test(normFeedback);
    const feedbackMentionsExcess = /\b(exced|exceso|me pase|pasado|demasiad|mas tss|mucho tss|fatiga|cargad)\b/.test(normFeedback);
    const originalTargetWasRest = !!plan.sessions[activeIdx]?.isRest;
    const recentExcessTSS = Math.max(
      Number(neighborhoodContext?.recentTssDelta || 0),
      Number(yesterdayContext?.actual?.tssDelta || 0),
      Number(contextDays.find(d => d.dayIndex === activeIdx - 2)?.actual?.tssDelta || 0)
    );
    const targetBecameTraining = originalTargetWasRest && !newSessions[activeIdx]?.isRest;
    const mustKeepTargetEasy = (allowToday || activeIdx > todayIdx) && originalTargetWasRest && wantsRideToday && (recentExcessTSS > 20 || feedbackMentionsExcess);
    if ((allowToday || activeIdx > todayIdx) && originalTargetWasRest && wantsRideToday) {
      const easyOnly = mustKeepTargetEasy || tomorrowIsQuality;
      newSessions[activeIdx] = {
        ...newSessions[activeIdx],
        isRest: false,
        type: easyOnly ? 'recovery' : 'endurance',
        name: easyOnly ? 'Salida recovery corta' : 'Z2 corta modificada',
        emoji: '😴',
        durationMin: easyOnly ? 35 : 50,
        tss: easyOnly ? 20 : 35,
        ifTarget: easyOnly ? 0.52 : 0.62,
        advice: easyOnly
          ? 'Puedes salir, pero solo muy suave: venias con carga extra o manana habia calidad.'
          : 'Salida corta en Z2: sumamos movimiento sin convertir el descanso en una sesion de calidad.'
      };
    }
    if ((targetBecameTraining || ((allowToday || activeIdx > todayIdx) && originalTargetWasRest && wantsRideToday)) && (recentExcessTSS > 20 || feedbackMentionsExcess) && tomorrowIsQuality) {
      const i = activeIdx + 1;
      if (i < 7 && newSessions[i] && !newSessions[i].isRest) {
        const originalTSS = Number(newSessions[i].tss || tomorrowContext?.planned?.tss || 60);
        newSessions[i] = {
          ...newSessions[i],
          isRest: false,
          type: 'endurance',
          name: 'Z2 suave (series aplazadas)',
          emoji: '🔵',
          durationMin: Math.max(40, Math.round((newSessions[i].durationMin || 75) * 0.65)),
          tss: Math.max(25, Math.round(originalTSS * 0.55)),
          ifTarget: 0.62,
          advice: `Bajamos las series por el exceso reciente (+${Math.round(recentExcessTSS)} TSS) y la salida extra de hoy.`
        };
      }
    }

    const finalTrainingDays = newSessions.filter(s => !s.isRest).length;
    if (finalTrainingDays > totalTrainingDays) {
      let excess = finalTrainingDays - totalTrainingDays;
      const PRIORITIES = ['recovery', 'endurance', 'tempo', 'long', 'strength', 'threshold', 'vo2max', 'sprint', 'race'];
      
      for (const p of PRIORITIES) {
        if (excess <= 0) break;
        // Busca quitar entrenamientos futuros, priorizando los más suaves, EVITANDO descansos consecutivos
        // Nunca eliminar el día que el usuario acaba de activar (activeIdx)
        for (let i = 6; i > todayIdx; i--) {
          if (i === activeIdx) continue; // proteger el día que el usuario quiere entrenar
          if (!newSessions[i].isRest && newSessions[i].type === p) {
            const prevRest = i > 0 ? newSessions[i-1].isRest : false;
            const nextRest = i < 6 ? newSessions[i+1].isRest : false;
            if (!prevRest && !nextRest) {
              newSessions[i] = {
                ...newSessions[i],
                isRest: true, durationMin: 0, tss: 0,
                type: 'recovery', name: 'Descanso', emoji: '😴',
                advice: 'Descanso reasignado automáticamente para mantener el límite de días de tu perfil.',
                description: 'Día de descanso.'
              };
              excess--;
              if (excess <= 0) break;
            }
          }
        }
      }

      // Si aún hay exceso, ignoramos la regla de consecutivos para cumplir el límite
      if (excess > 0) {
        for (const p of PRIORITIES) {
          if (excess <= 0) break;
          for (let i = 6; i > todayIdx; i--) {
            if (i === activeIdx) continue; // proteger el día que el usuario quiere entrenar
            if (!newSessions[i].isRest && newSessions[i].type === p) {
              newSessions[i] = {
                ...newSessions[i],
                isRest: true, durationMin: 0, tss: 0,
                type: 'recovery', name: 'Descanso', emoji: '😴',
                advice: 'Descanso reasignado automáticamente para mantener el límite de días.',
                description: 'Día de descanso.'
              };
              excess--;
              if (excess <= 0) break;
            }
          }
        }
      }
    }

    // ── Fallback determinista anti-descansos consecutivos ──────────────
    let resolved = false;
    let loopCount = 0;

    // Realizamos hasta 5 pasadas para desenredar los bloques de descansos
    while (!resolved && loopCount < 5) {
      resolved = true;
      for (let i = 0; i < 6; i++) {
        if (newSessions[i].isRest && newSessions[i+1].isRest) {
          resolved = false;
          let swapped = false;
          
          // 1. Intentar mover el segundo descanso hacia adelante (a un hueco perfecto aislado)
          for (let j = i + 2; j <= 6; j++) {
            if (!newSessions[j].isRest) {
              const jPrevRest = j > 0 ? newSessions[j-1].isRest : false;
              const jNextRest = j < 6 ? newSessions[j+1].isRest : false;
              if (!jNextRest && (j - 1 === i + 1 || !jPrevRest)) {
                const tempDay1 = newSessions[i+1].day;
                const tempDay2 = newSessions[j].day;
                const tempSess1 = { ...newSessions[i+1], day: tempDay2 };
                const tempSess2 = { ...newSessions[j], day: tempDay1 };
                newSessions[i+1] = tempSess2;
                newSessions[j] = tempSess1;
                swapped = true;
                break;
              }
            }
          }
          
          // 2. Si no, intentar mover el primer descanso hacia atrás a días futuros
          if (!swapped && i > todayIdx) {
            for (let j = i - 1; j > todayIdx; j--) {
              if (!newSessions[j].isRest) {
                const jPrevRest = j > 0 ? newSessions[j-1].isRest : false;
                if (!jPrevRest) {
                  const tempDay1 = newSessions[i].day;
                  const tempDay2 = newSessions[j].day;
                  const tempSess1 = { ...newSessions[i], day: tempDay2 };
                  const tempSess2 = { ...newSessions[j], day: tempDay1 };
                  newSessions[i] = tempSess2;
                  newSessions[j] = tempSess1;
                  swapped = true;
                  break;
                }
              }
            }
          }

          // 3. MODO DESESPERADO: Forzar el intercambio con el primer día de entreno disponible
          // Esto rompe la "parálisis" cuando hay 3 o 4 descansos agrupados por la IA o por el Límite de Días
          if (!swapped) {
            for (let j = i + 2; j <= 6; j++) {
              if (!newSessions[j].isRest) {
                const tempDay1 = newSessions[i+1].day;
                const tempDay2 = newSessions[j].day;
                const tempSess1 = { ...newSessions[i+1], day: tempDay2 };
                const tempSess2 = { ...newSessions[j], day: tempDay1 };
                newSessions[i+1] = tempSess2;
                newSessions[j] = tempSess1;
                swapped = true;
                break;
              }
            }
          }
        }
      }
      loopCount++;
    }

    // ── Fallback determinista escenario 1: si la IA ignoró la regla ──────────────
    // Si no hay sesiones futuras para intercambiar, evitamos terminar con bloque
    // sabado-domingo de descanso convirtiendo uno en recuperacion activa corta.
    for (let i = Math.max(todayIdx + 1, 1); i < 6; i++) {
      if (newSessions[i].isRest && newSessions[i + 1].isRest) {
        newSessions[i] = {
          ...newSessions[i],
          isRest: false,
          type: 'recovery',
          name: 'Recuperacion activa',
          emoji: '😴',
          durationMin: 35,
          tss: 18,
          ifTarget: 0.50,
          advice: 'Evitamos dos descansos seguidos: solo movilidad o Z1 muy suave, sin convertirlo en carga real.',
          description: 'Recuperacion activa muy suave.'
        };
        break;
      }
    }

    if (scenario1) {
      const nextSess = newSessions[nextDayIdx];
      if (nextSess && nextSess.type !== 'long' && nextSess.type !== 'endurance') {
        // La IA sustituyó el fondo largo — revertimos y añadimos carga manualmente
        const origLong = plan.sessions[nextDayIdx];
        const addTSS   = Math.round(cancelledTSS * 0.6);
        newSessions[nextDayIdx] = {
          ...origLong,
          tss: (origLong.tss || 0) + addTSS,
          durationMin: (origLong.durationMin || 0) + 30,
          name: 'Fondo largo + bloques Sweet Spot',
          advice: `Bloques Sweet Spot integrados para compensar la carga del ${plan.sessions[cancelledIdx]?.day || 'día cancelado'}.`,
          _sweetSpotBlocks: true
        };
      }
    }

    // Validacion final anti-series consecutivas. Esta regla manda sobre la IA.
    const isQualitySession = (s) => {
      if (!s || s.isRest) return false;
      return ['tempo', 'threshold', 'vo2max', 'sprint', 'race'].includes(s.type) || Number(s.ifTarget || 0) >= 0.78;
    };
    for (let i = Math.max(todayIdx + 1, 1); i < 7; i++) {
      if (isQualitySession(newSessions[i - 1]) && isQualitySession(newSessions[i])) {
        const originalTSS = Number(newSessions[i].tss || 55);
        newSessions[i] = {
          ...newSessions[i],
          isRest: false,
          type: 'endurance',
          name: 'Z2 suave (evitar series consecutivas)',
          emoji: '🔵',
          durationMin: Math.max(40, Math.round((newSessions[i].durationMin || 75) * 0.65)),
          tss: Math.max(25, Math.round(originalTSS * 0.55)),
          ifTarget: 0.62,
          advice: 'Rebajamos esta sesion porque no debes encadenar dos dias de series. Conservamos carga aerobica sin sumar fatiga de calidad.',
          _adapted: true
        };
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

// ── POST /api/coach/session-guidance ─────────────────────────
// Planifica una sesión personalizada desde cero (NO adapta una existente).
// El usuario describe lo que quiere hacer y la IA devuelve plan completo.
router.post('/session-guidance', async (req, res) => {
  try {
    const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const description = (req.body?.description || '').trim();
    if (!description) return res.status(400).json({ error: 'Descripción requerida' });

    const ftp    = user.ftp    || 200;
    const weight = user.weight || 70;
    const goal   = user.goal   || 'resistencia';
    const wkg    = ftp && weight ? (ftp / weight).toFixed(2) : '—';

    const metrics = req.body?.metrics || {};
    const ctl = Math.round(metrics.ctl || 0);
    const atl = Math.round(metrics.atl || 0);
    const tsb = Math.round(metrics.tsb || 0);

    // Estado de forma para contexto
    const fs = formState(tsb);

    const systemPrompt = 'Eres un coach de ciclismo experto. Responde SOLO con JSON válido, sin markdown ni texto extra.';

    const userMsg = `Atleta: FTP ${ftp}W, peso ${weight}kg, W/kg: ${wkg}, objetivo: ${goal}.
Estado de forma: CTL=${ctl}, ATL=${atl}, TSB=${tsb} (${fs.label}).

El atleta quiere hacer:
"${description}"



}`;

    const result = await callAI(systemPrompt, userMsg, { max_tokens: 900, temperature: 0.35 });

    if (!result || !result.titulo) {
      const nested = result ? Object.values(result).find(v => v && typeof v === 'object' && v.titulo) : null;
      const out    = nested || result;
      if (!out?.titulo) return res.status(500).json({ error: 'La IA no devolvió un plan válido.' });
      return res.json({ ok: true, guidance: out });
    }

    console.log('[Session Guidance]', JSON.stringify(result));
    return res.json({ ok: true, guidance: result });

  } catch (e) {
    console.error('[Session Guidance]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/coach/smart-insights ─────────────────────────────────────────
// Traduce métricas a lenguaje natural + alertas mantenimiento + detección FTP
// Query params: tomorrow_code, tomorrow_precip, tomorrow_wind, tomorrow_temp
router.get('/smart-insights', async (req, res) => {
  try {
    const uid = req.user.id;

    // ── Datos base ─────────────────────────────────────────────
    const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
    if (!user) return res.status(404).json({ insights: [] });
    const ftp    = user.ftp    || 200;
    const weight = user.weight || 70;

    // PMC (últimos 10 días para comparar tendencia)
    const { data: pmcRows } = await supabase.from('pmc')
      .select('date, ctl, atl, tsb')
      .eq('user_id', uid)
      .order('date', { ascending: false })
      .limit(10);
    const latestPMC  = pmcRows?.[0] || { ctl: 0, atl: 0, tsb: 0 };
    const weekAgoPMC = pmcRows?.[7] || null;

    // Actividades (30 días) para zonas + detección de esfuerzos máximos
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const { data: activities } = await supabase.from('activities')
      .select('date, duration, distance, tss, np, avg_power, max_power, if_value, elevation, zone_times, type, name, best_efforts')
      .eq('user_id', uid)
      .gte('date', since30)
      .order('date', { ascending: false })
      .limit(40);

    // Plan semanal actual
    const { data: planData } = await supabase.from('training_plans')
      .select('sessions, phase, tss_target')
      .eq('user_id', uid)
      .order('week_start', { ascending: false })
      .limit(1)
      .single();

    // Alertas de garaje (reutiliza la lógica de /api/garage/alerts)
    const { data: bikes } = await supabase.from('bikes')
      .select('id, name, type, total_km, total_hours')
      .eq('user_id', uid).eq('is_active', true);
    const KM_LIFE  = { chain: 3000, cassette: 9000, chainring: 15000, brakes_pad: 3000, tire_front: 5000, tire_rear: 4000 };
    const HR_LIFE  = { fork: 200, shock: 100, fork_service: 200, shock_service: 100 };
    const COMP_LABELS = { chain:'Cadena', cassette:'Cassette', chainring:'Platos', brakes_pad:'Pastillas de freno',
                          tire_front:'Cubierta delantera', tire_rear:'Cubierta trasera', fork:'Horquilla', shock:'Amortiguador' };

    const insights = [];

    // ── ALERTAS DE MANTENIMIENTO ───────────────────────────────
    for (const bike of (bikes || [])) {
      const { data: comps } = await supabase.from('bike_components')
        .select('*').eq('bike_id', bike.id).eq('is_active', true);
      for (const c of (comps || [])) {
        const ct = c.component_type;
        const isHours = ['fork','shock','fork_service','shock_service'].includes(ct);
        if (isHours) {
          const hoursUsed  = Math.max(0, (bike.total_hours || 0) - (c.hours_installed || 0));
          const limit      = HR_LIFE[ct] || 200;
          const pct        = limit ? Math.round(hoursUsed / limit * 100) : 0;
          if (pct >= 85) {
            insights.push({ type: 'maintenance', priority: pct >= 100 ? 5 : 4,
              icon: '🔧', color: pct >= 100 ? '#ef4444' : '#f59e0b',
              title: pct >= 100 ? `¡${COMP_LABELS[ct] || ct} al límite! — ${bike.name}` : `${COMP_LABELS[ct] || ct} próxima a revisión — ${bike.name}`,
              message: `Llevas ${Math.round(hoursUsed)}h de uso ${pct >= 100 ? `(límite: ${limit}h). Revisión urgente de retenes y aceite para evitar daños internos.` : `(límite recomendado: ${limit}h). Programa el servicio pronto.`}`,
              action: null });
          }
        } else {
          const kmUsed = Math.max(0, (bike.total_km || 0) - (c.km_installed || 0));
          const limit  = KM_LIFE[ct] || 3000;
          const pct    = limit ? Math.round(kmUsed / limit * 100) : 0;
          if (pct >= 85) {
            const label = COMP_LABELS[ct] || ct;
            const msg   = pct >= 100
              ? `Tu ${bike.name || 'bici'} lleva ${Math.round(kmUsed).toLocaleString()} km con esta ${label.toLowerCase()}. Cámbiala ya — seguir usando puede dañar el cassette o los discos.`
              : `${Math.round(kmUsed).toLocaleString()} km de ${limit.toLocaleString()} km recomendados. Quedan ~${Math.round(limit - kmUsed).toLocaleString()} km. Planifica el cambio.`;
            insights.push({ type: 'maintenance', priority: pct >= 100 ? 5 : 3,
              icon: pct >= 100 ? '⛔' : '⚠️', color: pct >= 100 ? '#ef4444' : '#f59e0b',
              title: pct >= 100 ? `¡${label} al límite! — ${bike.name}` : `${label} cerca del límite — ${bike.name}`,
              message: msg, action: { label: 'Ver garaje', url: 'garaje.html' } });
          }
        }
      }
    }

    // ── DETECCIÓN AUTOMÁTICA DE FTP ────────────────────────────
    // Busca actividades recientes con IF ≥ 0.95 y duración entre 18-40 min
    let detectedFTP = 0;
    for (const a of (activities || [])) {
      const dur = Number(a.duration || 0);
      const np  = Number(a.np || 0);
      const ifv = Number(a.if_value || 0);
      if (dur >= 1080 && dur <= 2400 && np > 0 && ifv >= 0.95) {
        const est = Math.round(np * 0.95);
        if (est > detectedFTP) detectedFTP = est;
      }
      // También mirar best_efforts[1200] (20 min)
      const be = a.best_efforts;
      if (be) {
        const p20 = Number(be['1200'] || be[1200] || 0);
        if (p20 > 0) {
          const est = Math.round(p20 * 0.95);
          if (est > detectedFTP) detectedFTP = est;
        }
      }
    }
    if (detectedFTP > ftp * 1.025) {
      insights.push({ type: 'ftp', priority: 4,
        icon: '🎯', color: '#9ED62B',
        title: `¡Nuevo FTP estimado detectado! ${ftp}W → ${detectedFTP}W`,
        message: `Hemos detectado un esfuerzo reciente donde tu potencia normalizada sugiere un FTP de ~${detectedFTP}W (+${detectedFTP - ftp}W vs actual). Actualiza tus zonas para que el plan trabaje con los números correctos.`,
        action: { label: 'Actualizar FTP', url: 'profile.html' } });
    }

    // ── CONFLICTO CLIMA + PLAN ─────────────────────────────────
    const tomorrowCode  = parseInt(req.query.tomorrow_code  || '0');
    const tomorrowPrec  = parseFloat(req.query.tomorrow_precip || '0');
    const tomorrowWind  = parseFloat(req.query.tomorrow_wind   || '0');
    const tomorrowTemp  = parseFloat(req.query.tomorrow_temp   || '15');
    const HEAVY_RAIN    = [65, 82, 95, 96, 99];
    const ANY_RAIN      = [51,53,55,61,63,65,80,81,82,95,96,99];
    const isHeavy       = HEAVY_RAIN.includes(tomorrowCode) || tomorrowPrec >= 3;
    const isRain        = ANY_RAIN.includes(tomorrowCode)   || tomorrowPrec >= 0.5;
    const isStorm       = tomorrowCode >= 95;
    const now           = new Date();
    const tomorrowDow   = ((now.getDay() + 6) % 7 + 1) % 7;
    const tomorrowSess  = planData?.sessions?.[tomorrowDow];
    const isTomOutdoor  = tomorrowSess && !tomorrowSess.isRest &&
                          ['long','endurance','tempo','threshold','vo2max','sprint'].includes(tomorrowSess?.type);

    if (isTomOutdoor && (isHeavy || (isRain && tomorrowWind > 35) || isStorm)) {
      const sName = tomorrowSess.name || tomorrowSess.type;
      const altMin = Math.round((tomorrowSess.durationMin || 60) * 0.85);
      const wxDesc = isStorm ? 'tormenta' : isHeavy ? 'lluvia torrencial' : 'lluvia + viento fuerte';
      const rollerAdvice = tomorrowSess.type === 'long'
        ? `Sustituye el fondo largo por ${altMin} min en rodillo: 15 min calentamiento Z1, 60-80 min bloques Z2 sostenidos, 10 min vuelta a la calma.`
        : tomorrowSess.type === 'threshold' || tomorrowSess.type === 'tempo'
          ? `Replica la sesión en rodillo: los intervalos de umbral funcionan igual de bien (mejor, sin tráfico ni semáforos).`
          : `Prepara el rodillo con ${altMin} min siguiendo la misma estructura del plan.`;
      insights.push({ type: 'weather', priority: 3,
        icon: '🌧️', color: '#60a5fa',
        title: `Mañana ${wxDesc} — cambia a rodillo`,
        message: `Tienes planificado "${sName}" mañana. ${rollerAdvice}`,
        action: { label: 'Ver plan', url: 'training-plan.html' } });
    }

    // ── TRADUCTOR IA DE MÉTRICAS ───────────────────────────────
    const hasMeaningfulData = (latestPMC.ctl > 5 || latestPMC.atl > 5) && (activities?.length || 0) > 0;
    if (hasMeaningfulData) {
      const zoneMins = [0,0,0,0,0,0,0,0];
      for (const a of (activities || [])) {
        if (a.zone_times) {
          const zt = typeof a.zone_times === 'string' ? JSON.parse(a.zone_times) : a.zone_times;
          for (let z = 1; z <= 7; z++) zoneMins[z] += (zt[`z${z}`] || 0) / 60;
        }
      }
      const totalZM = zoneMins.slice(1).reduce((s,v) => s+v, 0);
      const zonePct = zoneMins.map(v => totalZM > 0 ? Math.round(v / totalZM * 100) : 0);
      const ctlTrend = weekAgoPMC ? (latestPMC.ctl - weekAgoPMC.ctl).toFixed(1) : null;
      const todayDow = (now.getDay() + 6) % 7;
      const todaySess = planData?.sessions?.[todayDow];
      const tomorrowSessAI = planData?.sessions?.[tomorrowDow];

      const systemPrompt = `Eres el coach personal de ciclismo de VeloMind. Genera exactamente 2 insights en lenguaje natural, directo y específico, basados en los datos reales del atleta.

Reglas:
- Habla en segunda persona ("estás", "tu", "tienes")
- Sé muy concreto: menciona números, vatios, minutos, zonas específicas
- Cada mensaje debe incluir QUÉ hacer EXACTAMENTE hoy o mañana
- NO uses frases genéricas como "escucha a tu cuerpo" sin dar números concretos
- El icon debe ser un único emoji relevante
- type: "warning" si hay riesgo, "success" si todo va bien, "info" si es neutro
- Esta app es EXCLUSIVAMENTE de ciclismo

Responde SOLO con JSON: {"insights":[{"title":"...","message":"...","icon":"emoji","type":"info|warning|success"}]}`;

      const tsbSign = latestPMC.tsb >= 0 ? '+' : '';
      const userMsg = `Datos HOY:
CTL: ${latestPMC.ctl.toFixed(1)}${ctlTrend ? ` (${Number(ctlTrend) >= 0 ? '+' : ''}${ctlTrend} en 7 días)` : ''}
ATL: ${latestPMC.atl.toFixed(1)} | TSB: ${tsbSign}${latestPMC.tsb.toFixed(1)}
FTP: ${ftp}W | W/kg: ${(ftp/weight).toFixed(2)}
Zonas 30 días: Z1=${zonePct[1]}% Z2=${zonePct[2]}% Z3=${zonePct[3]}% Z4=${zonePct[4]}% Z5=${zonePct[5]}%
Sesión de HOY: ${todaySess ? (todaySess.isRest ? 'Descanso' : `${todaySess.name||todaySess.type} — ${todaySess.durationMin||'?'} min, TSS objetivo ${todaySess.tss||'?'}`) : 'Sin plan'}
Sesión de MAÑANA: ${tomorrowSessAI ? (tomorrowSessAI.isRest ? 'Descanso' : `${tomorrowSessAI.name||tomorrowSessAI.type} — ${tomorrowSessAI.durationMin||'?'} min`) : 'Sin plan'}
Objetivo del atleta: ${user.goal || 'resistencia'}`;

      try {
        const aiResult = await callAI(systemPrompt, userMsg, { max_tokens: 500, temperature: 0.35 });
        if (Array.isArray(aiResult?.insights)) {
          for (const ins of aiResult.insights) {
            if (!ins.title || !ins.message) continue;
            insights.push({ type: ins.type || 'info', priority: 1,
              icon: ins.icon || '🧠',
              color: ins.type === 'warning' ? '#f59e0b' : ins.type === 'success' ? '#10b981' : '#38BDF8',
              title: ins.title, message: ins.message, action: null });
          }
        }
      } catch (e) {
        console.error('[smart-insights] AI error:', e.message);
      }
    }

    // Ordenar por prioridad descendente, máx 5 insights
    insights.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return res.json({ insights: insights.slice(0, 5) });

  } catch (e) {
    console.error('[smart-insights]', e.message);
    return res.status(500).json({ insights: [], error: e.message });
  }
});

// ── POST /api/coach/analyze-race-profile ─────────────────────────────────────
// Analiza una imagen del perfil de carrera con Claude Vision y extrae los datos
router.post('/analyze-race-profile', async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'Imagen requerida' });

  const parsed = parseDataUrlImage(imageBase64);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const openaiKey    = process.env.OPENAI_API_KEY    || '';
  const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
  const googleKey    = process.env.GOOGLE_API_KEY    || '';
  const openAiModel  = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  const hasOpenAI    = openaiKey.length > 20;
  const hasAnthropic = anthropicKey.startsWith('sk-ant-');
  const hasGoogle    = googleKey.startsWith('AIzaSy');

  if (!hasOpenAI && !hasAnthropic && !hasGoogle) {
    return res.status(503).json({ error: 'Servicio de análisis de imagen no disponible en este servidor' });
  }

  const prompt = `Eres un analista de ciclismo. Analiza este perfil de etapa/carrera ciclista y extrae la información en JSON.
Devuelve ÚNICAMENTE el JSON, sin texto adicional, sin markdown, sin \`\`\`.

{
  "distance_km": número (distancia total en km, null si no visible),
  "elevation_m": número (desnivel acumulado total en metros, null si no visible),
  "start_location": "nombre del lugar de salida si aparece, null si no",
  "finish_location": "nombre del lugar de llegada si aparece, null si no",
  "climbs": [
    {
      "name": "nombre del puerto o repecho",
      "km_start": número (km donde empieza la subida),
      "length_km": número (longitud en km),
      "elevation_m": número (desnivel en metros),
      "avg_grade": número (pendiente media en %, null si no visible),
      "max_elevation": número (altitud máxima en metros, null si no visible)
    }
  ],
  "feed_zones_km": [lista de km donde hay puntos de avituallamiento, vacío si no hay]
}
Si un campo no es legible, usa null o [].`;

  function extractRaceJSON(text) {
    try {
      const clean = text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim();
      const data = JSON.parse(clean);
      if (typeof data === 'object' && data !== null) return data;
    } catch(_) {}
    try {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
    } catch(_) {}
    return null;
  }

  try {
    // ── 1. Google Gemini (visión, muy fiable para imágenes) ──
    if (hasGoogle) {
      const geminiModels = [...new Set([
        (process.env.GEMINI_MODEL || '').trim(),
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-1.5-pro',
        'gemini-1.5-flash',
        'gemini-1.5-flash-latest',
      ])].filter(Boolean);

      for (const model of geminiModels) {
        try {
          const b64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
          const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': googleKey },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [
                { text: prompt },
                { inlineData: { mimeType: parsed.mime, data: b64 } },
              ]}],
              generationConfig: { temperature: 0, maxOutputTokens: 1024 },
            }),
          });
          const data = await resp.json();
          if (!resp.ok) {
            if (resp.status === 404) continue;
            console.log('[race-profile] Gemini error:', data.error || resp.status);
            continue;
          }
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const parsedData = extractRaceJSON(text);
          if (parsedData) return res.json(parsedData);
        } catch (e) {
          console.log('[race-profile] Gemini exception:', e.message);
        }
      }
    }

    // ── 2. OpenAI GPT-4o (visión) ──
    if (hasOpenAI) {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: openAiModel || 'gpt-4o-mini',
          max_tokens: 1024,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageBase64, detail: 'high' } },
            ],
          }],
        }),
      });
      if (resp.ok) {
        const d = await resp.json();
        const data = extractRaceJSON(d.choices?.[0]?.message?.content || '');
        if (data) return res.json(data);
      }
      console.log('[race-profile] OpenAI falló o devolvió respuesta vacía');
    }

    // ── 3. Anthropic Claude ──
    if (hasAnthropic) {
      const b64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
      const aiClient = new Anthropic({ apiKey: anthropicKey });
      const anthropicModels = [
        (process.env.ANTHROPIC_MODEL || '').trim(),
        'claude-3-5-sonnet-20241022',
        'claude-3-haiku-20240307',
      ].filter(Boolean);
      for (const model of anthropicModels) {
        try {
          const msg = await aiClient.messages.create({
            model,
            max_tokens: 1024,
            messages: [{ role: 'user', content: [
              { type: 'image', source: { type: 'base64', media_type: parsed.mime, data: b64 } },
              { type: 'text', text: prompt },
            ]}],
          });
          const data = extractRaceJSON(msg.content?.[0]?.text || '');
          if (data) return res.json(data);
        } catch (e) {
          console.log('[race-profile] Anthropic model failed:', model, e.message);
        }
      }
    }

    return res.status(200).json({
      distance_km: null,
      elevation_m: null,
      start_location: null,
      finish_location: null,
      climbs: [],
      feed_zones_km: [],
      _fallback: true,
      _message: 'No se pudo interpretar la imagen con los proveedores disponibles. Se devolvió un análisis vacío para evitar bloquear la tarjeta.',
    });
  } catch (e) {
    console.error('[race-profile]', e.message);
    res.status(500).json({ error: 'Error al analizar la imagen: ' + e.message });
  }
});

module.exports = router;
