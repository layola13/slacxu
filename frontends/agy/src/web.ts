/** Antigravity — web side. */
import type { WebPlugin } from "@cxu/sdk-frontend/web";
import { AGY_MANIFEST } from "./manifest.js";

export const agyWebPlugin: WebPlugin = {
  manifest: AGY_MANIFEST,
  descriptor: {
    id: "agy",
    label: "Antigravity",
    icon: "/icons/agy-color.svg",
    labelKeys: { name: "cliBackend.agy" },
    builtIn: false,
  },
  installationKind: "agy",
  providerLinkage: { providerId: null, groupId: null, model: null, skipActivation: false },
  classification: { isBuiltInMini: false, family: "agy" },
  waterfall: { compactionLabel: "Antigravity" },
};

export default agyWebPlugin;
