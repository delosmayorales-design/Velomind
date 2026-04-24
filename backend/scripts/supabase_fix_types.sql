-- ═══════════════════════════════════════════════════════════════
-- VeloMind — Fix tipos user_id (UUID → INTEGER)
-- Las tablas estaban vacías, se pueden recrear sin pérdida de datos
-- Ejecutar en Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Borrar tablas en orden (dependencias primero)
DROP TABLE IF EXISTS component_history  CASCADE;
DROP TABLE IF EXISTS bike_components    CASCADE;
DROP TABLE IF EXISTS maintenance_thresholds CASCADE;
DROP TABLE IF EXISTS bikes              CASCADE;
DROP TABLE IF EXISTS training_plans     CASCADE;
DROP TABLE IF EXISTS nutrition_plans    CASCADE;
DROP TABLE IF EXISTS biomechanics       CASCADE;
DROP TABLE IF EXISTS kit_designs        CASCADE;

-- 2. Recrear con user_id INTEGER (igual que users.id)

CREATE TABLE bikes (
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

CREATE TABLE bike_components (
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

CREATE TABLE component_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id     UUID REFERENCES bike_components(id) ON DELETE SET NULL,
  km_at_install    NUMERIC,
  hours_at_install NUMERIC,
  km_at_remove     NUMERIC,
  hours_at_remove  NUMERIC,
  reason           TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE maintenance_thresholds (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bike_type        TEXT NOT NULL,
  component_type   TEXT NOT NULL,
  lifespan_km      NUMERIC,
  lifespan_hours   NUMERIC,
  alert_yellow_pct INTEGER DEFAULT 70,
  alert_red_pct    INTEGER DEFAULT 90,
  UNIQUE(bike_type, component_type)
);

CREATE TABLE training_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start      DATE NOT NULL,
  sessions        JSONB NOT NULL DEFAULT '[]',
  phase           TEXT,
  tss_target      INTEGER,
  ftp_at_creation INTEGER,
  advice          JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, week_start)
);

CREATE TABLE nutrition_plans (
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

CREATE TABLE biomechanics (
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

CREATE TABLE kit_designs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT 'Mi Diseño',
  design     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Añadir columnas a users si faltan
ALTER TABLE users ADD COLUMN IF NOT EXISTS height NUMERIC;
