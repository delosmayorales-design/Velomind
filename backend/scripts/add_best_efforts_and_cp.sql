-- ═══════════════════════════════════════════════════════════════
-- VeloMind — Curva de potencia real (best_efforts) + Potencia Crítica / W'
-- Ejecutar en Supabase → SQL Editor
-- Idempotente: usa IF NOT EXISTS, se puede correr más de una vez.
--
-- best_efforts ya se LEE en coach.js (power-curve) y analytics.js
-- (ftp-estimate) pero la columna nunca existió, así que ambos siempre
-- caían en la heurística de respaldo. critical_power/w_prime son la
-- base del modelo de Potencia Crítica (equivalente a lo que usa
-- GoldenCheetah), aditivos y opcionales — no sustituyen a users.ftp.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE activities ADD COLUMN IF NOT EXISTS best_efforts JSONB DEFAULT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS critical_power INTEGER     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS w_prime        INTEGER     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cp_updated_at  TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN activities.best_efforts IS
  'Mejores esfuerzos reales por duración, extraídos del stream de vatios de Strava: {"5":w,"10":w,"30":w,"60":w,"120":w,"300":w,"600":w,"1200":w,"1800":w,"3600":w}. NULL hasta que se recolecta (ver POST /providers/strava/sync).';
COMMENT ON COLUMN users.critical_power IS
  'Potencia Crítica (CP) en vatios, ajustada con el modelo hiperbólico de 2 parámetros sobre best_efforts reales. NULL si no hay datos suficientes.';
COMMENT ON COLUMN users.w_prime IS
  'W'' (capacidad de trabajo anaeróbico) en julios, del mismo ajuste que critical_power.';
