const express   = require('express');
const supabase  = require('../db');
const { requireAuth } = require('../middleware/auth');
const { generateWorkoutFIT, toAscii } = require('../fitWorkoutGenerator');
const PlanRecalculator = require('../services/planRecalculator');
const router    = express.Router();
router.use(requireAuth);

// ── Training Plan ───────────────────────────────────────────────

router.get('/training', async (req, res) => {
  const { data, error } = await supabase
    .from('training_plans')
    .select('*')
    .eq('user_id', req.user.id)
    .order('week_start', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || null);
});

router.post('/training', async (req, res) => {
  const { week_start, sessions, phase, tss_target, ftp_at_creation, advice, is_initial_generation } = req.body;
  if (!week_start || !sessions) return res.status(400).json({ error: 'week_start y sessions requeridos' });

  try {
    const { data, error } = await supabase
      .from('training_plans')
      .upsert({
        user_id: req.user.id,
        week_start,
        sessions,
        phase:            phase            || null,
        tss_target:       tss_target       || null,
        ftp_at_creation:  ftp_at_creation  || null,
        advice:           advice           || null,
        updated_at:       new Date().toISOString(),
      }, { onConflict: 'user_id,week_start' })
      .select('id')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // 📝 Si es generación inicial, guardar en histórico
    if (is_initial_generation) {
      try {
        const { data: athleteState } = await supabase
          .from('pmc')
          .select('ctl, atl, tsb')
          .eq('user_id', req.user.id)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle();

        const totalTSS = sessions.reduce((sum, s) => sum + (s.tss || 0), 0);

        await supabase
          .from('training_plans_history')
          .insert({
            user_id: req.user.id,
            week_start,
            phase: phase || null,
            tss_target_initial: tss_target,
            tss_target_recalc: tss_target,
            ftp_at_creation,
            sessions,
            reason: 'initial_generation',
            athlete_state: {
              ctl: athleteState?.ctl,
              atl: athleteState?.atl,
              tsb: athleteState?.tsb,
              actual_tss_week_so_far: 0,
            },
            adjustment_delta: {
              sessions_modified: 0,
              total_delta: 0,
              by_day: {},
            },
            advice,
          });

        // Guardar sesiones iniciales
        const historyId = (await supabase
          .from('training_plans_history')
          .select('id')
          .eq('user_id', req.user.id)
          .eq('week_start', week_start)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()).data?.id;

        if (historyId) {
          const sessionRows = sessions.map((sess, idx) => ({
            plan_history_id: historyId,
            user_id: req.user.id,
            week_start,
            day_of_week: idx,
            day_name: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][idx],
            session_index: idx,
            type: sess.type,
            name: sess.name,
            duration_min: sess.durationMin || 0,
            tss_planned: sess.tss || 0,
            if_target: sess.ifTarget,
            wattage_target: sess.wattage || 0,
            intervals: sess.intervals,
            description: sess.description,
          }));

          await supabase
            .from('training_sessions_initial')
            .insert(sessionRows)
            .catch(e => console.error('⚠️ Error guardando sesiones iniciales:', e.message));
        }
      } catch (histError) {
        console.error('⚠️ [Plans.POST] Error guardando histórico:', histError.message);
        // No fallar la respuesta si falla el histórico
      }
    }

    res.status(201).json({ message: 'Plan guardado', id: data.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Regenerar Plan (recalcular basado en cambios reales) ───────

router.post('/training/regenerate', async (req, res) => {
  const { week_start } = req.body;
  if (!week_start) return res.status(400).json({ error: 'week_start requerido' });

  try {
    // El recalculator ya maneja guardar histórico y recalcular. manual:true fuerza que
    // el clic del usuario en "Regenerar" siempre haga algo visible, sin depender de que
    // la desviación real supere el umbral pensado para la recalculación automática.
    const result = await PlanRecalculator.recalculateWeek(req.user.id, week_start, { manual: true });

    res.json({
      message: 'Plan regenerado',
      changed: result.changed,
      reason: result.reason,
      deltas: result.deltas,
      newSessions: result.newSessions || [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Obtener histórico de planes ───────────────────────────────

router.get('/training/history', async (req, res) => {
  const { week_start } = req.query;

  try {
    let query = supabase
      .from('training_plans_history')
      .select('id, week_start, phase, tss_target_initial, tss_target_recalc, reason, adaptation_reason, athlete_state, adjustment_delta, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (week_start) {
      query = query.eq('week_start', week_start);
    }

    const { data, error } = await query.limit(50);
    if (error) return res.status(500).json({ error: error.message });

    res.json({ history: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Obtener sesiones iniciales de un plan histórico ───────────

router.get('/training/history/:historyId/sessions', async (req, res) => {
  const { historyId } = req.params;

  try {
    const { data, error } = await supabase
      .from('training_sessions_initial')
      .select('*')
      .eq('plan_history_id', historyId)
      .order('session_index', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    res.json({ sessions: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Obtener adaptaciones realizadas ─────────────────────────────

router.get('/training/adaptations', async (req, res) => {
  const { week_start, limit = 20 } = req.query;

  try {
    let query = supabase
      .from('plan_adaptations')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (week_start) {
      query = query.eq('week_start', week_start);
    }

    const { data, error } = await query.limit(Math.min(parseInt(limit) || 20, 100));
    if (error) return res.status(500).json({ error: error.message });

    res.json({ adaptations: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Aprobar/Rechazar una adaptación ────────────────────────────

router.patch('/training/adaptations/:adaptationId', async (req, res) => {
  const { adaptationId } = req.params;
  const { approved } = req.body;

  if (approved === undefined) {
    return res.status(400).json({ error: 'approved (boolean) requerido' });
  }

  try {
    const { data, error } = await supabase
      .from('plan_adaptations')
      .update({
        approved_by_user: approved,
        updated_at: new Date().toISOString(),
      })
      .eq('id', adaptationId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ message: approved ? 'Adaptación aprobada' : 'Adaptación rechazada', adaptation: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Deshacer/Revertir una adaptación ────────────────────────

router.post('/training/adaptations/:adaptationId/revert', async (req, res) => {
  const { adaptationId } = req.params;
  const { week_start } = req.body;

  if (!week_start) {
    return res.status(400).json({ error: 'week_start requerido' });
  }

  try {
    const result = await PlanRecalculator.revertAdaptation(req.user.id, week_start, adaptationId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Reporte semanal de adaptaciones ────────────────────────────

router.get('/training/weekly-report', async (req, res) => {
  const { week_start } = req.query;

  try {
    // Obtener todas las adaptaciones de la semana
    let query = supabase
      .from('plan_adaptations')
      .select('*')
      .eq('user_id', req.user.id);

    if (week_start) {
      query = query.eq('week_start', week_start);
    }

    const { data: adaptations, error: adaptError } = await query.order('created_at', { ascending: true });
    if (adaptError) throw new Error(adaptError.message);

    // Obtener histórico de planes
    const { data: history, error: histError } = await supabase
      .from('training_plans_history')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('week_start', week_start || (new Date().toISOString().split('T')[0].split('-').slice(0,2).join('-') + '-01'))
      .order('created_at', { ascending: false })
      .limit(10);

    if (histError) throw new Error(histError.message);

    // Obtener actividades reales de la semana
    const weekStart = week_start || (() => {
      const d = new Date();
      d.setDate(d.getDate() - (d.getDay() || 7) + 1);
      return d.toISOString().split('T')[0];
    })();

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    const { data: activities, error: actError } = await supabase
      .from('activities')
      .select('date, tss, duration, name, type')
      .eq('user_id', req.user.id)
      .gte('date', weekStart)
      .lte('date', weekEndStr);

    if (actError) throw new Error(actError.message);

    // Compilar reporte
    const report = {
      week_start: weekStart,
      week_end: weekEndStr,
      adaptations_count: adaptations?.length || 0,
      adaptations,
      history_snapshots: history?.slice(0, 3) || [],
      total_activities: activities?.length || 0,
      total_tss: (activities || []).reduce((sum, a) => sum + (a.tss || 0), 0),
      total_hours: Math.round((activities || []).reduce((sum, a) => sum + (a.duration || 0), 0) / 3600) / 10,
      major_changes: (adaptations || []).filter(a => Math.abs(a.tss_total_before - a.tss_total_after) > 50),
      auto_generated_count: (adaptations || []).filter(a => a.auto_generated).length,
      approved_count: (adaptations || []).filter(a => a.approved_by_user === true).length,
      rejected_count: (adaptations || []).filter(a => a.approved_by_user === false).length,
    };

    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Nutrition Plan ─────────────────────────────────────────────

router.get('/nutrition', async (req, res) => {
  const { data, error } = await supabase
    .from('nutrition_plans')
    .select('*')
    .eq('user_id', req.user.id)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || null);
});

router.post('/nutrition', async (req, res) => {
  const { date, daily_calories, carbs_g, protein_g, fat_g, hydration_ml, pre_workout, during_workout, post_workout } = req.body;
  if (!date) return res.status(400).json({ error: 'date requerido' });

  const { data, error } = await supabase
    .from('nutrition_plans')
    .upsert({
      user_id:        req.user.id,
      date,
      daily_calories: daily_calories  || null,
      carbs_g:        carbs_g         || null,
      protein_g:      protein_g       || null,
      fat_g:          fat_g           || null,
      hydration_ml:   hydration_ml    || null,
      pre_workout:    pre_workout     || null,
      during_workout: during_workout  || null,
      post_workout:   post_workout    || null,
      updated_at:     new Date().toISOString(),
    }, { onConflict: 'user_id,date' })
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ message: 'Nutrición guardada', id: data.id });
});

// ── Biomechanics ───────────────────────────────────────────────

router.get('/biomechanics', async (req, res) => {
  const { data, error } = await supabase
    .from('biomechanics')
    .select('*')
    .eq('user_id', req.user.id)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || null);
});

router.post('/biomechanics', async (req, res) => {
  const { date, measurements, analysis_result, notes } = req.body;
  if (!measurements) return res.status(400).json({ error: 'measurements requerido' });

  const today = date || new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('biomechanics')
    .upsert({
      user_id:         req.user.id,
      date:            today,
      measurements,
      analysis_result: analysis_result || null,
      notes:           notes           || null,
      updated_at:      new Date().toISOString(),
    }, { onConflict: 'user_id,date' })
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ message: 'Biomecánica guardada', id: data.id });
});

// ── Biomechanics Snapshots ─────────────────────────────────────────────────

router.get('/biomechanics-snapshots', async (req, res) => {
  const { data, error } = await supabase
    .from('biomechanics_snapshots')
    .select('id, created_at, bike_name, discipline, objective, notes, angles, canvas_thumbnail')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ snapshots: data || [] });
});

router.post('/biomechanics-snapshot', async (req, res) => {
  const { bike_name, discipline, objective, notes, angles, keypoints, canvas_thumbnail } = req.body;
  if (!angles) return res.status(400).json({ error: 'angles requerido' });

  const { data, error } = await supabase
    .from('biomechanics_snapshots')
    .insert({
      user_id:          req.user.id,
      bike_name:        bike_name        || null,
      discipline:       discipline       || 'carretera',
      objective:        objective        || 'rendimiento',
      notes:            notes            || null,
      angles,
      keypoints:        keypoints        || {},
      canvas_thumbnail: canvas_thumbnail || null,
    })
    .select('id, created_at')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ ok: true, snapshot: data });
});

router.get('/biomechanics-snapshot/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('biomechanics_snapshots')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'Snapshot no encontrado' });
  res.json({ snapshot: data });
});

router.delete('/biomechanics-snapshot/:id', async (req, res) => {
  const { error } = await supabase
    .from('biomechanics_snapshots')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── FIT Export ────────────────────────────────────────────────────────────

router.post('/export-fit', async (req, res) => {
  const { name, steps } = req.body;

  if (!Array.isArray(steps) || steps.length === 0)
    return res.status(400).json({ error: 'steps requerido y no puede estar vacío' });

  // Sanear pasos recibidos del cliente
  const clean = steps.map(s => ({
    name:      String(s.name || 'Paso').slice(0, 30),
    sec:       Math.max(0, Math.round(Number(s.sec) || 0)),
    intensity: Number(s.intensity) || 0,
    lo:        Math.max(0, Math.round(Number(s.lo) || 0)),
    hi:        Math.max(0, Math.round(Number(s.hi) || 0)),
    open:      Boolean(s.open),
    isAlert:   Boolean(s.isAlert),
  }));

  try {
    const fitBuf  = generateWorkoutFIT(name || 'VeloMind', clean);
    const safeName = toAscii(name || 'VeloMind')
      .replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40) || 'workout';

    res.set({
      'Content-Type':        'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeName}.fit"`,
      'Content-Length':      fitBuf.length,
      'Cache-Control':       'no-store',
    });
    res.end(fitBuf);
  } catch (err) {
    console.error('[export-fit]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
