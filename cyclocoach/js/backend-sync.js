
/**
 * js/backend-sync.js — VeloMind
 * Sincronización bidireccional entre el frontend (AppState/localStorage)
 * y el backend (API REST con JWT).
 *
 * Cargar DESPUÉS de auth.js y app.js.
 *
 * Uso:
 *   await BackendSync.loadActivities();
 *   await BackendSync.saveActivity(activity);
 *   await BackendSync.syncStrava();
 *   await BackendSync.loadProfile();
 *   await BackendSync.saveWeight(entry);
 */

const BackendSync = (() => {
  const API = window.API_URL || 
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1' 
      ? 'http://localhost:3000/api' 
      : 'https://velomind-backend.onrender.com/api');

  function isLegacyDemoActivity(a) {
    // Desactivado: Evita eliminar actividades reales de Supabase por error en el frontend
    return false;
  }

  function sanitizeActivities(list) {
    const arr = Array.isArray(list) ? list : [];
    const cleaned = arr.filter(a => !isLegacyDemoActivity(a));
    return {
      cleaned,
      removed: arr.length - cleaned.length,
    };
  }

  // Detectar navegación por historial (BFCache) para no tener que pulsar F5
  window.addEventListener('pageshow', (e) => {
    if (e.persisted || (window.performance && window.performance.navigation.type === 2)) {
      // Si el navegador restauró la página desde la memoria caché, forzamos recarga silenciosa
      window.location.reload();
    }
  });

  // ── Helpers ──────────────────────────────────────────────────
  function headers() {
    return Auth.getHeaders();
  }

  async function apiFetch(path, options = {}) {
    const res = await fetch(`${API}${path}`, {
      headers: headers(),
      cache: 'no-store', // Evitar caché HTTP agresiva del navegador
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  // ── Perfil de atleta ─────────────────────────────────────────

  /** Descarga el perfil del backend y lo sincroniza en AppState */
  async function loadProfile() {
    try {
      const data = await apiFetch('/auth/verify');
      if (data.user) {
        AppState.athlete = { ...AppState.athlete, ...data.user };
        localStorage.setItem('velomind_athlete', JSON.stringify(AppState.athlete));
        
        // Sincronizar también la sesión de Auth
        const currentUser = JSON.parse(localStorage.getItem('velomind_user') || '{}');
        const updatedUser = { ...currentUser, ...data.user };
        localStorage.setItem('velomind_user', JSON.stringify(updatedUser));
        if (window.Auth && Auth.updateUI) Auth.updateUI(updatedUser);
      }
      return data.user;
    } catch (e) {
      console.warn('[BackendSync] loadProfile offline:', e.message);
      return null;
    }
  }

  /** Sube el perfil del atleta al backend */
  async function saveProfile(profileData) {
    try {
      const data = await apiFetch('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(profileData),
      });
      if (data.user) {
        AppState.athlete = { ...AppState.athlete, ...data.user };
        localStorage.setItem('velomind_athlete', JSON.stringify(AppState.athlete));
        
        // Sincronizar también la sesión de Auth
        const currentUser = JSON.parse(localStorage.getItem('velomind_user') || '{}');
        const updatedUser = { ...currentUser, ...data.user };
        localStorage.setItem('velomind_user', JSON.stringify(updatedUser));
        if (window.Auth && Auth.updateUI) Auth.updateUI(updatedUser);
      }
      return data;
    } catch (e) {
      console.warn('[BackendSync] saveProfile offline:', e.message);
      // Guardar localmente si el backend no está disponible
      AppState.saveAthlete(profileData);
      return null;
    }
  }

  // ── Actividades ──────────────────────────────────────────────

  /** Descarga todas las actividades del backend y las carga en AppState */
  async function loadActivities() {
    try {
      // Límite alto para asegurar que el servidor manda las más nuevas si está ordenando al revés
      const data = await apiFetch(`/activities?limit=5000&_t=${Date.now()}`);
      let { cleaned: activities, removed } = sanitizeActivities(data.activities || []);

      // Recortar estrictamente al último año (365 días) para no sobrecargar la app
      const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      activities = activities.filter(a => a.date >= cutoff);

      if (removed > 0) {
        console.warn(`[BackendSync] Eliminadas ${removed} actividades legacy/demo del estado local`);
      }

      // Reemplazar el estado local con los datos del backend
      localStorage.setItem('velomind_activities', JSON.stringify(activities));
      AppState.activities = activities.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      AppState.pmcData = PMC.compute(AppState.activities, 120);

      return activities;
    } catch (e) {
      console.warn('[BackendSync] loadActivities offline, usando localStorage:', e.message);
      // Fallback a datos locales si el backend no responde
      const { cleaned, removed } = sanitizeActivities(AppState.activities);
      if (removed > 0) {
        AppState.activities = cleaned;
        localStorage.setItem('velomind_activities', JSON.stringify(cleaned));
        AppState.pmcData = PMC.compute(cleaned, 120);
      }
      return AppState.activities;
    }
  }

  /** Sube una actividad al backend */
  async function saveActivity(activity) {
    try {
      const data = await apiFetch('/activities', {
        method: 'POST',
        body: JSON.stringify(activity),
      });
      // Actualizar TSS calculado por el backend
      if (data.tss && activity.tss !== data.tss) {
        activity.tss = data.tss;
        activity.if_value = data.if_value;
      }
      return data;
    } catch (e) {
      console.warn('[BackendSync] saveActivity offline:', e.message);
      // Guardar localmente
      AppState.saveActivity(activity);
      return null;
    }
  }

  /** Sube múltiples actividades en batch */
  async function batchSaveActivities(activities) {
    try {
      return await apiFetch('/activities/batch', {
        method: 'POST',
        body: JSON.stringify({ activities }),
      });
    } catch (e) {
      console.warn('[BackendSync] batchSave offline:', e.message);
      for (const a of activities) AppState.saveActivity(a);
      return null;
    }
  }

  /** Elimina una actividad del backend */
  async function deleteActivity(id) {
    try {
      return await apiFetch(`/activities/${id}`, { method: 'DELETE' });
    } catch (e) {
      console.warn('[BackendSync] deleteActivity offline:', e.message);
      AppState.removeActivity(id);
      return null;
    }
  }

  // ── PMC / Analytics ──────────────────────────────────────────

  /** Carga el PMC calculado por el backend (más preciso que el frontend) */
  async function loadPMC(days = 90) {
    try {
      const data = await apiFetch(`/analytics/pmc?days=${days}&_t=${Date.now()}`);
      if (data.pmc?.length) AppState.pmcData = data.pmc;
      return data;
    } catch (e) {
      console.warn('[BackendSync] loadPMC offline:', e.message);
      return null;
    }
  }

  /** Carga el resumen de estadísticas */
  async function loadSummary() {
    try {
      return await apiFetch(`/analytics/summary?_t=${Date.now()}`);
    } catch (e) {
      console.warn('[BackendSync] loadSummary offline:', e.message);
      return null;
    }
  }

  /** Carga los récords personales */
  async function loadRecords() {
    try {
      return await apiFetch(`/analytics/records?_t=${Date.now()}`);
    } catch (e) {
      return null;
    }
  }

  /** Carga la curva de potencia real estimada (Mejores Esfuerzos) */
  async function loadPowerCurve(days = 0) {
    try {
      return await apiFetch(`/coach/power-curve?days=${days}&_t=${Date.now()}`);
    } catch (e) {
      console.warn('[BackendSync] loadPowerCurve offline:', e.message);
      return null;
    }
  }

  // ── Sincronización con providers (Strava / Garmin) ───────────

  /** Sincroniza actividades de Strava vía backend */
  async function syncStrava(onProgress) {
    if (onProgress) onProgress('Conectando con Strava...', 20);
    const data = await apiFetch('/providers/strava/sync', { method: 'POST' });
    if (onProgress) onProgress(`${data.synced || 0} actividades sincronizadas`, 100);
    await loadActivities();
    return data;
  }

  /** Sincroniza actividades de Garmin vía backend */
  async function syncGarmin(onProgress) {
    if (onProgress) onProgress('Conectando con Garmin Connect...', 20);
    const data = await apiFetch('/providers/garmin/sync', { method: 'POST' });
    if (onProgress) onProgress(`${data.synced || 0} actividades sincronizadas`, 100);
    await loadActivities();
    return data;
  }

  /** Estado de conexión de providers */
  async function getProviderStatus() {
    try {
      return await apiFetch('/providers/status');
    } catch (e) {
      return {
        strava: { connected: false, configured: false },
        garmin: { connected: false, configured: false },
      };
    }
  }

  // ── Peso corporal ────────────────────────────────────────────

  /** Carga el historial de peso del backend */
  async function loadWeightLog() {
    try {
      const data = await apiFetch('/body/weight?limit=365');
      const entries = (data.entries || []).map(e => ({
        date:     e.date,
        weight:   e.weight,
        fat:      e.fat_pct,
        muscle:   e.muscle_pct,
        note:     e.note,
      }));
      localStorage.setItem('velomind_weight_log', JSON.stringify(entries));
      AppState.weightLog = entries;
      return entries;
    } catch (e) {
      console.warn('[BackendSync] loadWeightLog offline:', e.message);
      return AppState.weightLog;
    }
  }

  /** Guarda una entrada de peso en el backend */
  async function saveWeight(entry) {
    // Guardar localmente primero (inmediato)
    AppState.saveWeightEntry(entry);

    try {
      await apiFetch('/body/weight', {
        method: 'POST',
        body: JSON.stringify({
          date:       entry.date,
          weight:     entry.weight,
          fat_pct:    entry.fat || null,
          muscle_pct: entry.muscle || null,
          note:       entry.note || '',
        }),
      });
    } catch (e) {
      console.warn('[BackendSync] saveWeight offline, guardado localmente:', e.message);
    }
  }

  /** Elimina una entrada de peso */
  async function deleteWeight(date) {
    AppState.removeWeightEntry(date);
    try {
      await apiFetch(`/body/weight/${date}`, { method: 'DELETE' });
    } catch (e) {
      console.warn('[BackendSync] deleteWeight offline:', e.message);
    }
  }

  // ── Garaje ──────────────────────────────────────────────────

  /** Carga el garaje completo (bicis y componentes) del backend */
  async function loadGarage() {
    try {
      const data = await apiFetch('/garage');
      // Sincronizar siempre con el estado del backend si la respuesta es válida (evita fugas de datos entre usuarios)
      if (data.garage && Array.isArray(data.garage.bikes)) {
        localStorage.setItem('velomind_garage', JSON.stringify(data.garage));
        localStorage.setItem('velomind_garage_history', JSON.stringify(data.history || []));
        return data;
      }
    } catch (e) {
      console.warn('[BackendSync] loadGarage offline:', e.message);
    }
    return null;
  }

  /** Guarda el estado actual del garaje en el backend */
  async function saveGarage(garageState, history) {
    try {
      return await apiFetch('/garage', {
        method: 'POST',
        body: JSON.stringify({ garage: garageState, history: history }),
      });
    } catch (e) {
      console.warn('[BackendSync] saveGarage offline:', e.message);
      return null;
    }
  }

  /** Actualiza el odómetro (total_km / total_hours) de una bici en el servidor */
  async function updateBikeOdometer(bikeId, totalKm, totalHours) {
    try {
      return await apiFetch(`/garage/${bikeId}`, {
        method: 'PUT',
        body: JSON.stringify({ total_km: totalKm, total_hours: totalHours }),
      });
    } catch (e) {
      console.warn('[BackendSync] updateBikeOdometer offline:', e.message);
      return null;
    }
  }

  /** Elimina una bicicleta del garaje */
  async function deleteBike(bikeId) {
    try {
      return await apiFetch(`/garage/${bikeId}`, { 
        method: 'DELETE' 
      });
    } catch (e) {
      console.warn('[BackendSync] deleteBike error:', e.message);
      throw e;
    }
  }

  /** Notifica al backend el estado del garaje para activar alertas por email */
  async function notifyMaintenance(garageData) {
    try {
      return await apiFetch('/coach/maintenance-alert', {
        method: 'POST',
        body: JSON.stringify({ garage: garageData }),
      });
    } catch (e) {
      return null;
    }
  }

  // ── Carga inicial completa ────────────────────────────────────

  /**
   * Carga todos los datos del usuario desde el backend.
   * Llamar al inicio de cada página protegida.
   */
  async function loadAll() {
    await Promise.allSettled([
      loadProfile(),
      loadActivities(),
      loadWeightLog(),
      loadGarage(),
    ]);
  }

  // ── API pública ───────────────────────────────────────────────
  return {
    loadAll,
    loadProfile,
    saveProfile,
    loadActivities,
    saveActivity,
    batchSaveActivities,
    deleteActivity,
    loadPMC,
    loadSummary,
    loadRecords,
    loadPowerCurve,
    syncStrava,
    syncGarmin,
    getProviderStatus,
    loadWeightLog,
    saveWeight,
    deleteWeight,
    notifyMaintenance,
    loadGarage,
    saveGarage,
    updateBikeOdometer,
    deleteBike
  };
})();

window.BackendSync = BackendSync;
