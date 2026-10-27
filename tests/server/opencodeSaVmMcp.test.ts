import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildOpencodeConfigContent,
  buildOpencodeIsolationEnv,
  buildOpencodeSaVmMcpEntry,
  ensureOpencodePassThroughPlugin,
  opencodeIsolationDir,
  opencodePassThroughPluginPath,
} from "../../backends/opencode/src/runtime/opencodeCompatibleProcessManager.js";
import {
  OpencodeBridge,
  buildOpencodeModelPrompt,
  isOpencodeGoModel,
  isOpencodePassThroughModel,
  resolveOpencodeSaVmMcp,
  type OpencodeSessionSnapshot,
} from "../../backends/opencode/src/runtime/opencodeBridge.js";
import {
  SA_VM_MCP_SCRIPT_NAME,
  isJevMcpEnabled,
  mergeMcpServersJsonConfig,
  mergeMiniAgentTomlMcpConfig,
  mergeOpencodeMcpConfig,
} from "../../apps/server/src/saVmBundle.js";
import { workspaceSaVmSkillPath } from "../../apps/server/src/saVmWorkspaceSkill.js";
import { saVmDeveloperInstructions } from "../../apps/server/src/workbenchControlApi.js";

describe("opencode sa-vm MCP config injection", () => {
  test("omits mcp when no saVmMcp is given (back-compat)", () => {
    const parsed = JSON.parse(buildOpencodeConfigContent(true));
    expect(parsed.permission).toEqual({ "*": "allow" });
    expect(parsed.compaction.auto).toBe(true);
    expect(parsed.mcp).toBeUndefined();
  });

  test("injects sa-vm in v1 and v2 shapes for paid models while preserving permission + relay", () => {
    const scriptPath = "C:/data/sa-vm/sa-vm-mcp.mjs";
    const parsed = JSON.parse(
      buildOpencodeConfigContent(false, {
        providerId: "codex-relay",
        baseURL: "http://127.0.0.1:43121/api/relay-gateway/x/y/v1",
        apiKey: "loopback",
        models: ["gpt-5.6-luna"],
      }, { scriptPath }),
    );
    expect(parsed.permission).toEqual({ "*": "ask" });
    expect(parsed.provider["codex-relay"].models["gpt-5.6-luna"]).toBeDefined();
    expect(parsed.mcp["sa-vm"]).toEqual(buildOpencodeSaVmMcpEntry(scriptPath));
    expect(parsed.mcp["sa-vm"].command).toEqual(["node", scriptPath]);
    expect(parsed.mcp.servers["sa-vm"].command).toEqual(["node", scriptPath]);
  });

  test("disabled saVmMcp skips the injection", () => {
    const parsed = JSON.parse(
      buildOpencodeConfigContent(true, undefined, { scriptPath: "x.mjs", enabled: false }),
    );
    expect(parsed.mcp).toBeUndefined();
  });

  test("pass-through keeps only the gate-required read tool, MCP, and auto compaction off", () => {
    const parsed = JSON.parse(
      buildOpencodeConfigContent(false, {
        providerId: "codex-relay",
        baseURL: "http://127.0.0.1:43121/api/relay-gateway/x/y/v1",
        apiKey: "loopback",
        models: ["gpt-5.6-terra"],
      }, { scriptPath: "C:/data/sa-vm/sa-vm-mcp.mjs" }, true),
    );
    expect(parsed.permission).toEqual({ "*": "deny" });
    expect(parsed.tools).toEqual({ "*": false, read: true });
    expect(parsed.compaction.auto).toBe(false);
    expect(parsed.mcp).toBeUndefined();
    expect(parsed.plugin).toEqual([opencodePassThroughPluginPath()]);
    expect(parsed.provider["codex-relay"].models["gpt-5.6-terra"]).toBeDefined();
  });

  test("pass-through plugin strips every system message", () => {
    const pluginPath = ensureOpencodePassThroughPlugin();
    expect(pluginPath).toBe(opencodePassThroughPluginPath());
    const source = readFileSync(pluginPath, "utf8");
    expect(source).toContain("experimental.chat.system.transform");
    expect(source).toContain("output.system.length = 0");
  });
});

