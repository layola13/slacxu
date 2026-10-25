/**
 * Host services for server plugins (R2).
 *
 * Plugins may only call the SDK — never host modules. Capabilities that
 * live in the host (CLI selection store, candidate enumeration, the
 * Codex spawn shim, SA-VM tooling, databases, …) are exposed to plugins
 * exclusively through this surface: the host registers one
 * implementation at boot (`setPluginHostServices`), plugins read it via
 * `tryPluginHostServices()` / `pluginHostServices()` and call the
 * grouped services. Groups grow one host-module seam at a time; a group
 * is added here only when a plugin actually consumes it.
 */
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import type { ChannelGroupConfig, ProviderConfig, SaVmPolicyConfig } from "@codex-ui/shared";
import type { SaVmRunInput, SaVmRunResult } from "./saVmTypes.js";
import type { CodexRuntimeClient } from "./runtimeClient.js";

/** Backend ids the host's CLI selection store knows about. */
export type CliSelectionKind =
  | "codex" | "claude" | "agy" | "auggie" | "cline" | "command-code"
  | "grok" | "pi" | "opencode" | "opencode-v2" | "muse";

export interface PluginHostServices {
  /** CLI installation selection + discovery (host: cliSelectionState/cliVersions). */
  cli: {
    /** The user's preferred binary for a kind (Settings → CLI switcher), or null. */
    getPreferredCliBinary(kind: CliSelectionKind): string | null;
    /** Newest enumerated installation for a kind, once enumeration warmed up. */
    getCachedLatestCliPath(kind: CliSelectionKind): string | undefined;
    /** Every on-disk location that looks like a launcher for the kind. */
    enumerateCliCandidates(kind: CliSelectionKind, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string[];
  };
  /** SA-VM bundle installation (host: saVmBundle). */
  saVm: {
    /** Install/refresh the project's SA-VM MCP bundle under <cwd>/.codex-ultra. */
    ensureProjectBundleInstalled(cwd: string): Promise<{ scriptPath: string; installed: boolean }>;
    /** Run one SA-VM tool call through the host's dispatcher (policy-checked). */
    runTool(
      input: SaVmRunInput,
      options?: SaVmPolicyConfig | { cwd?: string; policy?: SaVmPolicyConfig; additionalRoots?: string[] },
      cwdOverride?: string,
    ): Promise<SaVmRunResult>;
  };
  /** Shared stream-json CLI transport (host: codeCliBridge). */
  codeCli: {
    /** Create the shared Code CLI bridge for a runtime environment. */
    createBridge(env: () => NodeJS.ProcessEnv): CodexRuntimeClient;
  };
  /** Remote Bun node tunnels (host: remoteBunNode). */
  remoteBun: {
    openTunnel(command: string, portInput?: number): Promise<{ tunnelId: string; localPort: number; remotePort: number; baseUrl: string; token: string }>;
    closeTunnel(tunnelId: string): boolean;
    request(tunnelId: string, method: string, path: string, body?: unknown, apiSession?: string): Promise<unknown>;
  };
  /** Codex launcher resolution + spawning (host: codexCommand). */
  codex: {
    findCodexBinary(customBin?: string): string;
    isCodexCliAvailable(platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): boolean;
    codexAppServerArgs(command: string): string[];
    spawnCodexCommand(command: string, args: string[], options: SpawnOptionsWithoutStdio): ChildProcessWithoutNullStreams;
    resolveCodexSpawn(command: string, args: string[], platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): { command: string; args: string[]; usesCommandShim: boolean };
  };
  /** Mini Agent fallback bridge (host: mini backend). */
  mini: {
    /**
     * Construct the built-in Mini Agent bridge. Backends that degrade
     * to Mini (e.g. the Codex runtime when no Codex CLI is available)
     * receive it from the host instead of importing the mini plugin.
     */
    createFallbackBridge(): CodexRuntimeClient;
  };
  /** Relay gateway capabilities (host: relay-config gateway + duck2api app). */
  relay: {
    /** Run one chat request through the relay gateway with per-key failover. */
    runChatRequestWithKeyFailover(input: {
      request: Request;
      provider: ProviderConfig;
      group: ChannelGroupConfig;
      apiKeys: string[];
      failoverBudgetMs?: number;
    }): Promise<Response>;
    /** Create the embedded duck2api app (in-process request handler). */
    createDuck2ApiApp(): { request(path: string, init?: RequestInit): Response | Promise<Response> };
  };
}

let current: PluginHostServices | null = null;

/** Called once by the host at boot, before any plugin engine runs. */
export function setPluginHostServices(services: PluginHostServices): void {
  current = services;
}

/**
 * The registered host services, or null when no host registered them
 * (unit tests, standalone tooling). Callers treat null as "no host
 * capabilities" — e.g. no preferred binary — never as another service.
 */
export function tryPluginHostServices(): PluginHostServices | null {
  return current;
}

/** The registered host services; throws when the host has not registered them. */
export function pluginHostServices(): PluginHostServices {
  if (!current) {
    throw new Error("plugin host services are not registered (the host must call setPluginHostServices at boot)");
  }
  return current;
}
