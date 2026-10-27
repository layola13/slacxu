import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isClaudeCodeSaVmRegistered,
  parseJsonObjectConfig,
  upsertSaVmMcpServerJsonFile
} from "../../apps/server/src/saVmBundle";

const SCRIPT = "C:\\Users\\zhan\\.codex-ultra\\sa-vm\\sa-vm-mcp.mjs";

test("parses JSON config with a UTF-8 BOM prefix", () => {
  expect(parseJsonObjectConfig("\uFEFF{\"mcpServers\":{}}")).toEqual({ mcpServers: {} });
});

test("rejects non-object JSON roots so callers fail closed", () => {
  expect(() => parseJsonObjectConfig("[]")).toThrow();
  expect(() => parseJsonObjectConfig("null")).toThrow();
  expect(() => parseJsonObjectConfig("{not json")).toThrow();
});

test("upserts sa-vm into a BOM-prefixed gemini config and keeps other servers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-test-gemini-mcp-"));
  try {
    const confPath = join(dir, "mcp_config.json");
    await writeFile(
      confPath,
      "\uFEFF" + JSON.stringify({ mcpServers: { other: { command: "uv", args: ["run"] } } }, null, 4),
      "utf8"
    );
    await upsertSaVmMcpServerJsonFile(confPath, SCRIPT);
    const after = JSON.parse(await readFile(confPath, "utf8"));
    expect(after.mcpServers.other).toEqual({ command: "uv", args: ["run"] });
    expect(after.mcpServers["sa-vm"]).toEqual({ command: "node", args: [SCRIPT] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("creates a gemini config when none exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-test-gemini-mcp-new-"));
  try {
    const confPath = join(dir, "mcp_config.json");
    await upsertSaVmMcpServerJsonFile(confPath, SCRIPT);
    const after = JSON.parse(await readFile(confPath, "utf8"));
    expect(Object.keys(after.mcpServers)).toEqual(["sa-vm"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("leaves an unparsable gemini config untouched instead of overwriting it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-test-gemini-mcp-bad-"));
  try {
    const confPath = join(dir, "mcp_config.json");
    const broken = "{ \"mcpServers\": { \"keep\": ";
    await writeFile(confPath, broken, "utf8");
    await expect(upsertSaVmMcpServerJsonFile(confPath, SCRIPT)).rejects.toThrow();
    expect(await readFile(confPath, "utf8")).toBe(broken);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const GET_OUTPUT = [
  "sa-vm:",
  "  Scope: User config (available in all your projects)",
  "  Status: ✔ Connected",
  "  Type: stdio",
  "  Command: node",
  "  Args: C:/Users/zhan/.codex-ultra/sa-vm/sa-vm-mcp.mjs",
  "  Environment:"
].join("\n");

test("recognizes a user-scope entry already pointing at the script (slash-insensitive)", () => {
  expect(isClaudeCodeSaVmRegistered(GET_OUTPUT, SCRIPT)).toBe(true);
});

test("treats a different script path as stale", () => {
  expect(isClaudeCodeSaVmRegistered(GET_OUTPUT, "D:\\other\\sa-vm-mcp.mjs")).toBe(false);
});

test("treats a project-scope entry as not the user registration", () => {
  const projectScope = GET_OUTPUT.replace("User config (available in all your projects)", "Project config (shared via .mcp.json)");
  expect(isClaudeCodeSaVmRegistered(projectScope, SCRIPT)).toBe(false);
});
