/**
 * Free (money-saving) mode — server side (kind "feature"). Owns the
 * free-compaction relay request logic (`src/free/
 * compactionRelayRequest.ts`, moved verbatim from the host): route
 * resolution, model/tool rewriting and fallback tracking for free
 * compaction through the relay engine (cxu-backend-relay-config).
 * The workbench server imports it via a staging import, as before.
 */
import type { ServiceHost, ServicePlugin } from "@cxu/sdk-backend";
import { FREE_MODE_MANIFEST } from "./manifest.js";

export { FREE_MODE_MANIFEST } from "./manifest.js";
export * from "./free/compactionRelayRequest.js";

class FreeModeService implements ServicePlugin {
  readonly manifest = FREE_MODE_MANIFEST;
  async start(_host: ServiceHost): Promise<void> {
    // Pure request-shaping library at the service layer; the host
    // drives it per compaction request, as before the move.
  }
  async stop(): Promise<void> {}
}

export const freeModeServicePlugin: ServicePlugin = new FreeModeService();
