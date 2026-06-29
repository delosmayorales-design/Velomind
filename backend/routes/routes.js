const express  = require('express');
const supabase  = require('../db');
const { requireAuth } = require('../middleware/auth');
const router   = express.Router();

// GET /api/routes — listar rutas del usuario
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('routes')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/routes — guardar nueva ruta
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, type, geojson, distance_km, elevation_gain_m, estimated_minutes, notes,
            activity_date, avg_power, avg_hr, strava_activity_id } = req.body;
    if (!geojson) return res.status(400).json({ error: 'GeoJSON requerido' });
    // Validación básica de estructura GeoJSON
    if (typeof geojson !== 'object' || !geojson.type || !['FeatureCollection','Feature','LineString','MultiLineString'].includes(geojson.type))
      return res.status(400).json({ error: 'GeoJSON inválido: type debe ser FeatureCollection, Feature o LineString' });

    const { data, error } = await supabase
      .from('routes')
      .insert({
        user_id: req.user.id,
        name: name || 'Mi Ruta',
        type: type || 'road',
        geojson,
        distance_km:       distance_km       ? Math.round(distance_km * 10) / 10       : null,
        elevation_gain_m:  elevation_gain_m  ? Math.round(elevation_gain_m)             : null,
        estimated_minutes: estimated_minutes ? Math.round(estimated_minutes)             : null,
        notes:               notes               || null,
        activity_date:       activity_date       || null,
        avg_power:           avg_power           ? Math.round(avg_power)  : null,
        avg_hr:              avg_hr              ? Math.round(avg_hr)     : null,
        strava_activity_id:  strava_activity_id  || null,
      })
      .select('*')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/routes/:id — obtener ruta propia o adjunta a una salida grupal accesible
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const routeId = req.params.id;

    // 1. Intentar con ruta propia
    const { data: own } = await supabase
      .from('routes').select('*').eq('id', routeId).eq('user_id', userId).single();
    if (own) return res.json(own);

    // 2. Verificar que esté adjunta a una salida grupal que el usuario puede ver
    //    (pública o es participante confirmado)
    const { data: ride } = await supabase
      .from('group_rides')
      .select('id, is_public, group_ride_participants!inner(user_id, status)')
      .eq('route_id', routeId)
      .limit(1)
      .maybeSingle();

    const accessible = ride && (
      ride.is_public ||
      ride.group_ride_participants?.some(p => p.user_id === userId && p.status === 'confirmed')
    );
    if (!accessible) return res.status(403).json({ error: 'Sin acceso a esta ruta' });

    const { data: route, error } = await supabase
      .from('routes').select('*').eq('id', routeId).single();
    if (error || !route) return res.status(404).json({ error: 'Ruta no encontrada' });
    res.json(route);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/routes/:id — actualizar (nombre, favorito, notas)
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const allowed = ['name', 'type', 'is_favorite', 'notes'];
    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('routes')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select('*')
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/routes/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('routes')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
