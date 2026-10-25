/** Pi — web side. */
import type { WebPlugin } from "@cxu/sdk-frontend/web";
import { PI_MANIFEST } from "./manifest.js";

export const piWebPlugin: WebPlugin = {
  manifest: PI_MANIFEST,
  descriptor: {
    id: "pi",
    label: "Pi",
    icon: "/icons/pi.svg",
    labelKeys: { name: "cliBackend.pi" },
    builtIn: false,
  },
  installationKind: "pi",
  providerLinkage: { providerId: null, groupId: null, model: null, skipActivation: false },
  classification: { isBuiltInMini: false, family: "pi" },
  waterfall: { compactionLabel: "Pi" },
};

export default piWebPlugin;
