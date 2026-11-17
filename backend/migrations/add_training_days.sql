-- Días concretos de bici elegidos por el atleta (0=Lunes..6=Domingo) y día de la salida larga.
-- training_days NULL = el plan reparte los días automáticamente (comportamiento anterior).
ALTER TABLE users ADD COLUMN IF NOT EXISTS training_days JSONB DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS long_ride_day SMALLINT DEFAULT NULL;
