const express = require('express');
const supabase = require('../db'); // Ahora db es el cliente de Supabase
const { requireAuth } = require('../middleware/auth');
const { recalculatePMC } = require('../services/pmc');
const router = express.Router();
router.use(requireAuth);

// Listar
router.get('/', async (req, res) => {
  try {
    const uid = req.user.id;
    const { limit = 5000, from, to, source } = req.query;

    console.log('\n[GET /activities] 🔍 CONSULTANDO DATOS');
    console.log('👉 UID del usuario que pide:', uid);

    let query = supabase
      .from('activities')
      .select('*', { count: 'exact' })
      .eq('user_id', uid);

    if (from)   query = query.gte('date', from);
    if (to)     query = query.lte('date', to);
    if (source) query = query.eq('source', source);

    const max = Math.min(parseInt(limit) || 5000, 5000);
    const { data, error, count } = await query
      .order('date', { ascending: false })
      .range(0, max - 1);

    if (error) {
      console.error('[Activities] ERROR:', error);
      throw error;
    }
    console.log('👉 FILAS DEVUELTAS POR SUPABASE:', data?.length || 0);
    if (data?.length === 0) console.log('⚠️ ADVERTENCIA: Supabase devolvió 0 filas. Revisa que el user_id coincida y que las políticas RLS permitan leer.');

    res.json({ activities: data || [], total: count || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Una actividad
router.get('/:id', async (req, res) => {
  const { data: act } = await supabase.from('activities').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
  if (!act) return res.status(404).json({ error: 'No encontrada' });
  res.json(act);
});

// Borrar todas las actividades
router.delete('/all', async (req, res) => {
  try {
    const { error } = await supabase.from('activities').delete().eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ message: 'Todas las actividades eliminadas' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Crear/actualizar
router.post('/', async (req, res) => {
  try {
    const uid = req.user.id;
    const a = req.body;
    if (!a.date) return res.status(400).json({ error: 'date es obligatorio' });

    const isMeters = a.source !== 'Manual' && a.source !== 'CSV';
    const distanceMeters = isMeters ? (Number(a.distance) || 0) : (Number(a.distance) * 1000 || 0);

    const { data: user } = await supabase.from('users').select('ftp').eq('id', uid).single();
    const ftp = Math.max(1, user?.ftp || 200);
    let tss = Number(a.tss) || 0;
    let ifValue = Number(a.if_value) || 0;
    let vi = 0;
    if (!tss && a.np && a.duration && ftp > 0) {
      ifValue = Math.round((a.np / ftp) * 100) / 100;
      tss = Math.round((a.duration * a.np * ifValue) / (ftp * 3600) * 100);
    }
    if (a.np && a.avg_power > 0) vi = Math.round((a.np / a.avg_power) * 100) / 100;
    const id = a.id || `act_${uid}_${a.date}_${Date.now()}`;

    const { error } = await supabase.from('activities').upsert({
      id, user_id: uid, name: a.name || 'Actividad', date: a.date,
      source: a.source || 'Manual', type: a.type || 'cycling',
      duration: a.duration || 0, distance: distanceMeters, elevation: a.elevation || 0,
      avg_speed: a.avg_speed || 0, avg_power: a.avg_power || 0, max_power: a.max_power || 0,
      np: a.np || 0, tss, if_value: ifValue, vi,
      avg_hr: a.avg_hr || 0, max_hr: a.max_hr || 0, avg_cadence: a.avg_cadence || 0,
      calories: a.calories || 0, notes: a.notes || '',
      strava_id: a.strava_id || (id.startsWith('strava_') ? id.replace('strava_', '') : null), garmin_id: a.garmin_id || null, gear_id: a.gear_id || null,
    }, { onConflict: 'id' });
    if (error) throw error;

    if (a.gear_id) await updateGarageStats(uid, a.gear_id, distanceMeters, a.duration || 0, true);
    setImmediate(() => recalculatePMC(uid));
    res.status(201).json({ message: 'Guardada', id, tss, if_value: ifValue });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Batch save
router.post('/batch', async (req, res) => {
  try {
    const { activities } = req.body;
    if (!Array.isArray(activities)) return res.status(400).json({ error: 'Array requerido' });
    const uid = req.user.id;
    const { data: user } = await supabase.from('users').select('ftp').eq('id', uid).single();
    const ftp = Math.max(1, user?.ftp || 200);

    const rows = [];
    for (const a of activities) {
      if (!a.date) continue;
      const id = a.id || `act_${uid}_${a.date}_${Date.now()}_${rows.length}`;
      let tss = Number(a.tss) || 0, ifValue = 0;
      if (!tss && a.np && a.duration && ftp > 0) {
        ifValue = Math.round((a.np / ftp) * 100) / 100;
        tss = Math.round((a.duration * a.np * ifValue) / (ftp * 3600) * 100);
      }
      const distMeters = (a.source === 'Manual' || a.source === 'CSV') ? (Number(a.distance) * 1000) : (Number(a.distance) || 0);
      rows.push({
        id, user_id: uid, name: a.name || 'Actividad', date: a.date,
        source: a.source || 'Manual', type: a.type || 'cycling',
        duration: a.duration || 0, distance: distMeters, elevation: a.elevation || 0,
        avg_speed: a.avg_speed || 0, avg_power: a.avg_power || 0, np: a.np || 0,
        tss, if_value: ifValue, avg_hr: a.avg_hr || 0, max_hr: a.max_hr || 0,
        avg_cadence: a.avg_cadence || 0, calories: a.calories || 0, gear_id: a.gear_id || null,
        strava_id: a.strava_id || (id.startsWith('strava_') ? id.replace('strava_', '') : null)
      });
      if (a.gear_id) await updateGarageStats(uid, a.gear_id, distMeters, a.duration || 0, true);
    }

    if (rows.length) {
      const { error } = await supabase.from('activities').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }

    setImmediate(() => recalculatePMC(uid));
    res.json({ message: `${rows.length} actividades guardadas`, saved: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Eliminar una
router.delete('/:id', async (req, res) => {
  await supabase.from('activities').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  setImmediate(() => recalculatePMC(req.user.id));
  res.json({ message: 'Eliminada' });
});

// Eliminar todas
router.delete('/', async (req, res) => {
  const { count } = await supabase.from('activities').select('*', { count: 'exact', head: true }).eq('user_id', req.user.id);
  await supabase.from('activities').delete().eq('user_id', req.user.id);
  await supabase.from('pmc').delete().eq('user_id', req.user.id);
  res.json({ message: `${count || 0} actividades eliminadas` });
});

async function updateGarageStats(userId, gearId, distance, durationSeconds, isMeters = true) {
  if (!gearId || gearId === 'null' || gearId === 'undefined') return;
  const distKm = isMeters ? distance / 1000 : distance;
  const hours = durationSeconds / 3600;

  // Buscar primero por strava_gear_id, luego por id
  let { data: bike } = await supabase.from('bikes').select('id').eq('user_id', userId).eq('strava_gear_id', String(gearId)).maybeSingle();
  if (!bike) {
    const res2 = await supabase.from('bikes').select('id').eq('user_id', userId).eq('id', gearId).maybeSingle();
    bike = res2.data;
  }

  if (bike) {
    const { data: current } = await supabase.from('bikes').select('total_km').eq('id', bike.id).single();
    await supabase.from('bikes').update({ total_km: (current?.total_km || 0) + distKm }).eq('id', bike.id);

    const { data: components } = await supabase.from('bike_components').select('id, km_remaining, hours_remaining').eq('bike_id', bike.id).eq('is_active', true);
    for (const c of components || []) {
      await supabase.from('bike_components').update({
        km_remaining: (c.km_remaining || 0) - distKm,
        hours_remaining: (c.hours_remaining || 0) - hours,
      }).eq('id', c.id);
    }
  }
}

module.exports = router;
