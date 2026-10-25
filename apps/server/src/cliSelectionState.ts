/**
 * Shared in-memory state for CLI binary selection.
 *
 * Kept dependency-free so both `codexCommand.ts` (resolution) and
 * `cliVersions.ts` (enumeration) can import it without cycles.
 */

export type CliSelectionKind = "codex" | "claude" | "agy" | "auggie" | "cline" | "command-code" | "grok" | "pi" | "opencode" | "opencode-v2" | "muse";

export interface CliInstallationEntry {
  path: string;
  version?: string;
  source: string;
}

interface CliLatestCache {
  installations: CliInstallationEntry[];
  latestPath: string | undefined;
  refreshedAt: number;
}

const REFRESH_TTL_MS = 5 * 60 * 1000;

const preferredPaths: Partial<Record<CliSelectionKind, string | null>> = {};

const latestCaches: Partial<Record<CliSelectionKind, CliLatestCache>> = {};

const inflightRefreshes: Partial<Record<CliSelectionKind, Promise<void>>> = {};

export function getPreferredCliBinary(kind: CliSelectionKind): string | null {
  return preferredPaths[kind] ?? null;
}

export function setPreferredCliBinary(kind: CliSelectionKind, value: string | null): void {
  if (value) {
    preferredPaths[kind] = value;
  } else {
    delete preferredPaths[kind];
  }
}

export function getCachedLatestCli(kind: CliSelectionKind, maxAgeMs: number = REFRESH_TTL_MS): CliLatestCache | undefined {
  const cache = latestCaches[kind];
  if (!cache) return undefined;
  if (Date.now() - cache.refreshedAt > maxAgeMs) return undefined;
  return cache;
}

/**
 * Synchronous "newest known installation" path used by binary resolution.
 * Deliberately ignores the refresh TTL: resolution must keep honoring the last
 * completed enumeration on long-running servers; staleness only triggers
 * another background refresh, never a silent fallback.
 */
export function getCachedLatestCliPath(kind: CliSelectionKind): string | undefined {
  return latestCaches[kind]?.latestPath;
}

export function getInflightCliRefresh(kind: CliSelectionKind): Promise<void> | undefined {
  return inflightRefreshes[kind];
}

export function setInflightCliRefresh(kind: CliSelectionKind, promise: Promise<void> | undefined): void {
  if (promise) {
    inflightRefreshes[kind] = promise;
  } else {
    delete inflightRefreshes[kind];
  }
}

export function storeLatestCliCache(
  kind: CliSelectionKind,
  installations: CliInstallationEntry[],
  latestPath: string | undefined,
): void {
  latestCaches[kind] = { installations, latestPath, refreshedAt: Date.now() };
}
