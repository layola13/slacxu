import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findOpencodeV2Bin,
  isOpencodeV2Version,
} from "../../backends/opencode/src/runtime/opencodeCompatibleProbe.js";
import {
  buildOpencodeConfigContent,
  buildOpencodeIsolationEnv,
  fingerprintOpencodeProcessConfig,
} from "../../backends/opencode/src/runtime/opencodeCompatibleProcessManager.js";

function fakeOpencodeDir(version: string, name = "opencode"): string {
  const dir = mkdtempSync(join(tmpdir(), "opencode-v2-test-"));
  const bin = join(dir, name);
  writeFileSync(bin, `#!/bin/sh\necho "${version}"\n`);
  chmodSync(bin, 0o755);
  return dir;
}

function fakeHomeWithBin(version: string, name: string): string {
  const home = mkdtempSync(join(tmpdir(), "opencode-v2-home-"));
  const binDir = join(home, ".opencode", "bin");
  const { mkdirSync } = require("node:fs") as typeof import("node:fs");
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, name);
  writeFileSync(bin, `#!/bin/sh\necho "${version}"\n`);
  chmodSync(bin, 0o755);
  return home;
}

const isolatedEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  PATH: "/nonexistent",
  HOME: mkdtempSync(join(tmpdir(), "opencode-v2-home-")),
  ...extra,
});

describe("isOpencodeV2Version", () => {
  test("accepts the v2 line only", () => {
    expect(isOpencodeV2Version("2.0.0")).toBe(true);
    expect(isOpencodeV2Version("2.1.3")).toBe(true);
    expect(isOpencodeV2Version("1.19.4")).toBe(false);
    expect(isOpencodeV2Version("0.9.0")).toBe(false);
    expect(isOpencodeV2Version(undefined)).toBe(false);
    expect(isOpencodeV2Version("")).toBe(false);
  });
});

describe("findOpencodeV2Bin", () => {
  test("explicit override is authoritative", () => {
    expect(findOpencodeV2Bin(isolatedEnv({ OPENCODE_V2_BIN: "/custom/opencode-v2" }))).toBe("/custom/opencode-v2");
  });
  test("finds a v2 binary via OPENCODE_V2_INSTALL_DIR", () => {
    const dir = fakeOpencodeDir("2.1.3");
    expect(findOpencodeV2Bin(isolatedEnv({ OPENCODE_V2_INSTALL_DIR: dir }))).toBe(join(dir, "opencode"));
  });
  test("accepts the official version string format 'opencode v2.1.3'", () => {
    const dir = fakeOpencodeDir("opencode v2.1.3");
    expect(findOpencodeV2Bin(isolatedEnv({ OPENCODE_V2_INSTALL_DIR: dir }))).toBe(join(dir, "opencode"));
  });
  test("opencode2 qualifies by name even without a v2 version string", () => {
    const dir = fakeOpencodeDir("0.0.0-beta-19271", "opencode2");
    expect(findOpencodeV2Bin(isolatedEnv({ OPENCODE_V2_INSTALL_DIR: dir }))).toBe(join(dir, "opencode2"));
  });
  test("finds opencode2 in the shared ~/.opencode/bin install dir", () => {
    const home = fakeHomeWithBin("opencode v2.1.3", "opencode2");
    expect(findOpencodeV2Bin(isolatedEnv({ HOME: home }))).toBe(join(home, ".opencode", "bin", "opencode2"));
  });
  test("rejects a v1 binary in the install dir", () => {
    const dir = fakeOpencodeDir("1.19.4");
    expect(findOpencodeV2Bin(isolatedEnv({ OPENCODE_V2_INSTALL_DIR: dir }))).toBe("");
  });
  test("returns empty string when nothing qualifies", () => {
    expect(findOpencodeV2Bin(isolatedEnv())).toBe("");
  });
});

describe("opencode v2 process flavor", () => {
  test("pass-through config content omits the v1-only strip plugin but keeps restrictions", () => {
    const v2 = JSON.parse(buildOpencodeConfigContent(false, undefined, undefined, true, 2));
    expect(v2.permission).toEqual({ "*": "deny" });
    expect(v2.tools).toEqual({ "*": false, read: true });
    expect(v2.compaction).toEqual({ auto: false, prune: false });
    expect("plugin" in v2).toBe(false);
    expect("mcp" in v2).toBe(false);
    const v1 = JSON.parse(buildOpencodeConfigContent(false, undefined, undefined, true, 1));
    expect(Array.isArray(v1.plugin)).toBe(true);
  });
  test("v2 isolation env only carries flags the v2 line honors", () => {
    const env = buildOpencodeIsolationEnv(process.platform, 2);
    expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE).toBe("1");
    expect("OPENCODE_DISABLE_EXTERNAL_SKILLS" in env).toBe(false);
    expect("OPENCODE_DISABLE_DEFAULT_PLUGINS" in env).toBe(false);
    expect("OPENCODE_PURE" in env).toBe(false);
    const v1 = buildOpencodeIsolationEnv(process.platform, 1);
    expect(v1.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBe("1");
    expect(v1.OPENCODE_PURE).toBe("0");
  });
  test("process fingerprint separates v1 and v2 servers", () => {
    const base = { binPath: "/bin/opencode", cwd: "/tmp" };
    expect(fingerprintOpencodeProcessConfig({ ...base, apiVersion: 1 }))
      .not.toBe(fingerprintOpencodeProcessConfig({ ...base, apiVersion: 2 }));
  });
});
