// Elimina usuarios demo creados hace más de 24h y todos sus datos asociados
const cron     = require('node-cron');
const supabase = require('../db');

async function cleanupDemoUsers() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: demos, error } = await supabase
    .from('users')
    .select('id')
    .like('email', 'demo_%@cyclocoach.local')
    .lt('created_at', cutoff);

  if (error || !demos?.length) return;

  for (const { id } of demos) {
    // Eliminar datos en cascada (mismo orden que DELETE /auth/account)
    await supabase.from('push_subscriptions').delete().eq('user_id', id);
    await supabase.from('password_reset_tokens').delete().eq('user_id', id);
    await supabase.from('pmc').delete().eq('user_id', id);
    await supabase.from('wellness_log').delete().eq('user_id', id);
    await supabase.from('weight_log').delete().eq('user_id', id);
    await supabase.from('nutrition_plans').delete().eq('user_id', id);
    await supabase.from('training_plans').delete().eq('user_id', id);
    await supabase.from('biomechanics').delete().eq('user_id', id);
    await supabase.from('activities').delete().eq('user_id', id);

    // Componentes e historial de bicis
    const { data: bikes } = await supabase.from('bikes').select('id').eq('user_id', id);
    for (const b of (bikes || [])) {
      const { data: comps } = await supabase.from('bike_components').select('id').eq('bike_id', b.id);
      for (const c of (comps || [])) {
        await supabase.from('component_history').delete().eq('component_id', c.id);
      }
      await supabase.from('bike_components').delete().eq('bike_id', b.id);
    }
    await supabase.from('bikes').delete().eq('user_id', id);
    await supabase.from('users').delete().eq('id', id);
  }

  console.log(`🧹 Demo cleanup: eliminados ${demos.length} usuarios demo caducados`);
}

function start() {
  // Ejecutar cada día a las 3:00 AM
  cron.schedule('0 3 * * *', () => {
    cleanupDemoUsers().catch(e => console.error('[demoCleanup]', e.message));
  });
  // También ejecutar al arrancar para limpiar acumulados
  cleanupDemoUsers().catch(() => {});
  console.log('🧹 Demo cleanup scheduler iniciado (diario a las 3:00)');
}

module.exports = { start, cleanupDemoUsers };
