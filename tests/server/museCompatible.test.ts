import "../../apps/server/src/pluginHostServices.js"; // register PluginHostServices for the code under test
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMuseExecArgs,
  buildMuseSaVmSettingsDir,
  findMuseBin,
  isMuseLoggedIn,
  isWithinDir,
  probeMuseCliCommand,
  resolveMuseScratchDirs,
  resolveMuseScratchRoot,
  sanitizePathSegment,
} from "../../backends/muse/src/runtime/museCompatibleProbe.js";
import {
  findMuseChildSessionLog,
  findMuseSessionLog,
  projectMuseJsonlLine,
  readMuseChildSessionLog,
  removeLegacyMuseWorkspaceDirs,
} from "../../backends/muse/src/runtime/museCompatibleRuntime.js";
import { buildMuseOfficialProvider, MUSE_OFFICIAL_PROVIDER_ID, MuseBridge } from "../../backends/muse/src/runtime/museBridge.js";

describe("museCompatibleProbe", () => {
  test("findMuseBin honors MUSE_BIN override", () => {
    const bin = findMuseBin({ ...process.env, MUSE_BIN: "/tmp/definitely-not-muse" } as NodeJS.ProcessEnv);
    expect(typeof bin).toBe("string");
  });

  test("probe reports availability shape", () => {
    const result = probeMuseCliCommand(findMuseBin());
    expect(typeof result.available).toBe("boolean");
    expect(typeof result.binPath).toBe("string");
  });

  test("isMuseLoggedIn honors META_API_KEY", () => {
    expect(isMuseLoggedIn({ ...process.env, META_API_KEY: "test-key" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isMuseLoggedIn({ ...process.env, META_API_KEY: "", HOME: "/tmp/no-home-muse-xyz", USERPROFILE: "", MUSE_AUTH_PATH: "/tmp/no-auth-muse-xyz.json" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  test("buildMuseExecArgs official mode has no base-url", () => {
    const args = buildMuseExecArgs({ prompt: "hello", model: "muse-spark-1.3" });
    expect(args).toContain("exec");
    expect(args).toContain("--json");
    expect(args).toContain("--provider");
    expect(args).toContain("meta");
    expect(args).not.toContain("--base-url");
    expect(args[args.length - 1]).toBe("hello");
  });

  test("buildMuseExecArgs relay mode carries base-url", () => {
    const args = buildMuseExecArgs({ prompt: "hi", baseUrl: "https://api.kilo.ai/api/openrouter", model: "kilo-auto/free" });
    const idx = args.indexOf("--base-url");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("https://api.kilo.ai/api/openrouter");
  });

  test("buildMuseExecArgs excludes foreign personal context (project-only skills)", () => {
    // 自动化 turn 只加载当前工程 skills：用户级 rules/skills 必须排除。
    // 当前工程 skills 仍由 --workspace + --trust-workspace 加载。
    const args = buildMuseExecArgs({ prompt: "hi", workspace: "/tmp/proj" });
    expect(args).toContain("--no-foreign-personal-context");
    expect(args).toContain("--trust-workspace");
    expect(args).toContain("/tmp/proj");
  });

  test("resolveMuseScratchDirs stays under user home, never the workspace", () => {
    const env = { ...process.env, HOME: join(tmpdir(), "muse-home-xyz"), USERPROFILE: "" } as NodeJS.ProcessEnv;
    const dirs = resolveMuseScratchDirs("thread-abc123", env);
    expect(dirs.root).toBe(join(env.HOME as string, ".codex-ultra", "muse-scratch"));
    expect(dirs.dataDir).toBe(join(dirs.root, "data"));
    expect(dirs.configDir).toBe(join(dirs.root, "config-thread-abc123"));
    expect(dirs.promptsDir).toBe(join(dirs.root, "prompts-thread-abc123"));
    // workspace 路径里有 thread 字样也不得影响：结果与 cwd 无关
    expect(dirs.root.includes("muse-data")).toBe(false);
  });

  test("resolveMuseScratchRoot honors override and sanitizes thread tag", () => {
    const env = { ...process.env, MUSE_SCRATCH_DIR: join(tmpdir(), "muse-override-xyz") } as NodeJS.ProcessEnv;
    expect(resolveMuseScratchRoot(env)).toBe(join(tmpdir(), "muse-override-xyz"));
    const root = join(tmpdir(), "muse-override-xyz");
    const dirs = resolveMuseScratchDirs("../../evil|name ..", env);
    // 恶意穿越序列被压平成单层目录名，仍在 root 之内
    expect(isWithinDir(root, dirs.configDir)).toBe(true);
    expect(isWithinDir(root, dirs.promptsDir)).toBe(true);
    expect(sanitizePathSegment("")).toBe("thread");
  });

  test("isWithinDir guards recursive deletes", () => {
    const root = join(tmpdir(), "muse-guard-xyz");
    expect(isWithinDir(root, join(root, "sub", "session.jsonl"))).toBe(true);
    expect(isWithinDir(root, root)).toBe(false);
    expect(isWithinDir(root, join(tmpdir(), "other", "x"))).toBe(false);
    expect(isWithinDir(root, join(root, "..", "escape"))).toBe(false);
  });

  test("removeLegacyMuseWorkspaceDirs drops only our three litter dirs", () => {
    const cwd = mkdtempSync(join(tmpdir(), "muse-legacy-"));
    const keep = join(cwd, ".codex-ultra", "keep-me.txt");
    mkdirSync(join(cwd, ".codex-ultra", "muse-data", "muse", "skills"), { recursive: true });
    mkdirSync(join(cwd, ".codex-ultra", "muse-config"), { recursive: true });
    writeFileSync(join(cwd, ".codex-ultra", "muse-data", "junk.txt"), "x", "utf8");
    writeFileSync(keep, "keep", "utf8");
    removeLegacyMuseWorkspaceDirs(cwd);
    expect(existsSync(join(cwd, ".codex-ultra", "muse-data"))).toBe(false);
    expect(existsSync(join(cwd, ".codex-ultra", "muse-config"))).toBe(false);
    expect(readFileSync(keep, "utf8")).toBe("keep");
    // 幂等：二次调用不抛错
    removeLegacyMuseWorkspaceDirs(cwd);
  });

  test("buildMuseSaVmSettingsDir honors xdgRoot override (scratch config)", () => {
    const cwd = mkdtempSync(join(tmpdir(), "muse-sa-vm-"));
    const scriptPath = join(cwd, "sa-vm-mcp.mjs");
    writeFileSync(scriptPath, "// stub", "utf8");
    const xdgRoot = join(mkdtempSync(join(tmpdir(), "muse-xdg-")), "config-t1");
    const dir = buildMuseSaVmSettingsDir({
      cwd,
      xdgRoot,
      scriptPath,
      token: "tok-xyz",
      apiUrl: "http://127.0.0.1:43121",
      env: { ...process.env, HOME: "/tmp/no-home-muse-xyz", XDG_CONFIG_HOME: "/tmp/no-xdg-muse-xyz", MUSE_AUTH_PATH: "/tmp/no-auth-muse-xyz.json" },
    });
    expect(dir).toBe(xdgRoot);
    const settings = JSON.parse(readFileSync(join(xdgRoot, "muse", "settings.json"), "utf8"));
    expect(settings.mcpServers["sa-vm"].args).toEqual([scriptPath]);
    // 默认行为不变：仍写 <cwd>/.codex-ultra/muse-config（向后兼容）
    const legacy = buildMuseSaVmSettingsDir({ cwd, scriptPath, env: { ...process.env } });
    expect(legacy).toBe(join(cwd, ".codex-ultra", "muse-config"));
  });

  test("buildMuseSaVmSettingsDir writes muse settings.json with sa-vm MCP (verified 1.4.7 shape)", () => {
    const cwd = mkdtempSync(join(tmpdir(), "muse-sa-vm-"));
    const scriptPath = join(cwd, "sa-vm-mcp.mjs");
    writeFileSync(scriptPath, "// stub", "utf8");
    const dir = buildMuseSaVmSettingsDir({
      cwd,
      scriptPath,
      token: "tok-123",
      apiUrl: "http://127.0.0.1:43121",
      env: { ...process.env, HOME: "/tmp/no-home-muse-xyz", XDG_CONFIG_HOME: "/tmp/no-xdg-muse-xyz", MUSE_AUTH_PATH: "/tmp/no-auth-muse-xyz.json" },
    });
    expect(typeof dir).toBe("string");
    const settings = JSON.parse(readFileSync(join(dir as string, "muse", "settings.json"), "utf8"));
    expect(settings.schema_version).toBe(1);
    const entry = settings.mcpServers["sa-vm"];
    expect(entry.command).toBe("node");
    expect(entry.args).toEqual([scriptPath]);
    expect(entry.env.CODEX_UI_TOKEN).toBe("tok-123");
    expect(entry.env.CODEX_UI_API_URL).toBe("http://127.0.0.1:43121");
    expect(entry.env.MUSE_SA_VM_ENVELOPE).toBe("1");
  });

  test("buildMuseSaVmSettingsDir returns undefined without script", () => {
    const cwd = mkdtempSync(join(tmpdir(), "muse-sa-vm-"));
    expect(buildMuseSaVmSettingsDir({ cwd, scriptPath: "" })).toBeUndefined();
  });
});

describe("museCompatibleRuntime projection", () => {
  test("projects run.output.delta text", () => {
    const acc = { text: "" };
    const line = JSON.stringify({ payload_type: "run.output.delta", payload: { text: "echo: hi" } });
    expect(projectMuseJsonlLine(line, acc)).toBe(true);
    expect(acc.text).toBe("echo: hi");
  });

  test("ignores non-JSON stderr lines", () => {
    const acc = { text: "" };
    expect(projectMuseJsonlLine("muse: workspace root: /tmp (cwd default)", acc)).toBe(false);
    expect(acc.text).toBe("");
  });
});

describe("muse session-log discovery (A->B->C start order)", () => {
  test("finds <dataDir>/muse/sessions/<date>/<sid>/session.jsonl", () => {
    const root = mkdtempSync(join(tmpdir(), "muse-sess-"));
    const sid = "11111111-2222-4333-8444-555555555555";
    const dir = join(root, "muse", "sessions", "2026-10-13", sid);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "session.jsonl"), "{}\n", "utf8");
    expect(findMuseSessionLog(root, sid)).toBe(join(dir, "session.jsonl"));
    expect(findMuseSessionLog(root, "no-such-sid")).toBeNull();
    expect(findMuseSessionLog(join(tmpdir(), "muse-sess-missing-xyz"), sid)).toBeNull();
  });

  test("finds nested <dataDir>/muse/sessions/<YYYY>/<MM>/<DD>/<sid>/session.jsonl (3 levels)", () => {
    const root = mkdtempSync(join(tmpdir(), "muse-sess-nested-"));
    const sid = "22222222-3333-4444-8555-666666666666";
    const dir = join(root, "muse", "sessions", "2026", "10", "19", sid);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "session.jsonl"), "{}\n", "utf8");
    expect(findMuseSessionLog(root, sid)).toBe(join(dir, "session.jsonl"));
  });
});

describe("museBridge official provider", () => {
  test("builds muse-official provider", () => {
    const provider = buildMuseOfficialProvider();
    expect(provider.id).toBe(MUSE_OFFICIAL_PROVIDER_ID);
    expect(provider.stationType).toBe("official");
    expect(provider.groups?.[0]?.id).toBe("default");
  });
});

describe("muse child session transcripts", () => {
  function writeChildLog(root: string, parentId: string, childId: string): string {
    const dir = join(root, "data", "muse", "sessions", "2026", "10", "22", parentId, "subagent", childId);
    mkdirSync(dir, { recursive: true });
    const records = [
      { recorded_at: "2026-10-22T03:00:00.000Z", payload_type: "runtime.session", payload: { event: { kind: "reasoning_committed", text: "inspect the file" } } },
      {
        recorded_at: "2026-10-22T03:00:01.000Z",
        payload_type: "runtime.session",
        payload: { event: { kind: "assistant_tool_calls_committed", tool_calls: [{ name: "read_file", call_id: "call-1", args: "{\"path\":\"/tmp/hello.txt\"}" }] } },
      },
      {
        recorded_at: "2026-10-22T03:00:02.000Z",
        payload_type: "tool_batch.effect.terminal",
        payload: { record: { call_id: "call-1", tool_name: "read_file", outcome: { kind: "completed" }, output: "HELLO_FROM_MUSE_REAL" } },
      },
      { recorded_at: "2026-10-22T03:00:03.000Z", payload_type: "runtime.session", payload: { event: { kind: "terminal", terminal: "completed" } } },
    ];
    const logPath = join(dir, "session.jsonl");
    writeFileSync(logPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    return logPath;
  }

  test("finds a subagent log under the parent session and projects its items", () => {
    const root = mkdtempSync(join(tmpdir(), "muse-child-"));
    const previous = process.env.MUSE_SCRATCH_DIR;
    process.env.MUSE_SCRATCH_DIR = root;
    try {
      const parentId = "parent-thread-1";
      const childId = "child-session-1";
      const logPath = writeChildLog(root, parentId, childId);
      expect(findMuseChildSessionLog(childId)).toBe(logPath);
      const projection = readMuseChildSessionLog(childId);
      expect(projection?.status).toBe("completed");
      expect(projection?.items.some((item) => item.type === "reasoning")).toBe(true);
      const tool = projection?.items.find((item) => item.type === "toolCall");
      expect(tool?.name).toBe("read_file");
      expect(String(tool?.output ?? "")).toContain("HELLO_FROM_MUSE_REAL");
    } finally {
      if (previous === undefined) delete process.env.MUSE_SCRATCH_DIR;
      else process.env.MUSE_SCRATCH_DIR = previous;
    }
  });

  test("thread/read opens the child card instead of failing as an unknown thread", async () => {
    const root = mkdtempSync(join(tmpdir(), "muse-child-rpc-"));
    const previous = process.env.MUSE_SCRATCH_DIR;
    process.env.MUSE_SCRATCH_DIR = root;
    try {
      const childId = "child-session-rpc";
      writeChildLog(root, "parent-thread-rpc", childId);
      const bridge = new MuseBridge();
      expect(bridge.hasChildThread(childId)).toBe(true);
      const result = (await bridge.request("thread/read", { threadId: childId, includeTurns: true })) as Record<string, any>;
      expect(result.thread.cliBackend).toBe("muse");
      expect(result.thread.turns[0].items.length).toBeGreaterThan(0);
      expect(result.thread.status.type).toBe("idle");
    } finally {
      if (previous === undefined) delete process.env.MUSE_SCRATCH_DIR;
      else process.env.MUSE_SCRATCH_DIR = previous;
    }
  });
});
