const supabase = require('../db'); // Ahora db es el cliente de Supabase

// El cobro con Stripe todavía no está activado (se activará cuando haya volumen de
// usuarios que lo justifique) — hasta entonces PREMIUM_ENFORCEMENT no está definida
// y este middleware deja pasar a todo el mundo sin tocar nada. El día que se active,
// basta con poner PREMIUM_ENFORCEMENT=true para que empiece a bloquear de verdad.
const ENFORCED = process.env.PREMIUM_ENFORCEMENT === 'true';

async function requirePremium(req, res, next) {
  if (!ENFORCED) return next();

  const { data: user } = await supabase.from('users').select('subscription_tier').eq('id', req.user.id).single();
  // 'past_due' = periodo de gracia mientras Stripe reintenta un cobro fallido —
  // mantiene el acceso, no corta de golpe (ver handleWebhook en payments.js).
  if (user?.subscription_tier === 'premium' || user?.subscription_tier === 'past_due') return next();
  return res.status(403).json({
    error: 'Función exclusiva Premium. Actualiza tu plan para acceder.',
    code: 'PREMIUM_REQUIRED',
    upgrade_url: '/app/pricing.html',
  });
}

module.exports = { requirePremium };
