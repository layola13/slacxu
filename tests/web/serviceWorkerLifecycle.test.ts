import { expect, test } from "bun:test";
import {
  currentWebBuildId,
  serviceWorkerScriptUrl,
  setupPwaServiceWorker,
  shouldReloadForController,
} from "../../apps/web/src/app/pwa/serviceWorkerLifecycle.ts";

test("reads the production build id and uses one stable no-cache worker URL", () => {
  const document = {
    querySelector: () => ({ content: "build-42" }),
  } as unknown as Document;
  expect(currentWebBuildId(document)).toBe("build-42");
  expect(serviceWorkerScriptUrl()).toBe("/sw.js");
});

test("reloads once per controller build", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  expect(shouldReloadForController("build-a", storage)).toBe(true);
  expect(shouldReloadForController("build-a", storage)).toBe(false);
  expect(shouldReloadForController("build-b", storage)).toBe(true);
});

test("registers without HTTP cache and reloads once for one controller", async () => {
  const listeners = new Set<() => void>();
  const controller = {} as ServiceWorker;
  const updateCalls: number[] = [];
  const serviceWorker = {
    controller,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    register: async (url: string, options: RegistrationOptions) => {
      expect(url).toBe("/sw.js");
      expect(options.updateViaCache).toBe("none");
      return { update: async () => { updateCalls.push(1); } };
    },
  };
  let reloads = 0;
  const release = await setupPwaServiceWorker({
    navigator: { serviceWorker } as unknown as Navigator,
    document: {} as Document,
    reload: () => { reloads += 1; },
  });
  for (const listener of listeners) listener();
  for (const listener of listeners) listener();
  expect(updateCalls).toHaveLength(1);
  expect(reloads).toBe(1);
  release();
  expect(listeners.size).toBe(0);
});

test("does not reload when the current build installs its first controller", async () => {
  const listeners = new Set<() => void>();
  const serviceWorker = {
    controller: null as ServiceWorker | null,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    register: async () => ({ update: async () => undefined }),
  };
  let reloads = 0;
  await setupPwaServiceWorker({
    navigator: { serviceWorker } as unknown as Navigator,
    document: {} as Document,
    reload: () => { reloads += 1; },
  });
  serviceWorker.controller = {} as ServiceWorker;
  for (const listener of listeners) listener();
  expect(reloads).toBe(0);
});
