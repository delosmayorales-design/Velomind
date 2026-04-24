-- ═══════════════════════════════════════════════════════════════
-- VeloMind — Reset componentes con km_installed = 0 correcto
-- Ejecutar en Supabase → SQL Editor
-- SOLO afecta bike_components y component_history (no borra bicis)
-- ═══════════════════════════════════════════════════════════════

-- 1. Limpiar historial y componentes existentes
TRUNCATE component_history CASCADE;
TRUNCATE bike_components   CASCADE;

-- 2. Recrear componentes por defecto para cada bici
DO $$
DECLARE
  b RECORD;
  km_chain       NUMERIC := 3000;
  km_cassette    NUMERIC := 9000;
  km_chainring   NUMERIC := 15000;
  km_jockey      NUMERIC := 15000;
  km_brakes_pad  NUMERIC := 3000;
  km_brake_rotor NUMERIC := 10000;
  km_tire_front  NUMERIC := 5000;
  km_tire_rear   NUMERIC := 4000;
  hr_fork        NUMERIC := 200;
  hr_shock       NUMERIC := 100;
BEGIN
  FOR b IN SELECT id, type FROM bikes LOOP

    -- Componentes comunes a todas las bicis
    INSERT INTO bike_components (bike_id, component_type, name, km_installed, hours_installed, km_remaining, hours_remaining) VALUES
      (b.id, 'chain',         'Cadena',               0,    NULL, km_chain,       0),
      (b.id, 'cassette',      'Cassette',              0,    NULL, km_cassette,    0),
      (b.id, 'chainring',     'Platos',                0,    NULL, km_chainring,   0),
      (b.id, 'jockey_wheels', 'Roldanas de Cambio',    0,    NULL, km_jockey,      0),
      (b.id, 'brakes_pad',    'Pastillas Delantera',   0,    NULL, km_brakes_pad,  0),
      (b.id, 'brakes_pad',    'Pastillas Trasera',     0,    NULL, km_brakes_pad,  0),
      (b.id, 'brake_rotor',   'Disco Delantero',       0,    NULL, km_brake_rotor, 0),
      (b.id, 'brake_rotor',   'Disco Trasero',         0,    NULL, km_brake_rotor, 0),
      (b.id, 'tire_front',    'Cubierta Delantera',    0,    NULL, km_tire_front,  0),
      (b.id, 'tire_rear',     'Cubierta Trasera',      0,    NULL, km_tire_rear,   0);

    -- Horquilla para MTB hardtail y MTB doble suspensión
    IF b.type IN ('mtb_hardtail', 'mtb_full') THEN
      INSERT INTO bike_components (bike_id, component_type, name, km_installed, hours_installed, km_remaining, hours_remaining) VALUES
        (b.id, 'fork', 'Horquilla', NULL, 0, 0, hr_fork);
    END IF;

    -- Amortiguador solo para MTB doble suspensión
    IF b.type = 'mtb_full' THEN
      INSERT INTO bike_components (bike_id, component_type, name, km_installed, hours_installed, km_remaining, hours_remaining) VALUES
        (b.id, 'shock', 'Amortiguador', NULL, 0, 0, hr_shock);
    END IF;

  END LOOP;
END $$;

-- 3. Verificar resultado
SELECT b.name AS bici, b.type, COUNT(c.id) AS num_componentes
FROM bikes b
LEFT JOIN bike_components c ON c.bike_id = b.id
GROUP BY b.id, b.name, b.type
ORDER BY b.name;
