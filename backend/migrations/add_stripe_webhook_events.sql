-- Idempotencia de webhooks de Stripe: Stripe puede reenviar el mismo evento
-- (reintentos de red, timeouts) y sin esto se re-aplicaría el cambio dos veces.
-- Ejecutar en Supabase SQL Editor. No activo todavía (Stripe no está instalado
-- ni configurado) pero deja la tabla lista para cuando se active el cobro.

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id    TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ DEFAULT NOW()
);
