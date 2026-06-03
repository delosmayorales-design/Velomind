const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { callAI }      = require('../services/ai');
const router = express.Router();

// BRouter profiles por tipo de bici
const BROUTER_PROFILE = { road: 'fastbike', gravel: 'trekking-bike', mtb: 'trekking-bike' };

// ── Geocodificación ───────────────────────────────────────────────────────────
async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const r = await fetch(url, { headers: { 'User-Agent': 'VeloMind/1.0' } });
  const d = await r.json();
  if (!d?.length) return null;
  return {
    lat: parseFloat(d[0].lat),
    lng: parseFloat(d[0].lon),
    name: d[0].display_name.split(',').slice(0, 2).join(', '),
  };
}

// ── Cálculo de ruta (BRouter primario → OSRM fallback) ───────────────────────
async function calculateRoute(startC, endC, bikeType) {
  // Primero BRouter (incluye altitudes en las coordenadas)
  const profile = BROUTER_PROFILE[bikeType] || 'trekking-bike';
  const lonlats  = `${startC.lng.toFixed(6)},${startC.lat.toFixed(6)}|${endC.lng.toFixed(6)},${endC.lat.toFixed(6)}`;
  try {
    const r = await fetch(
      `https://brouter.de/brouter?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`,
      { headers: { 'User-Agent': 'VeloMind/1.0' }, signal: AbortSignal.timeout(30000) }
    );
    if (r.ok) {
      const d = await r.json();
      const feature = d.features?.[0];
      if (feature?.geometry?.coordinates?.length >= 2) {
        const coords  = feature.geometry.coordinates; // [lng, lat, alt]
        const distM   = parseInt(feature.properties?.['track-length'] || 0);
        const distKm  = distM > 0 ? Math.round(distM / 100) / 10 : calcDistKm(coords);
        const elevM   = calcElevGain(coords);
        return { distance_km: distKm, elevation_m: elevM, coords };
      }
    }
  } catch (_) {}

  // Fallback: OSRM cycling (sin altitudes)
  try {
    const r = await fetch(
      `https://router.project-osrm.org/route/v1/cycling/${startC.lng},${startC.lat};${endC.lng},${endC.lat}?overview=full&geometries=geojson`,
      { headers: { 'User-Agent': 'VeloMind/1.0' }, signal: AbortSignal.timeout(20000) }
    );
    if (r.ok) {
      const d = await r.json();
      const route = d.routes?.[0];
      if (route?.geometry?.coordinates?.length >= 2) {
        const coords = route.geometry.coordinates; // [lng, lat]
        return {
          distance_km: Math.round(route.distance / 100) / 10,
          elevation_m: null,
          coords,
        };
      }
    }
  } catch (_) {}

  return null;
}

function calcDistKm(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i-1], [lng2, lat2] = coords[i];
    const R = 6371, dLa = (lat2-lat1)*Math.PI/180, dLo = (lng2-lng1)*Math.PI/180;
    const a = Math.sin(dLa/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLo/2)**2;
    d += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
  return Math.round(d * 10) / 10;
}

function calcElevGain(coords) {
  let gain = 0;
  for (let i = 1; i < coords.length; i++) {
    const dh = (coords[i][2] || 0) - (coords[i-1][2] || 0);
    if (dh > 0) gain += dh;
  }
  return Math.round(gain);
}

function segDistKm(coords) {
  return Math.round(calcDistKm(coords) * 10) / 10;
}

// ── División en días ──────────────────────────────────────────────────────────
function splitIntoDays(coords, days, totalKm) {
  if (!coords.length) return [];
  const kmPerDay = totalKm / days;
  const segments = [];
  let seg = [coords[0]], cumDist = 0, segDist = 0;

  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i-1], [lng2, lat2] = coords[i];
    const R = 6371, dLa = (lat2-lat1)*Math.PI/180, dLo = (lng2-lng1)*Math.PI/180;
    const a = Math.sin(dLa/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLo/2)**2;
    const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    cumDist += d;
    segDist += d;
    seg.push(coords[i]);

    if (cumDist >= kmPerDay * (segments.length + 1) && segments.length < days - 1) {
      segments.push({ coords: [...seg], distance_km: Math.round(segDist * 10) / 10 });
      seg = [coords[i]];
      segDist = 0;
    }
  }
  // Último segmento
  segments.push({ coords: seg, distance_km: Math.round(segDist * 10) / 10 });

  // Asegurar N segmentos
  while (segments.length < days) segments.push({ coords: [], distance_km: 0 });
  return segments.slice(0, days);
}

