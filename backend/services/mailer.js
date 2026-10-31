// Envío de email centralizado. Usa Brevo si BREVO_API_KEY está configurada y, si no,
// SendGrid (el proveedor anterior, que se quedó sin créditos). Mismo formato de mensaje
// que @sendgrid/mail ({ from, to, subject, html, headers }) para no tocar las plantillas.
const sgMail = require('@sendgrid/mail');

const DEFAULT_FROM = {
  name: 'VeloMind',
  email: process.env.MAIL_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL || 'info@velomind.org',
};

if (!process.env.BREVO_API_KEY && process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const provider = () => (process.env.BREVO_API_KEY ? 'brevo' : process.env.SENDGRID_API_KEY ? 'sendgrid' : null);
const isConfigured = () => provider() !== null;

async function sendViaBrevo({ from, to, subject, html, headers }) {
  const sender = from || DEFAULT_FROM;
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: sender.name, email: sender.email },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      ...(headers ? { headers } : {}),
    }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    // Mismo contrato que SendGrid: e.code = status HTTP y el texto en e.message, para que
    // quien llama pueda detectar cupo agotado (429 / "limit" / "credits")
    throw Object.assign(new Error(`Brevo ${r.status}: ${body.message || body.code || 'error'}`), { code: r.status });
  }
}

async function send(msg) {
  const p = provider();
  if (!p) throw new Error('Email no configurado (falta BREVO_API_KEY)');
  const full = { ...msg, from: msg.from || DEFAULT_FROM };
  if (p === 'brevo') return sendViaBrevo(full);
  return sgMail.send(full);
}

module.exports = { send, isConfigured, provider, DEFAULT_FROM };
