-- Corrige los avisos de Supabase Security Advisor sobre email_verification_tokens:
--   - "RLS Disabled in Public"
--   - "Sensitive Columns Exposed"
-- El backend accede a esta tabla con la service_role key (ver backend/db.js), que
-- ignora RLS, así que activarla no afecta al backend. Sin políticas permisivas,
-- ningún cliente que use la clave anon/pública puede leer ni escribir la tabla.
-- Ejecutar en Supabase SQL Editor.

ALTER TABLE email_verification_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON email_verification_tokens FROM anon, authenticated;
