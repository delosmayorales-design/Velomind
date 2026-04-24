const API_URL = window.API_URL ||
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api'
    : '/api');

const Auth = (() => {
  const TOKEN_KEY  = 'velomind_token';
  const USER_KEY   = 'velomind_user';

  // ─── Token ──────────────────────────────────────────────────
  function getToken() {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t || t === 'null' || t === 'undefined') return null;
    return t;
  }

  // 🔥 CORREGIDO: sin validación estricta JWT
  function setToken(token) {
    if (!token || token === 'null' || token === 'undefined') {
      return localStorage.removeItem(TOKEN_KEY);
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

  // ─── Headers ────────────────────────────────────────────────
  function getHeaders(extra = {}) {
    const token = getToken();

    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...extra,
    };
  }

  // ─── Limpieza ───────────────────────────────────────────────
  function clearSessionData() {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('velomind_') || key.startsWith('cyclocoach_')) {
        localStorage.removeItem(key);
      }
    });
  }

  // ─── Registro ───────────────────────────────────────────────
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

  // ─── Login ──────────────────────────────────────────────────
  async function login(email, password) {
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

    if (data.user && window.AppState) {
      window.AppState.athlete = data.user;
      localStorage.setItem('velomind_athlete', JSON.stringify(data.user));
    }

    return data;
  }

  // ─── Demo login ─────────────────────────────────────────────
  async function demoLogin() {
    clearSessionData();

    const res = await fetch(`${API_URL}/auth/demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error demo');

    setToken(data.token);
    setUser(data.user);

    return data;
  }

  // ─── Verify ─────────────────────────────────────────────────
  async function verifyToken() {
    const token = getToken();
    if (!token) return false;

    try {
      const res = await fetch(`${API_URL}/auth/verify`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!res.ok) {
        logout();
        return false;
      }

      const data = await res.json();
      if (data.user) setUser(data.user);

      return true;

    } catch {
      return !!getUser();
    }
  }

  // ─── Logout ────────────────────────────────────────────────
  function logout() {
    clearSessionData();
    window.location.href = 'login.html';
  }

  function hardReset() {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = 'login.html';
  }

  // ─── Protección ────────────────────────────────────────────
  async function requireAuth() {
    const token = getToken();
    const isLoginPage = window.location.pathname.includes('login.html');

    if (!token && !isLoginPage) {
      window.location.href = 'login.html';
      return null;
    }

    return getUser();
  }

  // ─── API Fetch ─────────────────────────────────────────────
  async function apiFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: getHeaders(options.headers),
    });

    if (res.status === 401) {
      logout();
    }

    return res;
  }

  // ─── API pública ───────────────────────────────────────────
  return {
    login,
    register,
    demoLogin,
    logout,
    hardReset,
    verifyToken,
    requireAuth,
    getToken,
    getUser,
    isAuthenticated,
    getHeaders,
    apiFetch,
  };
})();

window.Auth = Auth;

if (!window.CYCLOCOACH_PUBLIC) {
  Auth.init && Auth.init();
}