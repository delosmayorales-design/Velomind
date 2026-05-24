-- Caps para corregir picos erróneos de potencia y pulso
ALTER TABLE activities ADD COLUMN IF NOT EXISTS power_cap INTEGER DEFAULT NULL;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS hr_cap    INTEGER DEFAULT NULL;
