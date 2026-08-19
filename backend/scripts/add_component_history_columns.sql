-- ═══════════════════════════════════════════════════════════════
-- VeloMind — Historial de componentes completo (bici, nombres, coste)
-- Ejecutar en Supabase → SQL Editor
-- Idempotente: usa IF NOT EXISTS, se puede correr más de una vez.
--
-- GET /api/garage devolvía siempre history:[] porque component_history
-- no guardaba bike_id (no se podía filtrar por bici sin un join frágil)
-- ni el nombre/coste que el frontend necesita para pintar la lista.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE component_history
  ADD COLUMN IF NOT EXISTS bike_id             UUID REFERENCES bikes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS component_type      TEXT,
  ADD COLUMN IF NOT EXISTS component_name      TEXT,
  ADD COLUMN IF NOT EXISTS new_component_name  TEXT,
  ADD COLUMN IF NOT EXISTS cost                NUMERIC;

CREATE INDEX IF NOT EXISTS idx_component_history_bike_id ON component_history(bike_id);

COMMENT ON COLUMN component_history.bike_id IS
  'Bici a la que pertenecía el componente reemplazado — evita depender de un join a bike_components (la fila del componente viejo puede desvincularse con ON DELETE SET NULL).';
COMMENT ON COLUMN component_history.cost IS
  'Coste opcional introducido por el usuario al registrar el cambio/relleno.';
