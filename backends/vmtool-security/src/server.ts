/**
 * VM tool security — server side (kind "service"). Owns the SA-VM
 * security policy engine (`src/security/saVmPolicy.ts`: path/command/
 * network allow rules, bun profiles) and the interception checks
 * (`src/security/saVmInterception.ts`), moved verbatim from the
 * host. The SA-VM engine files (saVmTool, saVmApplyPatch,
 * saVmCodeGraph, saVmSplitWorkflow, gitWorkspace, index) consume
 * them via explicit staging imports; the policy store location
 * still comes from the host's localDatabase (staging edge).
 */
import type { ServiceHost, ServicePlugin } from "@cxu/sdk-backend";
import { VMTOOL_SECURITY_MANIFEST } from "./manifest.js";

export { VMTOOL_SECURITY_MANIFEST } from "./manifest.js";
export * from "./security/saVmPolicy.js";
export * from "./security/saVmInterception.js";

class VmToolSecurityService implements ServicePlugin {
  readonly manifest = VMTOOL_SECURITY_MANIFEST;
  async start(_host: ServiceHost): Promise<void> {
    // Pure policy/check library at the service layer; the host's
    // SA-VM engine drives it per tool call, as before the move.
  }
  async stop(): Promise<void> {}
}

export const vmToolSecurityServicePlugin: ServicePlugin = new VmToolSecurityService();
