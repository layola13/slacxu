/** Muse — web side. */
import type { WebPlugin } from "@cxu/sdk-frontend/web";
import { MUSE_MANIFEST } from "./manifest.js";

export const museWebPlugin: WebPlugin = {
  manifest: MUSE_MANIFEST,
  descriptor: {
    id: "muse",
    label: "Muse",
    icon: "/icons/muse.png",
    labelKeys: { name: "cliBackend.muse" },
    builtIn: false,
  },
  installationKind: "muse",
  providerLinkage: { providerId: null, groupId: null, model: null, skipActivation: false },
  classification: { isBuiltInMini: false, family: "muse" },
  waterfall: { compactionLabel: "Muse" },
};

export default museWebPlugin;
