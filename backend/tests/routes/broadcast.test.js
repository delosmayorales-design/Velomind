process.env.SENDGRID_API_KEY = 'SG.test';
process.env.VAPID_PUBLIC_KEY = 'pub';
process.env.VAPID_PRIVATE_KEY = 'priv';

jest.mock('../../db', () => require('../helpers/mockSupabase'));
jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => { req.user = { id: 1, name: 'Bautista', email: 'admin@x.com', isAdmin: true }; next(); },
  requireAdmin: (req, res, next) => next(),
}));
const mockSend = jest.fn();
jest.mock('@sendgrid/mail', () => ({ setApiKey: jest.fn(), send: (...a) => mockSend(...a) }));
const mockPush = jest.fn();
jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: (...a) => mockPush(...a) }));
const mockOverview = jest.fn();
jest.mock('../../routes/admin', () => ({ buildOverview: (...a) => mockOverview(...a) }));

const express = require('express');
const request = require('supertest');
const mockDb = require('../helpers/mockSupabase');
const { unsubToken, parseMessage } = require('../../routes/broadcast');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/broadcast', require('../../routes/broadcast').adminRouter);
  app.use('/api/broadcast', require('../../routes/broadcast').publicRouter);
  return app;
}

const USERS = [
  { id: 10, name: 'Ana López', email: 'ana@x.com', segment: 'sin_uso', providers: [] },
  { id: 11, name: 'Luis', email: 'luis@x.com', segment: 'diario', providers: ['Strava'] },
  { id: 12, name: 'Marta', email: 'marta@x.com', segment: 'solo_app', providers: [] },
];
const MSG = { subject: 'Hola {nombre}', body: 'Prueba para {nombre}', channels: ['email'], cta_label: 'Ir', cta_path: 'integrations.html' };
const flush = () => new Promise((r) => setImmediate(() => setImmediate(r)));

beforeEach(() => {
  mockDb.__reset();
  mockSend.mockReset().mockResolvedValue({});
  mockPush.mockReset().mockResolvedValue({});
  mockOverview.mockResolvedValue({ users: USERS, segments: [{ key: 'sin_uso', label: 'Sin uso', desc: '' }, { key: 'diario', label: 'Muy activos', desc: '' }, { key: 'solo_app', label: 'Solo app', desc: '' }] });
});

describe('parseMessage', () => {
  test('exige asunto, mensaje, canal y botón hacia una página de la app', () => {
    expect(parseMessage({ ...MSG, subject: '' }).error).toBeTruthy();
    expect(parseMessage({ ...MSG, channels: [] }).error).toBeTruthy();
    expect(parseMessage({ ...MSG, cta_path: 'https://evil.com' }).error).toMatch(/página de la app/);
    expect(parseMessage(MSG).msg).toMatchObject({ subject: 'Hola {nombre}', ctaPath: 'integrations.html', channels: ['email'] });
  });
});

