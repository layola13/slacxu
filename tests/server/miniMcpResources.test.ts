import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __clearMiniMcpCacheForTests,
  closeMiniMcpClients,
  listMiniMcpResources,
  listMiniMcpTools,
  mcpResourceContentsToText,
  miniMcpServerStatus,
  miniMcpStatusLine,
  readMiniMcpResource,
  runMiniMcpTool,
  tryReadMiniMcpResourceContents,
} from "../../backends/mini/src/runtime/miniMcp.ts";
import { MiniBridge, miniToolArgValidationError } from "../../backends/mini/src/runtime/miniBridge.ts";

const FAKE_SERVER_SCRIPT = `
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let m;
  try { m = JSON.parse(text); } catch { return; }
  if (m.method && (m.id === undefined || m.id === null)) return;
  const reply = (payload) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, ...payload }) + "\\n");
  if (m.method === "initialize") reply({ result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "1" } } });
  else if (m.method === "tools/list") reply({ result: { tools: [{ name: "echo", description: "echo tool", inputSchema: { type: "object", properties: {} } }] } });
  else if (m.method === "resources/list") reply({ result: { resources: [{ uri: "file:///notes.md", name: "notes", mimeType: "text/markdown" }] } });
  else if (m.method === "resources/read") reply({ result: { contents: [{ uri: m.params.uri, mimeType: "text/markdown", text: "hello resource" }] } });
  else if (m.method === "tools/call") reply({ result: { content: [{ type: "text", text: "echo:" + JSON.stringify(m.params.arguments) }] } });
  else if (m.method === "ping") reply({ result: {} });
  else reply({ error: { code: -32601, message: "nope" } });
});
`;

function fwd(p: string): string {
  return p.replace(/\\/g, "/");
}

async function withFakeHome(fn: (home: string) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "mini-mcp-res-"));
  const prevCodexHome = process.env.CODEX_HOME;
  const prevConfigPath = process.env.MINI_MCP_CONFIG_PATH;
  process.env.CODEX_HOME = home;
  process.env.MINI_MCP_CONFIG_PATH = join(home, "config.toml");
  __clearMiniMcpCacheForTests();
  try {
    const script = join(home, "fake-mcp-server.mjs");
    writeFileSync(script, FAKE_SERVER_SCRIPT, "utf8");
    writeFileSync(
      join(home, "config.toml"),
      [`[mcp_servers.fake]`, `command = "${fwd(process.execPath)}"`, `args = ["${fwd(script)}"]`, ""].join("\n"),
      "utf8",
    );
    await fn(home);
  } finally {
    try {
      await closeMiniMcpClients();
    } catch {
      /* ignore */
    }
    __clearMiniMcpCacheForTests();
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    if (prevConfigPath === undefined) delete process.env.MINI_MCP_CONFIG_PATH;
    else process.env.MINI_MCP_CONFIG_PATH = prevConfigPath;
    rmSync(home, { recursive: true, force: true });
  }
}