describe("buildOpencodeModelPrompt", () => {
  test("prepends developer instructions for opencode-go models", () => {
    expect(buildOpencodeModelPrompt("DEV", "hello", "opencode-go/kimi-k2")).toBe("DEV\n\n[User Instruction]\nhello");
    expect(buildOpencodeModelPrompt("DEV", "hello", "opencode-go")).toBe("DEV\n\n[User Instruction]\nhello");
    expect(buildOpencodeModelPrompt(undefined, "hello", "opencode-go/kimi-k2")).toBe("hello");
    expect(buildOpencodeModelPrompt("  ", "hello", "opencode-go/kimi-k2")).toBe("hello");
    expect(buildOpencodeModelPrompt("DEV", "  ", "opencode-go/kimi-k2")).toBe("DEV");
  });
  test("opencode/* models now get full capabilities (no pass-through)", () => {
    expect(buildOpencodeModelPrompt("DEV", "hello", "opencode/big-pickle")).toBe("DEV\n\n[User Instruction]\nhello");
    expect(buildOpencodeModelPrompt("DEV", "hello", "opencode/mimo-v2.5-free")).toBe("DEV\n\n[User Instruction]\nhello");
    expect(buildOpencodeModelPrompt("DEV", "hello")).toBe("DEV\n\n[User Instruction]\nhello");
    expect(buildOpencodeModelPrompt("DEV", "  ", "opencode/big-pickle")).toBe("DEV");
  });
  test("non-pass-through models keep developer instructions", () => {
    expect(buildOpencodeModelPrompt("DEV", "hello", "gpt-5.6-terra")).toBe("DEV\n\n[User Instruction]\nhello");
    expect(buildOpencodeModelPrompt("DEV", "  ", "gpt-5.6-terra")).toBe("DEV");
  });
});

describe("buildOpencodeIsolationEnv", () => {
  test("disables global config, prompts, plugins, tools, MCP and compaction", () => {
    const env = buildOpencodeIsolationEnv("linux");
    const isolatedDir = opencodeIsolationDir();
    expect(env.OPENCODE_CONFIG).toBe("");
    expect(env.OPENCODE_CONFIG_DIR).toBe("");
    expect(env.OPENCODE_PERMISSION).toBe("");
    expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
    expect(env.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBe("1");
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE).toBe("1");
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT).toBe("1");
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS).toBe("1");
    expect(env.OPENCODE_DISABLE_DEFAULT_PLUGINS).toBe("1");
    expect(env.OPENCODE_DISABLE_AUTOCOMPACT).toBe("1");
    expect(env.OPENCODE_DISABLE_PRUNE).toBe("1");
    expect(env.OPENCODE_PURE).toBe("0");
    expect(env.OPENCODE_TEST_HOME).toBe(isolatedDir);
    expect(env.XDG_CONFIG_HOME).toBe(isolatedDir);
    expect(env.APPDATA).toBeUndefined();
    expect(env.HOME).toBeUndefined();
  });

  test("isolates APPDATA on Windows without touching USERPROFILE", () => {
    const env = buildOpencodeIsolationEnv("win32");
    expect(env.APPDATA).toBe(opencodeIsolationDir());
    expect(env.USERPROFILE).toBeUndefined();
  });
});

describe("isOpencodeGoModel", () => {
  test("matches the opencode-go model prefix only", () => {
    expect(isOpencodeGoModel("opencode-go")).toBe(true);
    expect(isOpencodeGoModel("opencode-go/kimi-k2")).toBe(true);
    expect(isOpencodeGoModel("OpenCode-Go/kimi-k2")).toBe(true);
    expect(isOpencodeGoModel("opencode/big-pickle")).toBe(false);
    expect(isOpencodeGoModel("gpt-5.6-terra")).toBe(false);
  });
});

