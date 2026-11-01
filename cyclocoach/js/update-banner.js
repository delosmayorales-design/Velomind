(function () {
  var STORAGE_KEY = 'velomind_update_seen';

  function showModal(buildKey) {
    if (document.getElementById('vm-update-modal')) return;
    var overlay = document.createElement('div');
    overlay.id = 'vm-update-modal';
    overlay.innerHTML =
      '<div class="vm-modal-box">' +
        '<div class="vm-modal-icons">🚧 🦺 🔧 🔩 🏗️ 🦺 🚧</div>' +
        '<div class="vm-modal-cones">🔶 🔷 🔶 🔷 🔶</div>' +
        '<h2 class="vm-modal-title">¡App actualizada!</h2>' +
        '<p class="vm-modal-body">Hemos publicado cambios en VeloMind.<br>Es posible que notes mejoras o diferencias en el funcionamiento.</p>' +
        '<div class="vm-modal-cones" style="transform:scaleX(-1)">🔶 🔷 🔶 🔷 🔶</div>' +
        '<button class="vm-modal-btn" id="vm-update-ok">Entendido, ¡a entrenar! 🚴</button>' +
      '</div>';
    document.body.appendChild(overlay);
    document.getElementById('vm-update-ok').onclick = function () {
      localStorage.setItem(STORAGE_KEY, buildKey);
      overlay.style.transition = 'opacity 0.25s';
      overlay.style.opacity = '0';
      setTimeout(function () { overlay.remove(); }, 260);
    };
  }

  // Compara el commit desplegado en el backend con el último que vio este dispositivo.
  // Antes se comparaban fechas, pero document.lastModified vale "ahora" cuando el servidor no
  // manda Last-Modified, y deployedAt cambia cada vez que Render despierta el servidor: el
  // aviso salía casi a diario sin que hubiera nada nuevo.
  async function checkForUpdates() {
    try {
      var apiBase = window.API_URL || 'https://velomind-backend.onrender.com/api';
      var opts = {};
      if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
        opts.signal = AbortSignal.timeout(4000);
      }
      var res = await fetch(apiBase + '/version', opts);
      if (!res.ok) return;
      var data = await res.json();
      var build = data.buildId;
      // Sin commit real (arranque local) no hay forma de saber si es una versión nueva
      if (!build || /^deploy-/.test(build)) return;
      var seen = localStorage.getItem(STORAGE_KEY);
      // Primera visita (o valor antiguo con fecha): se apunta la versión sin avisar
      if (!seen || /^d{4}-d{2}-d{2}$/.test(seen)) { localStorage.setItem(STORAGE_KEY, build); return; }
      if (seen !== build) showModal(build);
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkForUpdates);
  } else {
    checkForUpdates();
  }
})();
