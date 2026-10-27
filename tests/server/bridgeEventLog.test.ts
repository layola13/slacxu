import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBridgeEventLogger } from "../../sdk-backend/src/bridgeEventLog.js";

describe("bridgeEventLog", () => {
  test("appends JSONL lines with timestamps under <dir>/logs", () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-log-"));
    try {
      const log = createBridgeEventLogger("cline", dir);
      expect(log.file).toBe(join(dir, "logs", "cline-bridge.log"));
      log.append({ kind: "hub-event", event: "tool.started" });
      log.append({ kind: "hub-event", event: "tool.finished" });
      const lines = readFileSync(log.file, "utf8").trim().split("\n");
      expect(lines).toHaveLength(2);
      const first = JSON.parse(lines[0]!) as Record<string, unknown>;
      expect(typeof first.ts).toBe("string");
      expect(first.backend).toBe("cline");
      expect(first.event).toBe("tool.started");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("CXU_BRIDGE_LOG=off disables writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-log-off-"));
    const prev = process.env.CXU_BRIDGE_LOG;
    process.env.CXU_BRIDGE_LOG = "off";
    try {
      const log = createBridgeEventLogger("auggie", dir);
      log.append({ kind: "frame" });
      expect(existsSync(log.file)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.CXU_BRIDGE_LOG;
      else process.env.CXU_BRIDGE_LOG = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rotates past 2 MiB keeping a single backup", () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-log-rot-"));
    try {
      const log = createBridgeEventLogger("command-code", dir);
      mkdirSync(join(dir, "logs"), { recursive: true });
      writeFileSync(join(dir, "logs", "command-code-bridge.log"), "x".repeat(2 * 1024 * 1024 + 1));
      log.append({ kind: "frame" });
      expect(existsSync(join(dir, "logs", "command-code-bridge.log.1"))).toBe(true);
      expect(existsSync(join(dir, "logs", "command-code-bridge.log"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("sanitizes backend names for the file path", () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-log-sani-"));
    try {
      const log = createBridgeEventLogger("../../evil", dir);
      expect(log.file).toBe(join(dir, "logs", "______evil-bridge.log"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
