/** Grok — web side. */
import type { WebPlugin } from "@cxu/sdk-frontend/web";
import { GROK_MANIFEST } from "./manifest.js";

export const grokWebPlugin: WebPlugin = {
  manifest: GROK_MANIFEST,
  descriptor: {
    id: "grok",
    label: "Grok",
    icon: "/icons/grok.svg",
    labelKeys: { name: "cliBackend.grok" },
    builtIn: false,
  },
  installationKind: "grok",
  providerLinkage: { providerId: null, groupId: null, model: null, skipActivation: false },
  classification: { isBuiltInMini: false, family: "grok" },
  waterfall: { compactionLabel: "Grok" },
};

export default grokWebPlugin;
