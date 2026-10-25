/**
 * Relay-station configuration — server side (kind "service").
 * Owns the relay (中转站) records the providers resolve through. API keys
 * are stored by reference into the host's secure storage, never raw.
 * The relay engine itself (omniRouteFree, relayProtocolGateway,
 * relayCatalog, freebuffSession, freeOllama) physically lives in this
 * project under `src/relay/` and is re-exported below; the host and
 * the backend plugins consume it from here. This service class keeps
 * the SDK-level station registry contract.
 */
import type { RelayConfigPlugin, RelayStation, ServiceHost } from "@cxu/sdk-backend";
import { RELAY_CONFIG_MANIFEST } from "./manifest.js";

export { RELAY_CONFIG_MANIFEST } from "./manifest.js";

class RelayConfigService implements RelayConfigPlugin {
  readonly manifest = RELAY_CONFIG_MANIFEST;
  readonly rpcNamespaces = {
    relay: async (method: string, params: Record<string, unknown>) => {
      switch (method) {
        case "list":
          return this.listRelays();
        case "upsert":
          return this.upsertRelay(params.relay as RelayStation);
        case "remove":
          return this.removeRelay(String(params.id ?? ""));
        default:
          throw new Error(`unknown relay method "${method}"`);
      }
    },
  };
  readonly #relays = new Map<string, RelayStation>();

  async start(_host: ServiceHost): Promise<void> {}
  async stop(): Promise<void> {}

  async listRelays(): Promise<RelayStation[]> {
    return [...this.#relays.values()];
  }

  async upsertRelay(relay: RelayStation): Promise<RelayStation> {
    this.#relays.set(relay.id, relay);
    return relay;
  }

  async removeRelay(id: string): Promise<boolean> {
    return this.#relays.delete(id);
  }

  async resolveRelay(id: string): Promise<RelayStation | undefined> {
    const relay = this.#relays.get(id);
    return relay?.enabled ? relay : undefined;
  }
}

export const relayConfigPlugin: RelayConfigPlugin = new RelayConfigService();

export default relayConfigPlugin;

// The relay engine, owned by this plugin (moved verbatim from the host).
export * from "./relay/omniRouteFree.js";
export * from "./relay/relayCatalog.js";
export * from "./relay/freeOllama.js";