describe("isOpencodePassThroughModel", () => {
  test("pass-through special handling is disabled: all models return false", () => {
    expect(isOpencodePassThroughModel("opencode/big-pickle")).toBe(false);
    expect(isOpencodePassThroughModel("opencode/mimo-v2.5-free")).toBe(false);
    expect(isOpencodePassThroughModel("OpenCode/Big-Pickle")).toBe(false);
    expect(isOpencodePassThroughModel("opencode")).toBe(false);
    expect(isOpencodePassThroughModel("opencode-go/kimi-k2")).toBe(false);
    expect(isOpencodePassThroughModel("opencode-zen/big-pickle")).toBe(false);
    expect(isOpencodePassThroughModel("gpt-5.6-terra")).toBe(false);
    expect(isOpencodePassThroughModel("claude-sonnet-4")).toBe(false);
  });
  test("empty or default model is also full-capability (no pass-through)", () => {
    expect(isOpencodePassThroughModel(undefined)).toBe(false);
    expect(isOpencodePassThroughModel("")).toBe(false);
    expect(isOpencodePassThroughModel("default")).toBe(false);
  });
});

describe("resolveOpencodeSaVmMcp", () => {
  test("returns undefined without developer instructions", () => {
    expect(resolveOpencodeSaVmMcp(undefined)).toBeUndefined();
    expect(resolveOpencodeSaVmMcp("  ")).toBeUndefined();
  });
  test("opencode-go models can resolve the shared bundle when present", () => {
    const resolved = resolveOpencodeSaVmMcp("SA-VM instructions", undefined, "opencode-go/kimi-k2");
    if (resolved) {
      expect(resolved.scriptPath.endsWith(SA_VM_MCP_SCRIPT_NAME)).toBe(true);
    } else {
      expect(resolved).toBeUndefined();
    }
  });
  test("opencode/* models resolve MCP like any other model (no pass-through)", () => {
    const forOpencode = resolveOpencodeSaVmMcp("SA-VM instructions", process.cwd(), "opencode/big-pickle");
    const forOther = resolveOpencodeSaVmMcp("SA-VM instructions", process.cwd(), "gpt-5.6-terra");
    // Both follow the same rule: defined iff the shared bundle exists.
    expect(Boolean(forOpencode)).toBe(Boolean(forOther));
    if (forOpencode) {
      expect(forOpencode.scriptPath.endsWith(SA_VM_MCP_SCRIPT_NAME)).toBe(true);
    }
  });
  test("non-pass-through models can resolve the shared bundle when present", () => {
    const resolved = resolveOpencodeSaVmMcp("SA-VM instructions", undefined, "gpt-5.6-terra");
    if (resolved) {
      expect(resolved.scriptPath.endsWith(SA_VM_MCP_SCRIPT_NAME)).toBe(true);
    } else {
      expect(resolved).toBeUndefined();
    }
  });
});

describe("OpencodeBridge developerInstructions plumbing", () => {
  test("thread/start persists instructions to the snapshot", async () => {
    const seen: OpencodeSessionSnapshot[] = [];
    const bridge = new OpencodeBridge({ onSnapshot: (s) => void seen.push(s) });
    const res = (await bridge.request("thread/start", {
      cwd: process.cwd(),
      developerInstructions: "SA-VM DEV",
    })) as unknown as { threadId: string };
    expect(typeof res.threadId).toBe("string");
    const last = seen[seen.length - 1];
    expect(last?.developerInstructions).toBe("SA-VM DEV");
  });

  test("restoreSession round-trips developerInstructions", () => {
    const bridge = new OpencodeBridge();
    const snapshot: OpencodeSessionSnapshot = {
      threadId: "thread-opencode-sa-vm-1",
      cwd: process.cwd(),
      turns: [],
      messages: [],
      developerInstructions: "SA-VM DEV",
    };
    const session = bridge.restoreSession(snapshot);
    expect(session.developerInstructions).toBe("SA-VM DEV");
  });
});

