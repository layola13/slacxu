import { describe, expect, test } from "bun:test";
import { SshCodexBridge } from "../../backends/codex/src/runtime/sshCodexBridge";

type TestBridgeInternals = {
  child: { stdin: { write(value: string): boolean }; kill(signal?: string): boolean } | null;
  start(): Promise<unknown>;
  handleLine(line: string): void;
};

describe("direct SSH Codex bridge recovery", () => {
  test("starts a stopped app-server before writing a request", async () => {
    const bridge = new SshCodexBridge({ command: "ssh test@example", cwd: "/work" });
    const internal = bridge as unknown as TestBridgeInternals;
    let starts = 0;
    let writtenMethod = "";
    internal.start = async () => {
      starts += 1;
      internal.child = {
        kill: () => true,
        stdin: {
          write(value) {
            const request = JSON.parse(value) as { id: number; method: string };
            writtenMethod = request.method;
            queueMicrotask(() => internal.handleLine(JSON.stringify({ id: request.id, result: { ok: true } })));
            return true;
          }
        }
      };
      return {};
    };

    await expect(bridge.request("thread/read", { threadId: "thread" })).resolves.toEqual({ ok: true });
    expect(starts).toBe(1);
    expect(writtenMethod).toBe("thread/read");
  });

  test("stopping an already exited app-server succeeds without restarting", async () => {
    const bridge = new SshCodexBridge({ command: "ssh test@example", cwd: "/work" });
    const internal = bridge as unknown as TestBridgeInternals;
    let starts = 0;
    internal.start = async () => { starts += 1; return {}; };

    await expect(bridge.request("turn/interrupt", { threadId: "thread", turnId: "turn" })).resolves.toEqual({});
    expect(starts).toBe(0);
  });

  test("forces a hung app-server closed and restarts for the next send", async () => {
    const bridge = new SshCodexBridge({ command: "ssh test@example", cwd: "/work" });
    const internal = bridge as unknown as TestBridgeInternals;
    let killed = false;
    internal.child = {
      kill: () => { killed = true; return true; },
      stdin: { write: () => true }
    };

    await expect(bridge.request("turn/interrupt", { threadId: "thread", turnId: "turn" }, 5)).resolves.toEqual({});
    expect(killed).toBe(true);
    expect(bridge.getStatus().phase).toBe("stopped");

    let starts = 0;
    internal.start = async () => {
      starts += 1;
      internal.child = {
        kill: () => true,
        stdin: {
          write(value) {
            const request = JSON.parse(value) as { id: number };
            queueMicrotask(() => internal.handleLine(JSON.stringify({ id: request.id, result: { accepted: true } })));
            return true;
          }
        }
      };
      return {};
    };

    await expect(bridge.request("turn/start", { threadId: "thread" })).resolves.toEqual({ accepted: true });
    expect(starts).toBe(1);
  });
});
