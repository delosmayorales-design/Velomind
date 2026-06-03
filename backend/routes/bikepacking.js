const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { callAI }      = require('../services/ai');
const router = express.Router();

const BROUTER_PROFILE = { road: 'fastbike', gravel: 'trekking-bike', mtb: 'trekking-bike' };

// ── Geocodificación ───────────────────────────────────────────────────────────
async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const r = await fetch(url, { headers: { 'User-Agent': 'VeloMind/1.0' } });
  const d = await r.json();
  if (!d?.length) return null;
  return {
    lat:  parseFloat(d[0].lat),
    lng:  parseFloat(d[0].lon),
    name: d[0].display_name.split(',').slice(0, 2).join(', '),
  };
}

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const r = await fetch(url, { headers: { 'User-Agent': 'VeloMind/1.0' } });
    const d = await r.json();
    const addr = d.address || {};
    return addr.town || addr.village || addr.city || addr.municipality || addr.county || null;
  } catch (_) { return null; }
}

// ── Routing BRouter + fallback OSRM ──────────────────────────────────────────
async function calcRouteBRouter(startC, endC, bikeType, altIdx = 0) {
  const profile = BROUTER_PROFILE[bikeType] || 'trekking-bike';
  const lonlats  = `${startC.lng.toFixed(6)},${startC.lat.toFixed(6)}|${endC.lng.toFixed(6)},${endC.lat.toFixed(6)}`;
  try {
    const r = await fetch(
      `https://brouter.de/brouter?lonlats=${lonlats}&profile=${profile}&alternativeidx=${altIdx}&format=geojson`,
      { headers: { 'User-Agent': 'VeloMind/1.0' }, signal: AbortSignal.timeout(35000) }
    );
    if (!r.ok) return null;
    const d    = await r.json();
    const feat = d.features?.[0];
    if (!feat?.geometry?.coordinates?.length) return null;
    const coords = feat.geometry.coordinates;
    const distM  = parseInt(feat.properties?.['track-length'] || 0);
    return {
      distance_km: distM > 0 ? Math.round(distM / 100) / 10 : calcDistKm(coords),
      elevation_m: calcElevGain(coords),
      coords,
    };
  } catch (_) { return null; }
}

