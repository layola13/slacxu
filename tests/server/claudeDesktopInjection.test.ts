import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildClaudeDesktopRelayInjection,
  readClaudeActiveConfig,
  resolveClaudeConfigLibraryDir,
  writeClaudeDesktopInference
} from "../../backends/claude/src/runtime/claudeDesktopInjection.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createConfigLibrary(config: Record<string, unknown> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "codex-ultra-claude-config-"));
  temporaryDirectories.push(directory);
  const id = "b8367be1-b755-4cb1-b14f-8f7b6e4cf6e6";
  writeFileSync(join(directory, "_meta.json"), JSON.stringify({ appliedId: id }), "utf8");
  writeFileSync(join(directory, `${id}.json`), JSON.stringify(config), "utf8");
  return { directory, id, path: join(directory, `${id}.json`) };
}

test("Claude Desktop injection writes the official flat gateway schema and preserves other settings", async () => {
  const library = createConfigLibrary({ theme: "dark", inference: { provider: "anthropic" } });

  const result = await writeClaudeDesktopInference({
    configLibraryDir: library.directory,
    baseUrl: "http://127.0.0.1:43120/api/relay-gateway/deepkey/default/v1/",
    token: "stable-gateway-token",
    models: ["claude-sonnet-4-5", "claude-opus-5[1m]"]
  });

  expect(result).toEqual({
    id: library.id,
    configPath: library.path,
    desktopConfigPath: join(dirname(library.directory), "claude_desktop_config.json")
  });
  expect(JSON.parse(readFileSync(library.path, "utf8"))).toEqual({
    theme: "dark",
    inferenceGatewayBaseUrl: "http://127.0.0.1:43120/api/relay-gateway/deepkey/default/v1",
    inferenceGatewayApiKey: "stable-gateway-token",
    inferenceGatewayAuthScheme: "bearer",
    inferenceProvider: "gateway",
    inferenceCredentialKind: "static",
    inferenceModels: ["claude-sonnet-4-5", "claude-opus-5[1m]"],
    modelDiscoveryEnabled: false
  });
});

test("Claude Desktop injection enables third-party deployment mode", async () => {
  const library = createConfigLibrary();
  const desktopConfigPath = join(dirname(library.directory), "claude_desktop_config.json");
  writeFileSync(desktopConfigPath, JSON.stringify({
    preferences: { theme: "dark" },
    deploymentMode: "1p",
    awaitingSignIn: true
  }), "utf8");

  await writeClaudeDesktopInference({
    configLibraryDir: library.directory,
    baseUrl: "http://127.0.0.1:43120/api/relay-gateway/deepkey/default",
    token: "stable-gateway-token",
    models: ["claude-opus-5[1m]"]
  });

  expect(JSON.parse(readFileSync(desktopConfigPath, "utf8"))).toEqual({
    preferences: { theme: "dark" },
    deploymentMode: "3p"
  });
});

test("Claude Desktop injection keeps the explicit 1M variant and removes its redundant base entry", async () => {
  const library = createConfigLibrary();

  await writeClaudeDesktopInference({
    configLibraryDir: library.directory,
    baseUrl: "http://127.0.0.1:43120/api/relay-gateway/anyrouter/claude/v1",
    token: "stable-gateway-token",
    models: ["claude-opus-5", "claude-opus-5[1m]", "claude-sonnet-5", " claude-opus-5[1m] "]
  });

  const config = JSON.parse(readFileSync(library.path, "utf8"));
  expect(config.modelDiscoveryEnabled).toBe(false);
  expect(config.inferenceModels).toEqual(["claude-opus-5[1m]", "claude-sonnet-5"]);
});

