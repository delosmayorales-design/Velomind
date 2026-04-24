/**
 * js/auth.js — VeloMind
 * Módulo de autenticación JWT.
 * Incluir en TODAS las páginas protegidas ANTES de app.js.
 *
 * Gestiona:
 *  - Token JWT en localStorage
 *  - Redirección a login.html si no hay sesión válida
 *  - Perfil de usuario en sidebar
 *  - Headers Authorization para fetch
 *  - Logout
 */

const API_URL = window.API_URL ||
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api'
    : 'https://velomind-backend.onrender.com/api');

const Auth = (() => {
  const TOKEN_KEY  = 'velomind_token';
  const USER_KEY   = 'velomind_user';

  // ─── Token ──────────────────────────────────────────────────
  function getToken() {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t === 'null' || t === 'undefined' || !t) return null;
    return t;
  }

  function setToken(token) {
    if (!token || token === 'null' || token === 'undefined') {
      return localStorage.removeItem(TOKEN_KEY);
    }
    // Si no tiene 3 partes (header.payload.signature), NO es un JWT de sesión
    if (token.split('.').length !== 3) {
      console.warn('[Auth] Intento de guardar un token no-JWT bloqueado para proteger la sesión.');
      return;
    }

    localStorage.setItem(TOKEN_KEY, token);
  }

  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  }

  function setUser(user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function isAuthenticated() {
    return !!getToken();
  }

  // ─── Headers para fetch con Authorization ───────────────────
  function getHeaders(extra = {}) {
    let token = getToken();
    
    // Si el token no tiene el formato JWT (3 partes), lo ignoramos
    if (token && (token === 'null' || token.split('.').length !== 3)) {
      token = null;
    }

    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...extra,
    };
  }

  // ─── Limpieza de sesión ──────────────────────────────────────
  function clearSessionData() {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('velomind_') || key.startsWith('cyclocoach_')) {
        localStorage.removeItem(key);
      }
    });
  }

  // ─── Registro ────────────────────────────────────────────────
  async function register(email, password, name) {
    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al registrarse');
    setToken(data.token);
    setUser(data.user);
    return data;
  }

  // ─── Login ────────────────────────────────────────────────────
  async function login(email, password) {
    // Limpiar rastro de sesiones anteriores antes de iniciar una nueva para evitar fugas de datos
    clearSessionData();

    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Credenciales incorrectas');
    setToken(data.token);
    setUser(data.user);
    // Sincronizar perfil completo al appState si existe
    if (data.user && window.AppState) {
      window.AppState.athlete = data.user;
      localStorage.setItem('velomind_athlete', JSON.stringify(data.user));
    }
    return data;
  }

  // ─── Demo login ──────────────────────────────────────────────
  async function demoLogin() {
    // Limpiar rastro de sesiones anteriores antes de iniciar una nueva para evitar fugas de datos
    clearSessionData();

    const res = await fetch(`${API_URL}/auth/demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error demo');
    setToken(data.token);
    setUser(data.user);
    if (data.user && window.AppState) {
      window.AppState.athlete = data.user;
      localStorage.setItem('velomind_athlete', JSON.stringify(data.user));
    }
    return data;
  }

  // ─── Verificar token con el backend ──────────────────────────
  async function verifyToken() {
    const token = getToken();
    if (!token) return false;
    try {
      const res = await fetch(`${API_URL}/auth/verify`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) { 
        if (res.status === 401 || res.status === 403) {
          console.warn('[Auth] Sesión rechazada por el servidor (401). Cerrando sesión.');
          logout(); 
          return false; 
        }
        console.warn(`[Auth] Backend inestable o durmiendo (Status: ${res.status}). Mantenemos sesión local.`);
        return !!getUser();
      }
      const data = await res.json();
      if (data.user) {
        setUser(data.user);
        if (window.AppState) {
          window.AppState.athlete = data.user;
          localStorage.setItem('velomind_athlete', JSON.stringify(data.user));
        }
      }
      return true;
    } catch {
      // Backend no disponible — usar datos locales
      return !!getUser();
    }
  }

  // ─── Logout ──────────────────────────────────────────────────
  function logout() {
    // Limpiar todos los datos específicos de VeloMind para evitar que persistan al cambiar de cuenta en el mismo navegador
    clearSessionData();

    window.location.href = 'login.html';
  }

  // Función para resetear TODO en caso de error grave
  function hardReset() {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = 'login.html';
  }

  // ─── Proteger página: redirige a login si no hay token ───────
  async function requireAuth() {
    const token = getToken();

    if (!token && !window.CYCLOCOACH_PUBLIC) {
      window.location.href = 'login.html';
      return null;
    }
    const user = getUser();
    return user;
  }

  // ─── Guardar Token de Strava de forma segura ────────────────
  async function saveStravaToken(stravaAccessToken) {
    if (!stravaAccessToken) throw new Error('El token de Strava es obligatorio');

    // Verificar que el usuario esté realmente logueado antes de enviar nada
    if (!isAuthenticated()) {
      throw new Error('Tu sesión ha expirado. Por favor, inicia sesión de nuevo antes de conectar Strava.');
    }
    
    // Forzamos el uso de fetch directo con los headers de sesión limpios
    const res = await fetch(`${API_URL}/providers/strava/save-token`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ access_token: stravaAccessToken })
    });
    
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Error al conectar con Strava');
    }
    return await res.json();
  }

  // ─── Inyectar UI de usuario en sidebar ───────────────────────
  function injectUserUI(user) {
    if (user) {
      const nameEls = document.querySelectorAll('#athlete-sidebar-name, #athlete-name, #name');
      const avatarEls = document.querySelectorAll('#athlete-avatar, #avatar');
      const ftpEls = document.querySelectorAll('#athlete-sidebar-ftp, #athlete-ftp, #ftp');

      const displayName = user.name || user.email?.split('@')[0] || 'Atleta';
      const initials = displayName.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);

      nameEls.forEach(el => el.textContent = displayName);
      avatarEls.forEach(el => el.textContent = initials);
      ftpEls.forEach(el => el.textContent = `FTP: ${user.ftp || '--'} W`);
    }

    // Botón de logout
    const footers = document.querySelectorAll('.sidebar-footer');
    footers.forEach(footer => {
      if (!footer.querySelector('#auth-logout-btn')) {
        const logoutWrap = document.createElement('div');
        logoutWrap.style.marginTop = '12px';
        logoutWrap.innerHTML = `
          <button id="auth-logout-btn"
            style="width:100%;padding:10px;background:rgba(255,71,87,0.05);border:1px solid rgba(255,71,87,0.2);
                   border-radius:8px;color:#ff4757;cursor:pointer;font-size:13px;font-weight:600;
                   font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;
                   transition:all 0.2s;"
            onmouseenter="this.style.backgroundColor='rgba(255,71,87,0.15)';this.style.borderColor='rgba(255,71,87,0.4)'"
            onmouseleave="this.style.backgroundColor='rgba(255,71,87,0.05)';this.style.borderColor='rgba(255,71,87,0.2)'">
            <i class="fas fa-sign-out-alt"></i> Cerrar sesión
          </button>`;
        footer.appendChild(logoutWrap);
        logoutWrap.querySelector('#auth-logout-btn').addEventListener('click', logout);
      }
    });
  }

  // ─── Inicializar en página protegida ─────────────────────────
  async function init() {
    let user = await requireAuth();

    const renderUI = () => {
      injectUserUI(user);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderUI);
    } else {
      renderUI();
    }

    // Verificar token con backend en segundo plano
    verifyToken().then(valid => {
      if (valid) {
        const refreshed = getUser();
        if (refreshed && JSON.stringify(refreshed) !== JSON.stringify(user)) {
          user = refreshed;
          injectUserUI(user);
        }
      } else if (!window.CYCLOCOACH_PUBLIC) {
        logout();
      }
    });

    return user;
  }

  // ─── Helper para fetch autenticado con manejo de premium ────
  async function apiFetch(url, options = {}) {
    const requestOptions = { ...options };
    const authHeaders = getHeaders();

    // Mezclar headers, pero asegurar que Authorization sea válido
    const mergedHeaders = { ...authHeaders, ...(options.headers || {}) };

    // Si el header resultante no parece un JWT (no tiene puntos), lo borramos y usamos el de la sesión
    const currentAuth = mergedHeaders.Authorization;
    if (currentAuth && typeof currentAuth === 'string' && (!currentAuth.includes('.') || currentAuth.split('.').length !== 3)) {
      console.warn('[Auth] Detectada cabecera Authorization malformada. Corrigiendo...');
      if (authHeaders.Authorization) {
        mergedHeaders.Authorization = authHeaders.Authorization;
      } else {
        delete mergedHeaders.Authorization;
      }
    }

    const res = await fetch(url, {
      ...requestOptions,
      headers: mergedHeaders,
    });

    // Si el servidor dice que la sesión no es válida, limpiamos y salimos
    if (res.status === 401 && !url.includes('/auth/login')) {
      console.warn('[Auth] Sesión invalidada por el servidor (401). Redirigiendo...');
      logout();
      return res;
    }

    if (res.status === 403) {
      const data = await res.json().catch(() => ({}));
      if (data.code === 'PREMIUM_REQUIRED') {
        showPremiumPrompt();
        const err = new Error(data.error || 'Premium requerido');
        err.code = 'PREMIUM_REQUIRED';
        throw err;
      }
    }
    return res;
  }

  function showPremiumPrompt() {
    if (document.getElementById('premium-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'premium-modal';
    modal.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      display:flex;align-items:center;justify-content:center;
      background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);
      font-family:'DM Sans',sans-serif;
    `;
    modal.innerHTML = `
      <div style="background:#13151c;border:1px solid rgba(255,107,53,0.3);border-radius:16px;
                  padding:40px;max-width:400px;width:90%;text-align:center;position:relative;">
        <button onclick="document.getElementById('premium-modal').remove()"
          style="position:absolute;top:12px;right:16px;background:none;border:none;color:#6b7280;
                 font-size:20px;cursor:pointer;">×</button>
        <div style="font-size:40px;margin-bottom:16px;">⭐</div>
        <h3 style="font-family:'Space Grotesk',sans-serif;font-size:22px;font-weight:700;
                   color:#f0f2f5;margin-bottom:10px;">Función Premium</h3>
        <p style="color:#9ca3af;font-size:14px;line-height:1.6;margin-bottom:28px;">
          Esta función utiliza IA avanzada (Claude / Gemini) y está disponible en el plan Premium.
        </p>
        <a href="pricing.html"
           style="display:block;background:#FF6B35;color:#fff;text-decoration:none;
                  padding:13px;border-radius:10px;font-family:'Space Grotesk',sans-serif;
                  font-weight:700;font-size:15px;margin-bottom:12px;">
          Ver planes y precios
        </a>
        <button onclick="document.getElementById('premium-modal').remove()"
          style="width:100%;background:transparent;border:1px solid rgba(255,255,255,0.08);
                 color:#6b7280;padding:11px;border-radius:10px;cursor:pointer;
                 font-family:'DM Sans',sans-serif;font-size:14px;">
          Quizás más tarde
        </button>
      </div>`;
    document.body.appendChild(modal);
  }

  function isPremium() {
    const user = getUser();
    return user?.subscription_tier === 'premium';
  }

  // ─── API pública ─────────────────────────────────────────────
  return {
    init,
    getToken,
    getUser,
    getHeaders,
    isAuthenticated,
    isPremium,
    apiFetch,
    showPremiumPrompt,
    updateUI: injectUserUI,
    login,
    register,
    demoLogin,
    logout,
    hardReset,
    verifyToken,
    requireAuth,
    saveStravaToken,
  };
})();

// Exponer globalmente
window.Auth = Auth;

// Auto-init en páginas protegidas
if (!window.CYCLOCOACH_PUBLIC) {
  Auth.init();
}
