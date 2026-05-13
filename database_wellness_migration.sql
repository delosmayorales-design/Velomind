-- ══════════════════════════════════════════════════════════════
-- VeloMind · Migración: Salud y Bienestar
-- Ejecutar en Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- 1. Tabla wellness_log
CREATE TABLE IF NOT EXISTS wellness_log (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  source           TEXT NOT NULL,          -- 'garmin' | 'fitbit'
  sleep_seconds    INTEGER,                -- segundos totales de sueño
  sleep_score      INTEGER,                -- puntuación 0-100 (Garmin)
  deep_sleep_seconds INTEGER,
  rem_sleep_seconds  INTEGER,
  hrv_weekly_avg   INTEGER,                -- ms (Garmin weekly avg)
  hrv_last_night   INTEGER,                -- ms (Garmin last night / Fitbit RMSSD)
  resting_hr       INTEGER,                -- lpm
  stress_avg       INTEGER,                -- 0-100 (Garmin)
  body_battery_high INTEGER,               -- 0-100 (Garmin)
  body_battery_low  INTEGER,               -- 0-100 (Garmin)
  spo2_avg         NUMERIC(5,2),           -- % SpO2
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date, source)
);

CREATE INDEX IF NOT EXISTS idx_wellness_user_date ON wellness_log(user_id, date DESC);

-- 2. Columnas Fitbit en tabla users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS fitbit_token      TEXT,
  ADD COLUMN IF NOT EXISTS fitbit_refresh    TEXT,
  ADD COLUMN IF NOT EXISTS fitbit_expires_at BIGINT,
  ADD COLUMN IF NOT EXISTS fitbit_user_id    TEXT;

-- 3. RLS (misma política que el resto de tablas)
ALTER TABLE wellness_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can manage own wellness"
  ON wellness_log FOR ALL
  USING (auth.uid()::text = user_id::text);
