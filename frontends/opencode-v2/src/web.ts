/** OpenCode v2 — web side. White-frame icon distinguishes it from v1. */
import type { WebPlugin } from "@cxu/sdk-frontend/web";
import { OPENCODE_V2_MANIFEST } from "./manifest.js";

export const opencodeV2WebPlugin: WebPlugin = {
  manifest: OPENCODE_V2_MANIFEST,
  descriptor: {
    id: "opencode-v2",
    label: "OpenCode v2",
    icon: "/icons/opencode-v2.svg",
    labelKeys: { name: "cliBackend.opencode-v2" },
    builtIn: false,
  },
  installationKind: "opencode-v2",
  providerLinkage: { providerId: "opencode-local", groupId: "v2", model: null, skipActivation: true },
  classification: { isBuiltInMini: false, family: "opencode" },
  waterfall: { compactionLabel: "OpenCode v2" },
};

export default opencodeV2WebPlugin;
