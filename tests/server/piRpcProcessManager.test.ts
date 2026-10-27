import "../../apps/server/src/pluginHostServices.js"; // register PluginHostServices for the code under test
import { describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  PiRpcProcessManager,
  BUILTIN_PI_RELAY_EXTENSION_CODE,
  defaultPiCliPath,
  defaultPiRelayExtensionDir,
  defaultPiSessionDir,
  defaultPiSourceDir,
  ensurePiRelayExtensionDir,
  isValidPiRelayExtensionDir,
  resolveExistingPiRelayExtensionDir,
  type PiProcessConfig,
} from "../../backends/pi/src/runtime/piRpcProcessManager.ts";

describe("PiRpcProcessManager configuration and paths", () => {
  test("resolves default Pi source and CLI paths", () => {
    const sourceDir = defaultPiSourceDir();
    expect(existsSync(sourceDir)).toBe(true);

    const cliPath = defaultPiCliPath();
    expect(typeof cliPath).toBe("string");
    expect(cliPath.length).toBeGreaterThan(0);

    const extDir = defaultPiRelayExtensionDir();
    expect(existsSync(extDir)).toBe(true);
    expect(isValidPiRelayExtensionDir(extDir)).toBe(true);
  });

  test("isValidPiRelayExtensionDir identifies valid directories with index.js", () => {
    expect(isValidPiRelayExtensionDir(defaultPiRelayExtensionDir())).toBe(true);
    expect(isValidPiRelayExtensionDir(tmpdir())).toBe(false);
  });

  test("ensurePiRelayExtensionDir materializes built-in extension in isolated directory", () => {
    const isolatedDataDir = join(tmpdir(), `pi-ext-test-${Date.now()}`);
    try {
      const ensured = ensurePiRelayExtensionDir({
        CODEX_UI_DATA_DIR: isolatedDataDir,
        CODEX_UI_PI_RELAY_EXTENSION: join(isolatedDataDir, "nonexistent-override"),
      });
      expect(existsSync(ensured)).toBe(true);
      expect(isValidPiRelayExtensionDir(ensured)).toBe(true);
      expect(existsSync(join(ensured, "index.js"))).toBe(true);
      expect(existsSync(join(ensured, "package.json"))).toBe(true);
    } finally {
      rmSync(isolatedDataDir, { recursive: true, force: true });
    }
  });

  test("sessionDir resolves to codexUiDataDir/pi-sessions by default", () => {
    const dir = defaultPiSessionDir();
    expect(dir).toContain("pi-sessions");
  });

  test("built-in pi-relay extension sends dedicated UA and thread-stable OpenCode session headers", () => {
    // Dedicated client identity (never a generic library name); kilo.ai keeps its mandated provider UA.
    expect(BUILTIN_PI_RELAY_EXTENSION_CODE).toContain('"User-Agent": "codex-ultra-pi/1.0"');
    expect(BUILTIN_PI_RELAY_EXTENSION_CODE).toContain('headers["User-Agent"] = "opencode-kilo-provider"');
    expect(BUILTIN_PI_RELAY_EXTENSION_CODE).not.toContain("curl/");
    // Stable per-conversation session from the manager-exported env (derived from thread id).
    expect(BUILTIN_PI_RELAY_EXTENSION_CODE).toContain("PI_LAUNCH_OPENCODE_SESSION");
    expect(BUILTIN_PI_RELAY_EXTENSION_CODE).toContain('"x-opencode-session": openCodeSession');
    expect(BUILTIN_PI_RELAY_EXTENSION_CODE).toContain('"x-opencode-client"');
    expect(BUILTIN_PI_RELAY_EXTENSION_CODE).toContain('"x-opencode-project"');
  });

  test("command-specific ACK timeout leaves the normal ACK timeout unchanged", async () => {
    const manager = new PiRpcProcessManager({
      threadId: "test-interrupt-timeout",
      workspaceCwd: process.cwd(),
      ackTimeoutMs: 100,
    });
    (manager as any).child = { stdin: { writable: true, write: () => true } };
    const timeoutEvents: string[] = [];
    manager.on("timeout", (event) => timeoutEvents.push(event.details));

    await expect(manager.sendCommand({ type: "abort" }, { ackTimeoutMs: 5 })).rejects.toThrow("5ms");
    await expect(manager.sendCommand({ type: "get_state" })).rejects.toThrow("100ms");

    expect(timeoutEvents).toEqual([
      expect.stringContaining("5ms"),
      expect.stringContaining("100ms"),
    ]);
  });
});

describe("PiRpcProcessManager live lifecycle", () => {
  test("starts process, verifies alive, sends get_state and stops gracefully", async () => {
    const localRpcEntry = [
      resolve("pi/packages/coding-agent/dist/rpc-entry.js"),
      "E:\\projects\\pi\\packages\\coding-agent\\dist\\rpc-entry.js",
    ].find((p) => existsSync(p));
    if (localRpcEntry && !process.env.PI_BIN) {
      process.env.PI_BIN = localRpcEntry;
    }
    const config: PiProcessConfig = {
      threadId: "test-thread-uuid-001",
      workspaceCwd: process.cwd(),
      model: "pi-relay/stepfun/step-3.7-flash:free",
      relayConfig: {
        baseUrl: "https://api.kilo.ai/api/openrouter",
        apiKey: "public",
        api: "openai-completions",
        model: "stepfun/step-3.7-flash:free",
      },
      ackTimeoutMs: 15_000,
      turnTimeoutMs: 30_000,
      idleTimeoutMs: 60_000,
    };

    const manager = new PiRpcProcessManager(config);
    expect(manager.isRunning()).toBe(false);

    manager.start();
    expect(manager.isRunning()).toBe(true);
    expect(manager.pid).toBeGreaterThan(0);

    // Send get_state
    const stateResp = await manager.sendCommand({ type: "get_state" });
    expect(stateResp).toBeDefined();
    expect(stateResp.type).toBe("response");
    expect(stateResp.command).toBe("get_state");
    expect(stateResp.success).toBe(true);

    // Stop process
    manager.stop(1000);
    await new Promise((r) => setTimeout(r, 500));
    expect(manager.isRunning()).toBe(false);
  }, 20_000);
});
