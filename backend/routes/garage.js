const express = require('express');
const supabase = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth);

const BIKE_TYPES = {
  gravel: 'Gravel', carretera: 'Carretera',
  mtb_full: 'MTB Doble Suspensión', mtb_hardtail: 'MTB Rígida'
};
const COMPONENT_LABELS = {
  chain:'Cadena', cassette:'Cassette', chainring:'Platos', brakes_pad:'Pastillas',
  brake_rotor:'Disco', brake_fluid:'Líquido Frenos', tire_front:'Cubierta Delantera',
  tire_rear:'Cubierta Trasera', fork:'Horquilla', shock:'Amortiguador'
};

// GET /api/garage/debug  — diagnóstico completo
router.get('/debug', async (req, res) => {
  const uid = req.user.id;

  // 1. Test insert
  const { data: testBike, error: testErr } = await supabase.from('bikes').insert({
    user_id: uid, name: 'TEST_DEBUG', type: 'road', total_km: 0, is_active: true,
  }).select().single();
  if (testErr) {
    return res.json({ insert_ok: false, error: testErr.message, code: testErr.code });
  }
  await supabase.from('bikes').delete().eq('id', testBike.id);

  // 2. Token de Strava
  const { data: user } = await supabase.from('users').select('strava_token, strava_athlete_id').eq('id', uid).single();
  if (!user?.strava_token) return res.json({ insert_ok: true, strava: 'NO TOKEN' });

  // 3. Raw athlete desde Strava
  const r = await fetch('https://www.strava.com/api/v3/athlete', {
    headers: { Authorization: `Bearer ${user.strava_token}` }
  });
  const athlete = await r.json();

  return res.json({
    insert_ok: true,
    strava_status: r.status,
    athlete_id: athlete.id,
    athlete_name: `${athlete.firstname} ${athlete.lastname}`,
    bikes_count: (athlete.bikes || []).length,
    bikes_raw: athlete.bikes || [],
  });
});

