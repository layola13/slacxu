import { describe, expect, test } from "bun:test";
import { transitionRemoteThreadLifecycle, type RemoteThreadConnection } from "../../apps/server/src/remoteThreadLifecycle";
import type { RemoteThreadRoute } from "../../apps/server/src/remoteThreadRouteStore";

function fixture(initial: "foreground" | "background" = "background") {
  let route: RemoteThreadRoute = {
    threadId: "thread-1", command: "ssh host", cwd: "/home/user", remotePort: 43130,
    lifecycleMode: initial, eventCursor: 0, createdAt: 1, updatedAt: 1
  };
  const store = {
    get: (threadId: string) => threadId === route.threadId ? route : null,
    setLifecycleMode: (threadId: string, lifecycleMode: "foreground" | "background") => {
      if (threadId !== route.threadId) return null;
      route = { ...route, lifecycleMode, updatedAt: route.updatedAt + 1 };
      return route;
    }
  };
  return { store, route: () => route };
}

describe("remote thread lifecycle transition", () => {
  test("persists foreground only after attach succeeds", async () => {
    const state = fixture();
    await expect(transitionRemoteThreadLifecycle(state.store, new Map(), async () => { throw new Error("SSH unavailable"); }, "thread-1", "foreground")).rejects.toThrow("SSH unavailable");
    expect(state.route().lifecycleMode).toBe("background");
  });

  test("detaches the local bridge before persisting background", async () => {
    const state = fixture("foreground");
    let stopped = false;
    const bridge: RemoteThreadConnection = { getStatus: () => ({ phase: "ready" }), stop: () => { stopped = true; } };
    const bridges = new Map([["thread-1", bridge]]);
    const result = await transitionRemoteThreadLifecycle(state.store, bridges, async () => bridge, "thread-1", "background");
    expect(stopped).toBe(true);
    expect(bridges.has("thread-1")).toBe(false);
    expect(result.state).toBe("background");
    expect(state.route().lifecycleMode).toBe("background");
  });

  test("attaches idempotently and returns the remote status", async () => {
    const state = fixture();
    const bridge: RemoteThreadConnection = { getStatus: () => ({ phase: "ready" }), stop: () => undefined };
    const bridges = new Map([["thread-1", bridge]]);
    const result = await transitionRemoteThreadLifecycle(state.store, bridges, async () => bridge, "thread-1", "foreground");
    expect(result.status).toEqual({ phase: "ready" });
    expect(state.route().lifecycleMode).toBe("foreground");
  });
});