describe("mergeOpencodeMcpConfig", () => {
  test("adds both v1 and v2 shapes and preserves existing keys", () => {
    const merged = mergeOpencodeMcpConfig(
      { model: "x", mcp: { "other": { type: "remote", url: "https://x" } } },
      "/s/sa-vm-mcp.mjs",
    );
    expect((merged.mcp["sa-vm"] as { command: string[] }).command).toEqual(["node", "/s/sa-vm-mcp.mjs"]);
    expect((merged.mcp.servers["sa-vm"] as { command: string[] }).command).toEqual(["node", "/s/sa-vm-mcp.mjs"]);
    expect(merged.mcp["other"]).toBeDefined();
    expect(merged.model).toBe("x");
  });

  test("omits jev by default (no global trigger)", () => {
    const prev = process.env.JEV_MCP_ENABLED;
    delete process.env.JEV_MCP_ENABLED;
    try {
      expect(isJevMcpEnabled()).toBe(false);
      const merged = mergeOpencodeMcpConfig({ mcp: {} }, "/s/sa-vm-mcp.mjs");
      expect(merged.mcp["jev"]).toBeUndefined();
      expect(merged.mcp.servers["jev"]).toBeUndefined();
      expect(merged.mcp["sa-vm"]).toBeDefined();
    } finally {
      if (prev === undefined) delete process.env.JEV_MCP_ENABLED;
      else process.env.JEV_MCP_ENABLED = prev;
    }
  });

  test("registers jev when JEV_MCP_ENABLED=1", () => {
    const prev = process.env.JEV_MCP_ENABLED;
    process.env.JEV_MCP_ENABLED = "1";
    try {
      expect(isJevMcpEnabled()).toBe(true);
      const merged = mergeOpencodeMcpConfig({ mcp: {} }, "/s/sa-vm-mcp.mjs");
      expect((merged.mcp["jev"] as { command: string[] }).command).toEqual(["node", "/s/sa-vm-mcp.mjs"]);
      expect((merged.mcp.servers["jev"] as { command: string[] }).command).toEqual(["node", "/s/sa-vm-mcp.mjs"]);
    } finally {
      if (prev === undefined) delete process.env.JEV_MCP_ENABLED;
      else process.env.JEV_MCP_ENABLED = prev;
    }
  });

  test("removes self-managed jev but preserves foreign jev entries", () => {
    const prev = process.env.JEV_MCP_ENABLED;
    delete process.env.JEV_MCP_ENABLED;
    try {
      const own = { type: "local", command: ["node", "/old/dir/sa-vm-mcp.mjs"], enabled: true };
      const foreign = { type: "local", command: ["node", "/home/user/custom-jevd"], enabled: true };
      const cleaned = mergeOpencodeMcpConfig(
        { mcp: { jev: own, servers: { jev: own } } },
        "/s/sa-vm-mcp.mjs",
      );
      expect(cleaned.mcp["jev"]).toBeUndefined();
      expect(cleaned.mcp.servers["jev"]).toBeUndefined();
      const kept = mergeOpencodeMcpConfig(
        { mcp: { jev: foreign, servers: { jev: foreign } } },
        "/s/sa-vm-mcp.mjs",
      );
      expect(kept.mcp["jev"]).toEqual(foreign);
      expect(kept.mcp.servers["jev"]).toEqual(foreign);
    } finally {
      if (prev === undefined) delete process.env.JEV_MCP_ENABLED;
      else process.env.JEV_MCP_ENABLED = prev;
    }
  });
});