test("Claude Desktop relay injection creates Claude aliases for non-Claude models", () => {
  expect(buildClaudeDesktopRelayInjection(
    ["gpt-5.6-terra", "gpt-5.6-sol"],
    {
      "gpt-5.6-terra": "claude-sonnet-5",
      "gpt-5.6-sol": "claude-opus-4-8[1m]"
    }
  )).toEqual({
    desktopModels: ["claude-sonnet-5", "claude-opus-4-8[1m]"],
    groupModelMappings: [
      { from: "claude-sonnet-5", to: "gpt-5.6-terra" },
      { from: "claude-opus-4-8", to: "gpt-5.6-sol" }
    ]
  });
});

test("Claude Desktop relay injection preserves native Claude models", () => {
  expect(buildClaudeDesktopRelayInjection(["claude-sonnet-5[1m]"])).toEqual({
    desktopModels: ["claude-sonnet-5[1m]"],
    groupModelMappings: []
  });
});

test("Claude Desktop relay injection requires unique aliases for non-Claude models", () => {
  expect(() => buildClaudeDesktopRelayInjection(
    ["gpt-5.6-terra", "gpt-5.6-sol"],
    {
      "gpt-5.6-terra": "claude-sonnet-5",
      "gpt-5.6-sol": "claude-sonnet-5[1m]"
    }
  )).toThrow("already mapped");
});

test("Claude Desktop injection rejects an empty model selection", async () => {
  const library = createConfigLibrary();

  await expect(writeClaudeDesktopInference({
    configLibraryDir: library.directory,
    baseUrl: "http://127.0.0.1:43120/api/relay-gateway/anyrouter/claude",
    token: "stable-gateway-token",
    models: []
  })).rejects.toThrow("at least one model");
});

test("Claude Desktop injection rejects unsupported platforms", async () => {
  await expect(resolveClaudeConfigLibraryDir({ platform: "linux", localAppData: "C:\\Users\\test\\AppData\\Local" }))
    .rejects.toThrow("only available on Windows");
});

test("Claude Desktop injection resolves the classic config library when it exists", async () => {
  const localAppData = mkdtempSync(join(tmpdir(), "codex-ultra-claude-appdata-"));
  temporaryDirectories.push(localAppData);
  const expected = join(localAppData, "Claude-3p", "configLibrary");
  mkdirSync(expected, { recursive: true });

  expect(await resolveClaudeConfigLibraryDir({ platform: "win32", localAppData })).toBe(expected);
});

test("Claude Desktop injection discovers packaged installs regardless of publisher hash", async () => {
  const localAppData = mkdtempSync(join(tmpdir(), "codex-ultra-claude-appdata-"));
  temporaryDirectories.push(localAppData);
  const packagesDir = join(localAppData, "Packages");
  const expected = join(packagesDir, "Claude_pzs8sxrjxfjjc", "LocalCache", "Local", "Claude-3p", "configLibrary");
  mkdirSync(expected, { recursive: true });

  expect(await resolveClaudeConfigLibraryDir({ platform: "win32", localAppData })).toBe(expected);
});

test("Claude Desktop injection reports every searched location before failing", async () => {
  const localAppData = mkdtempSync(join(tmpdir(), "codex-ultra-claude-appdata-"));
  temporaryDirectories.push(localAppData);
  mkdirSync(join(localAppData, "Packages", "NotClaude_abc123"), { recursive: true });

  await expect(resolveClaudeConfigLibraryDir({ platform: "win32", localAppData })).rejects.toThrow("was not found");
});

test("Claude Desktop injection rejects a missing active config", async () => {
  const library = createConfigLibrary();
  writeFileSync(join(library.directory, "_meta.json"), JSON.stringify({}), "utf8");

  await expect(readClaudeActiveConfig(library.directory)).rejects.toThrow("active third-party config was not found");
});

test("Claude Desktop injection rejects path traversal in the active id", async () => {
  const library = createConfigLibrary();
  writeFileSync(join(library.directory, "_meta.json"), JSON.stringify({ appliedId: "../outside" }), "utf8");

  await expect(readClaudeActiveConfig(library.directory)).rejects.toThrow("active third-party config was not found");
});
