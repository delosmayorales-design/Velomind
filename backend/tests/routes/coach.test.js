jest.mock('../../db', () => require('../helpers/mockSupabase'));
jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    req.user = { id: 'test-user-id', email: 'test@velomind.test' };
    next();
  },
}));

const express = require('express');
const request = require('supertest');
const mockDb = require('../helpers/mockSupabase');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/coach', require('../../routes/coach'));
  return app;
}

beforeEach(() => {
  mockDb.__reset();
});

// Regresión de esta sesión: la curva de potencia empezó a poblarse con
// best_efforts reales (recolectados en el sync de Strava), pero la heurística
// de respaldo para actividades SIN best_efforts (el caso de siempre) no debe
// cambiar ni un vatio — es el punto de mayor riesgo de todo el cambio.
describe('GET /api/coach/power-curve', () => {
  test('con best_efforts reales, la curva usa esos valores tal cual (respetando powerCap)', async () => {
    mockDb.__queueResponse('users', { data: { ftp: 200, weight: 70 }, error: null });
    mockDb.__queueResponse('activities', {
      data: [{
        np: 0, avg_power: 0, max_power: 0, duration: 3600, date: '2026-08-01',
        best_efforts: { 5: 900, 60: 350, 300: 280, 1200: 230 },
      }],
      error: null,
    });

    const res = await request(buildApp()).get('/api/coach/power-curve');

    expect(res.status).toBe(200);
    const byDur = Object.fromEntries(res.body.curve.map(c => [c.dur, c.power]));
    expect(byDur[5]).toBe(900);
    expect(byDur[60]).toBe(350);
    expect(byDur[300]).toBe(280);
    expect(byDur[1200]).toBe(230);
  });

  test('con best_efforts que exceden el powerCap, se recortan al límite fisiológico', async () => {
    // ftp=200 → powerCap = min(1500, 200*5) = 1000
    mockDb.__queueResponse('users', { data: { ftp: 200, weight: 70 }, error: null });
    mockDb.__queueResponse('activities', {
      data: [{
        np: 0, avg_power: 0, max_power: 0, duration: 3600, date: '2026-08-01',
        best_efforts: { 5: 2000 },
      }],
      error: null,
    });

    const res = await request(buildApp()).get('/api/coach/power-curve');
    const byDur = Object.fromEntries(res.body.curve.map(c => [c.dur, c.power]));
    expect(byDur[5]).toBe(1000);
  });

  test('sin best_efforts, la heurística de respaldo se mantiene exactamente igual (snapshot)', async () => {
    mockDb.__queueResponse('users', { data: { ftp: 200, weight: 70 }, error: null });
    mockDb.__queueResponse('activities', {
      data: [{
        np: 0, avg_power: 200, max_power: 0, duration: 3600, date: '2026-08-01',
        best_efforts: null,
      }],
      error: null,
    });

    const res = await request(buildApp()).get('/api/coach/power-curve');
    expect(res.status).toBe(200);
    expect(res.body.curve).toMatchSnapshot();
  });
});
