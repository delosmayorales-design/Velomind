-- Días de "otro" entrenamiento complementario por semana configurados por el atleta
ALTER TABLE users ADD COLUMN IF NOT EXISTS other_days INTEGER DEFAULT 0;