async function calcRouteOSRM(startC, endC) {
  try {
    const r = await fetch(
      `https://router.project-osrm.org/route/v1/cycling/${startC.lng},${startC.lat};${endC.lng},${endC.lat}?overview=full&geometries=geojson`,
      { headers: { 'User-Agent': 'VeloMind/1.0' }, signal: AbortSignal.timeout(20000) }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const route = d.routes?.[0];
    if (!route?.geometry?.coordinates?.length) return null;
    return { distance_km: Math.round(route.distance / 100) / 10, elevation_m: 0, coords: route.geometry.coordinates };
  } catch (_) { return null; }
}

async function calculateRoute(startC, endC, bikeType, altIdx = 0) {
  return (await calcRouteBRouter(startC, endC, bikeType, altIdx)) || (await calcRouteOSRM(startC, endC));
}

// ── Utilidades ────────────────────────────────────────────────────────────────
function hvDist([lng1, lat1], [lng2, lat2]) {
  const R = 6371, dLa = (lat2-lat1)*Math.PI/180, dLo = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLa/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLo/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function calcDistKm(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += hvDist(coords[i-1], coords[i]);
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

function splitIntoDays(coords, days) {
  if (!coords.length || days < 1) return [];
  const total    = calcDistKm(coords);
  const kmPerDay = total / days;
  const segments = [];
  let seg = [coords[0]], segDist = 0, cumDist = 0;

  for (let i = 1; i < coords.length; i++) {
    const d = hvDist(coords[i-1], coords[i]);
    cumDist += d; segDist += d;
    seg.push(coords[i]);
    if (segments.length < days - 1 && cumDist >= kmPerDay * (segments.length + 1)) {
      segments.push({ coords: [...seg], distance_km: Math.round(segDist * 10) / 10 });
      seg = [coords[i]]; segDist = 0;
    }
  }
  segments.push({ coords: seg, distance_km: Math.round(segDist * 10) / 10 });
  while (segments.length < days) segments.push({ coords: [], distance_km: 0 });
  return segments.slice(0, days);
}

// ── Alojamientos — busca en radio creciente hasta encontrar ──────────────────
async function findAccommodationsWithFallback(lat, lng) {
  const RADII = [6000, 12000, 25000, 50000];
  for (const radius of RADII) {
    const results = await queryOverpass(lat, lng, radius);
    if (results.length > 0) {
      const adjusted = radius > 6000;
      // Si hubo que ampliar el radio, obtener nombre del pueblo del primer alojamiento
      let nearestTown = null;
      if (adjusted && results[0]) {
        nearestTown = await reverseGeocode(results[0].lat, results[0].lng);
      }
      return { accommodations: results, adjusted, nearestTown, searchRadius: radius };
    }
  }
  return { accommodations: [], adjusted: false, nearestTown: null, searchRadius: 0 };
}

async function queryOverpass(lat, lng, radiusM) {
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
      .filter(el => { const n = el.tags?.name; if (!n || seen.has(n)) return false; seen.add(n); return true; })
      .slice(0, 6)
      .map(el => {
        const tags  = el.tags || {};
        const elLat = el.lat ?? el.center?.lat ?? lat;
        const elLng = el.lon ?? el.center?.lon ?? lng;
        const name  = tags.name || 'Alojamiento';
        const type  = typeLabel[tags.tourism] || 'Alojamiento';
        const stars = tags.stars ? '⭐'.repeat(Math.min(parseInt(tags.stars), 5)) : '';
        const city  = tags['addr:city'] || tags['addr:town'] || '';
        const bUrl  = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(name + (city ? ', '+city : ''))}&group_adults=1&latitude=${elLat}&longitude=${elLng}`;
        return { name, type, stars, lat: elLat, lng: elLng, booking_url: bUrl };
      });
  } catch (_) { return []; }
}

// ── POST /api/bikepacking/plan ────────────────────────────────────────────────
router.post('/plan', requireAuth, async (req, res) => {
  const { start, end, bike_type, days, circular } = req.body;
  if (!start?.trim() || !end?.trim()) return res.status(400).json({ error: 'Introduce origen y destino' });

  const numDays    = Math.min(Math.max(parseInt(days) || 1, 1), 30);
  const type       = ['road','gravel','mtb'].includes(bike_type) ? bike_type : 'road';
  const isCircular = !!circular;

  try {
    const [startC, endC] = await Promise.all([geocode(start.trim()), geocode(end.trim())]);
    if (!startC) return res.status(400).json({ error: `No se encontró: "${start}"` });
    if (!endC)   return res.status(400).json({ error: `No se encontró: "${end}"` });

    // Calcular ruta(s)
    let allCoords, totalDistKm, totalElevM;

    if (isCircular) {
      const [outbound, returnLeg] = await Promise.all([
        calculateRoute(startC, endC, type, 0),
        calculateRoute(endC, startC, type, 1), // alternativa diferente para la vuelta
      ]);
      if (!outbound?.coords?.length)  return res.status(400).json({ error: 'No se pudo calcular la ruta de ida.' });
      if (!returnLeg?.coords?.length) return res.status(400).json({ error: 'No se pudo calcular la ruta de vuelta.' });

      allCoords    = [...outbound.coords, ...returnLeg.coords.slice(1)];
      totalDistKm  = Math.round((outbound.distance_km + returnLeg.distance_km) * 10) / 10;
      totalElevM   = (outbound.elevation_m || 0) + (returnLeg.elevation_m || 0);
    } else {
      const route = await calculateRoute(startC, endC, type, 0);
      if (!route?.coords?.length) return res.status(400).json({ error: 'No se pudo calcular la ruta.' });
      allCoords   = route.coords;
      totalDistKm = route.distance_km;
      totalElevM  = route.elevation_m || 0;
    }

    const segments = splitIntoDays(allCoords, numDays);

    // Plan diario + alojamientos (con fallback a pueblo más cercano)
    const dayPlans = await Promise.all(segments.map(async (seg, i) => {
      const last    = seg.coords.length ? seg.coords[seg.coords.length - 1] : allCoords[allCoords.length - 1];
      const stopLat = last[1];
      const stopLng = last[0];
      const elevM   = calcElevGain(seg.coords);
      const isLastDay = i === numDays - 1;

      let accommodations = [], stopAdjusted = false, adjustedTown = null;
      if (!isLastDay) {
        const result = await findAccommodationsWithFallback(stopLat, stopLng);
        accommodations = result.accommodations;
        stopAdjusted   = result.adjusted;
        adjustedTown   = result.nearestTown;
      }

      return {
        day: i + 1,
        distance_km: seg.distance_km,
        elevation_m: elevM,
        geojson: { type: 'LineString', coordinates: seg.coords.length >= 2 ? seg.coords : [last, last] },
        overnight_stop: { lat: stopLat, lng: stopLng },
        accommodations,
        stop_adjusted: stopAdjusted,     // true si no había alojamiento cerca y se amplió el radio
        adjusted_town: adjustedTown,     // nombre del pueblo con alojamiento encontrado
      };
    }));

    // IA
    let aiResult = { description: '', highlights: [], tips: [] };
    try {
      const bikeLabel   = { road: 'bicicleta de carretera', gravel: 'gravel', mtb: 'MTB' }[type];
      const circularStr = isCircular ? ' (circular, ida y vuelta por rutas distintas)' : '';
      const raw = await callAI(
        'Eres un experto en bikepacking y cicloturismo.',
        `Ruta en ${bikeLabel}${circularStr}: ${startC.name} → ${endC.name}. ${totalDistKm} km, ${totalElevM} m D+, ${numDays} días.
Responde SOLO JSON exacto:
{"description":"(3-4 frases motivadoras)","highlights":["lugar/curiosidad 1","2","3","4","5"],"tips":["consejo 1","2","3"]}`,
        { max_tokens: 700, response_format: { type: 'json_object' } }
      );
      if (raw) aiResult = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) {}

    res.json({
      start: startC, end: endC, bike_type: type, days: numDays, circular: isCircular,
      total_distance_km: totalDistKm,
      total_elevation_m: totalElevM,
      geojson: { type: 'LineString', coordinates: allCoords },
      day_plans: dayPlans,
      ...aiResult,
    });
  } catch (e) {
    console.error('[Bikepacking]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
