-- Avisos a usuarios desde el panel de admin (email + push)
-- Ejecutar en Supabase SQL Editor

-- Baja de los avisos (los emails de cuenta — verificación, contraseña — se siguen enviando)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS broadcast_opt_out BOOLEAN NOT NULL DEFAULT FALSE;

-- Historial de envíos
CREATE TABLE IF NOT EXISTS broadcasts (
  id           BIGSERIAL PRIMARY KEY,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  cta_label    TEXT,
  cta_path     TEXT,
  channels     TEXT[] NOT NULL,         -- {'email','push'}
  segment      TEXT NOT NULL,
  recipients   INTEGER NOT NULL DEFAULT 0,
  email_sent   INTEGER NOT NULL DEFAULT 0,
  email_failed INTEGER NOT NULL DEFAULT 0,
  push_sent    INTEGER NOT NULL DEFAULT 0,
  push_failed  INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'sending',   -- 'sending' | 'done' | 'partial' | 'error'
  error        TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  finished_at  TIMESTAMPTZ
);

ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
