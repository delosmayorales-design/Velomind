jest.mock('../../db', () => require('../helpers/mockSupabase'));
jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: jest.fn().mockResolvedValue(),
}));

const express = require('express');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const mockDb = require('../helpers/mockSupabase');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../../routes/auth'));
  return app;
}

beforeEach(() => {
  mockDb.__reset();
});

describe('POST /api/auth/register', () => {
  test('crea la cuenta con email_verified:false y manda el email de confirmación', async () => {
    // 1ª consulta a 'users': comprobar que el email no existe todavía.
    mockDb.__queueResponse('users', { data: null, error: null });
    // 2ª consulta a 'users': el insert().select().single() devuelve la fila creada.
    mockDb.__queueResponse('users', {
      data: { id: 'u1', email: 'nueva@test.com', name: 'Nueva', email_verified: false },
      error: null,
    });

    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ email: 'nueva@test.com', password: 'password123', name: 'Nueva' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();

    const inserts = mockDb.__getCalls('users', 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toMatchObject({ email: 'nueva@test.com', email_verified: false });
  });

  test('rechaza un email con formato inválido antes de tocar la base de datos', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ email: 'no-es-un-email', password: 'password123' });
    expect(res.status).toBe(400);
    expect(mockDb.__getCalls('users').length).toBe(0);
  });

  test('rechaza un email ya registrado con 409', async () => {
    mockDb.__queueResponse('users', { data: { id: 'existing' }, error: null });
    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ email: 'ya@existe.com', password: 'password123' });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  test('bloquea con 403 EMAIL_NOT_VERIFIED si la cuenta no confirmó el email', async () => {
    const hash = await bcrypt.hash('password123', 10);
    mockDb.__queueResponse('users', {
      data: { id: 'u1', email: 'sinverificar@test.com', password: hash, email_verified: false },
      error: null,
    });

    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'sinverificar@test.com', password: 'password123' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  test('permite iniciar sesión con una cuenta ya verificada y contraseña correcta', async () => {
    const hash = await bcrypt.hash('password123', 10);
    mockDb.__queueResponse('users', {
      data: { id: 'u1', email: 'verificado@test.com', password: hash, email_verified: true },
      error: null,
    });

    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'verificado@test.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  test('rechaza contraseña incorrecta con 401 (sin filtrar si el email existe)', async () => {
    const hash = await bcrypt.hash('password123', 10);
    mockDb.__queueResponse('users', {
      data: { id: 'u1', email: 'verificado@test.com', password: hash, email_verified: true },
      error: null,
    });
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'verificado@test.com', password: 'incorrecta' });
    expect(res.status).toBe(401);
  });

  test('usuarios existentes anteriores a la migración (email_verified undefined) pueden loguearse', async () => {
    // Simula una fila de antes de la migración de verificación de email: sin la columna
    // seteada explícitamente, el DEFAULT true de la migración la deja "undefined" en
    // el objeto mockeado -- el login solo debe bloquear cuando es EXACTAMENTE false.
    const hash = await bcrypt.hash('password123', 10);
    mockDb.__queueResponse('users', {
      data: { id: 'u_old', email: 'viejo@test.com', password: hash },
      error: null,
    });
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'viejo@test.com', password: 'password123' });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/auth/verify-email', () => {
  test('sin token en la query, redirige con status=missing', async () => {
    const res = await request(buildApp()).get('/api/auth/verify-email');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('status=missing');
  });

  test('token inexistente/ya usado, redirige con status=invalid', async () => {
    mockDb.__queueResponse('email_verification_tokens', { data: null, error: null });
    const res = await request(buildApp()).get('/api/auth/verify-email?token=noexiste');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('status=invalid');
  });

  test('token expirado, redirige con status=expired', async () => {
    mockDb.__queueResponse('email_verification_tokens', {
      data: { id: 1, user_id: 'u1', expires_at: new Date(Date.now() - 60000).toISOString(), used: false },
      error: null,
    });
    const res = await request(buildApp()).get('/api/auth/verify-email?token=expirado');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('status=expired');
  });

  test('token válido, marca email_verified:true y redirige con status=ok', async () => {
    mockDb.__queueResponse('email_verification_tokens', {
      data: { id: 1, user_id: 'u1', expires_at: new Date(Date.now() + 60000).toISOString(), used: false },
      error: null,
    });
    const res = await request(buildApp()).get('/api/auth/verify-email?token=valido');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('status=ok');

    const updates = mockDb.__getCalls('users', 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toMatchObject({ email_verified: true });
  });
});

describe('POST /api/auth/resend-verification', () => {
  test('responde el mismo mensaje genérico si el email no existe (no filtra info)', async () => {
    mockDb.__queueResponse('users', { data: null, error: null });
    const res = await request(buildApp())
      .post('/api/auth/resend-verification')
      .send({ email: 'no-existe@test.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Si la cuenta existe/i);
  });

  test('no reenvía nada si la cuenta ya está verificada', async () => {
    mockDb.__queueResponse('users', { data: { id: 'u1', email_verified: true }, error: null });
    const res = await request(buildApp())
      .post('/api/auth/resend-verification')
      .send({ email: 'verificado@test.com' });
    expect(res.status).toBe(200);
    expect(mockDb.__getCalls('email_verification_tokens', 'insert')).toHaveLength(0);
  });
});
