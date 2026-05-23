const express    = require('express');
const supabase   = require('../db');
const { requireAuth } = require('../middleware/auth');
const router     = express.Router();

// ─── GET /api/group-rides
// Devuelve salidas públicas futuras + las del usuario (creadas o apuntado)
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Salidas públicas futuras
    const { data: rides, error } = await supabase
      .from('group_rides')
      .select(`
        id, title, description, departure_time, meeting_point,
        meeting_lat, meeting_lng, distance_km, elevation_gain_m,
        route_type, is_public, max_participants, created_at, route_id,
        creator_id,
        users!group_rides_creator_id_fkey(id, name, avatar_url),
        group_ride_participants(user_id, status)
      `)
      .eq('is_public', true)
      .gte('departure_time', new Date().toISOString())
      .order('departure_time', { ascending: true });

    if (error) throw error;

    // Añadir flags de participación del usuario actual
    const result = (rides || []).map(r => {
      const me = r.group_ride_participants?.find(p => p.user_id === userId && p.status === 'confirmed');
      return {
        ...r,
        participant_count: (r.group_ride_participants || []).filter(p => p.status === 'confirmed').length,
        is_joined:    !!me,
        is_mine:      r.creator_id === userId,
        creator_name: r.users?.name || 'Ciclista',
        creator_avatar: r.users?.avatar_url || null,
        group_ride_participants: undefined,
        users: undefined,
      };
    });

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/group-rides/mine
// Salidas creadas por el usuario + salidas a las que está apuntado
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Creadas por el usuario
    const { data: created, error: e1 } = await supabase
      .from('group_rides')
      .select(`
        id, title, description, departure_time, meeting_point,
        meeting_lat, meeting_lng, distance_km, elevation_gain_m,
        route_type, is_public, max_participants, created_at, route_id,
        creator_id,
        users!group_rides_creator_id_fkey(id, name, avatar_url),
        group_ride_participants(user_id, status)
      `)
      .eq('creator_id', userId)
      .gte('departure_time', new Date(Date.now() - 86400000).toISOString())
      .order('departure_time', { ascending: true });
    if (e1) throw e1;

    // Apuntado pero no creadas por él
    const { data: joined, error: e2 } = await supabase
      .from('group_ride_participants')
      .select(`
        ride_id,
        group_rides(
          id, title, description, departure_time, meeting_point,
          meeting_lat, meeting_lng, distance_km, elevation_gain_m,
          route_type, is_public, max_participants, created_at, route_id,
          creator_id,
          users!group_rides_creator_id_fkey(id, name, avatar_url),
          group_ride_participants(user_id, status)
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'confirmed')
      .gte('group_rides.departure_time', new Date(Date.now() - 86400000).toISOString());
    if (e2) throw e2;

    const format = (r, meJoined) => ({
      ...r,
      participant_count: (r.group_ride_participants || []).filter(p => p.status === 'confirmed').length,
      is_joined:    meJoined,
      is_mine:      r.creator_id === userId,
      creator_name: r.users?.name || 'Ciclista',
      creator_avatar: r.users?.avatar_url || null,
      group_ride_participants: undefined,
      users: undefined,
    });

    const createdIds = new Set((created || []).map(r => r.id));
    const joinedRides = (joined || [])
      .map(j => j.group_rides)
      .filter(r => r && !createdIds.has(r.id));

    const all = [
      ...(created || []).map(r => format(r, true)),
      ...joinedRides.map(r => format(r, true)),
    ].sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time));

    res.json(all);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/group-rides/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { data: ride, error } = await supabase
      .from('group_rides')
      .select(`
        id, title, description, departure_time, meeting_point,
        meeting_lat, meeting_lng, distance_km, elevation_gain_m,
        route_type, is_public, max_participants, created_at, route_id,
        creator_id,
        users!group_rides_creator_id_fkey(id, name, avatar_url),
        group_ride_participants(
          user_id, status, joined_at,
          users(id, name, avatar_url)
        )
      `)
      .eq('id', req.params.id)
      .single();

    if (error) return res.status(404).json({ error: 'Salida no encontrada' });

    const confirmed = (ride.group_ride_participants || []).filter(p => p.status === 'confirmed');
    const me = confirmed.find(p => p.user_id === userId);

    res.json({
      ...ride,
      participant_count: confirmed.length,
      is_joined: !!me,
      is_mine:   ride.creator_id === userId,
      creator_name:   ride.users?.name || 'Ciclista',
      creator_avatar: ride.users?.avatar_url || null,
      participants: confirmed.map(p => ({
        user_id: p.user_id,
        name:    p.users?.name || 'Ciclista',
        avatar:  p.users?.avatar_url || null,
        joined_at: p.joined_at,
      })),
      group_ride_participants: undefined,
      users: undefined,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/group-rides  (crear salida)
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      title, description, departure_time, meeting_point,
      meeting_lat, meeting_lng, distance_km, elevation_gain_m,
      route_type, is_public, max_participants, route_id,
    } = req.body;

    if (!title)          return res.status(400).json({ error: 'Título obligatorio' });
    if (!departure_time) return res.status(400).json({ error: 'Hora de salida obligatoria' });

    const { data, error } = await supabase
      .from('group_rides')
      .insert({
        creator_id:      req.user.id,
        title:           title.trim(),
        description:     description?.trim() || null,
        departure_time,
        meeting_point:   meeting_point?.trim() || null,
        meeting_lat:     meeting_lat   || null,
        meeting_lng:     meeting_lng   || null,
        distance_km:     distance_km   || null,
        elevation_gain_m: elevation_gain_m || null,
        route_type:      route_type    || 'road',
        is_public:       is_public !== false,
        max_participants: max_participants || null,
        route_id:        route_id      || null,
      })
      .select('*')
      .single();

    if (error) throw error;

    // Apuntar automáticamente al creador
    await supabase.from('group_ride_participants').insert({
      ride_id: data.id,
      user_id: req.user.id,
      status:  'confirmed',
    }).catch(() => {});

    res.status(201).json({ ...data, participant_count: 1, is_joined: true, is_mine: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/group-rides/:id/join  (apuntarse)
router.post('/:id/join', requireAuth, async (req, res) => {
  try {
    const { data: ride } = await supabase
      .from('group_rides')
      .select('id, max_participants')
      .eq('id', req.params.id)
      .single();
    if (!ride) return res.status(404).json({ error: 'Salida no encontrada' });

    if (ride.max_participants) {
      const { count } = await supabase
        .from('group_ride_participants')
        .select('*', { count: 'exact', head: true })
        .eq('ride_id', ride.id)
        .eq('status', 'confirmed');
      if (count >= ride.max_participants)
        return res.status(409).json({ error: 'Salida completa' });
    }

    const { error } = await supabase
      .from('group_ride_participants')
      .upsert({ ride_id: req.params.id, user_id: req.user.id, status: 'confirmed' }, { onConflict: 'ride_id,user_id' });

    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/group-rides/:id/join  (cancelar asistencia)
router.delete('/:id/join', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('group_ride_participants')
      .update({ status: 'cancelled' })
      .eq('ride_id', req.params.id)
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/group-rides/:id  (borrar, solo el creador)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('group_rides')
      .delete()
      .eq('id', req.params.id)
      .eq('creator_id', req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
