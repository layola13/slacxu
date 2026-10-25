/** OpenCode v1 — web side. */
import type { WebPlugin } from "@cxu/sdk-frontend/web";
import { OPENCODE_MANIFEST } from "./manifest.js";

export const opencodeWebPlugin: WebPlugin = {
  manifest: OPENCODE_MANIFEST,
  descriptor: {
    id: "opencode",
    label: "OpenCode",
    icon: "/icons/opencode.svg",
    labelKeys: { name: "cliBackend.opencode" },
    builtIn: false,
  },
  installationKind: "opencode",
  providerLinkage: { providerId: "opencode-local", groupId: "v1", model: null, skipActivation: true },
  classification: { isBuiltInMini: false, family: "opencode" },
  waterfall: { compactionLabel: "OpenCode" },
};

export default opencodeWebPlugin;
