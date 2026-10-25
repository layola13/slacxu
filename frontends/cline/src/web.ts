/** Cline — web side. */
import type { WebPlugin } from "@cxu/sdk-frontend/web";
import { CLINE_MANIFEST } from "./manifest.js";

export const clineWebPlugin: WebPlugin = {
  manifest: CLINE_MANIFEST,
  descriptor: {
    id: "cline",
    label: "Cline",
    icon: "/icons/cline-color.svg",
    labelKeys: { name: "cliBackend.cline" },
    builtIn: false,
  },
  installationKind: "cline",
  providerLinkage: { providerId: null, groupId: null, model: null, skipActivation: false },
  classification: { isBuiltInMini: false, family: "cline" },
  waterfall: { compactionLabel: "Cline" },
};

export default clineWebPlugin;
