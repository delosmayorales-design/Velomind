const express = require('express');
const supabase = require('../db');
const { requireAuth } = require('../middleware/auth');
const { recalculatePMC } = require('../services/pmc');
const { calcIF, calcTSS, calcVI } = require('../utils/training');
const router = express.Router();

router.use(requireAuth);

module.exports = router;

// Listar
router.get('/', async (req, res) => {
  try {
    const uid = req.user.id;
    const { limit = 5000, from, to, source } = req.query;

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

    if (error) throw error;

    res.json({ activities: data || [], total: count || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Una actividad
router.get('/:id', async (req, res) => {
  const { data: act } = await supabase.from('activities').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
  if (!act) return res.status(404).json({ error: 'No encontrada' });
  res.json(act);
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
      ifValue = calcIF(a.np, ftp);
      tss     = calcTSS(a.np, a.duration, ftp);
    }
    if (a.np && a.avg_power > 0) vi = calcVI(a.np, a.avg_power);
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
    
    setImmediate(async () => {
      try {
        await recalculatePMC(uid);
      } catch(err) {
        console.error('⚠️ [Activities] Error recalculando PMC en background:', err.message);
      }
    });
    res.status(201).json({ message: 'Guardada', id, tss, if_value: ifValue });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Actualizar campos calculados y correcciones de picos de una actividad existente
router.patch('/:id', correctActivity);
router.post('/:id/update-np', correctActivity);
async function correctActivity(req, res) {
  try {
    const uid = req.user.id;
    const { id } = req.params;
    const { np, power_cap, hr_cap } = req.body;

    if (!np && power_cap === undefined && hr_cap === undefined)
      return res.status(400).json({ error: 'Se requiere al menos np, power_cap o hr_cap' });

    const { data: act } = await supabase.from('activities')
      .select('duration, avg_power, np')
      .eq('id', id).eq('user_id', uid).single();
    if (!act) return res.status(404).json({ error: 'No encontrada' });

    const updates = {};

    if (np && !isNaN(np)) {
      const { data: user } = await supabase.from('users').select('ftp').eq('id', uid).single();
      const ftp = Math.max(1, user?.ftp || 200);
      const npNum = Math.round(Number(np));
      updates.np       = npNum;
      updates.if_value = calcIF(npNum, ftp);
      updates.tss      = act.duration ? calcTSS(npNum, act.duration, ftp) : 0;
    }

    if (power_cap !== undefined)
      updates.power_cap = power_cap === null ? null : Math.max(1, Math.round(Number(power_cap)));
    if (hr_cap !== undefined)
      updates.hr_cap = hr_cap === null ? null : Math.max(1, Math.round(Number(hr_cap)));

    const { error } = await supabase.from('activities')
      .update(updates).eq('id', id).eq('user_id', uid);
    if (error) throw error;

    if (updates.tss !== undefined) {
      setImmediate(async () => {
        try { await recalculatePMC(uid); } catch {}
      });
    }

    res.json({ ...updates });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

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
        ifValue = calcIF(a.np, ftp);
        tss     = calcTSS(a.np, a.duration, ftp);
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

    setImmediate(async () => {
      try {
        await recalculatePMC(uid);
      } catch(err) {
        console.error('⚠️ [Activities Batch] Error recalculando PMC en background:', err.message);
      }
    });
    res.json({ message: `${rows.length} actividades guardadas`, saved: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Compatibilidad con clientes antiguos que llamaban DELETE /activities/all
router.delete('/all', async (req, res) => {
  try {
    const uid = req.user.id;
    const { count } = await supabase.from('activities').select('*', { count: 'exact', head: true }).eq('user_id', uid);
    const { error: err1 } = await supabase.from('activities').delete().eq('user_id', uid);
    if (err1) throw err1;
    const { error: err2 } = await supabase.from('pmc').delete().eq('user_id', uid);
    if (err2) throw err2;
    res.json({ message: `${count || 0} actividades eliminadas y mÃ©tricas reseteadas` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Eliminar una
router.delete('/:id', async (req, res) => {
  await supabase.from('activities').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  setImmediate(async () => {
    try {
      await recalculatePMC(req.user.id);
    } catch(err) {
      console.error('⚠️ [Activities Delete] Error recalculando PMC en background:', err.message);
    }
  });
  res.json({ message: 'Eliminada' });
});

// Eliminar todas (Vaciado completo del historial)
router.delete('/', async (req, res) => {
  try {
    const uid = req.user.id;
    const { count } = await supabase.from('activities').select('*', { count: 'exact', head: true }).eq('user_id', uid);
    
    const { error: err1 } = await supabase.from('activities').delete().eq('user_id', uid);
    if (err1) throw err1;
    
    // También limpiamos el PMC ya que no quedan datos para calcularlo
    const { error: err2 } = await supabase.from('pmc').delete().eq('user_id', uid);
    if (err2) throw err2;

    res.json({ message: `${count || 0} actividades eliminadas y métricas reseteadas` });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
