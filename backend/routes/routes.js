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
    const { name, type, geojson, distance_km, elevation_gain_m, estimated_minutes, notes } = req.body;
    if (!geojson) return res.status(400).json({ error: 'GeoJSON requerido' });

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
        notes: notes || null,
      })
      .select('*')
      .single();

    if (error) throw error;
    res.status(201).json(data);
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
