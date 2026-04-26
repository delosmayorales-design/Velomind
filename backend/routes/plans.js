const express   = require('express');
const supabase  = require('../db');
const { requireAuth } = require('../middleware/auth');
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
  const { week_start, sessions, phase, tss_target, ftp_at_creation, advice } = req.body;
  if (!week_start || !sessions) return res.status(400).json({ error: 'week_start y sessions requeridos' });

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
  res.status(201).json({ message: 'Plan guardado', id: data.id });
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

module.exports = router;
