jest.mock('../../db', () => require('../helpers/mockSupabase'));
jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => { req.user = { id: 7, email: 'u@x.com' }; next(); },
}));
jest.mock('../../services/pmc', () => ({ recalculatePMC: jest.fn() }));
jest.mock('../../services/criticalPower', () => ({ recalculateCP: jest.fn() }));
jest.mock('../../routes/providers', () => ({
  getLatestRestingHR: async () => null,
  stravaToAppType: jest.requireActual('../../routes/providers').stravaToAppType,
}));

const express = require('express');
const request = require('supertest');
const mockDb = require('../helpers/mockSupabase');
const { mapIcuActivity, isDuplicate } = require('../../routes/intervals');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/providers/intervals', require('../../routes/intervals'));
  return app;
}

const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  mockDb.__reset();
  global.fetch = jest.fn();
});

describe('mapIcuActivity', () => {
  test('calcula TSS con NP y el FTP de VeloMind', () => {
    const row = mapIcuActivity({
      id: 'i123', type: 'Ride', name: 'Z2', start_date_local: '2026-10-20T08:00:00',
      moving_time: 3600, distance: 30000, icu_weighted_avg_watts: 200, icu_average_watts: 190, average_speed: 8.33,
    }, 7, 250, {});
    expect(row).toMatchObject({ id: 'icu_i123', type: 'cycling', date: '2026-10-20', duration: 3600, np: 200, avg_power: 190, if_value: 0.8, tss: 64, source: 'Intervals.icu' });
    expect(row.avg_speed).toBe(30);
  });

  test('no usa la potencia estimada en carrera a pie', () => {
    const row = mapIcuActivity({ id: 'r1', type: 'Run', start_date_local: '2026-10-20T08:00:00', moving_time: 1800, icu_weighted_avg_watts: 300 }, 7, 250, {});
    expect(row.type).toBe('running');
    expect(row.avg_power).toBe(0);
  });
});

describe('isDuplicate', () => {
  test('mismo día y duración parecida es duplicado; otro día no', () => {
    const row = { date: '2026-10-20', duration: 3600 };
    expect(isDuplicate(row, [{ date: '2026-10-20', duration: 3700 }])).toBe(true);
    expect(isDuplicate(row, [{ date: '2026-10-21', duration: 3600 }])).toBe(false);
    expect(isDuplicate(row, [{ date: '2026-10-20', duration: 1800 }])).toBe(false);
  });
});

describe('POST /connect', () => {
  test('rechaza claves con formato inválido sin llamar a intervals.icu', async () => {
    const res = await request(buildApp()).post('/api/providers/intervals/connect').send({ api_key: 'x' });
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('guarda la key y el athlete id si intervals.icu la acepta', async () => {
    global.fetch.mockResolvedValueOnce(jsonRes(200, { id: 'i9999', name: 'Ana' }));
    const res = await request(buildApp()).post('/api/providers/intervals/connect').send({ api_key: 'abcdef1234567890' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true, athlete: 'Ana' });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://intervals.icu/api/v1/athlete/0');
    expect(opts.headers.Authorization).toBe('Basic ' + Buffer.from('API_KEY:abcdef1234567890').toString('base64'));
    expect(mockDb.__getCalls('users', 'update')[0].args[0]).toEqual({ intervals_api_key: 'abcdef1234567890', intervals_athlete_id: 'i9999' });
  });
});

describe('POST /sync', () => {
  test('importa, descarta las de Strava y los duplicados', async () => {
    mockDb.__queueResponse('users', { data: { id: 7, ftp: 250, intervals_api_key: 'k', intervals_athlete_id: 'i9999' }, error: null });
    mockDb.__queueResponse('activities', { data: [{ date: '2026-10-21', duration: 5400, source: 'Manual' }], error: null });
    global.fetch.mockResolvedValueOnce(jsonRes(200, [
      { id: 'a1', type: 'Ride', start_date_local: '2026-10-20T08:00:00', moving_time: 3600, icu_weighted_avg_watts: 200, source: 'GARMIN_CONNECT' },
      { id: 'a2', type: 'Ride', start_date_local: '2026-10-21T08:00:00', moving_time: 5450, source: 'GARMIN_CONNECT' },
      { id: 'a3', type: 'Ride', start_date_local: '2026-10-22T08:00:00', source: 'STRAVA' },
      { id: 'a4', type: 'Swim', start_date_local: '2026-10-22T08:00:00', moving_time: 1800, source: 'GARMIN_CONNECT' },
    ]));

    const res = await request(buildApp()).post('/api/providers/intervals/sync').send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ downloaded: 4, synced: 1, duplicates: 1, skipped_strava: 1 });
    const upserted = mockDb.__getCalls('activities', 'upsert')[0].args[0];
    expect(upserted.map((r) => r.id)).toEqual(['icu_a1']);
  });

  test('si intervals.icu rechaza la key responde 424 (no 401, que cerraría la sesión)', async () => {
    mockDb.__queueResponse('users', { data: { id: 7, intervals_api_key: 'k', intervals_athlete_id: 'i1' }, error: null });
    global.fetch.mockResolvedValueOnce(jsonRes(401, {}));
    const res = await request(buildApp()).post('/api/providers/intervals/sync').send({});
    expect(res.status).toBe(424);
    expect(res.body.code).toBe('ICU_KEY_REJECTED');
  });
});