describe("mergeMcpServersJsonConfig jev opt-in", () => {
  test("omits self-managed jev by default, keeps sa-vm", () => {
    const prev = process.env.JEV_MCP_ENABLED;
    delete process.env.JEV_MCP_ENABLED;
    try {
      const merged = mergeMcpServersJsonConfig(
        { mcpServers: { jev: { command: "node", args: ["/old/sa-vm-mcp.mjs"] } } },
        "/s/sa-vm-mcp.mjs",
      );
      expect(merged.mcpServers["jev"]).toBeUndefined();
      expect(merged.mcpServers["sa-vm"]).toBeDefined();
    } finally {
      if (prev === undefined) delete process.env.JEV_MCP_ENABLED;
      else process.env.JEV_MCP_ENABLED = prev;
    }
  });

  test("registers jev when JEV_MCP_ENABLED=1", () => {
    const prev = process.env.JEV_MCP_ENABLED;
    process.env.JEV_MCP_ENABLED = "1";
    try {
      const merged = mergeMcpServersJsonConfig({}, "/s/sa-vm-mcp.mjs");
      expect(merged.mcpServers["jev"]).toBeDefined();
      expect(merged.mcpServers["sa-vm"]).toBeDefined();
    } finally {
      if (prev === undefined) delete process.env.JEV_MCP_ENABLED;
      else process.env.JEV_MCP_ENABLED = prev;
    }
  });
});

describe("mergeMiniAgentTomlMcpConfig jev opt-in", () => {
  test("fresh config has no jev by default", () => {
    const prev = process.env.JEV_MCP_ENABLED;
    delete process.env.JEV_MCP_ENABLED;
    try {
      const out = mergeMiniAgentTomlMcpConfig("", "/s/sa-vm-mcp.mjs");
      expect(out.includes("[mcp_servers.jev]")).toBe(false);
      expect(out.includes("[mcp_servers.sa-vm]")).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.JEV_MCP_ENABLED;
      else process.env.JEV_MCP_ENABLED = prev;
    }
  });

  test("strips self-managed jev section but preserves foreign ones", () => {
    const prev = process.env.JEV_MCP_ENABLED;
    delete process.env.JEV_MCP_ENABLED;
    try {
      const own = `[mcp_servers.jev]\ncommand = "node"\nargs = ["/old/sa-vm-mcp.mjs"]\nstartup_timeout_sec = 30\n`;
      const stripped = mergeMiniAgentTomlMcpConfig(`${own}\n[mcp_servers.sa-vm]\ncommand = "node"\n`, "/s/sa-vm-mcp.mjs");
      expect(stripped.includes("[mcp_servers.jev]")).toBe(false);
      expect(stripped.includes("[mcp_servers.sa-vm]")).toBe(true);
      const foreign = `[mcp_servers.jev]\ncommand = "/usr/bin/custom-jevd"\n`;
      const kept = mergeMiniAgentTomlMcpConfig(foreign, "/s/sa-vm-mcp.mjs");
      expect(kept.includes("[mcp_servers.jev]")).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.JEV_MCP_ENABLED;
      else process.env.JEV_MCP_ENABLED = prev;
    }
  });
});

describe("opencode skill path + prompt guide", () => {
  test("workspace skill resolves to .opencode for opencode backend", () => {
    expect(workspaceSaVmSkillPath("E:/projects/demo", undefined, "opencode").replaceAll("\\", "/"))
      .toBe("E:/projects/demo/.opencode/skills/sa-vm/SKILL.md");
    expect(workspaceSaVmSkillPath("E:/projects/demo", undefined, "pi").replaceAll("\\", "/"))
      .toBe("E:/projects/demo/.pi/skills/sa-vm/SKILL.md");
  });

  test("developer instructions carry the opencode MCP guide", () => {
    const instructions = saVmDeveloperInstructions(undefined, "C:\\work", undefined, "opencode");
    expect(instructions).toContain(".opencode/skills/sa-vm/SKILL.md");
    expect(instructions).toContain("[CRITICAL FOR OPENCODE AGENT]");
    expect(instructions).toContain("sa-vm_sa_vm_run");
  });
});
