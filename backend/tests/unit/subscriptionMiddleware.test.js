// requirePremium lee PREMIUM_ENFORCEMENT en el top-level del módulo, así que hay que
// resetear el registro de módulos entre tests para que cada uno vea el env var que le
// corresponde en el momento de requerir el archivo.
describe('requirePremium', () => {
  const ORIGINAL_ENV = process.env.PREMIUM_ENFORCEMENT;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.PREMIUM_ENFORCEMENT;
    else process.env.PREMIUM_ENFORCEMENT = ORIGINAL_ENV;
    jest.resetModules();
  });

  function makeRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  }

  test('sin PREMIUM_ENFORCEMENT definida, deja pasar a cualquiera sin consultar la base de datos', async () => {
    delete process.env.PREMIUM_ENFORCEMENT;
    jest.resetModules();
    jest.doMock('../../db', () => require('../helpers/mockSupabase'));
    const mockDb = require('../helpers/mockSupabase');
    mockDb.__reset();
    // Deliberadamente NO se configura ninguna respuesta para 'users' -- si el middleware
    // intentara consultar, devolvería el fallback {data:null} y fallaría por otra vía;
    // en vez de eso comprobamos que directamente no hay ninguna llamada a esa tabla.
    const { requirePremium } = require('../../middleware/subscriptionMiddleware');
    const next = jest.fn();
    await requirePremium({ user: { id: 'u1' } }, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockDb.__getCalls('users').length).toBe(0);
  });

  test('con PREMIUM_ENFORCEMENT=false, tampoco bloquea', async () => {
    process.env.PREMIUM_ENFORCEMENT = 'false';
    jest.resetModules();
    const { requirePremium } = require('../../middleware/subscriptionMiddleware');
    const next = jest.fn();
    await requirePremium({ user: { id: 'u1' } }, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('con PREMIUM_ENFORCEMENT=true, bloquea con 403 a un usuario free', async () => {
    process.env.PREMIUM_ENFORCEMENT = 'true';
    jest.resetModules();
    jest.doMock('../../db', () => require('../helpers/mockSupabase'));
    const mockDb = require('../helpers/mockSupabase');
    mockDb.__reset();
    mockDb.__queueResponse('users', { data: { subscription_tier: 'free' }, error: null });
    const { requirePremium } = require('../../middleware/subscriptionMiddleware');
    const next = jest.fn();
    const res = makeRes();
    await requirePremium({ user: { id: 'u1' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PREMIUM_REQUIRED' }));
  });

  test('con PREMIUM_ENFORCEMENT=true, deja pasar a un usuario premium', async () => {
    process.env.PREMIUM_ENFORCEMENT = 'true';
    jest.resetModules();
    jest.doMock('../../db', () => require('../helpers/mockSupabase'));
    const mockDb = require('../helpers/mockSupabase');
    mockDb.__reset();
    mockDb.__queueResponse('users', { data: { subscription_tier: 'premium' }, error: null });
    const { requirePremium } = require('../../middleware/subscriptionMiddleware');
    const next = jest.fn();
    await requirePremium({ user: { id: 'u1' } }, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('con PREMIUM_ENFORCEMENT=true, deja pasar a un usuario en periodo de gracia (past_due)', async () => {
    process.env.PREMIUM_ENFORCEMENT = 'true';
    jest.resetModules();
    jest.doMock('../../db', () => require('../helpers/mockSupabase'));
    const mockDb = require('../helpers/mockSupabase');
    mockDb.__reset();
    mockDb.__queueResponse('users', { data: { subscription_tier: 'past_due' }, error: null });
    const { requirePremium } = require('../../middleware/subscriptionMiddleware');
    const next = jest.fn();
    await requirePremium({ user: { id: 'u1' } }, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
