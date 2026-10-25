/**
 * JEV evaluation engine — server side (kind "service"). Owns the JEV
 * upstream client and the native jev_* tool implementations
 * (`src/jev/saVmJev.ts`, moved verbatim from the host) plus the
 * OpenAI-bridge converter (`src/jev/jevOpenAiBridge.ts`). The host's
 * SA-VM engine (saVmTool) and the workbench server import the engine
 * from here via staging imports; shared JEV config state lives in the
 * engine module itself, exactly as before the move.
 */
import type { ServiceHost, ServicePlugin } from "@cxu/sdk-backend";
import { JEV_MANIFEST } from "./manifest.js";

export { JEV_MANIFEST } from "./manifest.js";
export * from "./jev/saVmJev.js";
export * from "./jev/jevOpenAiBridge.js";

class JevService implements ServicePlugin {
  readonly manifest = JEV_MANIFEST;
  async start(_host: ServiceHost): Promise<void> {
    // The engine is stateless at the service layer: its config and
    // rate-limit state live in saVmJev.ts and are driven by the host.
  }
  async stop(): Promise<void> {}
}

export const jevServicePlugin: ServicePlugin = new JevService();
