// Captures the PWA beforeinstallprompt event so the app can surface an install
// button later. Kept as an external script so the production Content-Security-
// Policy can use a strict `script-src 'self'` (no 'unsafe-inline'). In the desktop
// Electron renderer this event never fires; the file is a harmless no-op there.
window.addEventListener("beforeinstallprompt", function (event) {
  window.__deferredPwaInstallPrompt = event;
});
