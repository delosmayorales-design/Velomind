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
const { mapIcuActivity, isDuplicate, removeIcuDuplicatesOfStrava } = require('../../routes/intervals');

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

describe('POST /planned-workouts', () => {
  const url = '/api/providers/intervals/planned-workouts';
  const workout = { date: '2026-11-10', name: 'Umbral', steps: [{ sec: 600, lo: 140, hi: 175 }] };

  test('crea el evento con id por día para que reenviar lo sustituya', async () => {
    mockDb.__queueResponse('users', { data: { intervals_api_key: 'key', intervals_athlete_id: 'i9' }, error: null });
    global.fetch.mockResolvedValue(jsonRes(200, []));

    const res = await request(buildApp()).post(url).send({ workouts: [workout] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: 1 });
    const [calledUrl, init] = global.fetch.mock.calls[0];
    expect(calledUrl).toBe('https://intervals.icu/api/v1/athlete/i9/events/bulk?upsert=true');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual([{
      category: 'WORKOUT', type: 'Ride', start_date_local: '2026-11-10T00:00:00', name: 'Umbral',
      description: '- 10m 140-175w', external_id: 'velomind-2026-11-10',
    }]);
  });

  test('rechaza fechas o pasos inválidos sin llamar a intervals.icu', async () => {
    const badDate = await request(buildApp()).post(url).send({ workouts: [{ ...workout, date: 'mañana' }] });
    const noSteps = await request(buildApp()).post(url).send({ workouts: [{ ...workout, steps: [] }] });
    const empty = await request(buildApp()).post(url).send({ workouts: [] });
    expect([badDate.status, noSteps.status, empty.status]).toEqual([400, 400, 400]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('sin intervals.icu conectado avisa de que hay que conectarlo', async () => {
    mockDb.__queueResponse('users', { data: { intervals_api_key: null }, error: null });
    const res = await request(buildApp()).post(url).send({ workouts: [workout] });
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('una API key rechazada devuelve 424 para no cerrar la sesión de VeloMind', async () => {
    mockDb.__queueResponse('users', { data: { intervals_api_key: 'key', intervals_athlete_id: 'i9' }, error: null });
    global.fetch.mockResolvedValue(jsonRes(401, {}));
    const res = await request(buildApp()).post(url).send({ workouts: [workout] });
    expect(res.status).toBe(424);
    expect(res.body.code).toBe('ICU_KEY_REJECTED');
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

describe('GET /streams/:activityId', () => {
  test('devuelve la telemetría con la misma forma que la de Strava (GPS en pares lat/lng)', async () => {
    mockDb.__queueResponse('users', { data: { intervals_api_key: 'k' }, error: null });
    global.fetch.mockResolvedValueOnce(jsonRes(200, [
      { type: 'time', data: [0, 1, 2] },
      { type: 'watts', data: [150, 200, 250] },
      { type: 'latlng', data: [40.1, 40.2, 40.3], data2: [-3.1, -3.2, -3.3] },
    ]));
    const res = await request(buildApp()).get('/api/providers/intervals/streams/icu_i123');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ time: [0, 1, 2], watts: [150, 200, 250], latlng: [[40.1, -3.1], [40.2, -3.2], [40.3, -3.3]] });
    expect(global.fetch.mock.calls[0][0]).toContain('/activity/i123/streams');
  });

  test('si intervals.icu rechaza la key responde 424 (no 401, que cerraría la sesión)', async () => {
    mockDb.__queueResponse('users', { data: { intervals_api_key: 'k' }, error: null });
    global.fetch.mockResolvedValueOnce(jsonRes(403, {}));
    const res = await request(buildApp()).get('/api/providers/intervals/streams/i123');
    expect(res.status).toBe(424);
    expect(res.body.code).toBe('ICU_KEY_REJECTED');
  });
});

describe('removeIcuDuplicatesOfStrava', () => {
  test('borra solo las de intervals.icu que ya están por Strava', async () => {
    mockDb.__queueResponse('activities', { data: [
      { id: 'icu_a', date: '2026-10-30', duration: 6180 },
      { id: 'icu_b', date: '2026-10-29', duration: 3600 },
    ], error: null });
    mockDb.__queueResponse('activities', { data: [{ date: '2026-10-30', duration: 6200 }], error: null });
    mockDb.__queueResponse('activities', { data: null, error: null });

    expect(await removeIcuDuplicatesOfStrava(7)).toBe(1);
    const inCalls = mockDb.__getCalls('activities', 'in');
    expect(inCalls[inCalls.length - 1].args).toEqual(['id', ['icu_a']]);
  });

  test('sin actividades de intervals.icu no consulta nada más', async () => {
    mockDb.__queueResponse('activities', { data: [], error: null });
    expect(await removeIcuDuplicatesOfStrava(7)).toBe(0);
    expect(mockDb.__getCalls('activities', 'delete')).toHaveLength(0);
  });
});
