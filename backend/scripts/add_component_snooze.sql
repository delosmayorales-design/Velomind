-- ═══════════════════════════════════════════════════════════════
-- VeloMind — Posponer revisión de componente ("revisar en +X km")
-- Ejecutar en Supabase → SQL Editor
-- Idempotente: usa IF NOT EXISTS, se puede correr más de una vez.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE bike_components
  ADD COLUMN IF NOT EXISTS snooze_until_km    numeric,
  ADD COLUMN IF NOT EXISTS snooze_until_hours numeric,
  ADD COLUMN IF NOT EXISTS snoozed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS snooze_note        text;

COMMENT ON COLUMN bike_components.snooze_until_km IS
  'Km de uso del componente (current_km) a partir del cual vuelve a alertar. NULL = sin posponer.';
COMMENT ON COLUMN bike_components.snooze_until_hours IS
  'Horas de uso del componente (current_hours) a partir de las cuales vuelve a alertar. NULL = sin posponer.';
