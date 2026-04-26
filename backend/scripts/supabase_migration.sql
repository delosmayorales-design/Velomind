-- ═══════════════════════════════════════════════════════════════
-- VeloMind — Migración de tablas de persistencia
-- Ejecutar en Supabase → SQL Editor
-- NOTA: users.id es INTEGER (no UUID)
-- ═══════════════════════════════════════════════════════════════

-- Planes de entrenamiento semanales
CREATE TABLE IF NOT EXISTS training_plans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start   DATE NOT NULL,
  sessions     JSONB NOT NULL DEFAULT '[]',
  phase        TEXT,
  tss_target   INTEGER,
  ftp_at_creation INTEGER,
  advice       JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, week_start)
);

-- Planes de nutrición diarios
CREATE TABLE IF NOT EXISTS nutrition_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  daily_calories  INTEGER,
  carbs_g         NUMERIC,
  protein_g       NUMERIC,
  fat_g           NUMERIC,
  hydration_ml    INTEGER,
  pre_workout     JSONB,
  during_workout  JSONB,
  post_workout    JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- Medidas biomecánicas
CREATE TABLE IF NOT EXISTS biomechanics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  measurements    JSONB,
  analysis_result JSONB,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- Diseños de equipación
CREATE TABLE IF NOT EXISTS kit_designs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT 'Mi Diseño',
  design     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Asegurar que users tiene la columna height
ALTER TABLE users ADD COLUMN IF NOT EXISTS height NUMERIC;

-- Asegurar columnas necesarias en bikes
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS total_km    NUMERIC  DEFAULT 0;
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS is_active   BOOLEAN  DEFAULT true;
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS strava_gear_id TEXT;
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS brand       TEXT;
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS model       TEXT;
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS year        INTEGER;
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS photo_url   TEXT;
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS notes       TEXT;
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT NOW();

-- Si la tabla bikes no existe, crearla completa
CREATE TABLE IF NOT EXISTS bikes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'road',
  brand          TEXT,
  model          TEXT,
  year           INTEGER,
  strava_gear_id TEXT,
  total_km       NUMERIC DEFAULT 0,
  is_active      BOOLEAN DEFAULT true,
  photo_url      TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bike_components (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bike_id         UUID NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
  component_type  TEXT NOT NULL,
  name            TEXT,
  brand           TEXT,
  model           TEXT,
  km_installed    NUMERIC DEFAULT 0,
  hours_installed NUMERIC DEFAULT 0,
  km_remaining    NUMERIC DEFAULT 0,
  hours_remaining NUMERIC DEFAULT 0,
  is_active       BOOLEAN DEFAULT true,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS component_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id    UUID REFERENCES bike_components(id) ON DELETE SET NULL,
  km_at_install   NUMERIC,
  hours_at_install NUMERIC,
  km_at_remove    NUMERIC,
  hours_at_remove NUMERIC,
  reason          TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS maintenance_thresholds (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bike_type      TEXT NOT NULL,
  component_type TEXT NOT NULL,
  lifespan_km    NUMERIC,
  lifespan_hours NUMERIC,
  alert_yellow_pct INTEGER DEFAULT 70,
  alert_red_pct    INTEGER DEFAULT 90,
  UNIQUE(bike_type, component_type)
);

-- Foto de perfil del atleta
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
