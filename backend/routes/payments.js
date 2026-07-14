const express = require('express');
const supabase = require('../db'); // Ahora db es el cliente de Supabase
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

function getStripe() {
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

const PLANS = {
  monthly: process.env.STRIPE_PRICE_MONTHLY,
  yearly:  process.env.STRIPE_PRICE_YEARLY,
};

// POST /api/payments/create-checkout
router.post('/create-checkout', requireAuth, async (req, res) => {
  try {
    const stripe = getStripe();
    const { plan = 'monthly' } = req.body;
    const priceId = PLANS[plan];
    if (!priceId) return res.status(400).json({ error: 'Plan no válido' });
    
    const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    let customerId = user.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name || user.email,
        metadata: { user_id: String(user.id) },
      });
      customerId = customer.id;
      await supabase.from('users').update({ stripe_customer_id: customerId }).eq('id', user.id);
    }

    const appUrl = process.env.APP_URL || 'http://localhost:8085';
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${appUrl}/app/dashboard.html?premium=1`,
      cancel_url:  `${appUrl}/app/pricing.html?canceled=1`,
      metadata: { user_id: String(user.id) },
      allow_promotion_codes: true,
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error('[payments/checkout]', e.message);
    res.status(500).json({ error: 'No se pudo iniciar el pago. Inténtalo de nuevo.' });
  }
});

// POST /api/payments/portal
router.post('/portal', requireAuth, async (req, res) => {
  try {
    const stripe = getStripe();
    const { data: user } = await supabase.from('users').select('stripe_customer_id').eq('id', req.user.id).single();
    if (!user?.stripe_customer_id)
      return res.status(400).json({ error: 'No tienes suscripción activa' });

    const appUrl = process.env.APP_URL || 'http://localhost:8085';
    const { url } = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${appUrl}/app/dashboard.html`,
    });
    res.json({ url });
  } catch (e) {
    console.error('[payments/portal]', e.message);
    res.status(500).json({ error: 'No se pudo abrir el portal de facturación. Inténtalo de nuevo.' });
  }
});

// GET /api/payments/status
router.get('/status', requireAuth, async (req, res) => {
  const { data: user } = await supabase.from('users')
    .select('subscription_tier, stripe_subscription_id')
    .eq('id', req.user.id)
    .single();
  const tier = user?.subscription_tier || 'free';
  res.json({
    tier,
    isPremium: tier === 'premium',
    hasSubscription: !!user?.stripe_subscription_id,
  });
});

// POST /api/payments/webhook  (raw body — montada con express.raw() antes de express.json() en server.js)
async function handleWebhook(req, res) {
  const stripe = getStripe();
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    console.error('[webhook] signature error:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  // Idempotencia: Stripe puede reenviar el mismo evento (reintentos de red, etc.).
  // Si ya lo procesamos, respondemos ok sin volver a aplicar el cambio.
  const { error: dupError } = await supabase.from('stripe_webhook_events').insert({ event_id: event.id });
  if (dupError) {
    console.log('[webhook] evento ya procesado, se ignora:', event.id);
    return res.json({ received: true, duplicate: true });
  }

  const obj = event.data.object;

  if (event.type === 'checkout.session.completed') {
    const userId = obj.metadata?.user_id;
    if (userId) {
      await supabase.from('users').update({ subscription_tier: 'premium', stripe_subscription_id: obj.subscription }).eq('id', userId);
      console.log('[webhook] premium activado usuario:', userId);
    }
  }

  if (event.type === 'customer.subscription.updated') {
    const status = obj.status;
    if (['active', 'trialing'].includes(status)) {
      await supabase.from('users').update({ subscription_tier: 'premium' }).eq('stripe_customer_id', obj.customer);
    } else if (status === 'past_due' || status === 'unpaid') {
      // Periodo de gracia: Stripe todavía está reintentando el cobro (dunning). No cortamos
      // el acceso de golpe — requirePremium también acepta 'past_due' mientras dura.
      await supabase.from('users').update({ subscription_tier: 'past_due' }).eq('stripe_customer_id', obj.customer);
      console.log('[webhook] pago pendiente, periodo de gracia customer:', obj.customer);
    } else {
      await supabase.from('users').update({ subscription_tier: 'free' }).eq('stripe_customer_id', obj.customer);
    }
  }

  if (event.type === 'invoice.payment_failed') {
    // Aquí es donde, cuando se active el cobro, se debería enviar un email de aviso
    // de pago fallido (dunning) — de momento solo se deja constancia en el log.
    console.log('[webhook] pago fallido customer:', obj.customer);
  }

  if (
    event.type === 'customer.subscription.deleted' ||
    event.type === 'customer.subscription.paused'
  ) {
    await supabase.from('users').update({ subscription_tier: 'free', stripe_subscription_id: null }).eq('stripe_customer_id', obj.customer);
    console.log('[webhook] premium cancelado customer:', obj.customer);
  }

  res.json({ received: true });
}

module.exports = router;
module.exports.handleWebhook = handleWebhook;
