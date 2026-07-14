-- ═══════════════════════════════════════════════════════════════
-- Restaurar componentes por defecto después de TRUNCATE
-- Ejecutar en Supabase → SQL Editor
-- Esto recreará los componentes para todas las bicis existentes
-- ═══════════════════════════════════════════════════════════════

-- Función para crear componentes por defecto para una bici
CREATE OR REPLACE FUNCTION create_default_components_for_bike(
  bike_uuid UUID,
  bike_type TEXT,
  bike_total_km NUMERIC DEFAULT 0
) RETURNS VOID AS $$
BEGIN
  -- Componentes básicos (todos los tipos de bici)
  INSERT INTO bike_components (bike_id, component_type, name, km_installed, km_remaining, hours_installed, hours_remaining) VALUES
  (bike_uuid, 'chain', 'Cadena', bike_total_km, 3000, 0, 0),
  (bike_uuid, 'cassette', 'Cassette', bike_total_km, 9000, 0, 0),
  (bike_uuid, 'chainring', 'Platos', bike_total_km, 15000, 0, 0),
  (bike_uuid, 'jockey_wheels', 'Roldanas de Cambio', bike_total_km, 15000, 0, 0),
  (bike_uuid, 'brakes_pad', 'Pastillas Delantera', bike_total_km, 3000, 0, 0),
  (bike_uuid, 'brakes_pad', 'Pastillas Trasera', bike_total_km, 3000, 0, 0),
  (bike_uuid, 'brake_rotor', 'Disco Delantero', bike_total_km, 10000, 0, 0),
  (bike_uuid, 'brake_rotor', 'Disco Trasero', bike_total_km, 10000, 0, 0),
  (bike_uuid, 'tire_front', 'Cubierta Delantera', bike_total_km, 5000, 0, 0),
  (bike_uuid, 'tire_rear', 'Cubierta Trasera', bike_total_km, 4000, 0, 0);

  -- Componentes adicionales para MTB
  IF bike_type IN ('mtb_full', 'mtb_hardtail') THEN
    INSERT INTO bike_components (bike_id, component_type, name, km_installed, km_remaining, hours_installed, hours_remaining) VALUES
    (bike_uuid, 'fork', 'Horquilla', NULL, 0, 0, 200);
  END IF;

  IF bike_type = 'mtb_full' THEN
    INSERT INTO bike_components (bike_id, component_type, name, km_installed, km_remaining, hours_installed, hours_remaining) VALUES
    (bike_uuid, 'shock', 'Amortiguador', NULL, 0, 0, 100);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Restaurar componentes para todas las bicis existentes
SELECT create_default_components_for_bike(id, type, total_km)
FROM bikes
WHERE is_active = true;

-- Limpiar la función temporal
DROP FUNCTION IF EXISTS create_default_components_for_bike(UUID, TEXT, NUMERIC);