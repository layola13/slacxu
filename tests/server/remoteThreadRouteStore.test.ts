import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteThreadRouteStore } from "../../apps/server/src/remoteThreadRouteStore";
import { openRuntimeDatabase } from "../../apps/server/src/runtime/database";

describe("remote thread route persistence", () => {
  test("keeps route identity across store instances", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-route-"));
    const first = openRuntimeDatabase(join(dir, "routes.sqlite"));
    const store = new RemoteThreadRouteStore({ connection: first });
    store.put({ threadId: "thread-1", command: "ssh user@example.com", cwd: "~/projects", remotePort: 43130, cliBackend: "claude" });
    expect(store.get("thread-1")?.remotePort).toBe(43130);
    expect(store.get("thread-1")?.lifecycleMode).toBe("background");
    expect(store.get("thread-1")?.cliBackend).toBe("claude");
    expect(store.get("thread-1")?.eventCursor).toBe(0);
    expect(store.setEventCursor("thread-1", 12)?.eventCursor).toBe(12);
    expect(store.setEventCursor("thread-1", 8)?.eventCursor).toBe(12);
    expect(store.setLifecycleMode("thread-1", "foreground")?.lifecycleMode).toBe("foreground");
    expect(store.put({ threadId: "thread-1", command: "ssh user@example.com", cwd: "~/next", remotePort: 43131 })).toMatchObject({ lifecycleMode: "foreground", cliBackend: "claude", eventCursor: 12, cwd: "~/next" });
    expect(store.list()).toHaveLength(1);
    first.close();
    const second = openRuntimeDatabase(join(dir, "routes.sqlite"));
    const restored = new RemoteThreadRouteStore({ connection: second }).get("thread-1");
    expect(restored?.command).toBe("ssh user@example.com");
    expect(restored?.eventCursor).toBe(12);
    expect(restored?.cliBackend).toBe("claude");
    second.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may briefly retain SQLite handles. */ }
  });
});
