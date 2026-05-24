-- Añade CTL inicial para seed del cálculo PMC (cold-start fix)
ALTER TABLE users ADD COLUMN IF NOT EXISTS initial_ctl INTEGER DEFAULT 0;
