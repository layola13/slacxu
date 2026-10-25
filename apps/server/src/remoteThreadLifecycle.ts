import type { RemoteThreadRoute, RemoteThreadRouteStore } from "./remoteThreadRouteStore.js";

export type RemoteThreadConnection = {
  getStatus(): unknown;
  stop(): void;
};

export type RemoteThreadLifecycleResult = {
  threadId: string;
  state: "foreground" | "background";
  remoteContinues: boolean;
  route: RemoteThreadRoute;
  status?: unknown;
};

export async function transitionRemoteThreadLifecycle(
  store: Pick<RemoteThreadRouteStore, "get" | "setLifecycleMode">,
  bridges: Map<string, RemoteThreadConnection>,
  restore: (threadId: string) => Promise<RemoteThreadConnection | null>,
  threadId: string,
  lifecycleMode: "foreground" | "background"
): Promise<RemoteThreadLifecycleResult> {
  const current = store.get(threadId);
  if (!current) throw new Error("Autonomous remote thread route not found");

  if (lifecycleMode === "foreground") {
    // Establish the remote control path first. A failed attach must leave the
    // persisted route in background mode so the UI never reports false success.
    const remote = await restore(threadId);
    if (!remote) throw new Error("Autonomous remote thread is unavailable");
    const route = store.setLifecycleMode(threadId, "foreground");
    if (!route) {
      remote.stop();
      bridges.delete(threadId);
      throw new Error("Autonomous remote thread route disappeared during attach");
    }
    return { threadId, state: "foreground", remoteContinues: true, route, status: remote.getStatus() };
  }

  // Dropping the local bridge does not stop the autonomous remote node. Persist
  // background only after local ownership has actually been released.
  bridges.get(threadId)?.stop();
  bridges.delete(threadId);
  const route = store.setLifecycleMode(threadId, "background");
  if (!route) throw new Error("Autonomous remote thread route disappeared during detach");
  return { threadId, state: "background", remoteContinues: true, route };
}