// GET /api/garage  — devuelve { garage: { bikes:[...] }, history:[] }
router.get('/', async (req, res) => {
  const uid = req.user.id;
  console.log('\n[GET /garage] ══════════════════════════');
  console.log('[GET /garage] user autenticado:', JSON.stringify(req.user));

  // DEBUG: ver TODAS las bicis en la BD (sin filtro de usuario)
  const { data: allBikes } = await supabase.from('bikes').select('id, user_id, name');
  console.log('[GET /garage] Total bicis en BD:', allBikes?.length || 0);
  console.log('[GET /garage] Distribución por user_id:', JSON.stringify(
    (allBikes || []).reduce((acc, b) => { acc[b.user_id] = (acc[b.user_id] || 0) + 1; return acc; }, {})
  ));

  const { data: bikes, error: bikesErr } = await supabase
    .from('bikes').select('*')
    .eq('user_id', uid)
    .order('is_active', { ascending: false })
    .order('updated_at',  { ascending: false });

  console.log('[GET /garage] Bicis devueltas para user_id=' + uid + ':', bikes?.length || 0);
  if (bikes?.length) console.log('[GET /garage] Nombres:', bikes.map(b => `${b.name} (uid=${b.user_id})`).join(', '));
  if (bikesErr) console.error('[GET /garage] ERROR Supabase:', bikesErr.message);

  if (bikesErr) return res.status(500).json({ error: bikesErr.message });

  // Mapear al formato que espera el frontend (garaje.html)
  const mappedBikes = await Promise.all((bikes || []).map(async bike => {
    const { data: comps } = await supabase
      .from('bike_components').select('*')
      .eq('bike_id', bike.id).eq('is_active', true);

    const TYPE_MAP = {
      brakes_pad:  'brake_pads_front',
      brake_rotor: 'rotor_front',
      fork:        'fork_service',
      shock:       'shock_service',
    };
    const HOUR_BASED_TYPES = new Set(['fork', 'shock', 'fork_service', 'shock_service']);
    const KM_LIFE_FE = { chain:3000, cassette:9000, chainring:15000, jockey_wheels:15000,
                         brakes_pad:3000, brake_rotor:10000, tire_front:5000, tire_rear:4000 };
    const HR_LIFE_FE = { fork:200, fork_service:200, shock:100, shock_service:100 };

    const typeCount = {};
      const components = (comps || []).map(c => {
        typeCount[c.component_type] = (typeCount[c.component_type] || 0) + 1;
        let feType = TYPE_MAP[c.component_type] || c.component_type;
        if (c.component_type === 'brakes_pad'  && typeCount['brakes_pad']  > 1) feType = 'brake_pads_rear';
        if (c.component_type === 'brake_rotor' && typeCount['brake_rotor'] > 1) feType = 'rotor_rear';
        const isHours = HOUR_BASED_TYPES.has(c.component_type);

        // current_km = km recorridos DESDE que se instaló el componente
        const odometer_at_install = c.km_installed || 0;
        const km_since_install    = Math.max(0, Math.round(((bike.total_km || 0) - odometer_at_install) * 10) / 10);
        const lifespan_km  = KM_LIFE_FE[c.component_type] || 3000;
        const lifespan_h   = HR_LIFE_FE[c.component_type] || 100;
        // hours_installed = odómetro de la bici al instalar el componente
        const hours_used   = Math.max(0, (bike.total_hours || 0) - (c.hours_installed || 0));

        return {
          id:            c.id,
          bike_id:       bike.id,
          type:          feType,
          name:          c.name || COMPONENT_LABELS[c.component_type] || c.component_type,
          brand:         c.brand || '',
          model:         c.model || '',
          current_km:    isHours ? 0 : km_since_install,
          current_hours: isHours ? hours_used : 0,
          km_remaining:  isHours ? 0 : Math.max(0, c.km_remaining || 0),
          threshold_km:    isHours ? null : lifespan_km,
          threshold_hours: isHours ? lifespan_h : null,
          status: 'green',
        };
      });

    return {
      id:             bike.id,
      type:           bike.type || 'road',
      name:           bike.name,
      brand:          bike.brand  || '',
      model:          bike.model  || '',
      year:           bike.year   || new Date().getFullYear(),
      strava_gear_id: bike.strava_gear_id || null,
      total_km:       bike.total_km || 0,
      total_hours:    bike.total_hours || 0,
      is_active:      bike.is_active !== false,
      components,
    };
  }));

  // Wrapper en formato { garage, history } que espera BackendSync.loadGarage()
  res.json({
    garage:  { version: 2, bikes: mappedBikes, processed_ids: [] },
    history: [],
  });
});

// GET /api/garage/alerts — DEBE ir ANTES de /:bikeId para no quedar enmascarado
router.get('/alerts', async (req, res) => {
  const { data: bikes } = await supabase.from('bikes').select('*').eq('user_id', req.user.id).eq('is_active', true);
  const alerts = [];
  for (const bike of bikes || []) {
    const { data: components } = await supabase.from('bike_components').select('*').eq('bike_id', bike.id).eq('is_active', true);
    for (const c of components || []) {
      const threshold = await getThreshold(bike.type, c.component_type);
      if (!threshold) continue;
      const lifespan = threshold.lifespan_km || threshold.lifespan_hours;
      const used = lifespan - (c.km_remaining || c.hours_remaining || lifespan);
      const pct = lifespan ? Math.round((used / lifespan) * 100) : 0;
      if (pct >= threshold.alert_yellow_pct) {
        alerts.push({ bike: bike.name, bike_id: bike.id, component: COMPONENT_LABELS[c.component_type] || c.component_type, component_id: c.id, pct, status: pct >= threshold.alert_red_pct ? 'red' : 'yellow', action: pct >= threshold.alert_red_pct ? 'CAMBIAR YA' : 'Revisar pronto' });
      }
    }
  }
  res.json(alerts.sort((a, b) => b.pct - a.pct));
});

