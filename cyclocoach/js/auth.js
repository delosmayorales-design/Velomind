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

  // ─── Subir foto de perfil ────────────────────────────────────
  async function uploadAvatar(file) {
    // Comprimir a 400×400 JPEG antes de subir
    const bitmap = await createImageBitmap(file);
    const size = 400;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const w = bitmap.width * scale, h = bitmap.height * scale;
    ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);

    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
    const form = new FormData();
    form.append('avatar', blob, 'avatar.jpg');

    const res = await fetch(`${API_URL}/auth/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: form,
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || 'Error al subir foto');
    }
    const data = await res.json();
    setUser(data.user);
    injectUserUI(data.user);
    return data.user;
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
      avatarEls.forEach(el => {
        // Render photo or initials
        if (user.avatar_url) {
          el.textContent = '';
          el.style.backgroundImage = `url('${user.avatar_url}')`;
          el.style.backgroundSize = 'cover';
          el.style.backgroundPosition = 'center';
          el.style.fontSize = '0';
        } else {
          el.textContent = initials;
          el.style.backgroundImage = '';
        }

        // Make avatar clickable to upload photo (attach once)
        if (!el.dataset.avatarUploadBound) {
          el.dataset.avatarUploadBound = '1';
          el.style.cursor = 'pointer';
          el.title = 'Cambiar foto de perfil';

          // Camera overlay on hover
          el.addEventListener('mouseenter', () => {
            el.style.filter = 'brightness(0.6)';
            let cam = el.querySelector('.avatar-cam');
            if (!cam) {
              cam = document.createElement('span');
              cam.className = 'avatar-cam';
              cam.innerHTML = '📷';
              cam.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:16px;pointer-events:none;';
              el.style.position = 'relative';
              el.appendChild(cam);
            }
            cam.style.display = 'block';
          });
          el.addEventListener('mouseleave', () => {
            el.style.filter = '';
            const cam = el.querySelector('.avatar-cam');
            if (cam) cam.style.display = 'none';
          });

          el.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/jpeg,image/png,image/webp';
            input.onchange = async () => {
              const f = input.files[0];
              if (!f) return;
              const orig = el.style.filter;
              el.style.filter = 'brightness(0.4)';
              try {
                await uploadAvatar(f);
              } catch (err) {
                alert('Error al subir foto: ' + err.message);
              } finally {
                el.style.filter = orig;
              }
            };
            input.click();
          });
        }
      });
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

    // ─── Redirección Inteligente (Omitir Onboarding) ─────────────
    const isProfilePage = window.location.pathname.endsWith('index.html') ||
                          window.location.pathname.endsWith('/') ||
                          window.location.pathname.endsWith('/cyclocoach/');
    // Saltar perfil si el usuario ya tiene datos: vino desde login O navega directamente
    // (solo mostrar el perfil si viene desde el sidebar con referrer interno de la app)
    const fromSidebar = document.referrer.includes(window.location.hostname) &&
                        !document.referrer.includes('login.html');
    if (isProfilePage && !fromSidebar && user && user.ftp && user.weight) {
      window.location.replace('activities.html');
      return user;
    }

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
      font-family:'Roboto Condensed',sans-serif;
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
                   font-family:'Roboto Condensed',sans-serif;font-size:14px;">
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
    uploadAvatar,
  };
})();

// Exponer globalmente
window.Auth = Auth;

// Auto-init en páginas protegidas
if (!window.CYCLOCOACH_PUBLIC) {
  Auth.init();
}

// ── Navigation UX: barra de progreso + prefetch en hover ─────────
(function () {
  let bar, hideTimer;

  function createBar() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'nav-progress-bar';
    Object.assign(bar.style, {
      position: 'fixed', top: '0', left: '0', zIndex: '999999',
      width: '0', height: '2px', opacity: '1',
      background: 'var(--primary, #9ED62B)',
      boxShadow: '0 0 8px var(--primary, #9ED62B)',
      transition: 'none', pointerEvents: 'none',
    });
    document.body.appendChild(bar);
    return bar;
  }

  function startBar() {
    const b = createBar();
    clearTimeout(hideTimer);
    b.style.transition = 'none';
    b.style.opacity = '1';
    b.style.width = '0';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        b.style.transition = 'width 1s cubic-bezier(.1,.8,.5,1)';
        b.style.width = '75%';
      });
    });
  }

  function finishBar() {
    if (!bar) return;
    bar.style.transition = 'width .12s ease';
    bar.style.width = '100%';
    hideTimer = setTimeout(() => {
      if (bar) { bar.style.opacity = '0'; bar.style.width = '0'; }
    }, 320);
  }

  // Detectar clicks en links internos → iniciar barra y marcar nav activo
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto') || href.startsWith('javascript')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    // Feedback inmediato: marcar item de nav como activo antes de navegar
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    a.classList.add('active');

    // Barra de progreso
    if (document.readyState !== 'loading') startBar();
    else document.addEventListener('DOMContentLoaded', startBar, { once: true });
  }, true);

  // Completar barra cuando la nueva página carga
  window.addEventListener('pageshow', finishBar);
  window.addEventListener('load', finishBar);

  // Prefetch en hover: el browser descarga la página siguiente en background
  const _prefetched = new Set();
  document.addEventListener('mouseover', (e) => {
    const a = e.target.closest('a.nav-item[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || _prefetched.has(href) || href.startsWith('http')) return;
    _prefetched.add(href);
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = href;
    document.head.appendChild(link);
  }, { passive: true });
})();
