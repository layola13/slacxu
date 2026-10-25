/** Auggie (Augment Code) — web side. */
import type { WebPlugin } from "@cxu/sdk-frontend/web";
import { AUGGIE_MANIFEST } from "./manifest.js";

export const auggieWebPlugin: WebPlugin = {
  manifest: AUGGIE_MANIFEST,
  descriptor: {
    id: "auggie",
    label: "Auggie",
    icon: "/icons/auggie-color.svg",
    labelKeys: { name: "cliBackend.auggie" },
    builtIn: false,
  },
  installationKind: "auggie",
  providerLinkage: { providerId: null, groupId: null, model: null, skipActivation: false },
  classification: { isBuiltInMini: false, family: "auggie" },
  waterfall: { compactionLabel: "Auggie" },
};

export default auggieWebPlugin;
