-- Tabla para tokens de recuperación de contraseña
-- Ejecutar en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para búsqueda rápida por token
CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens(token);

-- Índice para limpiar tokens viejos por usuario
CREATE INDEX IF NOT EXISTS idx_prt_user_id ON password_reset_tokens(user_id);
