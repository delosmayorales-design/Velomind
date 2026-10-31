-- Tracking de uso para el panel de administración (/admin.html)
-- Ejecutar en Supabase SQL Editor
--
-- Hasta ahora la única señal de actividad era activities.date (cuándo entrenó el usuario),
-- que no dice si abre la app. Esto añade:
--   · users.last_seen_at  → última vez que abrió cualquier página de la app
--   · app_events          → una fila por página vista / llamada a IA, para medir qué funciones se usan

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS app_events (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event      TEXT NOT NULL,          -- 'page_view' | 'ai_call'
  page       TEXT,                   -- 'dashboard', 'training-plan', 'coach/ai-analysis'...
  platform   TEXT,                   -- 'web' | 'android'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_events_created   ON app_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_user_date ON app_events(user_id, created_at DESC);

-- Solo el backend (service role) lee/escribe esta tabla
ALTER TABLE app_events ENABLE ROW LEVEL SECURITY;
