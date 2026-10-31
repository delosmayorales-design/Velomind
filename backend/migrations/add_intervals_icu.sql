-- Integración con intervals.icu (alternativa a Strava sin límite de atletas)
-- Ejecutar en Supabase SQL Editor
--
-- Cada usuario pega su propia API key (intervals.icu → Settings → Developer Settings),
-- así que no depende de ninguna aprobación ni cupo de la plataforma.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS intervals_api_key    TEXT,
  ADD COLUMN IF NOT EXISTS intervals_athlete_id TEXT;
