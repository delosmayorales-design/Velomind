// El mailer elige proveedor al llamar a send(): Brevo si hay BREVO_API_KEY, si no SendGrid.
const mockSgSend = jest.fn();
jest.mock('@sendgrid/mail', () => ({ setApiKey: jest.fn(), send: (...a) => mockSgSend(...a) }));

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; jest.resetModules(); mockSgSend.mockReset(); });

test('con BREVO_API_KEY envía por la API de Brevo con el remitente por defecto', async () => {
  process.env.BREVO_API_KEY = 'xkeysib-test';
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ messageId: '1' }) });
  const mailer = require('../../services/mailer');

  await mailer.send({ to: 'ana@x.com', subject: 'Hola', html: '<p>Hola</p>', headers: { 'List-Unsubscribe': '<https://x>' } });

  expect(mailer.provider()).toBe('brevo');
  const [url, opts] = global.fetch.mock.calls[0];
  expect(url).toBe('https://api.brevo.com/v3/smtp/email');
  expect(opts.headers['api-key']).toBe('xkeysib-test');
  expect(JSON.parse(opts.body)).toMatchObject({
    sender: { name: 'VeloMind' }, to: [{ email: 'ana@x.com' }], subject: 'Hola', htmlContent: '<p>Hola</p>',
    headers: { 'List-Unsubscribe': '<https://x>' },
  });
  expect(mockSgSend).not.toHaveBeenCalled();
});

test('un error de Brevo lleva el status en e.code (para detectar cupo agotado)', async () => {
  process.env.BREVO_API_KEY = 'xkeysib-test';
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ message: 'Daily limit reached' }) });
  const mailer = require('../../services/mailer');
  await expect(mailer.send({ to: 'a@x.com', subject: 's', html: 'h' })).rejects.toMatchObject({ code: 429, message: expect.stringMatching(/limit/) });
});

test('sin Brevo usa SendGrid si está configurado, y sin ninguno falla claro', async () => {
  delete process.env.BREVO_API_KEY;
  process.env.SENDGRID_API_KEY = 'SG.x';
  let mailer = require('../../services/mailer');
  await mailer.send({ to: 'a@x.com', subject: 's', html: 'h' });
  expect(mockSgSend).toHaveBeenCalledTimes(1);

  jest.resetModules();
  delete process.env.SENDGRID_API_KEY;
  mailer = require('../../services/mailer');
  expect(mailer.isConfigured()).toBe(false);
  await expect(mailer.send({ to: 'a@x.com', subject: 's', html: 'h' })).rejects.toThrow(/BREVO_API_KEY/);
});
