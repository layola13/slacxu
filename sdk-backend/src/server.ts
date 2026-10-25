/**
 * Server side of the plugin SDK. A plugin's server entry point exports a
 * `ServerPlugin`; the server host holds one live engine per installed
 * plugin and routes work to it by plugin id.
 */
import type { PluginManifest } from "./index.js";

export interface EngineStatus {
  phase: "stopped" | "starting" | "ready" | "error";
  transport?: string;
  version?: string;
  error?: string;
}

/** One discovered installation of the plugin's CLI on this machine. */
export interface PluginInstallation {
  /** Absolute path to the executable. */
  path: string;
  /** Probed version string, when the binary answered a version probe. */
  version?: string;
  /** How it was found: well-known dir, PATH, or an env override. */
  source: "well-known-dir" | "path" | "env";
}

export interface RpcContext {
  /** Authenticated user id, or "local" in local-token mode. */
  ownerId: string;
  /** The API session the call belongs to. */
  apiSessionId?: string;
}

/**
 * A live engine for one installed plugin. The engine owns its threads end
 * to end and stamps its own plugin id on every thread/session object it
 * returns — identity is never re-derived by the host.
 */
export interface EngineHandle {
  readonly pluginId: string;
  start(): Promise<EngineStatus>;
  stop(): Promise<void>;
  status(): EngineStatus;
  /**
   * Handle one workbench RPC (`thread/start`, `thread/list`,
   * `thread/read`, `turn/start`, …). Returns the RPC result payload;
   * throws an Error with a user-presentable message on failure.
   */
  handleRpc(method: string, params: Record<string, unknown>, ctx: RpcContext): Promise<unknown>;
}

export interface ServerHost {
  /** Per-user data directory for this plugin (config, sessions, caches). */
  dataDir(pluginId: string): string;
  /** Directory the plugin may treat as its workspace-skills root source. */
  workspaceRoot(): string;
  log(pluginId: string, message: string): void;
}

/**
 * The per-backend discovery knowledge a plugin owns: which binary names
 * are its launchers, which env vars override the binary path, and how to
 * qualify a probed candidate. The host owns the generic directory scan
 * (PATH, toolchain dirs, package-manager locations — platform knowledge,
 * not backend knowledge) and asks the plugin only what is backend
 * knowledge. A look-alike binary of a different backend (a v1 `opencode`
 * next to `opencode2`) is rejected by the plugin's own `matchesKind`.
 */
export interface CliDiscoverySpec {
  /** Launcher file names, e.g. ["opencode2", "opencode"]. */
  binaryNames: readonly string[];
  /** Env vars that may hold an explicit binary path, in priority order. */
  envBinVars: readonly string[];
  /** Qualify one probed candidate (path + optional probed version). */
  matchesKind(entry: { path: string; version?: string }): boolean;
  /**
   * User-preferences key holding this backend's preferred binary path
   * (written by POST /api/cli/select). Present = the backend has a
   * selectable binary; embedded engines (Mini) omit it.
   */
  preferredPathPrefKey?: string;
}

/** Host wiring a CLI plugin declares for its Settings toggle (R3). */
export interface CliSettingsDeclaration {
  /** Route slug: the toggle lives at /api/codex/settings/<slug>. */
  slug: string;
  /** Env var that enables the plugin by default (1/true/yes) before any runtime PATCH. */
  enabledEnvVar: string;
  /** Key under which the toggle URL appears in the settings links document, when listed. */
  linkKey?: string;
}

export interface ServerPlugin {
  readonly manifest: PluginManifest;
  /** Settings toggle wiring; absent for plugins without a toggle (e.g. Mini). */
  readonly cliSettings?: CliSettingsDeclaration;
  /**
   * The provider id that, when named by an RPC's providerId /
   * modelProvider, routes the call to this backend (its "official"
   * provider). Absent for backends selected only by explicit id.
   */
  readonly officialProviderId?: string;
  createEngine(host: ServerHost): EngineHandle;
  /** Discovery knowledge for this backend's CLI (see CliDiscoverySpec). */
  readonly discovery: CliDiscoverySpec;
  /**
   * Standalone installation scan: every copy of the plugin's CLI the
   * plugin finds on its own (well-known dirs + PATH), already qualified
   * by `discovery.matchesKind`. Hosts with a richer directory scan use
   * `discovery` directly instead.
   */
  findInstallations(env: NodeJS.ProcessEnv): Promise<PluginInstallation[]>;
  /**
   * Workspace skill roots for this backend, most specific first
   * (e.g. [".opencode/skills", ...]). Empty when the backend has no
   * skills concept.
   */
  skillRoots(cwd: string): string[];
}
export * from "./runtimeClient.js";
