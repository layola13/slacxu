/**
 * Service plugins (kind "service"): long-lived server features that are
 * not agent backends — relay-station configuration, MCP hosting, skills
 * hosting, … A service plugin has a lifecycle and may expose RPC
 * namespaces to the workbench; its web side (when it has one) is a
 * WebFeaturePlugin from the web SDK.
 */
import type { PluginManifest, RpcContext } from "./index.js";

export interface ServiceHost {
  /** Per-user data directory for this plugin. */
  dataDir(pluginId: string): string;
  log(pluginId: string, message: string): void;
}

export type RpcHandler = (
  method: string,
  params: Record<string, unknown>,
  ctx: RpcContext,
) => Promise<unknown>;

export interface ServicePlugin {
  readonly manifest: PluginManifest;
  start(host: ServiceHost): Promise<void>;
  stop(): Promise<void>;
  /** RPC namespaces this service answers, e.g. { "relay": handler }. */
  readonly rpcNamespaces?: Readonly<Record<string, RpcHandler>>;
}

/** One configured relay station (中转站). Secrets are references, never raw keys. */
export interface RelayStation {
  id: string;
  name: string;
  /** Gateway base URL, e.g. "https://relay.example.com/v1". */
  baseUrl: string;
  /** Reference to the API key in the host's secure storage. */
  apiKeyRef: string;
  enabled: boolean;
  /** Model ids this relay is known to serve; empty = discover. */
  models: string[];
}

/** Relay-station configuration service (kind "service", id "relay-config"). */
export interface RelayConfigPlugin extends ServicePlugin {
  listRelays(): Promise<RelayStation[]>;
  /** Create or replace a relay by id. Returns the stored record. */
  upsertRelay(relay: RelayStation): Promise<RelayStation>;
  removeRelay(id: string): Promise<boolean>;
  /** The relay a provider/group resolves to, or undefined. */
  resolveRelay(id: string): Promise<RelayStation | undefined>;
}
