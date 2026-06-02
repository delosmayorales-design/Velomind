const express    = require('express');
const webpush    = require('web-push');
const supabase   = require('../db');
const { requireAuth } = require('../middleware/auth');
const router     = express.Router();

// ── Push helper ───────────────────────────────────────────────────────────────
async function sendPushToUser(userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  try {
    webpush.setVapidDetails(
      `mailto:${process.env.VAPID_EMAIL || 'info@velomind.org'}`,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    const { data } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', String(userId))
      .eq('active', true)
      .single();
    if (!data) return;
    const sub = { endpoint: data.subscription.endpoint, keys: data.subscription.keys, expirationTime: data.subscription.expirationTime ?? null };
    await webpush.sendNotification(sub, JSON.stringify(payload));
  } catch (_) {}
}

// ── Selector reutilizable ─────────────────────────────────────────────────────
const RIDE_SELECT = `
  id, title, description, departure_time, meeting_point,
  meeting_lat, meeting_lng, distance_km, elevation_gain_m,
  route_type, is_public, max_participants, created_at, route_id,
  creator_id,
  users!group_rides_creator_id_fkey(id, name, avatar_url),
  group_ride_participants(user_id, status)
`;

function formatRide(r, userId) {
  const me = (r.group_ride_participants || []).find(p => p.user_id === userId && p.status === 'confirmed');
  return {
    ...r,
    participant_count: (r.group_ride_participants || []).filter(p => p.status === 'confirmed').length,
    is_joined:    !!me,
    is_mine:      r.creator_id === userId,
    creator_name:   r.users?.name   || 'Ciclista',
    creator_avatar: r.users?.avatar_url || null,
    group_ride_participants: undefined,
    users: undefined,
  };
}

// ─── GET /api/group-rides ──────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data: rides, error } = await supabase
      .from('group_rides')
      .select(RIDE_SELECT)
      .eq('is_public', true)
      .gte('departure_time', new Date().toISOString())
      .order('departure_time', { ascending: true });
    if (error) throw error;
    res.json((rides || []).map(r => formatRide(r, req.user.id)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/group-rides/mine ────────────────────────────────────────────────
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString(); // mostrar hasta 7 días después de finalizada

    const { data: created, error: e1 } = await supabase
      .from('group_rides')
      .select(RIDE_SELECT)
      .eq('creator_id', userId)
      .gte('departure_time', cutoff)
      .order('departure_time', { ascending: true });
    if (e1) throw e1;

    const { data: joined, error: e2 } = await supabase
      .from('group_ride_participants')
      .select(`ride_id, group_rides(${RIDE_SELECT})`)
      .eq('user_id', userId)
      .eq('status', 'confirmed')
      .gte('group_rides.departure_time', cutoff);
    if (e2) throw e2;

    const createdIds = new Set((created || []).map(r => r.id));
    const joinedRides = (joined || []).map(j => j.group_rides).filter(r => r && !createdIds.has(r.id));

    const all = [
      ...(created    || []).map(r => formatRide(r, userId)),
      ...joinedRides.map(r => formatRide(r, userId)),
    ].sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time));

    res.json(all);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/group-rides/users/search ────────────────────────────────────────
router.get('/users/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, avatar_url')
      .ilike('name', `%${q}%`)
      .neq('id', req.user.id)
      .limit(10);
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/group-rides/:id ─────────────────────────────────────────────────
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
        group_ride_participants(user_id, status, joined_at, users(id, name, avatar_url))
      `)
      .eq('id', req.params.id)
      .single();

    if (error) return res.status(404).json({ error: 'Salida no encontrada' });

    const confirmed = (ride.group_ride_participants || []).filter(p => p.status === 'confirmed');
    res.json({
      ...ride,
      participant_count: confirmed.length,
      is_joined: !!confirmed.find(p => p.user_id === userId),
      is_mine:   ride.creator_id === userId,
      creator_name:   ride.users?.name || 'Ciclista',
      creator_avatar: ride.users?.avatar_url || null,
      participants: confirmed.map(p => ({
        user_id:   p.user_id,
        name:      p.users?.name || 'Ciclista',
        avatar:    p.users?.avatar_url || null,
        joined_at: p.joined_at,
      })),
      group_ride_participants: undefined,
      users: undefined,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/group-rides ────────────────────────────────────────────────────
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
        creator_id:       req.user.id,
        title:            title.trim(),
        description:      description?.trim() || null,
        departure_time,
        meeting_point:    meeting_point?.trim() || null,
        meeting_lat:      meeting_lat      || null,
        meeting_lng:      meeting_lng      || null,
        distance_km:      distance_km      || null,
        elevation_gain_m: elevation_gain_m || null,
        route_type:       route_type       || 'road',
        is_public:        is_public !== false,
        max_participants: max_participants  || null,
        route_id:         route_id         || null,
      })
      .select('*')
      .single();

    if (error) throw error;

    try {
      await supabase.from('group_ride_participants').insert({
        ride_id: data.id,
        user_id: req.user.id,
        status:  'confirmed',
      });
    } catch (_) {}

    res.status(201).json({ ...data, participant_count: 1, is_joined: true, is_mine: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PATCH /api/group-rides/:id ───────────────────────────────────────────────
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const allowed = [
      'title','description','departure_time','meeting_point',
      'meeting_lat','meeting_lng','distance_km','elevation_gain_m',
      'route_type','is_public','max_participants',
    ];
    const updates = { updated_at: new Date().toISOString() };
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    if (updates.title) updates.title = updates.title.trim();
    if (updates.description) updates.description = updates.description.trim() || null;
    if (updates.meeting_point) updates.meeting_point = updates.meeting_point.trim() || null;

    const { data, error } = await supabase
      .from('group_rides')
      .update(updates)
      .eq('id', req.params.id)
      .eq('creator_id', req.user.id)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: 'No encontrado o sin permiso' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/group-rides/:id/join ──────────────────────────────────────────
router.post('/:id/join', requireAuth, async (req, res) => {
  try {
    const { data: ride } = await supabase
      .from('group_rides')
      .select('id, creator_id, title, max_participants')
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

    // Notificar al organizador (fire and forget)
    if (ride.creator_id !== req.user.id) {
      supabase.from('users').select('name').eq('id', req.user.id).single()
        .then(({ data: joiner }) => {
          sendPushToUser(ride.creator_id, {
            title: '🚴 Nueva inscripción',
            body:  `${joiner?.name || 'Alguien'} se ha apuntado a "${ride.title}"`,
            tag:   `join-${req.params.id}`,
            url:   '/cyclocoach/salidas-grupales.html',
          });
        });
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/group-rides/:id/join ────────────────────────────────────────
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

// ─── DELETE /api/group-rides/:id ─────────────────────────────────────────────
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

// ── Helper: verificar que el usuario es participante confirmado ───────────────
async function assertParticipant(rideId, userId) {
  // El creador siempre tiene acceso
  const { data: ride } = await supabase
    .from('group_rides')
    .select('creator_id')
    .eq('id', rideId)
    .single();
  if (ride?.creator_id === userId) return true;

  const { data } = await supabase
    .from('group_ride_participants')
    .select('status')
    .eq('ride_id', rideId)
    .eq('user_id', userId)
    .single();
  return data?.status === 'confirmed';
}

// ─── GET /api/group-rides/:id/comments ───────────────────────────────────────
router.get('/:id/comments', requireAuth, async (req, res) => {
  try {
    const ok = await assertParticipant(req.params.id, req.user.id);
    if (!ok) return res.status(403).json({ error: 'Solo los participantes pueden ver el chat' });

    const { data, error } = await supabase
      .from('group_ride_comments')
      .select('id, content, created_at, user_id, users(name, avatar_url)')
      .eq('ride_id', req.params.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json((data || []).map(c => ({
      id:         c.id,
      content:    c.content,
      created_at: c.created_at,
      user_id:    c.user_id,
      user_name:  c.users?.name || 'Ciclista',
      user_avatar: c.users?.avatar_url || null,
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/group-rides/:id/comments ──────────────────────────────────────
router.post('/:id/comments', requireAuth, async (req, res) => {
  try {
    const ok = await assertParticipant(req.params.id, req.user.id);
    if (!ok) return res.status(403).json({ error: 'Solo los participantes pueden comentar' });

    const content = req.body.content?.trim();
    if (!content) return res.status(400).json({ error: 'Contenido requerido' });

    const { data, error } = await supabase
      .from('group_ride_comments')
      .insert({ ride_id: req.params.id, user_id: req.user.id, content })
      .select('id, content, created_at, user_id, users(name, avatar_url)')
      .single();
    if (error) throw error;

    const response = {
      id:          data.id,
      content:     data.content,
      created_at:  data.created_at,
      user_id:     data.user_id,
      user_name:   data.users?.name || 'Ciclista',
      user_avatar: data.users?.avatar_url || null,
    };
    res.status(201).json(response);

    // Notificar a todos los participantes confirmados (excepto quien comentó)
    setImmediate(async () => {
      try {
        const { data: ride } = await supabase
          .from('group_rides')
          .select('title')
          .eq('id', req.params.id)
          .single();

        const { data: participants } = await supabase
          .from('group_ride_participants')
          .select('user_id')
          .eq('ride_id', req.params.id)
          .eq('status', 'confirmed')
          .neq('user_id', req.user.id);

        const authorName = response.user_name;
        const preview    = content.length > 60 ? content.substring(0, 60) + '…' : content;

        await Promise.allSettled(
          (participants || []).map(p =>
            sendPushToUser(p.user_id, {
              title: `💬 ${ride?.title || 'Salida grupal'}`,
              body:  `${authorName}: ${preview}`,
              tag:   `comment-${req.params.id}`,
              url:   '/cyclocoach/salidas-grupales.html',
            })
          )
        );
      } catch (_) {}
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/group-rides/:id/invitations ─────────────────────────────────────
router.get('/:id/invitations', requireAuth, async (req, res) => {
  try {
    const { data: ride } = await supabase
      .from('group_rides')
      .select('creator_id')
      .eq('id', req.params.id)
      .single();
    if (!ride || String(ride.creator_id) !== String(req.user.id))
      return res.status(403).json({ error: 'No autorizado' });

    const { data, error } = await supabase
      .from('group_ride_invitations')
      .select('invitee_id, created_at, users!group_ride_invitations_invitee_id_fkey(name, avatar_url)')
      .eq('ride_id', req.params.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json((data || []).map(i => ({
      user_id:     i.invitee_id,
      user_name:   i.users?.name,
      user_avatar: i.users?.avatar_url,
      invited_at:  i.created_at,
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/group-rides/:id/invite ─────────────────────────────────────────
router.post('/:id/invite', requireAuth, async (req, res) => {
  try {
    const { user_ids } = req.body;
    if (!Array.isArray(user_ids) || user_ids.length === 0)
      return res.status(400).json({ error: 'user_ids requerido' });

    const { data: ride } = await supabase
      .from('group_rides')
      .select('id, title, departure_time, creator_id')
      .eq('id', req.params.id)
      .single();
    if (!ride) return res.status(404).json({ error: 'Salida no encontrada' });
    if (String(ride.creator_id) !== String(req.user.id))
      return res.status(403).json({ error: 'No autorizado' });

    const { data: inviter } = await supabase
      .from('users')
      .select('name')
      .eq('id', req.user.id)
      .single();
    const inviterName = inviter?.name || 'Alguien';

    await supabase
      .from('group_ride_invitations')
      .upsert(
        user_ids.map(uid => ({ ride_id: req.params.id, inviter_id: req.user.id, invitee_id: uid })),
        { onConflict: 'ride_id,invitee_id', ignoreDuplicates: true }
      );

    const dt      = new Date(ride.departure_time ?? '');
    const dateStr = isNaN(dt) ? '' : dt.toLocaleDateString('es-ES', { weekday:'short', day:'numeric', month:'short' });

    await Promise.allSettled(
      user_ids.map(uid =>
        sendPushToUser(uid, {
          title: `🚴 ${inviterName} te ha invitado`,
          body:  `${ride.title}${dateStr ? ' · ' + dateStr : ''}`,
          tag:   `invite-${req.params.id}`,
          url:   '/cyclocoach/salidas-grupales.html',
        })
      )
    );

    res.json({ ok: true, invited: user_ids.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