// GET /api/garage/:bikeId
router.get('/:bikeId', async (req, res) => {
  const { data: bike } = await supabase.from('bikes').select('*').eq('id', req.params.bikeId).eq('user_id', req.user.id).single();
  if (!bike) return res.status(404).json({ error: 'Bici no encontrada' });

  const { data: components } = await supabase.from('bike_components').select('*').eq('bike_id', bike.id).order('component_type');
  const { data: history } = await supabase.from('component_history').select('*, bike_components(name, component_type)').eq('bike_components.bike_id', bike.id).order('created_at', { ascending: false }).limit(20);

  const enriched = await Promise.all((components || []).map(async c => {
    const threshold = await getThreshold(bike.type, c.component_type);
    if (!threshold) return { ...c, status: 'unknown', pct: 0 };
    const lifespan = threshold.lifespan_km || threshold.lifespan_hours;
    const used = lifespan - (c.km_remaining || c.hours_remaining || lifespan);
    const pct = lifespan ? Math.round((used / lifespan) * 100) : 0;
    let status = 'green';
    if (pct >= threshold.alert_red_pct) status = 'red';
    else if (pct >= threshold.alert_yellow_pct) status = 'yellow';
    return { ...c, status, pct, threshold_km: threshold.lifespan_km, threshold_hours: threshold.lifespan_hours, label: COMPONENT_LABELS[c.component_type] || c.component_type };
  }));

  res.json({ ...bike, type_label: BIKE_TYPES[bike.type], components: enriched, history: history || [] });
});

// POST /api/garage
router.post('/', async (req, res) => {
  const { name, type, brand, model, year, frame_number, photo_url, strava_gear_id, notes } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'Nombre y tipo son obligatorios' });

  const { data: newBike, error } = await supabase.from('bikes')
    .insert({ user_id: req.user.id, name, type, brand, model, year, frame_number, photo_url, strava_gear_id, notes })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  await createDefaultComponents(newBike.id, type, 0);
  res.json({ id: newBike.id, message: 'Bici creada correctamente' });
});

// PUT /api/garage/:bikeId
router.put('/:bikeId', async (req, res) => {
  const { name, brand, model, year, frame_number, photo_url, strava_gear_id, is_active, notes, total_km, total_hours } = req.body;
  const { data: bike } = await supabase.from('bikes').select('id').eq('id', req.params.bikeId).eq('user_id', req.user.id).single();
  if (!bike) return res.status(404).json({ error: 'Bici no encontrada' });

  const updates = {};
  if (name           !== undefined) updates.name            = name;
  if (brand          !== undefined) updates.brand           = brand;
  if (model          !== undefined) updates.model           = model;
  if (year           !== undefined) updates.year            = year;
  if (frame_number   !== undefined) updates.frame_number    = frame_number;
  if (photo_url      !== undefined) updates.photo_url       = photo_url;
  if (strava_gear_id !== undefined) updates.strava_gear_id  = strava_gear_id;
  if (is_active      !== undefined) updates.is_active       = is_active;
  if (notes          !== undefined) updates.notes           = notes;
  if (total_km       != null)       updates.total_km        = Math.max(0, parseFloat(total_km)    || 0);
  if (total_hours    != null)       updates.total_hours     = Math.max(0, parseFloat(total_hours) || 0);
  if (!Object.keys(updates).length) return res.json({ message: 'Sin cambios' });

  await supabase.from('bikes').update(updates).eq('id', req.params.bikeId);
  res.json({ message: 'Bici actualizada' });
});

// DELETE /api/garage/:bikeId
router.delete('/:bikeId', async (req, res) => {
  const { data: bike } = await supabase.from('bikes').select('id').eq('id', req.params.bikeId).eq('user_id', req.user.id).single();
  if (!bike) return res.status(404).json({ error: 'Bici no encontrada' });
  await supabase.from('bikes').delete().eq('id', req.params.bikeId);
  res.json({ message: 'Bici eliminada' });
});

