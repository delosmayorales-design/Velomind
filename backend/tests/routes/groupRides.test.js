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
  app.use('/api/group-rides', require('../../routes/groupRides'));
  return app;
}

beforeEach(() => {
  mockDb.__reset();
});

function baseRide(overrides = {}) {
  return {
    id: 'ride1',
    title: 'Salida secreta',
    creator_id: 'otro-usuario',
    is_public: false,
    meeting_point: 'Plaza Mayor',
    meeting_lat: 1, meeting_lng: 2,
    users: { name: 'Organizador', avatar_url: null },
    group_ride_participants: [],
    ...overrides,
  };
}

// Regresión del IDOR corregido en esta sesión: antes se devolvía el detalle completo
// (punto de encuentro, coordenadas, lista de participantes) de una salida privada a
// cualquier usuario autenticado, sin comprobar si era el creador o un participante.
describe('GET /api/group-rides/:id', () => {
  test('devuelve 404 en una salida privada si el usuario no es creador ni participante', async () => {
    mockDb.__queueResponse('group_rides', { data: baseRide(), error: null });

    const res = await request(buildApp()).get('/api/group-rides/ride1');

    expect(res.status).toBe(404);
    expect(res.body.meeting_point).toBeUndefined();
  });

  test('devuelve el detalle completo si el usuario es participante confirmado', async () => {
    mockDb.__queueResponse('group_rides', {
      data: baseRide({
        group_ride_participants: [
          { user_id: 'test-user-id', status: 'confirmed', joined_at: '2026-01-01', users: { name: 'Yo', avatar_url: null } },
        ],
      }),
      error: null,
    });

    const res = await request(buildApp()).get('/api/group-rides/ride1');

    expect(res.status).toBe(200);
    expect(res.body.meeting_point).toBe('Plaza Mayor');
    expect(res.body.is_joined).toBe(true);
  });

  test('devuelve el detalle completo si el usuario es el creador', async () => {
    mockDb.__queueResponse('group_rides', { data: baseRide({ creator_id: 'test-user-id' }), error: null });

    const res = await request(buildApp()).get('/api/group-rides/ride1');

    expect(res.status).toBe(200);
    expect(res.body.is_mine).toBe(true);
  });

  test('una salida pública es visible aunque el usuario no participe', async () => {
    mockDb.__queueResponse('group_rides', { data: baseRide({ is_public: true }), error: null });

    const res = await request(buildApp()).get('/api/group-rides/ride1');

    expect(res.status).toBe(200);
    expect(res.body.meeting_point).toBe('Plaza Mayor');
  });
});
