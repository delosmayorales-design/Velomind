const express    = require('express');
const { requireAuth } = require('../middleware/auth');
const { callAI } = require('../services/ai');
const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const r = await fetch(url, { headers: { 'User-Agent': 'VeloMind/1.0' } });
  const d = await r.json();
  if (!d.length) return null;
  return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon), name: d[0].display_name.split(',').slice(0, 2).join(', ') };
}

async function calcRouteValhalla(startC, endC, bikeType) {
  const costing = bikeType === 'road' ? 'bicycle' : bikeType === 'gravel' ? 'bicycle' : null;
  if (!costing) return null;
  const body = {
    locations: [{ lon: startC.lng, lat: startC.lat }, { lon: endC.lng, lat: endC.lat }],
    costing,
    costing_options: { bicycle: { bicycle_type: bikeType === 'road' ? 'Road' : 'Cross' } },
    units: 'kilometers',
    shape_format: 'geojson',
  };
  const r = await fetch('https://valhalla1.openstreetmap.de/route', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return null;
  const d = await r.json();
  const leg = d.trip?.legs?.[0];
  if (!leg) return null;
  const coords = leg.shape?.coordinates || [];
  let elevGain = 0;
  const elevs = coords.map(c => c[2] || 0);
  for (let i = 1; i < elevs.length; i++) { const dh = elevs[i] - elevs[i-1]; if (dh > 0) elevGain += dh; }
  return {
    distance_km: Math.round((d.trip.summary.length || 0) * 10) / 10,
    elevation_m: Math.round(elevGain),
    coords,            // [[lng, lat, alt?], ...]
    geojson: { type: 'LineString', coordinates: coords },
  };
}

async function calcRouteBRouter(startC, endC) {
  const lonlats = `${startC.lng},${startC.lat}|${endC.lng},${endC.lat}`;
  const url = `https://brouter.de/brouter?lonlats=${lonlats}&profile=trekking-bike&alternativeidx=0&format=geojson`;
  const r = await fetch(url, { headers: { 'User-Agent': 'VeloMind/1.0' } });
  if (!r.ok) return null;
  const d = await r.json();
  const feature = d.features?.[0];
  if (!feature) return null;
  const coords = feature.geometry?.coordinates || [];
  const distM  = parseInt(feature.properties?.['track-length'] || 0);
  let elevGain = 0;
  const elevs = coords.map(c => c[2] || 0);
  for (let i = 1; i < elevs.length; i++) { const dh = elevs[i] - elevs[i-1]; if (dh > 0) elevGain += dh; }
  return {
    distance_km: Math.round(distM / 100) / 10,
    elevation_m: Math.round(elevGain),
    coords,
    geojson: { type: 'LineString', coordinates: coords },
  };
}

// Divide las coordenadas en N segmentos de distancia similar
function splitIntoDays(coords, days, totalKm) {
  if (!coords.length) return [];
  const kmPerDay = totalKm / days;
  const segments = [];
  let seg = [coords[0]], cumDist = 0, dayIdx = 0;

  function hvDist([lng1,lat1], [lng2,lat2]) {
    const R = 6371, dLa = (lat2-lat1)*Math.PI/180, dLo = (lng2-lng1)*Math.PI/180;
    const a = Math.sin(dLa/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLo/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  for (let i = 1; i < coords.length; i++) {
    cumDist += hvDist(coords[i-1], coords[i]);
    seg.push(coords[i]);
    if (cumDist >= kmPerDay * (dayIdx + 1) && dayIdx < days - 1) {
      const last = coords[i];
      segments.push({ coords: [...seg], distance_km: Math.round(cumDist / (dayIdx+1) * 10) / 10 });
      dayIdx++;
      seg = [last];
    }
  }
  segments.push({ coords: seg, distance_km: Math.round((totalKm - (kmPerDay * (days-1))) * 10) / 10 });
  // Asegurar que tenemos exactamente `days` segmentos
  while (segments.length < days) segments.push({ coords: [], distance_km: 0 });
  return segments.slice(0, days);
}

// Busca alojamientos via Overpass API (OpenStreetMap) — gratuito
async function findAccommodations(lat, lng, radiusM = 2500) {
  const q = `[out:json][timeout:10];(
    node["tourism"~"^(hotel|hostel|motel|guest_house|apartment)$"](around:${radiusM},${lat},${lng});
    node["tourism"="camp_site"](around:${radiusM},${lat},${lng});
    way["tourism"~"^(hotel|hostel|motel|guest_house)$"](around:${radiusM},${lat},${lng});
  );out body center;`;
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: 'data=' + encodeURIComponent(q),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!r.ok) return [];
    const d = await r.json();
    const typeLabel = { hotel: 'Hotel', hostel: 'Hostal', motel: 'Motel', guest_house: 'Casa rural', apartment: 'Apartamento', camp_site: '🏕 Camping' };
    return (d.elements || []).slice(0, 5).map(el => {
      const tags = el.tags || {};
      const elLat = el.lat || el.center?.lat || lat;
      const elLng = el.lon || el.center?.lon || lng;
      const name  = tags.name || 'Alojamiento';
      const type  = typeLabel[tags.tourism] || 'Alojamiento';
      const stars = tags.stars ? '⭐'.repeat(Math.min(parseInt(tags.stars), 5)) : '';
      const bookingUrl = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(tags.name || '')}+${encodeURIComponent(tags['addr:city'] || '')}&latitude=${elLat}&longitude=${elLng}&group_adults=1`;
      return { name, type, stars, lat: elLat, lng: elLng, booking_url: bookingUrl, address: tags['addr:street'] || '' };
    });
  } catch (_) { return []; }
}

// ── POST /api/bikepacking/plan ────────────────────────────────────────────────
router.post('/plan', requireAuth, async (req, res) => {
  const { start, end, bike_type, days } = req.body;
  if (!start || !end || !days) return res.status(400).json({ error: 'start, end y days son requeridos' });
  const numDays = Math.min(Math.max(parseInt(days) || 1, 1), 30);
  const type = ['road','gravel','mtb'].includes(bike_type) ? bike_type : 'road';

  try {
    // 1. Geocodificar
    const [startC, endC] = await Promise.all([geocode(start), geocode(end)]);
    if (!startC) return res.status(400).json({ error: `No se encontró: "${start}"` });
    if (!endC)   return res.status(400).json({ error: `No se encontró: "${end}"` });

    // 2. Calcular ruta
    const route = type === 'mtb'
      ? await calcRouteBRouter(startC, endC)
      : await calcRouteValhalla(startC, endC, type);
    if (!route) return res.status(400).json({ error: 'No se pudo calcular la ruta. Prueba con ciudades más grandes o conectadas.' });

    // 3. Dividir por días
    const segments = splitIntoDays(route.coords, numDays, route.distance_km);

    // 4. Alojamientos por parada nocturna (todos los días excepto el último)
    const dayPlans = await Promise.all(segments.map(async (seg, i) => {
      const lastCoord = seg.coords[seg.coords.length - 1] || route.coords[route.coords.length - 1];
      const stopLat   = lastCoord ? lastCoord[1] : endC.lat;
      const stopLng   = lastCoord ? lastCoord[0] : endC.lng;
      let elevGain = 0;
      for (let j = 1; j < seg.coords.length; j++) {
        const dh = (seg.coords[j][2] || 0) - (seg.coords[j-1][2] || 0);
        if (dh > 0) elevGain += dh;
      }
      const accommodations = (i < numDays - 1) ? await findAccommodations(stopLat, stopLng) : [];
      return {
        day: i + 1,
        distance_km: seg.distance_km,
        elevation_m: Math.round(elevGain),
        geojson: { type: 'LineString', coordinates: seg.coords },
        overnight_stop: { lat: stopLat, lng: stopLng },
        accommodations,
      };
    }));

    // 5. Descripción IA + puntos de interés
    let aiResult = { description: '', highlights: [], tips: [] };
    try {
      const bikeLabel = { road: 'bicicleta de carretera', gravel: 'gravel', mtb: 'bicicleta de montaña (MTB)' }[type];
      const prompt = `Planifica un viaje de bikepacking en ${bikeLabel} de ${startC.name} a ${endC.name}.
Distancia total: ${route.distance_km} km, desnivel acumulado: ${route.elevation_m} m, duración: ${numDays} días.
Responde SOLO con JSON válido con exactamente estas claves:
{
  "description": "párrafo motivador y descriptivo de la ruta (3-4 frases)",
  "highlights": ["punto o curiosidad de interés 1", "punto 2", "punto 3", "punto 4", "punto 5"],
  "tips": ["consejo práctico 1", "consejo 2", "consejo 3"]
}`;
      const raw = await callAI(
        'Eres un experto en bikepacking y cicloturismo en España y Europa.',
        prompt,
        { max_tokens: 600, response_format: { type: 'json_object' } }
      );
      if (raw) aiResult = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) {}

    res.json({
      start: startC,
      end:   endC,
      bike_type: type,
      days: numDays,
      total_distance_km: route.distance_km,
      total_elevation_m: route.elevation_m,
      geojson: route.geojson,
      day_plans: dayPlans,
      ...aiResult,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
