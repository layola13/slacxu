import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __clearMiniMcpCacheForTests,
  isMiniMcpToolName,
  loadMiniMcpServers,
  mcpResultToText,
  miniMcpEnabled,
  parseMcpServersSubset,
  qualifiedMcpToolName,
  resolveMiniAgentHome,
  resolveMiniAgentUserAgent,
  resolveMiniMcpConfigPaths,
  sanitizeMcpNamePart,
  setMiniMcpRuntimeCodexHome,
  setMiniMcpWorkspaceRoots,
  stripJsonComments,
  parseConfigFile,
  MINI_AGENT_NAME,
  MINI_AGENT_VERSION,
} from "../../backends/mini/src/runtime/miniMcp.ts";
import { miniToolsWithMcpForDepth } from "../../backends/mini/src/runtime/miniBridge.ts";

describe("mini MCP (codex-style)", () => {
  test("sanitize mirrors codex responses-api rule", () => {
    expect(sanitizeMcpNamePart("file-system")).toBe("file_system");
    expect(sanitizeMcpNamePart("a.b:c")).toBe("a_b_c");
    expect(sanitizeMcpNamePart("")).toBe("_");
    expect(sanitizeMcpNamePart("read_file")).toBe("read_file");
  });

  test("qualified names use mcp__server__tool", () => {
    expect(qualifiedMcpToolName("filesystem", "read_file")).toBe("mcp__filesystem__read_file");
    expect(qualifiedMcpToolName("my-server", "read-file")).toBe("mcp__my_server__read_file");
    expect(isMiniMcpToolName("mcp__filesystem__read_file")).toBe(true);
    expect(isMiniMcpToolName("sa_vm")).toBe(false);
  });

  test("turn tool list falls back to built-ins when no MCP configured", async () => {
    const tools = await miniToolsWithMcpForDepth(0);
    const names = tools.map((t) => t.name);
    expect(names).toContain("sa_vm");
    expect(names).toContain("spawn_agent");
  });

  test("long names stay within the model limit", () => {
    const name = qualifiedMcpToolName("s".repeat(40), "t".repeat(40));
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name.startsWith("mcp__")).toBe(true);
  });

  test("subset parser reads [mcp_servers.*] tables", () => {
    const parsed = parseMcpServersSubset([
      "[mcp_servers.fs]",
      'command = "npx"',
      'args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]',
      "enabled = true",
      "",
      "[mcp_servers.web]",
      'url = "https://mcp.example.com/mcp"',
      'bearer_token_env_var = "EXAMPLE_TOKEN"',
      "enabled = false",
      "",
      "[mcp_servers.fs.env]",
      'ROOT = "/tmp"',
    ].join("\n"));
    const servers = parsed.mcp_servers as Record<string, Record<string, unknown>>;
    expect(servers.fs?.command).toBe("npx");
    expect(servers.fs?.args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]);
    expect(servers.web?.url).toBe("https://mcp.example.com/mcp");
    expect((servers.fs?.env as Record<string, unknown>)?.ROOT).toBe("/tmp");
  });

  test("result blocks collapse to text like codex", () => {
    expect(mcpResultToText({ content: [{ type: "text", text: "hello" }] })).toBe("hello");
    expect(mcpResultToText({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })).toBe("a\nb");
    expect(mcpResultToText({ content: [], structuredContent: { ok: true } })).toContain("ok");
    expect(mcpResultToText(null)).toBe("(empty MCP result)");
  });

  test("MINI_MCP=off disables discovery", () => {
    expect(miniMcpEnabled({ ...process.env, MINI_MCP: "off" })).toBe(false);
    expect(miniMcpEnabled({ ...process.env })).toBe(true);
    __clearMiniMcpCacheForTests();
  });

  test("oauth/ema servers are skipped, plain stdio servers load", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-mcp-cfg-"));
    try {
      const path = join(dir, "config.toml");
      writeFileSync(path, [
        "[mcp_servers.plain]",
        'command = "node"',
        'args = ["server.mjs"]',
        "",
        "[mcp_servers.oauthed]",
        'url = "https://mcp.example.com/mcp"',
        "",
        "[mcp_servers.oauthed.oauth]",
        'authorization_server = "https://auth.example.com"',
        "",
        "[mcp_servers.ema]",
        'url = "https://corp.example.com/mcp"',
        'auth = "ema_auth"',
        "",
        "[mcp_servers.disabled]",
        'command = "node"',
        "enabled = false",
        "",
      ].join("\n"));
      const servers = await loadMiniMcpServers(path);
      expect(servers.map((s) => s.name)).toEqual(["plain"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("env_http_headers resolve from env, plural *_secs honored", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-mcp-cfg-"));
    try {
      process.env.MINI_MCP_TEST_TOKEN = "secret-123";
      const path = join(dir, "config.toml");
      writeFileSync(path, [
        "[mcp_servers.h]",
        'url = "https://mcp.example.com/mcp"',
        "startup_timeout_secs = 7",
        "tool_timeout_secs = 42",
        "",
        "[mcp_servers.h.env_http_headers]",
        'X-Custom-Auth = "MINI_MCP_TEST_TOKEN"',
        'X-Missing = "MINI_MCP_TEST_ABSENT_VAR"',
        "",
        "[mcp_servers.h.http_headers]",
        'X-Static = "yes"',
        "",
      ].join("\n"));
      const servers = await loadMiniMcpServers(path);
      expect(servers).toHaveLength(1);
      expect(servers[0]?.startupTimeoutMs).toBe(7000);
      expect(servers[0]?.toolTimeoutMs).toBe(42000);
      expect(servers[0]?.httpHeaders).toEqual({ "X-Custom-Auth": "secret-123", "X-Static": "yes" });
    } finally {
      delete process.env.MINI_MCP_TEST_TOKEN;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("workspace roots setter accepts cwd lists without throwing", () => {
    setMiniMcpWorkspaceRoots(["/tmp/work", undefined, "", "/tmp/work", null, "/extra"]);
    setMiniMcpWorkspaceRoots([]);
    __clearMiniMcpCacheForTests();
  });

  test("resolveMiniMcpConfigPaths discovers workspace, virtual, and runtime daemon configs", () => {
    const wsDir = mkdtempSync(join(tmpdir(), "mini-ws-"));
    const runtimeDir = mkdtempSync(join(tmpdir(), "mini-runtime-"));
    try {
      setMiniMcpWorkspaceRoots([wsDir]);
      setMiniMcpRuntimeCodexHome(runtimeDir);
      const paths = resolveMiniMcpConfigPaths({ CODEX_HOME: runtimeDir });
      expect(paths.some((p) => p.includes(join(wsDir, ".codex", "config.toml")))).toBe(true);
      expect(paths.some((p) => p.includes("virtual-codex"))).toBe(true);
      expect(paths.some((p) => p.includes(join(runtimeDir, "config.toml")))).toBe(true);
    } finally {
      setMiniMcpWorkspaceRoots([]);
      setMiniMcpRuntimeCodexHome(null);
      rmSync(wsDir, { recursive: true, force: true });
      rmSync(runtimeDir, { recursive: true, force: true });
    }
  });

  test("loadMiniMcpServers merges multi-source configs with workspace overriding global", async () => {
    const globalDir = mkdtempSync(join(tmpdir(), "mini-global-"));
    const wsDir = mkdtempSync(join(tmpdir(), "mini-ws-merge-"));
    try {
      writeFileSync(join(globalDir, "config.toml"), [
        "[mcp_servers.srv_a]",
        'command = "node"',
        'args = ["a-global.js"]',
        "",
        "[mcp_servers.srv_b]",
        'command = "node"',
        'args = ["b-global.js"]',
      ].join("\n"));

      const wsCodexDir = join(wsDir, ".codex");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(wsCodexDir, { recursive: true });
      writeFileSync(join(wsCodexDir, "config.toml"), [
        "[mcp_servers.srv_b]",
        'command = "node"',
        'args = ["b-workspace.js"]',
        "",
        "[mcp_servers.srv_c]",
        'command = "node"',
        'args = ["c-workspace.js"]',
      ].join("\n"));

      setMiniMcpWorkspaceRoots([wsDir]);
      const servers = await loadMiniMcpServers(undefined, { CODEX_HOME: globalDir });
      const byName = new Map(servers.map((s) => [s.name, s]));

      expect(byName.has("srv_a")).toBe(true);
      expect(byName.has("srv_b")).toBe(true);
      expect(byName.has("srv_c")).toBe(true);

      // srv_b from workspace should override global
      expect(byName.get("srv_b")?.args).toEqual(["b-workspace.js"]);
      expect(byName.get("srv_a")?.args).toEqual(["a-global.js"]);
      expect(byName.get("srv_c")?.args).toEqual(["c-workspace.js"]);
    } finally {
      setMiniMcpWorkspaceRoots([]);
      rmSync(globalDir, { recursive: true, force: true });
      rmSync(wsDir, { recursive: true, force: true });
    }
  });

  test("mini-agent identity and user-agent defaults and overrides", () => {
    __clearMiniMcpCacheForTests();
    expect(MINI_AGENT_NAME).toBe("mini-agent");
    expect(typeof MINI_AGENT_VERSION).toBe("string");
    expect(resolveMiniAgentUserAgent({})).toBe(`mini-agent/${MINI_AGENT_VERSION}`);
    expect(resolveMiniAgentUserAgent({ MINI_USER_AGENT: "custom-agent/1.0" })).toBe("custom-agent/1.0");
    expect(resolveMiniAgentHome({ MINI_AGENT_HOME: "/opt/mini" })).toContain("mini");
  });

  test("loadMiniMcpServers prioritizes dedicated .mini-agent over .codex", async () => {
    const wsDir = mkdtempSync(join(tmpdir(), "mini-prio-"));
    try {
      const { mkdirSync } = await import("node:fs");
      const codexDir = join(wsDir, ".codex");
      const miniDir = join(wsDir, ".mini-agent");
      mkdirSync(codexDir, { recursive: true });
      mkdirSync(miniDir, { recursive: true });

      writeFileSync(join(codexDir, "config.toml"), [
        "[mcp_servers.tool_x]",
        'command = "node"',
        'args = ["from-codex.js"]',
      ].join("\n"));

      writeFileSync(join(miniDir, "config.toml"), [
        "[mcp_servers.tool_x]",
        'command = "node"',
        'args = ["from-mini-agent.js"]',
      ].join("\n"));

      setMiniMcpWorkspaceRoots([wsDir]);
      const servers = await loadMiniMcpServers(undefined, {});
      const toolX = servers.find((s) => s.name === "tool_x");
      expect(toolX).toBeDefined();
      expect(toolX?.args).toEqual(["from-mini-agent.js"]);
    } finally {
      setMiniMcpWorkspaceRoots([]);
      rmSync(wsDir, { recursive: true, force: true });
    }
  });

  test("loadMiniMcpServers extracts [agent] user_agent and name", async () => {
    const wsDir = mkdtempSync(join(tmpdir(), "mini-agent-cfg-"));
    try {
      const { mkdirSync } = await import("node:fs");
      const miniDir = join(wsDir, ".mini-agent");
      mkdirSync(miniDir, { recursive: true });

      writeFileSync(join(miniDir, "config.toml"), [
        "[agent]",
        'name = "super-mini"',
        'user_agent = "super-mini/1.5.0"',
        "",
        "[mcp_servers.echo]",
        'command = "node"',
      ].join("\n"));

      setMiniMcpWorkspaceRoots([wsDir]);
      await loadMiniMcpServers(undefined, {});
      expect(resolveMiniAgentUserAgent({})).toBe("super-mini/1.5.0");
    } finally {
      setMiniMcpWorkspaceRoots([]);
      __clearMiniMcpCacheForTests();
      rmSync(wsDir, { recursive: true, force: true });
    }
  });

  test("stripJsonComments removes single-line, multi-line comments and trailing commas", () => {
    const raw = `
    {
      // single line comment
      "name": "test", /* inline comment */
      "list": [
        "a", // comment in list
        "b",
      ],
      "obj": {
        "x": 1,
      }
    }
    `;
    const cleaned = stripJsonComments(raw);
    const parsed = JSON.parse(cleaned);
    expect(parsed.name).toBe("test");
    expect(parsed.list).toEqual(["a", "b"]);
    expect(parsed.obj.x).toBe(1);
  });

  test("loadMiniMcpServers loads OpenCode format (opencode.json) with array command and remote URL", async () => {
    const wsDir = mkdtempSync(join(tmpdir(), "mini-opencode-"));
    try {
      const opencodeContent = JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        mcp: {
          "oc_local": {
            type: "command",
            command: ["node", "local-worker.mjs", "--flag"],
            enabled: true,
            environment: { FOO: "bar" },
          },
          "oc_remote": {
            type: "remote",
            url: "https://mcp.example.com/sse",
            headers: { Authorization: "Bearer token123" },
          },
        },
      }, null, 2);

      writeFileSync(join(wsDir, "opencode.json"), opencodeContent);

      setMiniMcpWorkspaceRoots([wsDir]);
      const servers = await loadMiniMcpServers(undefined, {});
      const byName = new Map(servers.map((s) => [s.name, s]));

      expect(byName.has("oc_local")).toBe(true);
      expect(byName.get("oc_local")?.command).toBe("node");
      expect(byName.get("oc_local")?.args).toEqual(["local-worker.mjs", "--flag"]);
      expect(byName.get("oc_local")?.env).toEqual({ FOO: "bar" });

      expect(byName.has("oc_remote")).toBe(true);
      expect(byName.get("oc_remote")?.url).toBe("https://mcp.example.com/sse");
      expect(byName.get("oc_remote")?.httpHeaders).toEqual({ Authorization: "Bearer token123" });
    } finally {
      setMiniMcpWorkspaceRoots([]);
      __clearMiniMcpCacheForTests();
      rmSync(wsDir, { recursive: true, force: true });
    }
  });

  test("loadMiniMcpServers loads standard mcpServers JSON (.mini-agent/config.json and mcp.json)", async () => {
    const wsDir = mkdtempSync(join(tmpdir(), "mini-standard-mcp-"));
    try {
      const { mkdirSync } = await import("node:fs");
      const miniDir = join(wsDir, ".mini-agent");
      mkdirSync(miniDir, { recursive: true });

      writeFileSync(join(miniDir, "config.json"), JSON.stringify({
        agent: {
          name: "json-agent",
          userAgent: "json-agent/2.0.0",
        },
        mcpServers: {
          "tool_json": {
            command: "bun",
            args: ["run", "tool.ts"],
            env: { PORT: "8080" },
          },
        },
      }, null, 2));

      setMiniMcpWorkspaceRoots([wsDir]);
      const servers = await loadMiniMcpServers(undefined, {});
      const toolJson = servers.find((s) => s.name === "tool_json");

      expect(toolJson).toBeDefined();
      expect(toolJson?.command).toBe("bun");
      expect(toolJson?.args).toEqual(["run", "tool.ts"]);
      expect(toolJson?.env?.PORT).toBe("8080");
      expect(resolveMiniAgentUserAgent({})).toBe("json-agent/2.0.0");
    } finally {
      setMiniMcpWorkspaceRoots([]);
      __clearMiniMcpCacheForTests();
      rmSync(wsDir, { recursive: true, force: true });
    }
  });
});


