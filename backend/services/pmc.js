const supabase = require('../db');

/**
 * Obtiene el historial de métricas PMC (CTL, ATL, TSB) para un usuario.
 */
const getPMC = async (userId, days = 90) => {
  try {
    const { data, error } = await supabase
      .from('pmc')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(days);

    if (error) throw error;

    // Verificar que data no sea null antes de acceder a sus propiedades
    return (data || []).reverse();
  } catch (e) {
    console.error('[PMC Service] Error en getPMC:', e.message);
    return [];
  }
};

/**
 * Obtiene la métrica más reciente (estado de forma actual) del usuario.
 */
const getCurrentMetrics = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('pmc')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    // Verificar que data no sea null antes de acceder a sus propiedades
    return data || { ctl: 0, atl: 0, tsb: 0 };
  } catch (e) {
    console.error('[PMC Service] Error en getCurrentMetrics:', e.message);
    return { ctl: 0, atl: 0, tsb: 0 };
  }
};

/**
 * Recalcula el PMC completo basado en el historial de actividades.
 * Implementa la fórmula de EWMA (Exponential Weighted Moving Average):
 * CTL_hoy = CTL_ayer + (TSS_hoy - CTL_ayer) / 42
 * ATL_hoy = ATL_ayer + (TSS_hoy - ATL_ayer) / 7
 */
const recalculatePMC = async (userId) => {
  try {
    console.log(`[PMC] Recalculando para usuario: ${userId}...`);
    
    // 1. Obtener FTP para cálculos de TSS si faltan
    const { data: user } = await supabase.from('users').select('ftp').eq('id', userId).single();
    const ftp = user?.ftp || 200;

    // 2. Obtener todas las actividades ordenadas
    const { data: activities } = await supabase
      .from('activities')
      .select('date, tss')
      .eq('user_id', userId)
      .order('date', { ascending: true });

    if (!activities || activities.length === 0) return;

    // 3. Agrupar TSS por día
    const tssByDay = {};
    activities.forEach(a => {
      tssByDay[a.date] = (tssByDay[a.date] || 0) + (Number(a.tss) || 0);
    });

    // 4. Calcular evolución día a día desde la primera actividad hasta hoy
    const dates = Object.keys(tssByDay).sort();
    const startDate = new Date(dates[0]);
    const endDate = new Date();
    
    let ctl = 0, atl = 0;
    const pmcRows = [];

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const tss = tssByDay[dateStr] || 0;

      ctl = ctl + (tss - ctl) / 42;
      atl = atl + (tss - atl) / 7;
      const tsb = ctl - atl;

      pmcRows.push({
        user_id: userId,
        date: dateStr,
        ctl: Math.round(ctl * 10) / 10,
        atl: Math.round(atl * 10) / 10,
        tsb: Math.round(tsb * 10) / 10
      });
    }

    // 5. Upsert masivo en Supabase
    await supabase.from('pmc').upsert(pmcRows, { onConflict: 'user_id, date' });
  } catch (e) {
    console.error('[PMC Service] Error en recalculatePMC:', e.message);
  }
};

module.exports = { getPMC, getCurrentMetrics, recalculatePMC };