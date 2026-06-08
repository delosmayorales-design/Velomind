-- Días de running y caminata por semana configurados por el atleta
ALTER TABLE users ADD COLUMN IF NOT EXISTS running_days INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS walking_days INTEGER DEFAULT 0;
