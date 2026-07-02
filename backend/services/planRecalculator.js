/**
 * Plan Recalculator Service
 * ========================
 * Detecta cambios en el progreso real vs planificado y adapta la semana
 * 
 * Triggers:
 * - Nueva actividad registrada
 * - Actividad modificada (TSS, NP, duración)
 * - Manual regeneration (botón "Regenerar")
 * - Diariamente: Verificar fatiga (TSB < -30)
 */

const supabase = require('../db');

class PlanRecalculator {
  /**
   * MAIN: Recalcular plan semanal si hay cambios desde lo planificado
   * @param {string} userId - User ID
   * @param {Date} weekStart - Monday of the week (ISO format YYYY-MM-DD)
   * @returns {Promise<{changed: boolean, reason: string, adaptation: object}>}
   */
  static async recalculateWeek(userId, weekStart) {
    try {
      // 1️⃣ Cargar plan actual
      const { data: currentPlan, error: planError } = await supabase
        .from('training_plans')
        .select('*')
        .eq('user_id', userId)
        .eq('week_start', weekStart)
        .maybeSingle();

      if (planError) throw new Error(`Error loading plan: ${planError.message}`);
      if (!currentPlan) {
        console.log(`[PlanRecalc] No plan found for week ${weekStart}`);
        return { changed: false, reason: 'no_plan_found' };
      }

      // 2️⃣ Obtener PMC/CTL actual del usuario
      const { data: athleteState, error: stateError } = await supabase
        .from('pmc')
        .select('ctl, atl, tsb')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (stateError) throw new Error(`Error loading PMC: ${stateError.message}`);
      const today = new Date().toISOString().split('T')[0];

      // 3️⃣ Calcular actividades REALES de la semana hasta hoy
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const weekEndStr = weekEnd.toISOString().split('T')[0];

      const { data: realActivities, error: activError } = await supabase
        .from('activities')
        .select('date, duration, tss, np, avg_power, type, name')
        .eq('user_id', userId)
        .gte('date', weekStart)
        .lte('date', today)
        .order('date', { ascending: true });

      if (activError) throw new Error(`Error loading activities: ${activError.message}`);

      // 4️⃣ Agrupar TSS real por día
      const realTSSByDay = {};
      const realActivityByDay = {};
      realActivities.forEach(act => {
        const dateStr = act.date.substring(0, 10);
        realTSSByDay[dateStr] = (realTSSByDay[dateStr] || 0) + (act.tss || 0);
        if (!realActivityByDay[dateStr]) {
          realActivityByDay[dateStr] = [];
        }
        realActivityByDay[dateStr].push(act);
      });

      // 5️⃣ Comparar: Sesiones Planeadas vs Reales
      const deltas = this._computeDeltas(currentPlan.sessions, realTSSByDay, weekStart);

      // 6️⃣ Decidir si hay que recalcular
      const shouldRecalc = this._shouldAdapt(deltas, athleteState);

      if (!shouldRecalc) {
        return { changed: false, reason: 'within_tolerance', deltas };
      }

      // 7️⃣ Guardar histórico del plan ACTUAL antes de cambiar
      await this._saveHistoricalPlan(userId, weekStart, currentPlan, 'auto_recalculation', deltas, athleteState);

      // 8️⃣ RECALCULAR: Distribuir TSS restante en sesiones futuras
      const newSessions = await this._redistributeSessions(
        currentPlan.sessions,
        realTSSByDay,
        weekStart,
        athleteState
      );

      // 9️⃣ Actualizar plan en BD
      const { error: updateError } = await supabase
        .from('training_plans')
        .update({
          sessions: newSessions,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('week_start', weekStart);

      if (updateError) throw new Error(`Error updating plan: ${updateError.message}`);

      // 🔟 Guardar registro de adaptación
      await this._logAdaptation(userId, weekStart, deltas, athleteState, newSessions);

      return {
        changed: true,
        reason: deltas.reason,
        deltas,
        newSessions,
      };
    } catch (error) {
      console.error('[PlanRecalculator.recalculateWeek] Error:', error);
      throw error;
    }
  }

  /**
   * Comparar TSS planificado vs real por día
   */
  static _computeDeltas(plannedSessions, realTSSByDay, weekStart) {
    const deltas = {
      byDay: {},
      totalPlanned: 0,
      totalReal: 0,
      totalDelta: 0,
      exceedingDays: [],
      missingDays: [],
      reason: null,
    };

    // Crear mapa de TSS planeado por fecha
    const plannedByDate = {};
    plannedSessions.forEach((sess, idx) => {
      const sessionDate = new Date(weekStart);
      sessionDate.setDate(sessionDate.getDate() + idx);
      const dateStr = sessionDate.toISOString().split('T')[0];
      plannedByDate[dateStr] = sess.tss || 0;
    });

    // Comparar
    Object.keys(plannedByDate).forEach(date => {
      const planned = plannedByDate[date];
      const real = realTSSByDay[date] || 0;
      const delta = real - planned;

      deltas.byDay[date] = {
        planned,
        real,
        delta,
      };
      deltas.totalPlanned += planned;
      deltas.totalReal += real;

      if (delta > 0) {
        deltas.exceedingDays.push({ date, delta });
      } else if (delta < 0 && real === 0) {
        deltas.missingDays.push({ date, delta }); // No hizo nada
      }
    });

    deltas.totalDelta = deltas.totalReal - deltas.totalPlanned;

    // Determinar razón
    if (deltas.exceedingDays.length > 0) {
      deltas.reason = 'exceeded_target';
    } else if (deltas.missingDays.length > 0) {
      deltas.reason = 'missed_sessions';
    } else if (Math.abs(deltas.totalDelta) > 30) {
      deltas.reason = 'significant_deviation';
    } else {
      deltas.reason = 'on_track';
    }

    return deltas;
  }

  /**
   * Decidir si hay que recalcular el plan
   */
  static _shouldAdapt(deltas, athleteState) {
    // ✅ Recalcular si:
    // - User se pasó por +30 TSS en algún día
    // - User faltó una sesión (TSS 0)
    // - TSB < -30 (sobreentrenamiento)
    // - Desviación total > 50 TSS

    const { exceedingDays, missingDays, totalDelta } = deltas;

    // Threshold suave: si algún día se pasó de 40 TSS
    if (exceedingDays.some(d => d.delta > 40)) {
      return true;
    }

    // Si faltó sesión de calidad (>50 TSS)
    if (missingDays.some(d => Math.abs(d.delta) > 50)) {
      return true;
    }

    // Si desviación total > 50
    if (Math.abs(totalDelta) > 50) {
      return true;
    }

    // Si sobreentrenamiento crítico
    if (athleteState?.tsb < -30) {
      return true;
    }

    return false;
  }

  /**
   * Guardar plan actual en histórico antes de modificar
   */
  static async _saveHistoricalPlan(userId, weekStart, plan, reason, deltas, athleteState) {
    const exceedingDays = deltas.exceedingDays || [];
    const missingDays = deltas.missingDays || [];
    const byDay = deltas.byDay || {};

    const { data, error } = await supabase
      .from('training_plans_history')
      .insert({
        user_id: userId,
        week_start: weekStart,
        phase: plan.phase,
        tss_target_initial: plan.tss_target,
        ftp_at_creation: plan.ftp_at_creation,
        sessions: plan.sessions,
        reason,
        adaptation_reason: deltas.reason,
        athlete_state: {
          ctl: athleteState?.ctl,
          atl: athleteState?.atl,
          tsb: athleteState?.tsb,
          actual_tss_week_so_far: deltas.totalReal,
        },
        adjustment_delta: {
          sessions_modified: exceedingDays.length + missingDays.length,
          total_delta: deltas.totalDelta,
          by_day: byDay,
        },
        advice: plan.advice,
      })
      .select('id')
      .single();

    if (error) throw new Error(`Error saving historical plan: ${error.message}`);

    // Guardar sesiones iniciales de este plan
    const historyId = data.id;
    const sessionRows = plan.sessions.map((sess, idx) => ({
      plan_history_id: historyId,
      user_id: userId,
      week_start: weekStart,
      day_of_week: idx,
      day_name: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][idx],
      session_index: idx,
      type: sess.type,
      name: sess.name,
      duration_min: sess.durationMin || 0,
      tss_planned: sess.tss || 0,
      if_target: sess.ifTarget,
      wattage_target: sess.wattage || 0,
      intervals: sess.intervals,
      description: sess.description,
    }));

    const { error: sessError } = await supabase
      .from('training_sessions_initial')
      .insert(sessionRows);

    if (sessError) throw new Error(`Error saving initial sessions: ${sessError.message}`);
  }

  /**
   * Recalcular distribución de TSS en sesiones futuras
   */
  static async _redistributeSessions(plannedSessions, realTSSByDay, weekStart, athleteState) {
    const today = new Date().toISOString().split('T')[0];
    const newSessions = JSON.parse(JSON.stringify(plannedSessions)); // Deep copy

    // Calcular TSS faltante
    let remainingTSS = 0;
    let remainingDays = [];

    plannedSessions.forEach((sess, dayIdx) => {
      const sessionDate = new Date(weekStart);
      sessionDate.setDate(sessionDate.getDate() + dayIdx);
      const dateStr = sessionDate.toISOString().split('T')[0];

      const real = realTSSByDay[dateStr] || 0;
      const planned = sess.tss || 0;

      if (dateStr > today) {
        // Sesión futura: calcular déficit/exceso
        remainingDays.push({ dayIdx, dateStr, planned });
        remainingTSS += planned;
      } else if (dateStr <= today) {
        // Sesión pasada: usar lo real
        const delta = planned - real;
        remainingTSS += delta; // Si se pasó: delta negativo, si faltó: delta positivo
      }
    });

    // Redistribuir TSS en sesiones futuras
    if (remainingDays.length > 0 && Math.abs(remainingTSS) > 10) {
      // Intentar distribuir equitativamente, respetando caps
      const tssPerDay = Math.round(remainingTSS / remainingDays.length);

      remainingDays.forEach(({ dayIdx }) => {
        const currentTSS = newSessions[dayIdx].tss || 0;
        let newTSS = currentTSS + tssPerDay;

        // Respetar caps
        const MAX_TSS = {
          long: 185,
          endurance: 140,
          recovery: 45,
          threshold: 115,
          tempo: 115,
          vo2max: 115,
          sprint: 100,
        };

        const cap = MAX_TSS[newSessions[dayIdx].type] || 140;
        newTSS = Math.max(0, Math.min(newTSS, cap));

        // Recalcular duración si cambia TSS
        if (newTSS !== currentTSS) {
          const ifTarget = newSessions[dayIdx].ifTarget || 0.75;
          const durMin = Math.round((newTSS / (Math.pow(ifTarget, 2) * 100)) * 60);
          newSessions[dayIdx].tss = newTSS;
          newSessions[dayIdx].durationMin = durMin;
        }
      });
    }

    // Aplicar restricción de fatiga si TSB < -30
    if (athleteState?.tsb < -30) {
      newSessions.forEach((sess, idx) => {
        // Reducir intensidad de sesiones futuras
        if (sess.type !== 'recovery' && sess.type !== 'descanso') {
          const reductionFactor = 0.70; // 30% reducción
          sess.tss = Math.round((sess.tss || 0) * reductionFactor);
          sess.durationMin = Math.round((sess.durationMin || 0) * reductionFactor);
        }
      });
    }

    return newSessions;
  }

  /**
   * Registrar adaptación en tabla de auditoría
   */
  static async _logAdaptation(userId, weekStart, deltas, athleteState, newSessions) {
    const tssAdjustments = {};
    deltas.exceedingDays.forEach(({ date, delta }) => {
      tssAdjustments[date] = -delta; // Reducir
    });
    deltas.missingDays.forEach(({ date, delta }) => {
      tssAdjustments[date] = -delta; // Compensar
    });

    const { error } = await supabase
      .from('plan_adaptations')
      .insert({
        user_id: userId,
        week_start: weekStart,
        trigger_type: 'auto_recalculation',
        trigger_details: `Detected ${deltas.reason}: total delta ${deltas.totalDelta} TSS`,
        sessions_affected: Object.keys(tssAdjustments).length,
        tss_adjustments: tssAdjustments,
        reason: `Auto-recalculated due to ${deltas.reason}`,
        tss_total_before: deltas.totalPlanned,
        tss_total_after: newSessions.reduce((s, ss) => s + (ss.tss || 0), 0),
        ctl_before: athleteState?.ctl,
        tsb_before: athleteState?.tsb,
      });

    if (error) console.error('[PlanRecalculator] Error logging adaptation:', error);
  }

  /**
   * API: Forzar regeneración del plan (botón "Regenerar")
   */
  static async regeneratePlan(userId, weekStart, generatorFn) {
    try {
      // 1. Obtener datos del usuario
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (userError) throw new Error(userError.message);

      // 2. Obtener actividades recientes para PMC
      const { data: activities, error: actError } = await supabase
        .from('activities')
        .select('date, tss')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(500);

      if (actError) throw new Error(actError.message);

      // 3. Generar nuevo plan (llamar función del generator)
      const newPlan = await generatorFn(user, activities);

      // 4. Guardar histórico del plan anterior
      const { data: oldPlan, error: oldError } = await supabase
        .from('training_plans')
        .select('*')
        .eq('user_id', userId)
        .eq('week_start', weekStart)
        .maybeSingle();

      if (oldPlan && !oldError) {
        const { data: athleteState } = await supabase
          .from('pmc')
          .select('ctl, atl, tsb')
          .eq('user_id', userId)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle();

        await this._saveHistoricalPlan(userId, weekStart, oldPlan, 'manual_regenerate', {
          reason: 'manual_regeneration',
          totalReal: 0,
          totalPlanned: oldPlan.tss_target,
        }, athleteState);
      }

      // 5. Guardar nuevo plan
      const { error: saveError } = await supabase
        .from('training_plans')
        .upsert({
          user_id: userId,
          week_start: weekStart,
          sessions: newPlan.sessions,
          phase: newPlan.phase,
          tss_target: newPlan.tss_target,
          ftp_at_creation: user.ftp,
          advice: newPlan.advice,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,week_start' });

      if (saveError) throw new Error(saveError.message);

      return { success: true, plan: newPlan };
    } catch (error) {
      console.error('[PlanRecalculator.regeneratePlan] Error:', error);
      throw error;
    }
  }

  /**
   * Deshacer una adaptación: Revertir a la versión anterior del plan
   */
  static async revertAdaptation(userId, weekStart, adaptationId) {
    try {
      // 1. Obtener la adaptación
      const { data: adaptation, error: adaptError } = await supabase
        .from('plan_adaptations')
        .select('*')
        .eq('id', adaptationId)
        .eq('user_id', userId)
        .single();

      if (adaptError || !adaptation) {
        throw new Error('Adaptación no encontrada');
      }

      // 2. Obtener el histórico ANTERIOR (la versión antes de esta adaptación)
      const { data: historyRecords, error: histError } = await supabase
        .from('training_plans_history')
        .select('*')
        .eq('user_id', userId)
        .eq('week_start', weekStart)
        .order('created_at', { ascending: false })
        .limit(2); // Obtener los 2 últimos para saber cuál es el anterior

      if (histError || !historyRecords || historyRecords.length === 0) {
        throw new Error('Histórico no encontrado');
      }

      // El plan anterior es el segundo más reciente
      const previousPlan = historyRecords.length > 1 
        ? historyRecords[1]
        : historyRecords[0];

      // 3. Restaurar el plan anterior
      const { error: restoreError } = await supabase
        .from('training_plans')
        .update({
          sessions: previousPlan.sessions,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('week_start', weekStart);

      if (restoreError) throw new Error(restoreError.message);

      // 4. Marcar adaptación como rechazada por usuario
      const { error: updateError } = await supabase
        .from('plan_adaptations')
        .update({
          approved_by_user: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', adaptationId);

      if (updateError) console.error('Error marking adaptation as rejected:', updateError.message);

      return {
        success: true,
        message: 'Plan restaurado a la versión anterior',
        plan: previousPlan,
      };
    } catch (error) {
      console.error('[PlanRecalculator.revertAdaptation] Error:', error);
      throw error;
    }
  }
}

module.exports = PlanRecalculator;
