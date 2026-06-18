(function () {
  var STORAGE_KEY = 'velomind_last_build_id';
  var BANNER_HEIGHT = 44;

  function getApiBase() {
    if (window.API_URL) return window.API_URL;
    return (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
      ? 'http://localhost:3000/api'
      : 'https://velomind-backend.onrender.com/api';
  }

  function showBanner(buildId) {
    if (document.getElementById('vm-update-banner')) return;

    var banner = document.createElement('div');
    banner.id = 'vm-update-banner';
    banner.innerHTML =
      '<span class="vm-banner-icon">🔄</span>' +
      '<span class="vm-banner-text">La app ha sido actualizada hoy &middot; Es posible que notes cambios en el funcionamiento</span>' +
      '<button class="vm-banner-close" aria-label="Cerrar aviso">&#x2715;</button>';
    document.body.appendChild(banner);

    var main = document.querySelector('.main-content');
    if (main) main.style.paddingTop = BANNER_HEIGHT + 'px';

    banner.querySelector('.vm-banner-close').onclick = function () {
      localStorage.setItem(STORAGE_KEY, buildId);
      banner.style.transition = 'opacity 0.2s';
      banner.style.opacity = '0';
      setTimeout(function () {
        banner.remove();
        if (main) main.style.paddingTop = '';
      }, 200);
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
        showBanner(data.buildId);
      }
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkForUpdates);
  } else {
    checkForUpdates();
  }
})();
