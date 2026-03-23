// PWA Install Prompt & Service Worker Registration
(function() {
  // Register service worker
  if ('serviceWorker' in navigator) {
    // Reload once when a new service worker takes control (ensures fresh assets)
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        console.log('[PWA] New service worker activated — reloading for fresh assets');
        window.location.reload();
      }
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => {
          console.log('[PWA] Service worker registered, scope:', reg.scope);
          // Force immediate check for SW updates on every page load
          reg.update().catch(() => {});
        })
        .catch(err => console.warn('[PWA] SW registration failed:', err));
    });
  }

  // Install prompt handling
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;

    // Check 24h dismiss cooldown
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed && Date.now() - parseInt(dismissed) < 86400000) return;

    showInstallBanner();
  });

  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App installed');
    hideInstallBanner();
    deferredPrompt = null;
  });

  function showInstallBanner() {
    if (document.getElementById('pwa-install-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.innerHTML = `
      <div class="pwa-banner-content">
        <img src="/icons/icon-96.png" alt="App Icon" class="pwa-banner-icon">
        <div class="pwa-banner-text">
          <strong>Install Leave Form App</strong>
          <span>Quick access from your home screen</span>
        </div>
        <div class="pwa-banner-actions">
          <button id="pwa-install-btn" class="pwa-btn-install">Install</button>
          <button id="pwa-dismiss-btn" class="pwa-btn-dismiss">✕</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);

    // Trigger animation
    requestAnimationFrame(() => banner.classList.add('pwa-banner-visible'));

    document.getElementById('pwa-install-btn').addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      console.log('[PWA] Install choice:', result.outcome);
      deferredPrompt = null;
      hideInstallBanner();
    });

    document.getElementById('pwa-dismiss-btn').addEventListener('click', () => {
      localStorage.setItem('pwa-install-dismissed', Date.now().toString());
      hideInstallBanner();
    });
  }

  function hideInstallBanner() {
    const banner = document.getElementById('pwa-install-banner');
    if (banner) {
      banner.classList.remove('pwa-banner-visible');
      setTimeout(() => banner.remove(), 400);
    }
  }
})();
