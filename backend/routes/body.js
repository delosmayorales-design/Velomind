const express = require('express');
const supabase = require('../db'); // Ahora db es el cliente de Supabase
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth);

router.get('/weight', async (req, res) => {
  const { limit=365 } = req.query;
  const { data: entries, error } = await supabase.from('weight_log')
    .select('*')
    .eq('user_id', req.user.id)
    .order('date', { ascending: false })
    .limit(parseInt(limit));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ entries: entries || [] });
});

router.post('/weight', async (req, res) => {
  const { date, weight, fat_pct, muscle_pct, note } = req.body;
  if (!date || !weight) return res.status(400).json({ error: 'date y weight requeridos' });
  if (weight < 30 || weight > 200) return res.status(400).json({ error: 'Peso inválido' });
  const { error: upsertError } = await supabase.from('weight_log').upsert({
    user_id: req.user.id, date, weight, fat_pct: fat_pct || null, muscle_pct: muscle_pct || null, note: note || ''
  }, { onConflict: ['user_id', 'date'] });
  if (upsertError) return res.status(500).json({ error: upsertError.message });
  await supabase.from('users').update({ weight, updated_at: new Date().toISOString() }).eq('id', req.user.id);
  res.status(201).json({ message: 'Peso guardado', date, weight });
});

router.delete('/weight/:date', async (req, res) => {
  await supabase.from('weight_log').delete().eq('user_id', req.user.id).eq('date', req.params.date);
  res.json({ message: 'Eliminado' });
});

module.exports = router;