// PUT /api/garage/component/:componentId  — actualiza marca, modelo y km
router.put('/component/:componentId', async (req, res) => {
  const { brand, model, km_installed, hours_installed } = req.body;
  const { data: comp } = await supabase.from('bike_components')
    .select('id, bike_id').eq('id', req.params.componentId).single();
  if (!comp) return res.status(404).json({ error: 'Componente no encontrado' });

  const { data: bike } = await supabase.from('bikes')
    .select('id').eq('id', comp.bike_id).eq('user_id', req.user.id).single();
  if (!bike) return res.status(403).json({ error: 'No autorizado' });

  const updates = {};
  if (brand            !== undefined) updates.brand            = brand || null;
  if (model            !== undefined) updates.model            = model || null;
  if (km_installed     !== undefined) updates.km_installed     = parseFloat(km_installed) || 0;
  if (hours_installed  !== undefined) updates.hours_installed  = parseFloat(hours_installed) || 0;

  const { error } = await supabase.from('bike_components').update(updates).eq('id', comp.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// POST /api/garage/:bikeId/components
router.post('/:bikeId/components', async (req, res) => {
  const { component_type, name, brand, model, notes } = req.body;
  const { data: bike } = await supabase.from('bikes').select('*').eq('id', req.params.bikeId).eq('user_id', req.user.id).single();
  if (!bike) return res.status(404).json({ error: 'Bici no encontrada' });

  const threshold = await getThreshold(bike.type, component_type);
  const { error } = await supabase.from('bike_components').insert({
    bike_id: req.params.bikeId, component_type, name, brand, model,
    km_installed: 0, hours_installed: 0,
    km_remaining: threshold?.lifespan_km || 0, hours_remaining: threshold?.lifespan_hours || 0, notes
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Componente añadido' });
});

// POST /api/garage/:bikeId/components/:componentId/change
router.post('/:bikeId/components/:componentId/change', async (req, res) => {
  const { new_component_type, new_name, new_brand, new_model, new_notes, reason } = req.body;

  const { data: component } = await supabase.from('bike_components').select('*, bikes(type, user_id)').eq('id', req.params.componentId).single();
  if (!component || component.bikes?.user_id !== req.user.id) return res.status(404).json({ error: 'Componente no encontrado' });

  await supabase.from('component_history').insert({
    component_id: component.id,
    km_at_install: component.km_installed, hours_at_install: component.hours_installed,
    km_at_remove: component.km_installed + (component.km_remaining || 0),
    hours_at_remove: component.hours_installed + (component.hours_remaining || 0),
    reason, notes: component.notes
  });

  await supabase.from('bike_components').update({ is_active: false }).eq('id', component.id);

  const threshold = await getThreshold(component.bikes?.type, new_component_type || component.component_type);
  await supabase.from('bike_components').insert({
    bike_id: component.bike_id,
    component_type: new_component_type || component.component_type,
    name: new_name || component.name, brand: new_brand, model: new_model,
    km_installed: 0, hours_installed: 0,
    km_remaining: threshold?.lifespan_km || 0, hours_remaining: threshold?.lifespan_hours || 0,
    notes: new_notes
  });

  res.json({ message: 'Componente cambiado correctamente' });
});

// POST /api/garage/import-strava  — importa bicis desde gear_ids de actividades + /gear/{id}
router.post('/import-strava', async (req, res) => {
  const uid = req.user.id;

  const { data: user } = await supabase.from('users').select('strava_token, strava_refresh, strava_expires_at').eq('id', uid).single();
  if (!user?.strava_token) return res.status(400).json({ error: 'No tienes Strava conectado. Ve a Integraciones y conecta tu cuenta.' });

  let token = user.strava_token;

  // Refrescar token si ha expirado
  if (user.strava_refresh && user.strava_expires_at && Date.now() / 1000 > user.strava_expires_at - 300) {
    try {
      const re = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: user.strava_refresh }),
      });
      const d = await re.json();
      if (re.ok && d.access_token) {
        token = d.access_token;
        await supabase.from('users').update({ strava_token: d.access_token, strava_refresh: d.refresh_token, strava_expires_at: d.expires_at }).eq('id', uid);
      }
    } catch(e) { /* usar token existente */ }
  }

  function mapFrameType(ft) {
    if (ft === 1 || ft === 6) return 'mtb_hardtail';
    if (ft === 12)            return 'mtb_full';
    if (ft === 5)             return 'gravel';
    return 'road';
  }

  // 1. Intentar vía /athlete (requiere profile:read_all)
  let gearIds = new Set();
  try {
    const athleteRes = await fetch('https://www.strava.com/api/v3/athlete', { headers: { Authorization: `Bearer ${token}` } });
    if (athleteRes.ok) {
      const athlete = await athleteRes.json();
      (athlete.bikes || []).forEach(b => gearIds.add(b.id));
    }
  } catch(e) { /* continuar */ }

  // 2. Fallback: extraer gear_ids únicos de actividades ya sincronizadas en Supabase
  if (gearIds.size === 0) {
    const { data: acts } = await supabase.from('activities')
      .select('gear_id').eq('user_id', uid).not('gear_id', 'is', null);
    (acts || []).forEach(a => { if (a.gear_id) gearIds.add(a.gear_id); });
  }

  if (gearIds.size === 0) {
    return res.json({ imported: 0, updated: 0, bikes: [], message: 'No se encontraron bicis. Sincroniza actividades de Strava primero.' });
  }

  let imported = 0, updated = 0;
  const resultBikes = [];
  const errors = [];

  for (const gid of gearIds) {
    // Obtener detalles completos del gear desde Strava
    let details = { id: gid };
    try {
      const gearRes = await fetch(`https://www.strava.com/api/v3/gear/${gid}`, { headers: { Authorization: `Bearer ${token}` } });
      if (gearRes.ok) details = await gearRes.json();
    } catch(e) { /* usar id solo */ }

    const bikeType  = mapFrameType(details.frame_type);
    const totalKm   = Math.round((details.distance || 0) / 1000);
    const bikeName  = details.name || details.nickname || `Bici ${gid}`;
    const brandName = details.brand_name || null;
    const modelName = details.model_name || null;

    const { data: existing } = await supabase.from('bikes')
      .select('id').eq('user_id', uid).eq('strava_gear_id', String(gid)).maybeSingle();

    if (existing) {
      await supabase.from('bikes').update({ name: bikeName, brand: brandName, model: modelName, total_km: totalKm, updated_at: new Date().toISOString() }).eq('id', existing.id);
      updated++;
    } else {
      // Calcular total_hours de esta bici desde actividades ya sincronizadas
      let totalBikeHours = 0;
      const { data: bikeActs } = await supabase.from('activities')
        .select('duration').eq('user_id', uid).eq('gear_id', String(gid));
      totalBikeHours = Math.round(((bikeActs || []).reduce((s, a) => s + (a.duration || 0), 0) / 3600) * 10) / 10;

      const { data: newBike, error } = await supabase.from('bikes').insert({
        user_id: uid, name: bikeName, type: bikeType, brand: brandName, model: modelName,
        strava_gear_id: String(gid), total_km: totalKm, total_hours: totalBikeHours, is_active: true,
      }).select('id').single();
      if (error) {
        errors.push({ bike: bikeName, error: error.message, code: error.code });
      } else if (newBike) {
        await createDefaultComponents(newBike.id, bikeType, totalKm, totalBikeHours);
        imported++;
      }
    }

    resultBikes.push({ strava_gear_id: gid, type: bikeType, name: bikeName, brand: brandName, model: modelName, total_km: totalKm });
  }

  res.json({ imported, updated, bikes: resultBikes, errors, message: `${imported} bici(s) importada(s), ${updated} actualizada(s) de ${gearIds.size} detectada(s).` });
});

// POST /api/garage/sync-strava
router.post('/sync-strava', async (req, res) => {
  const { activity_km, gear_id } = req.body;
  if (!gear_id) return res.status(400).json({ error: 'Se requiere gear_id de Strava' });

  const { data: bike } = await supabase.from('bikes').select('*').eq('strava_gear_id', gear_id).eq('user_id', req.user.id).single();
  if (!bike) return res.status(404).json({ error: 'No se encontró bici con ese gear_id' });

  await supabase.from('bikes').update({ total_km: (bike.total_km || 0) + (activity_km || 0) }).eq('id', bike.id);

  const { data: components } = await supabase.from('bike_components').select('id, km_remaining').eq('bike_id', bike.id).eq('is_active', true);
  for (const c of components || []) {
    await supabase.from('bike_components').update({ km_remaining: (c.km_remaining || 0) - (activity_km || 0) }).eq('id', c.id);
  }
  res.json({ message: 'Kilómetros actualizados', bike_id: bike.id, km_added: activity_km });
});

// --- Helpers ---
async function getThreshold(discipline, componentType) {
  const map = { mtb_full: 'mtb', mtb_hardtail: 'mtb' };
  const d = map[discipline] || discipline;
  const { data } = await supabase.from('maintenance_thresholds').select('*').eq('discipline', d).eq('component_type', componentType).single();
  return data;
}

async function createDefaultComponents(bikeId, type, bikeTotalKm = 0, bikeTotalHours = 0) {
  const baseComps = [
    { type:'chain',          name:'Cadena'             },
    { type:'cassette',       name:'Cassette'            },
    { type:'chainring',      name:'Platos'              },
    { type:'jockey_wheels',  name:'Roldanas de Cambio'  },
    { type:'brakes_pad',     name:'Pastillas Delantera' },
    { type:'brakes_pad',     name:'Pastillas Trasera'   },
    { type:'brake_rotor',    name:'Disco Delantero'     },
    { type:'brake_rotor',    name:'Disco Trasero'       },
    { type:'tire_front',     name:'Cubierta Delantera'  },
    { type:'tire_rear',      name:'Cubierta Trasera'    },
  ];
  const defaults = {
    road:         baseComps,
    carretera:    baseComps,
    gravel:       baseComps,
    mtb_full:     [...baseComps, { type:'fork', name:'Horquilla' }, { type:'shock', name:'Amortiguador' }],
    mtb_hardtail: [...baseComps, { type:'fork', name:'Horquilla' }],
  };
  // Componentes medidos en horas (horquilla, amortiguador)
  const HOUR_BASED = new Set(['fork', 'shock']);
  // Vida útil por defecto según tipo (km o horas)
  const KM_DEFAULTS  = { chain:3000, cassette:9000, chainring:15000, jockey_wheels:15000, brakes_pad:3000, brake_rotor:10000, tire_front:5000, tire_rear:4000 };
  const HR_DEFAULTS  = { fork:200, shock:100 };

  const components = defaults[type] || defaults.road;

  for (const c of components) {
    const isHourBased = HOUR_BASED.has(c.type);
    await supabase.from('bike_components').insert({
      bike_id: bikeId, component_type: c.type, name: c.name,
      km_installed:    isHourBased ? null : bikeTotalKm,       // Odómetro km de la bici al instalar
      hours_installed: isHourBased ? bikeTotalHours : null,   // Odómetro horas de la bici al instalar
      km_remaining:    isHourBased ? 0    : (KM_DEFAULTS[c.type] || 3000),
      hours_remaining: isHourBased ? (HR_DEFAULTS[c.type] || 100) : 0,
    });
  }
}

module.exports = router;