describe("mini MCP resources (stdio fake server)", () => {
  test("tools + resources discovery and reads", async () => {
    await withFakeHome(async () => {
      const tools = await listMiniMcpTools(false);
      expect(tools.map((t) => t.name)).toContain("mcp__fake__echo");

      const resources = await listMiniMcpResources();
      expect(resources).toHaveLength(1);
      expect(resources[0]).toMatchObject({ server: "fake", uri: "file:///notes.md", name: "notes" });

      const scoped = await listMiniMcpResources("fake");
      expect(scoped).toHaveLength(1);
      expect(await listMiniMcpResources("missing")).toEqual([]);

      expect(await readMiniMcpResource("fake", "file:///notes.md")).toBe("hello resource");
      expect(await readMiniMcpResource("fake", "")).toContain("needs {server, uri}");
      expect(await readMiniMcpResource("missing", "file:///x")).toContain("unknown or unavailable");

      const contents = await tryReadMiniMcpResourceContents("fake", "file:///notes.md");
      expect(contents).toHaveLength(1);
      expect(contents[0]?.text).toBe("hello resource");
      expect(await tryReadMiniMcpResourceContents("missing", "file:///x")).toEqual([]);

      expect(await runMiniMcpTool("mcp__fake__echo", { k: 1 })).toContain("echo:");
    });
  }, 60000);

  test("resource text conversion covers binary and empty", () => {
    expect(mcpResourceContentsToText([{ uri: "u", text: "hi" }])).toBe("hi");
    expect(mcpResourceContentsToText([{ uri: "u", mimeType: "image/png", blob: "aGVsbG8=" }])).toContain("binary content");
    expect(mcpResourceContentsToText([])).toBe("(empty MCP resource)");
    expect(mcpResourceContentsToText(null)).toBe("(empty MCP resource)");
  });

  test("structured status and enriched status line", async () => {
    await withFakeHome(async () => {
      await listMiniMcpTools(false);
      const status = miniMcpServerStatus();
      expect(status).toHaveLength(1);
      expect(status[0]).toMatchObject({ name: "fake", connected: true, transport: "stdio" });
      expect(miniMcpStatusLine()).toContain("fake (1 tools)");
    });
  }, 60000);

  test("model tool validation for the resource tools", () => {
    expect(miniToolArgValidationError("list_mcp_resources", {})).toBeNull();
    expect(miniToolArgValidationError("read_mcp_resource", { server: "s" })).toContain('{"uri"');
    expect(miniToolArgValidationError("read_mcp_resource", { uri: "u" })).toContain('{"server"');
    expect(
      miniToolArgValidationError("read_mcp_resource", { server: "s", uri: "u" }),
    ).toBeNull();
  });

  test("unsupported resources/list warns once then skips quietly", async () => {
    const NO_RES_SCRIPT = FAKE_SERVER_SCRIPT.replace(
      'else if (m.method === "resources/list") reply({ result: { resources: [{ uri: "file:///notes.md", name: "notes", mimeType: "text/markdown" }] } });',
      'else if (m.method === "resources/list") reply({ error: { code: -32601, message: "Method \'resources/list\' not supported" } });',
    ).replace(
      'else if (m.method === "resources/read") reply({ result: { contents: [{ uri: m.params.uri, mimeType: "text/markdown", text: "hello resource" }] } });',
      'else if (m.method === "resources/read") reply({ error: { code: -32601, message: "Method \'resources/read\' not supported" } });',
    );
    const home = mkdtempSync(join(tmpdir(), "mini-mcp-nores-"));
    const prevCodexHome = process.env.CODEX_HOME;
    const prevConfigPath = process.env.MINI_MCP_CONFIG_PATH;
    process.env.CODEX_HOME = home;
    process.env.MINI_MCP_CONFIG_PATH = join(home, "config.toml");
    __clearMiniMcpCacheForTests();
    const origWarn = console.warn;
    const warns: string[] = [];
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(" "));
    };
    try {
      const script = join(home, "nores-mcp-server.mjs");
      writeFileSync(script, NO_RES_SCRIPT, "utf8");
      writeFileSync(
        join(home, "config.toml"),
        [`[mcp_servers.nores]`, `command = "${fwd(process.execPath)}"`, `args = ["${fwd(script)}"]`, ""].join("\n"),
        "utf8",
      );
      const tools = await listMiniMcpTools(false);
      expect(tools.map((t) => t.name)).toContain("mcp__nores__echo");

      expect(await listMiniMcpResources()).toEqual([]);
      const polls = 3;
      for (let i = 0; i < polls; i += 1) {
        expect(await listMiniMcpResources()).toEqual([]);
        expect(await listMiniMcpResources("nores")).toEqual([]);
      }
      // tools 仍可用；resources 不支持只应告警一次，后续轮询静默跳过。
      expect(await runMiniMcpTool("mcp__nores__echo", { k: 1 })).toContain("echo:");
      const resWarns = warns.filter((w) => w.includes("resources/list") || w.includes("resources/read"));
      expect(resWarns.length).toBeLessThanOrEqual(1);
      expect(await tryReadMiniMcpResourceContents("nores", "file:///x")).toEqual([]);
    } finally {
      console.warn = origWarn;
      try {
        await closeMiniMcpClients();
      } catch {
        /* ignore */
      }
      __clearMiniMcpCacheForTests();
      if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prevCodexHome;
      if (prevConfigPath === undefined) delete process.env.MINI_MCP_CONFIG_PATH;
      else process.env.MINI_MCP_CONFIG_PATH = prevConfigPath;
      rmSync(home, { recursive: true, force: true });
    }
  }, 60000);
});

describe("mini MCP bridge RPCs", () => {
  test("status/reload/tool-call/resource-read round-trip", async () => {
    await withFakeHome(async () => {
      const bridge = new MiniBridge();
      try {
        const status = (await bridge.request("mcpServerStatus/list", { detail: "full" })) as {
          data: Array<{ name: string; authStatus: string; tools: Record<string, { name: string }> }>;
        };
        expect(status.data).toHaveLength(1);
        expect(status.data[0]?.name).toBe("fake");
        expect(status.data[0]?.authStatus).toBe("active");
        expect(status.data[0]?.tools["mcp__fake__echo"]?.name).toBe("echo");

        const reload = (await bridge.request("config/mcpServer/reload", {})) as { ok: boolean };
        expect(reload.ok).toBe(true);

        const called = (await bridge.request("mcpServer/tool/call", {
          server: "fake",
          tool: "echo",
          arguments: { k: 2 },
        })) as { content: Array<{ text: string }>; isError: boolean };
        expect(called.isError).toBe(false);
        expect(called.content[0]?.text).toContain("echo:");
        await expect(
          bridge.request("mcpServer/tool/call", { server: "fake", tool: "nope", arguments: {} }),
        ).rejects.toThrow("unknown MCP tool");

        const read = (await bridge.request("mcpServer/resource/read", {
          server: "fake",
          uri: "file:///notes.md",
        })) as { contents: Array<{ text: string }> };
        expect(read.contents[0]?.text).toBe("hello resource");

        await expect(bridge.request("mcpServer/resource/read", { server: "fake" })).rejects.toThrow(
          "requires {server, uri}",
        );
      } finally {
        bridge.stop();
      }
    });
  }, 60000);
});
