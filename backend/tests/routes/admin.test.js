jest.mock('../../db', () => require('../helpers/mockSupabase'));
let mockUser;
jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => { req.user = mockUser; next(); },
  requireAdmin: (req, res, next) => (req.user?.isAdmin ? next() : res.status(403).json({ error: 'Acceso restringido al administrador' })),
  isAdminEmail: (email) => email === 'admin@velomind.test',
}));

const mockRelease = jest.fn();
jest.mock('../../routes/providers', () => ({ releaseStrava: (...a) => mockRelease(...a) }));

const express = require('express');
const request = require('supertest');
const mockDb = require('../helpers/mockSupabase');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', require('../../routes/admin'));
  return app;
}

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();
const dateAgo = (n) => daysAgo(n).slice(0, 10);

beforeEach(() => {
  mockRelease.mockReset();
  mockDb.__reset();
  mockUser = { id: 1, email: 'admin@velomind.test', isAdmin: true };
});

describe('GET /api/admin/overview', () => {
  test('403 si el usuario no es admin', async () => {
    mockUser = { id: 2, email: 'user@velomind.test', isAdmin: false };
    const res = await request(buildApp()).get('/api/admin/overview');
    expect(res.status).toBe(403);
  });

  test('segmenta usuarios y excluye demos y al propio admin', async () => {
    const base = { email_verified: true, ftp: 250, weight: 70 };
    mockDb.__queueResponse('users', {
      data: [
        { ...base, id: 1, email: 'admin@velomind.test', name: 'Admin', created_at: daysAgo(100) },
        { ...base, id: 10, email: 'diario@x.com', name: 'Diario', created_at: daysAgo(90), strava_token: 'tok', last_seen_at: daysAgo(0) },
        { ...base, id: 11, email: 'dormido@x.com', name: 'Dormido', created_at: daysAgo(90) },
        { ...base, id: 12, email: 'nunca@x.com', name: 'Nunca', created_at: daysAgo(40), email_verified: false },
        { ...base, id: 13, email: 'nuevo@x.com', name: 'Nuevo', created_at: daysAgo(2) },
        { ...base, id: 14, email: 'demo_123@cyclocoach.local', name: 'Demo', created_at: daysAgo(0) },
      ],
      error: null,
    });
    const acts = [];
    for (let i = 0; i < 20; i++) acts.push({ user_id: 10, date: dateAgo(i), source: 'Strava' });
    acts.push({ user_id: 11, date: dateAgo(60), source: 'Manual' });
    acts.push({ user_id: 14, date: dateAgo(0), source: 'Manual' }); // demo: no debe contar
    mockDb.__queueResponse('users', { data: [{ id: 12 }], error: null }); // quién tiene intervals.icu
    mockDb.__queueResponse('activities', { data: acts, error: null });
    mockDb.__queueResponse('app_events', { data: [{ user_id: 10, event: 'page_view', page: 'dashboard', platform: 'web', created_at: daysAgo(1) }], error: null });
    mockDb.__queueResponse('training_plans', { data: [{ user_id: 10 }], error: null });
    mockDb.__queueResponse('biomechanics_snapshots', { data: [{ user_id: 11 }], error: null });
    mockDb.__queueResponse('bikes', { data: [{ user_id: 10 }, { user_id: 11 }], error: null });

    const res = await request(buildApp()).get('/api/admin/overview');
    expect(res.status).toBe(200);
    expect(res.body.trackingEnabled).toBe(true);
    expect(res.body.excluded.demo).toBe(1);

    const seg = Object.fromEntries(res.body.users.map((u) => [u.name, u.segment]));
    expect(seg).toEqual({ Diario: 'diario', Dormido: 'dormido', Nunca: 'sin_uso', Nuevo: 'nuevo' });

    const kpi = Object.fromEntries(res.body.kpis.map((k) => [k.key, k]));
    expect(kpi.users.value).toBe(4);
    expect(kpi.dau.value).toBe(1);
    expect(kpi.verified.value).toBe(75);

    expect(res.body.pageUsage[0]).toMatchObject({ key: 'dashboard', label: 'Inicio', users: 1, views: 1 });
    expect(res.body.features.find((f) => f.name === 'Plan de entrenamiento').users).toBe(1);
    const feats = Object.fromEntries(res.body.users.map((u) => [u.name, u.feature_names]));
    expect(feats.Diario).toEqual(expect.arrayContaining(['Plan de entrenamiento', 'Garaje (bicis)', 'Strava']));
    expect(feats.Dormido).toEqual(['Garaje (bicis)', 'Biomecánica']);
    expect(feats.Nunca).toEqual(['intervals.icu']);
    expect(res.body.sources).toEqual({ Strava: 20 });
  });

  test('sin la migración de tracking sigue respondiendo y lo indica', async () => {
    mockDb.__queueResponse('users', { data: null, error: { message: 'column users.last_seen_at does not exist' } });
    mockDb.__queueResponse('users', { data: [{ id: 10, email: 'a@x.com', name: 'A', created_at: daysAgo(30) }], error: null });
    mockDb.__queueResponse('activities', { data: [], error: null });

    const res = await request(buildApp()).get('/api/admin/overview');
    expect(res.status).toBe(200);
    expect(res.body.trackingEnabled).toBe(false);
    expect(res.body.insights[0].title).toMatch(/Tracking/);
  });
});

describe('Plazas de Strava', () => {
  test('GET /strava-slots marca la plaza reservada y clasifica por inactividad', async () => {
    mockDb.__queueResponse('users', {
      data: [
        { id: 1, name: 'Bautista', email: 'JBautistaAlvarez@hotmail.com', last_seen_at: daysAgo(90) },
        { id: 2, name: 'Activo', email: 'a@x.com', last_seen_at: daysAgo(1) },
        { id: 3, name: 'Fantasma', email: 'f@x.com', last_seen_at: null },
      ],
      error: null,
    });
    mockDb.__queueResponse('activities', { data: [{ user_id: 3, date: dateAgo(45) }], error: null });

    const res = await request(buildApp()).get('/api/admin/strava-slots');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ capacity: 10, used: 3, free: 7, releasable: 1 });
    const st = Object.fromEntries(res.body.slots.map((s) => [s.name, s.status]));
    expect(st).toEqual({ Bautista: 'reserved', Activo: 'active', Fantasma: 'inactive' });
  });

  test('no permite liberar la plaza reservada', async () => {
    mockDb.__queueResponse('users', { data: { id: 1, email: 'jbautistaalvarez@hotmail.com' }, error: null });
    const res = await request(buildApp()).post('/api/admin/strava-slots/1/release');
    expect(res.status).toBe(403);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  test('libera la plaza de otro usuario', async () => {
    mockRelease.mockResolvedValueOnce({ ok: true });
    mockDb.__queueResponse('users', { data: { id: 3, email: 'f@x.com' }, error: null });
    const res = await request(buildApp()).post('/api/admin/strava-slots/3/release');
    expect(res.status).toBe(200);
    expect(mockRelease).toHaveBeenCalledWith(3);
  });

  test('si Strava no confirma, avisa de que la plaza sigue ocupada', async () => {
    mockRelease.mockResolvedValueOnce({ ok: false, error: 'Strava respondió 500' });
    mockDb.__queueResponse('users', { data: { id: 3, email: 'f@x.com' }, error: null });
    const res = await request(buildApp()).post('/api/admin/strava-slots/3/release');
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/sigue ocupada/);
  });
});
