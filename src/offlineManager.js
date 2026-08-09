const STATUS_EVENT = 'math-notebook-offline-status';
const INSTALL_EVENT = 'math-notebook-install-available';

let deferredInstallPrompt = null;

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    emit(INSTALL_EVENT, { available: true });
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    emit(INSTALL_EVENT, { available: false });
  });
}

export function hasOfflineInstallPrompt() {
  return Boolean(deferredInstallPrompt);
}

export async function promptOfflineInstall() {
  if (!deferredInstallPrompt) return { outcome: 'unavailable' };
  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  emit(INSTALL_EVENT, { available: false, outcome: choice.outcome });
  return choice;
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted?.()) return true;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function registerOfflineApp() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  try {
    const baseUrl = import.meta.env.BASE_URL || '/';
    const serviceWorkerUrl = `${baseUrl}service-worker.js`;
    const registration = await navigator.serviceWorker.register(serviceWorkerUrl, {
      scope: baseUrl,
      updateViaCache: 'none',
    });

    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'MATH_NOTEBOOK_OFFLINE_READY') {
        emit(STATUS_EVENT, { ready: true, cacheName: event.data.cacheName });
      }
    });

    await navigator.serviceWorker.ready;
    const persistent = await requestPersistentStorage();
    emit(STATUS_EVENT, { ready: true, persistent });
    registration.active?.postMessage({ type: 'GET_OFFLINE_STATUS' });

    const update = () => {
      if (navigator.onLine) registration.update().catch(() => undefined);
    };
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') update();
    });
  } catch (error) {
    console.error('[Offline] Service Worker registration failed:', error);
    emit(STATUS_EVENT, { ready: false, error: error.message });
  }
}

export { INSTALL_EVENT, STATUS_EVENT };
