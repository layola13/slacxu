import { randomUUID } from "node:crypto";
import { access, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

type JsonObject = Record<string, unknown>;
const MODEL_CONTEXT_VARIANT_PATTERN = /\[(\d+(?:\.\d+)?)\s*([km])\]$/i;
const CLAUDE_MODEL_PATTERN = /(?:^|[./:_-])claude(?:[./:_-]|$)/i;

export type ClaudeDesktopRelayMapping = { from: string; to: string };

// Returned when automatic discovery cannot locate the config library, so the
// client can prompt for a manually entered path (configLibraryDir).
export const CLAUDE_DESKTOP_CONFIG_NOT_FOUND_CODE = "claudeDesktopConfigLibraryNotFound";

export type ClaudeDesktopInjectionInput = {
  baseUrl: string;
  token: string;
  models: string[];
  configLibraryDir?: string;
  platform?: NodeJS.Platform;
  localAppData?: string;
};

export function buildClaudeDesktopRelayInjection(
  sourceModels: string[],
  modelMappings: Record<string, string> = {}
): { desktopModels: string[]; groupModelMappings: ClaudeDesktopRelayMapping[] } {
  const desktopModels: string[] = [];
  const groupModelMappings: ClaudeDesktopRelayMapping[] = [];
  const aliasTargets = new Map<string, string>();

  for (const sourceModel of [...new Set(sourceModels.map((model) => model.trim()).filter(Boolean))]) {
    const source = splitModelContextVariant(sourceModel);
    if (CLAUDE_MODEL_PATTERN.test(source.baseModel)) {
      desktopModels.push(sourceModel);
      continue;
    }
    const requestedAlias = (modelMappings[sourceModel] ?? modelMappings[source.baseModel] ?? "").trim();
    const alias = splitModelContextVariant(requestedAlias);
    if (!requestedAlias || !CLAUDE_MODEL_PATTERN.test(alias.baseModel)) {
      throw new Error(`Claude model mapping is required for non-Claude model: ${sourceModel}`);
    }
    const existingTarget = aliasTargets.get(alias.baseModel);
    if (existingTarget && existingTarget !== source.baseModel) {
      throw new Error(`Claude model alias is already mapped to another model: ${alias.baseModel}`);
    }
    aliasTargets.set(alias.baseModel, source.baseModel);
    const contextSuffix = source.contextSuffix || alias.contextSuffix;
    desktopModels.push(`${alias.baseModel}${contextSuffix}`);
    groupModelMappings.push({ from: alias.baseModel, to: source.baseModel });
  }

  return {
    desktopModels: [...new Set(desktopModels)],
    groupModelMappings: [...new Map(groupModelMappings.map((entry) => [entry.from, entry])).values()]
  };
}

// The publisher hash suffix of the MSIX package family name varies per machine,
// so packaged installs are discovered instead of hard-coded.
const CLAUDE_MSIX_PACKAGE_PATTERN = /^Claude_[A-Za-z0-9]+$/i;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolveClaudeConfigLibraryDir(options: {
  platform?: NodeJS.Platform;
  localAppData?: string;
} = {}): Promise<string> {
  const targetPlatform = options.platform ?? process.platform;
  if (targetPlatform !== "win32") throw new Error("Claude Desktop injection is only available on Windows");
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
  if (!localAppData?.trim()) throw new Error("LOCALAPPDATA is unavailable");
  const candidates = [join(localAppData, "Claude-3p", "configLibrary")];
  try {
    const packagesDir = join(localAppData, "Packages");
    const entries = (await readdir(packagesDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && CLAUDE_MSIX_PACKAGE_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const packageName of entries) {
      candidates.push(
        join(packagesDir, packageName, "LocalCache", "Local", "Claude-3p", "configLibrary"),
        join(packagesDir, packageName, "LocalCache", "Roaming", "Claude-3p", "configLibrary")
      );
    }
  } catch {
    // No Packages directory: only the classic install location can exist.
  }
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  throw new Error(`Claude Desktop config library directory was not found (searched: ${candidates.join(", ")})`);
}

export async function readClaudeActiveConfig(configLibraryDir: string): Promise<{ id: string; path: string; config: JsonObject }> {
  const meta = parseJsonObject(await readFile(join(configLibraryDir, "_meta.json"), "utf8"), "Claude Desktop config metadata");
  const id = typeof meta.appliedId === "string" ? meta.appliedId.trim() : "";
  if (!id || basename(id) !== id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error("Claude Desktop active third-party config was not found");
  }
  const path = join(configLibraryDir, `${id}.json`);
  const config = parseJsonObject(await readFile(path, "utf8"), "Claude Desktop active config");
  return { id, path, config };
}

export async function writeClaudeDesktopInference(input: ClaudeDesktopInjectionInput): Promise<{
  id: string;
  configPath: string;
  desktopConfigPath: string;
}> {
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
  const token = input.token.trim();
  const requestedModels = [...new Set(input.models.map((model) => model.trim()).filter(Boolean))];
  const variantBaseModels = new Set(requestedModels.flatMap((model) => {
    const match = model.match(MODEL_CONTEXT_VARIANT_PATTERN);
    return match ? [model.slice(0, match.index).trim()] : [];
  }));
  const models = requestedModels.filter((model) => MODEL_CONTEXT_VARIANT_PATTERN.test(model) || !variantBaseModels.has(model));
  if (!baseUrl || !token || models.length === 0) {
    throw new Error("Claude Desktop injection requires a gateway URL, token, and at least one model");
  }
  const configLibraryDir = input.configLibraryDir ?? await resolveClaudeConfigLibraryDir({ platform: input.platform, localAppData: input.localAppData });
  const active = await readClaudeActiveConfig(configLibraryDir);
  const nextConfig: JsonObject = {
    ...active.config,
    inferenceGatewayBaseUrl: baseUrl,
    inferenceGatewayApiKey: token,
    inferenceGatewayAuthScheme: "bearer",
    inferenceProvider: "gateway",
    inferenceCredentialKind: "static",
    inferenceModels: models,
    modelDiscoveryEnabled: false
  };
  delete nextConfig.inference;
  delete nextConfig.models;
  const temporaryPath = join(configLibraryDir, `.${active.id}.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(nextConfig, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, active.path);

  const desktopConfigPath = join(dirname(configLibraryDir), "claude_desktop_config.json");
  let existingDesktopConfig: JsonObject = {};
  try {
    existingDesktopConfig = parseJsonObject(await readFile(desktopConfigPath, "utf8"), "Claude Desktop settings");
  } catch (error) {
    if (!(error instanceof Error) || !/ENOENT/.test(error.message)) throw error;
  }
  const nextDesktopConfig: JsonObject = { ...existingDesktopConfig, deploymentMode: "3p" };
  delete nextDesktopConfig.awaitingSignIn;
  await writeFile(desktopConfigPath, `${JSON.stringify(nextDesktopConfig, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  return { id: active.id, configPath: active.path, desktopConfigPath };
}

function parseJsonObject(source: string, label: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value as JsonObject;
}

function splitModelContextVariant(model: string): { baseModel: string; contextSuffix: string } {
  const normalized = model.trim();
  const match = normalized.match(MODEL_CONTEXT_VARIANT_PATTERN);
  return match
    ? { baseModel: normalized.slice(0, match.index).trim(), contextSuffix: match[0].replace(/\s+/g, "") }
    : { baseModel: normalized, contextSuffix: "" };
}
