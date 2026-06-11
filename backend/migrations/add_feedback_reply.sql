-- Añade soporte de respuestas del Equipo VeloMind a los comentarios de feedback
-- Ejecutar en Supabase SQL Editor

ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS reply     TEXT,
  ADD COLUMN IF NOT EXISTS reply_at  TIMESTAMPTZ;
