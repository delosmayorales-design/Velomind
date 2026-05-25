-- Días de gimnasio por semana configurados por el atleta
ALTER TABLE users ADD COLUMN IF NOT EXISTS gym_days INTEGER DEFAULT 0;