// ── Alojamientos via Overpass ─────────────────────────────────────────────────
async function findAccommodations(lat, lng, radiusM = 5000) {
  // Query simple (sin regex — compatible con todas las versiones de Overpass)
  const q = `[out:json][timeout:15];(
node["tourism"="hotel"](around:${radiusM},${lat},${lng});
node["tourism"="hostel"](around:${radiusM},${lat},${lng});
node["tourism"="motel"](around:${radiusM},${lat},${lng});
node["tourism"="guest_house"](around:${radiusM},${lat},${lng});
node["tourism"="camp_site"](around:${radiusM},${lat},${lng});
node["tourism"="alpine_hut"](around:${radiusM},${lat},${lng});
way["tourism"="hotel"](around:${radiusM},${lat},${lng});
way["tourism"="hostel"](around:${radiusM},${lat},${lng});
way["tourism"="guest_house"](around:${radiusM},${lat},${lng});
);out body center qt 10;`;
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(q),
    });
    if (!r.ok) return [];
    const d = await r.json();
    const typeLabel = {
      hotel: 'Hotel', hostel: 'Hostal', motel: 'Motel',
      guest_house: 'Casa rural', camp_site: '🏕 Camping', alpine_hut: '🏔 Refugio',
    };
    const seen = new Set();
    return (d.elements || [])
      .filter(el => {
        const name = el.tags?.name;
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
      })
      .slice(0, 6)
      .map(el => {
        const tags = el.tags || {};
        const elLat = el.lat ?? el.center?.lat ?? lat;
        const elLng = el.lon ?? el.center?.lon ?? lng;
        const name  = tags.name || 'Alojamiento sin nombre';
        const type  = typeLabel[tags.tourism] || 'Alojamiento';
        const stars = tags.stars ? '⭐'.repeat(Math.min(parseInt(tags.stars), 5)) : '';
        const city  = tags['addr:city'] || tags['addr:town'] || '';
        const bUrl  = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(name + (city ? ', ' + city : ''))}&group_adults=1&latitude=${elLat}&longitude=${elLng}`;
        return { name, type, stars, lat: elLat, lng: elLng, booking_url: bUrl };
      });
  } catch (_) { return []; }
}

// ── POST /api/bikepacking/plan ────────────────────────────────────────────────
router.post('/plan', requireAuth, async (req, res) => {
  const { start, end, bike_type, days } = req.body;
  if (!start?.trim() || !end?.trim()) return res.status(400).json({ error: 'Introduce origen y destino' });
  const numDays = Math.min(Math.max(parseInt(days) || 1, 1), 30);
  const type    = ['road','gravel','mtb'].includes(bike_type) ? bike_type : 'road';

  try {
    // 1. Geocodificar
    const [startC, endC] = await Promise.all([geocode(start.trim()), geocode(end.trim())]);
    if (!startC) return res.status(400).json({ error: `No se encontró: "${start}"` });
    if (!endC)   return res.status(400).json({ error: `No se encontró: "${end}"` });

    // 2. Ruta
    const route = await calculateRoute(startC, endC, type);
    if (!route?.coords?.length) return res.status(400).json({ error: 'No se pudo calcular la ruta. Intenta con nombres de ciudad más conocidos.' });

    // 3. División por días
    const segments = splitIntoDays(route.coords, numDays, route.distance_km);

    // 4. Plan diario + alojamientos en paralelo
    const dayPlans = await Promise.all(segments.map(async (seg, i) => {
      const last    = seg.coords.length ? seg.coords[seg.coords.length - 1] : route.coords[route.coords.length - 1];
      const stopLat = last[1];  // GeoJSON [lng, lat] → lat = [1]
      const stopLng = last[0];
      const elevM   = calcElevGain(seg.coords);
      const accommodations = (i < numDays - 1) ? await findAccommodations(stopLat, stopLng) : [];
      return {
        day: i + 1,
        distance_km: seg.distance_km,
        elevation_m: elevM,
        geojson: { type: 'LineString', coordinates: seg.coords.length >= 2 ? seg.coords : [last, last] },
        overnight_stop: { lat: stopLat, lng: stopLng },
        accommodations,
      };
    }));

    // 5. IA: descripción + POIs + consejos
    let aiResult = { description: '', highlights: [], tips: [] };
    try {
      const bikeLabel = { road: 'bicicleta de carretera', gravel: 'gravel', mtb: 'MTB' }[type];
      const elevStr   = route.elevation_m ? `${route.elevation_m} m D+` : 'desnivel no disponible';
      const raw = await callAI(
        'Eres un experto en bikepacking y cicloturismo.',
        `Ruta en ${bikeLabel}: ${startC.name} → ${endC.name}. ${route.distance_km} km, ${elevStr}, ${numDays} días.
Responde SOLO JSON con estas claves exactas:
{"description":"(3-4 frases motivadoras sobre la ruta)","highlights":["lugar o curiosidad 1","2","3","4","5"],"tips":["consejo práctico 1","2","3"]}`,
        { max_tokens: 700, response_format: { type: 'json_object' } }
      );
      if (raw) aiResult = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) {}

    res.json({
      start: startC, end: endC, bike_type: type, days: numDays,
      total_distance_km: route.distance_km,
      total_elevation_m: route.elevation_m ?? 0,
      geojson: { type: 'LineString', coordinates: route.coords },
      day_plans: dayPlans,
      ...aiResult,
    });
  } catch (e) {
    console.error('[Bikepacking]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
