const express = require('express');
const supabase = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth);

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

// GET /api/feedback — obtiene todos los comentarios públicos
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('feedback')
      .select('id, user_id, user_name, message, rating, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const isAdmin = req.user.email === ADMIN_EMAIL;
    res.json({ feedback: data, isAdmin });
  } catch (e) {
    console.error('[feedback/GET]', e.message);
    res.status(500).json({ error: 'Error al obtener feedback' });
  }
});

// POST /api/feedback — crea un nuevo comentario
router.post('/', async (req, res) => {
  try {
    const { message, rating } = req.body;
    if (!message || message.trim().length < 5)
      return res.status(400).json({ error: 'El comentario debe tener al menos 5 caracteres' });
    if (message.trim().length > 1000)
      return res.status(400).json({ error: 'El comentario no puede superar 1000 caracteres' });
    if (rating !== undefined && (rating < 1 || rating > 5))
      return res.status(400).json({ error: 'La valoración debe ser entre 1 y 5' });

    const { data, error } = await supabase.from('feedback').insert({
      user_id: req.user.id,
      user_name: req.user.name,
      message: message.trim(),
      rating: rating || null
    }).select().single();

    if (error) throw error;
    res.status(201).json({ feedback: data });
  } catch (e) {
    console.error('[feedback/POST]', e.message);
    res.status(500).json({ error: 'Error al guardar el comentario' });
  }
});

// DELETE /api/feedback/:id — admin elimina cualquier mensaje; usuario elimina el suyo
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const isAdmin = req.user.email === ADMIN_EMAIL;

    const { data: existing, error: fetchErr } = await supabase
      .from('feedback')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (fetchErr || !existing)
      return res.status(404).json({ error: 'Comentario no encontrado' });

    if (!isAdmin && existing.user_id !== req.user.id)
      return res.status(403).json({ error: 'No tienes permiso para eliminar este comentario' });

    const { error } = await supabase.from('feedback').delete().eq('id', id);
    if (error) throw error;
    res.json({ message: 'Comentario eliminado' });
  } catch (e) {
    console.error('[feedback/DELETE]', e.message);
    res.status(500).json({ error: 'Error al eliminar el comentario' });
  }
});

module.exports = router;
