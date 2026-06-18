(function () {
  var STORAGE_KEY = 'velomind_last_build_id';

  function getApiBase() {
    if (window.API_URL) return window.API_URL;
    return (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
      ? 'http://localhost:3000/api'
      : 'https://velomind-backend.onrender.com/api';
  }

  function showModal(buildId) {
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
      localStorage.setItem(STORAGE_KEY, buildId);
      overlay.style.transition = 'opacity 0.25s';
      overlay.style.opacity = '0';
      setTimeout(function () { overlay.remove(); }, 260);
    };
  }

  async function checkForUpdates() {
    try {
      var res = await fetch(getApiBase() + '/version');
      if (!res.ok) return;
      var data = await res.json();

      var deployDate = (data.deployedAt || '').split('T')[0];
      var today = new Date().toISOString().split('T')[0];
      var lastSeen = localStorage.getItem(STORAGE_KEY);

      if (deployDate === today && data.buildId !== lastSeen) {
        showModal(data.buildId);
      }
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkForUpdates);
  } else {
    checkForUpdates();
  }
})();
