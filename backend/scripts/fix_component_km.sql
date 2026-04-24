-- ═══════════════════════════════════════════════════════════════
-- VeloMind — Recalcular km_installed desde actividades (idempotente)
-- Ejecutar en Supabase → SQL Editor
-- NO borra datos, solo corrige los km_installed / km_remaining
-- ═══════════════════════════════════════════════════════════════

-- 1. Ver estado actual (diagnóstico)
SELECT b.name, bc.name AS componente, bc.component_type,
       bc.km_installed, bc.km_remaining,
       bc.km_installed + bc.km_remaining AS lifespan_calculado
FROM bike_components bc
JOIN bikes b ON b.id = bc.bike_id
WHERE bc.is_active = true
ORDER BY b.name, bc.component_type;

-- 2. Recalcular km_installed y km_remaining para componentes de km
--    Lifespan = km_installed + km_remaining (se preserva, es constante)
UPDATE bike_components bc
SET
  km_installed = totals.total_km,
  km_remaining = GREATEST(0, (bc.km_installed + bc.km_remaining) - totals.total_km)
FROM (
  SELECT
    b.id AS bike_id,
    COALESCE(SUM(a.distance) / 1000.0, 0) AS total_km
  FROM bikes b
  LEFT JOIN activities a
    ON a.gear_id = b.strava_gear_id
    AND a.user_id = b.user_id
  GROUP BY b.id
) totals
WHERE bc.bike_id = totals.bike_id
  AND bc.is_active = true
  AND bc.component_type NOT IN ('fork', 'shock');  -- excluir basados en horas

-- 3. Recalcular hours_installed / hours_remaining para suspensiones MTB
--    Las horas se calculan como el tiempo total rodado con esa bici en Strava
UPDATE bike_components bc
SET
  hours_installed = totals.total_hours,
  hours_remaining = GREATEST(0, (bc.hours_installed + bc.hours_remaining) - totals.total_hours)
FROM (
  SELECT
    b.id AS bike_id,
    ROUND(COALESCE(SUM(a.duration) / 3600.0, 0)::numeric, 1) AS total_hours
  FROM bikes b
  LEFT JOIN activities a
    ON a.gear_id = b.strava_gear_id
    AND a.user_id = b.user_id
  WHERE b.type IN ('mtb_full', 'mtb_hardtail')
  GROUP BY b.id
) totals
WHERE bc.bike_id = totals.bike_id
  AND bc.is_active = true
  AND bc.component_type IN ('fork', 'shock');

-- 4. Actualizar total_km de las bicis
UPDATE bikes b
SET total_km = totals.total_km
FROM (
  SELECT
    b2.id,
    COALESCE(SUM(a.distance) / 1000.0, 0) AS total_km
  FROM bikes b2
  LEFT JOIN activities a
    ON a.gear_id = b2.strava_gear_id
    AND a.user_id = b2.user_id
  GROUP BY b2.id
) totals
WHERE b.id = totals.id;

-- 5. Verificar resultado final
SELECT b.name AS bici, bc.name AS componente,
       ROUND(bc.km_installed::numeric, 1) AS km_usados,
       ROUND(bc.km_remaining::numeric, 1) AS km_restantes,
       ROUND((bc.km_installed + bc.km_remaining)::numeric, 0) AS vida_total
FROM bike_components bc
JOIN bikes b ON b.id = bc.bike_id
WHERE bc.is_active = true AND bc.component_type NOT IN ('fork','shock')
ORDER BY b.name, bc.component_type;
