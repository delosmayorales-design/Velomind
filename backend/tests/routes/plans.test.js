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
  app.use('/api/plans', require('../../routes/plans'));
  return app;
}

beforeEach(() => {
  mockDb.__reset();
});

// Regresión del IDOR corregido en esta sesión: antes el PATCH no filtraba por
// user_id, así que cualquiera podía aprobar/rechazar la adaptación de otra persona.
describe('PATCH /api/plans/training/adaptations/:adaptationId', () => {
  test('devuelve 404 si la adaptación no pertenece al usuario autenticado', async () => {
    // Supabase real: un update().eq(id).eq(user_id).select().single() sin filas
    // coincidentes devuelve error (0 filas con .single()).
    mockDb.__queueResponse('plan_adaptations', { data: null, error: { message: 'no rows' } });

    const res = await request(buildApp())
      .patch('/api/plans/training/adaptations/adapt-de-otro-usuario')
      .send({ approved: true });

    expect(res.status).toBe(404);
  });

  test('aprueba la adaptación cuando sí pertenece al usuario', async () => {
    mockDb.__queueResponse('plan_adaptations', {
      data: { id: 'a1', user_id: 'test-user-id', approved_by_user: true },
      error: null,
    });

    const res = await request(buildApp())
      .patch('/api/plans/training/adaptations/a1')
      .send({ approved: true });

    expect(res.status).toBe(200);
    expect(res.body.adaptation.approved_by_user).toBe(true);

    // Confirma que el filtro de propiedad se aplicó en la query (no solo en el 404).
    const updateCall = mockDb.__getCalls('plan_adaptations', 'update')[0];
    expect(updateCall).toBeTruthy();
    const eqCalls = mockDb.__getCalls('plan_adaptations', 'eq');
    const eqArgs = eqCalls.map(c => c.args[0]);
    expect(eqArgs).toEqual(expect.arrayContaining(['user_id']));
  });
});

// Regresión del IDOR corregido en esta sesión: antes se podían leer las sesiones de un
// historial de plan ajeno sin comprobar que perteneciera al usuario.
describe('GET /api/plans/training/history/:historyId/sessions', () => {
  test('devuelve 404 y NO consulta las sesiones si el historial no es del usuario', async () => {
    mockDb.__queueResponse('training_plans_history', { data: null, error: null });

    const res = await request(buildApp()).get('/api/plans/training/history/hist-ajeno/sessions');

    expect(res.status).toBe(404);
    expect(mockDb.__getCalls('training_sessions_initial')).toHaveLength(0);
  });

  test('devuelve las sesiones cuando el historial sí pertenece al usuario', async () => {
    mockDb.__queueResponse('training_plans_history', { data: { id: 'hist1' }, error: null });
    mockDb.__queueResponse('training_sessions_initial', {
      data: [{ session_index: 0, type: 'threshold' }],
      error: null,
    });

    const res = await request(buildApp()).get('/api/plans/training/history/hist1/sessions');

    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(1);
  });
});
