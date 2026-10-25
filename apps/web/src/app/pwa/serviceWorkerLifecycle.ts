const CONTROLLER_RELOAD_BUILD_KEY = "codex-ultra.service-worker-controller-build";
const handledControllers = new WeakSet<ServiceWorker>();

export function currentWebBuildId(document: Document): string {
  return document.querySelector<HTMLMetaElement>('meta[name="codex-react-ui-build"]')?.content.trim() || "development";
}

export function serviceWorkerScriptUrl(): string {
  // Cache freshness is controlled by updateViaCache and the server's no-store
  // response. Keeping one script URL avoids a second activation after the new
  // document has already loaded the same worker under a new build query.
  return "/sw.js";
}

export function shouldReloadForController(buildId: string, storage: Pick<Storage, "getItem" | "setItem">): boolean {
  if (storage.getItem(CONTROLLER_RELOAD_BUILD_KEY) === buildId) return false;
  storage.setItem(CONTROLLER_RELOAD_BUILD_KEY, buildId);
  return true;
}

export async function setupPwaServiceWorker(input: {
  navigator: Navigator;
  document: Document;
  reload: () => void;
}): Promise<() => void> {
  const serviceWorker = input.navigator.serviceWorker;
  const replacingExistingController = Boolean(serviceWorker.controller);
  let reloadScheduled = false;
  const onControllerChange = () => {
    const controller = serviceWorker.controller;
    if (!replacingExistingController || reloadScheduled || (controller && handledControllers.has(controller))) return;
    if (controller) handledControllers.add(controller);
    reloadScheduled = true;
    input.reload();
  };
  serviceWorker.addEventListener("controllerchange", onControllerChange);
  try {
    const registration = await serviceWorker.register(serviceWorkerScriptUrl(), { updateViaCache: "none" });
    await registration.update();
  } catch (error) {
    serviceWorker.removeEventListener("controllerchange", onControllerChange);
    throw error;
  }
  return () => serviceWorker.removeEventListener("controllerchange", onControllerChange);
}

export async function cleanupDesktopServiceWorkers(input: {
  navigator: Navigator;
  document: Document;
  storage: Pick<Storage, "getItem" | "setItem">;
  reload: () => void;
}): Promise<void> {
  const serviceWorker = input.navigator.serviceWorker;
  const controlled = Boolean(serviceWorker.controller);
  const registrations = await serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if (controlled && shouldReloadForController(`desktop:${currentWebBuildId(input.document)}`, input.storage)) {
    input.reload();
  }
}
