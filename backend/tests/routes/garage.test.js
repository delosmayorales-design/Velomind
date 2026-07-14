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
  app.use('/api/garage', require('../../routes/garage'));
  return app;
}

beforeEach(() => {
  mockDb.__reset();
});

// Regresión del fix de esta sesión: el reset de un componente debe anclar el contador
// a la fecha real indicada (performed_at), no a "ahora", y el componente nuevo debe
// nacer con el odómetro actual de la bici (no con 0, que lo hacía aparecer ya gastado).
describe('POST /api/garage/:bikeId/components/:componentId/change', () => {
  test('usa performed_at como created_at y el odómetro real de la bici como km/hours_installed', async () => {
    mockDb.__queueResponse('bike_components', {
      data: {
        id: 'comp1',
        bike_id: 'bike1',
        component_type: 'tubeless_sealant',
        name: 'Sellante Tubeless',
        km_installed: 0,
        hours_installed: 0,
        km_remaining: 0,
        hours_remaining: 0,
        notes: null,
        bikes: { type: 'gravel', user_id: 'test-user-id', total_km: 5000, total_hours: 200 },
      },
      error: null,
    });

    const performedAt = '2026-07-08';
    const res = await request(buildApp())
      .post('/api/garage/bike1/components/comp1/change')
      .send({ reason: 'Relleno', new_name: 'Sellante Tubeless', performed_at: performedAt });

    expect(res.status).toBe(200);

    const expectedISO = new Date(performedAt).toISOString();

    const historyInsert = mockDb.__getCalls('component_history', 'insert')[0].args[0];
    expect(historyInsert.created_at).toBe(expectedISO);

    const newComponentInsert = mockDb.__getCalls('bike_components', 'insert')[0].args[0];
    expect(newComponentInsert.created_at).toBe(expectedISO);
    expect(newComponentInsert.km_installed).toBe(5000);
    expect(newComponentInsert.hours_installed).toBe(200);
  });

  test('sin performed_at, usa la fecha actual (comportamiento por defecto)', async () => {
    mockDb.__queueResponse('bike_components', {
      data: {
        id: 'comp1', bike_id: 'bike1', component_type: 'chain', name: 'Cadena',
        km_installed: 100, hours_installed: 0, km_remaining: 500, hours_remaining: 0, notes: null,
        bikes: { type: 'road', user_id: 'test-user-id', total_km: 3000, total_hours: 120 },
      },
      error: null,
    });

    const before = Date.now();
    const res = await request(buildApp())
      .post('/api/garage/bike1/components/comp1/change')
      .send({ reason: 'Cambio' });
    const after = Date.now();

    expect(res.status).toBe(200);
    const newComponentInsert = mockDb.__getCalls('bike_components', 'insert')[0].args[0];
    const createdAtMs = new Date(newComponentInsert.created_at).getTime();
    expect(createdAtMs).toBeGreaterThanOrEqual(before);
    expect(createdAtMs).toBeLessThanOrEqual(after);
  });

  test('devuelve 404 si el componente no pertenece al usuario autenticado', async () => {
    mockDb.__queueResponse('bike_components', {
      data: {
        id: 'comp1', bike_id: 'bike1', component_type: 'chain', name: 'Cadena',
        bikes: { type: 'road', user_id: 'otro-usuario', total_km: 100, total_hours: 5 },
      },
      error: null,
    });

    const res = await request(buildApp())
      .post('/api/garage/bike1/components/comp1/change')
      .send({ reason: 'Cambio' });

    expect(res.status).toBe(404);
  });
});
