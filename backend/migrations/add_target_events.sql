-- Añade columna target_events a la tabla users
-- Almacena un array JSON de eventos/carreras objetivo con prioridad A/B/C
-- Ejecutar en Supabase: Dashboard → SQL Editor

ALTER TABLE users ADD COLUMN IF NOT EXISTS target_events TEXT;
