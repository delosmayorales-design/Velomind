jest.mock('../../db', () => require('../helpers/mockSupabase'));

const mockDb = require('../helpers/mockSupabase');
const { recalculatePMC } = require('../../services/pmc');

beforeEach(() => {
  mockDb.__reset();
});

describe('recalculatePMC', () => {
  test('calcula CTL/ATL/TSB día a día con la fórmula EWMA de TrainingPeaks', async () => {
    mockDb.__queueResponse('users', { data: { ftp: 250, initial_ctl: 0 }, error: null });
    mockDb.__queueResponse('activities', {
      data: [
        { date: '2026-01-01', tss: 100, np: null, avg_power: null, duration: 3600 },
        { date: '2026-01-02', tss: 50, np: null, avg_power: null, duration: 3600 },
      ],
      error: null,
    });

    await recalculatePMC('user-1');

    const upsertCalls = mockDb.__getCalls('pmc', 'upsert');
    expect(upsertCalls).toHaveLength(1);
    const rows = upsertCalls[0].args[0];
    const byDate = Object.fromEntries(rows.map(r => [r.date, r]));

    // CTL_hoy = CTL_ayer + (TSS_hoy - CTL_ayer) / 42 ; ATL_hoy = ATL_ayer + (TSS_hoy - ATL_ayer) / 7
    expect(byDate['2026-01-01']).toMatchObject({ user_id: 'user-1', ctl: 2.4, atl: 14.3, tsb: -11.9 });
    expect(byDate['2026-01-02']).toMatchObject({ ctl: 3.5, atl: 19.4, tsb: -15.9 });
  });

  test('usa initial_ctl como semilla en vez de arrancar siempre de 0', async () => {
    mockDb.__queueResponse('users', { data: { ftp: 250, initial_ctl: 40 }, error: null });
    mockDb.__queueResponse('activities', {
      data: [{ date: '2026-01-01', tss: 40, np: null, avg_power: null, duration: 3600 }],
      error: null,
    });

    await recalculatePMC('user-1');

    const rows = mockDb.__getCalls('pmc', 'upsert')[0].args[0];
    // Con semilla=40 y un día con TSS=40 (igual al CTL de partida), el CTL no debería
    // moverse (ya está en su punto de equilibrio).
    expect(rows[0].ctl).toBeCloseTo(40, 1);
  });

  test('estima el TSS a partir de potencia normalizada cuando la actividad no trae TSS', async () => {
    mockDb.__queueResponse('users', { data: { ftp: 200, initial_ctl: 0 }, error: null });
    // 1h a NP=200 (=100% FTP) sin tss explícito -> debe estimarse ~100 TSS.
    mockDb.__queueResponse('activities', {
      data: [{ date: '2026-01-01', tss: 0, np: 200, avg_power: null, duration: 3600 }],
      error: null,
    });

    await recalculatePMC('user-1');

    const rows = mockDb.__getCalls('pmc', 'upsert')[0].args[0];
    // CTL tras un solo día con TSS estimado ~100: 0 + (100-0)/42 ≈ 2.4
    expect(rows[0].ctl).toBeCloseTo(2.4, 1);
  });

  test('no falla y no hace upsert si el usuario no tiene actividades', async () => {
    mockDb.__queueResponse('users', { data: { ftp: 250, initial_ctl: 0 }, error: null });
    mockDb.__queueResponse('activities', { data: [], error: null });

    await expect(recalculatePMC('user-sin-actividad')).resolves.toBeUndefined();
    expect(mockDb.__getCalls('pmc', 'upsert')).toHaveLength(0);
  });
});
