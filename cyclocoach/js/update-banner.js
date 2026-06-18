(function () {
  var STORAGE_KEY = 'velomind_update_seen';

  function showModal(dateKey) {
    if (document.getElementById('vm-update-modal')) return;
    var overlay = document.createElement('div');
    overlay.id = 'vm-update-modal';
    overlay.innerHTML =
      '<div class="vm-modal-box">' +
        '<div class="vm-modal-icons">🚧 🦺 🔧 🪛 🏗️ 🦺 🚧</div>' +
        '<div class="vm-modal-cones">🔶 🔷 🔶 🔷 🔶</div>' +
        '<h2 class="vm-modal-title">¡App actualizada!</h2>' +
        '<p class="vm-modal-body">Hemos publicado cambios hoy en VeloMind.<br>Es posible que notes mejoras o diferencias en el funcionamiento.</p>' +
        '<div class="vm-modal-cones" style="transform:scaleX(-1)">🔶 🔷 🔶 🔷 🔶</div>' +
        '<button class="vm-modal-btn" id="vm-update-ok">Entendido, ¡a entrenar! 🚴</button>' +
      '</div>';
    document.body.appendChild(overlay);
    document.getElementById('vm-update-ok').onclick = function () {
      localStorage.setItem(STORAGE_KEY, dateKey);
      overlay.style.transition = 'opacity 0.25s';
      overlay.style.opacity = '0';
      setTimeout(function () { overlay.remove(); }, 260);
    };
  }

  async function checkForUpdates() {
    var today = new Date().toISOString().split('T')[0];
    if (localStorage.getItem(STORAGE_KEY) === today) return; // ya visto hoy

    // Check 1: fecha del propio documento HTML (Vercel actualiza Last-Modified con cada deploy)
    try {
      var lm = new Date(document.lastModified);
      if (!isNaN(lm.getTime())) {
        var docDay = lm.toISOString().split('T')[0];
        if (docDay === today) { showModal(today); return; }
      }
    } catch (e) {}

    // Check 2: endpoint /api/version del backend (fallback con timeout de 4 s)
    try {
      var apiBase = window.API_URL || 'https://velomind-backend.onrender.com/api';
      var opts = {};
      if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
        opts.signal = AbortSignal.timeout(4000);
      }
      var res = await fetch(apiBase + '/version', opts);
      if (res.ok) {
        var data = await res.json();
        var deployDay = (data.deployedAt || '').split('T')[0];
        if (deployDay === today) { showModal(today); }
      }
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkForUpdates);
  } else {
    checkForUpdates();
  }
})();
