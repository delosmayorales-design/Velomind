const supabase = require('../db'); // Ahora db es el cliente de Supabase

async function requirePremium(req, res, next) {
  const { data: user } = await supabase.from('users').select('subscription_tier').eq('id', req.user.id).single();
  if (user?.subscription_tier === 'premium') return next();
  return res.status(403).json({
    error: 'Función exclusiva Premium. Actualiza tu plan para acceder.',
    code: 'PREMIUM_REQUIRED',
    upgrade_url: '/app/pricing.html',
  });
}

module.exports = { requirePremium };