describe('POST /send', () => {
  test('envía a "sin fuente de entrenos", excluye a quien se dio de baja y personaliza', async () => {
    mockDb.__queueResponse('broadcasts', { data: [], error: null });          // ninguno enviándose
    mockDb.__queueResponse('users', { data: [{ id: 12 }], error: null });     // Marta se dio de baja
    mockDb.__queueResponse('broadcasts', { data: { id: 5 }, error: null });   // insert
    mockDb.__queueResponse('broadcasts', { data: null, error: null });        // update final

    const res = await request(buildApp()).post('/api/admin/broadcast/send').send({ ...MSG, segment: 'no_provider' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ id: 5, recipients: 1 });
    await flush();

    expect(mockSend).toHaveBeenCalledTimes(1);
    const mail = mockSend.mock.calls[0][0];
    expect(mail.to).toBe('ana@x.com');
    expect(mail.subject).toBe('Hola Ana');
    expect(mail.html).toContain('Prueba para Ana');
    expect(mail.html).toContain('/api/broadcast/unsubscribe?u=10');
    expect(mail.headers['List-Unsubscribe']).toContain(unsubToken(10));
    const update = mockDb.__getCalls('broadcasts', 'update').pop().args[0];
    expect(update).toMatchObject({ email_sent: 1, email_failed: 0, status: 'done' });
  });

  test('si se agota el cupo de SendGrid para y lo deja registrado', async () => {
    mockDb.__queueResponse('broadcasts', { data: [], error: null });
    mockDb.__queueResponse('users', { data: [], error: null });
    mockDb.__queueResponse('broadcasts', { data: { id: 6 }, error: null });
    mockDb.__queueResponse('broadcasts', { data: null, error: null });
    mockSend.mockResolvedValueOnce({}).mockRejectedValueOnce(Object.assign(new Error('Maximum credits exceeded'), { code: 429 }));

    await request(buildApp()).post('/api/admin/broadcast/send').send({ ...MSG, segment: 'all' });
    await flush();

    expect(mockSend).toHaveBeenCalledTimes(2);
    const update = mockDb.__getCalls('broadcasts', 'update').pop().args[0];
    expect(update).toMatchObject({ email_sent: 1, email_failed: 2, status: 'partial' });
    expect(update.error).toMatch(/Maximum credits exceeded/);
  });

  test('no permite dos envíos a la vez', async () => {
    mockDb.__queueResponse('broadcasts', { data: [{ id: 4 }], error: null });
    const res = await request(buildApp()).post('/api/admin/broadcast/send').send({ ...MSG, segment: 'all' });
    expect(res.status).toBe(409);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('POST /test', () => {
  test('solo se envía al admin', async () => {
    const res = await request(buildApp()).post('/api/admin/broadcast/test').send(MSG);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('enviado');
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].to).toBe('admin@x.com');
  });
});

describe('GET /unsubscribe', () => {
  test('con firma válida da de baja', async () => {
    const res = await request(buildApp()).get(`/api/broadcast/unsubscribe?u=10&t=${unsubToken(10)}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('no recibirás más avisos');
    expect(mockDb.__getCalls('users', 'update')[0].args[0]).toEqual({ broadcast_opt_out: true });
  });

  test('con firma de otro usuario no hace nada', async () => {
    const res = await request(buildApp()).get(`/api/broadcast/unsubscribe?u=11&t=${unsubToken(10)}`);
    expect(res.text).toContain('Enlace no válido');
    expect(mockDb.__getCalls('users', 'update')).toHaveLength(0);
  });
});

describe('POST /test con push', () => {
  test('traduce los errores del servicio de push y desactiva suscripciones caducadas', async () => {
    const sub = { user_id: '1', subscription: { endpoint: 'https://push.test/x', keys: {} } };
    mockDb.__queueResponse('push_subscriptions', { data: [sub], error: null });
    mockPush.mockRejectedValueOnce(Object.assign(new Error('Received unexpected response code'), { statusCode: 403 }));
    let res = await request(buildApp()).post('/api/admin/broadcast/test').send({ ...MSG, channels: ['push'] });
    expect(res.body.push).toMatch(/claves VAPID/);
    expect(mockDb.__getCalls('push_subscriptions', 'update')).toHaveLength(0);

    mockPush.mockRejectedValueOnce(Object.assign(new Error('Received unexpected response code'), { statusCode: 410 }));
    res = await request(buildApp()).post('/api/admin/broadcast/test').send({ ...MSG, channels: ['push'] });
    expect(res.body.push).toMatch(/caducado/);
    expect(mockDb.__getCalls('push_subscriptions', 'update')[0].args[0]).toEqual({ active: false });
  });
});

describe('personas concretas (segment "users")', () => {
  test('envía solo a las marcadas', async () => {
    mockDb.__queueResponse('broadcasts', { data: [], error: null });
    mockDb.__queueResponse('users', { data: [], error: null });
    mockDb.__queueResponse('broadcasts', { data: { id: 8 }, error: null });
    mockDb.__queueResponse('broadcasts', { data: null, error: null });

    const res = await request(buildApp()).post('/api/admin/broadcast/send').send({ ...MSG, segment: 'users', user_ids: [11, '12'] });
    expect(res.status).toBe(202);
    expect(res.body.recipients).toBe(2);
    await flush();
    expect(mockSend.mock.calls.map((c) => c[0].to).sort()).toEqual(['luis@x.com', 'marta@x.com']);
  });

  test('sin nadie marcado da error en vez de enviar a todos', async () => {
    const res = await request(buildApp()).post('/api/admin/broadcast/preview').send({ segment: 'users', user_ids: [] });
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
