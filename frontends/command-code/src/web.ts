/** Command Code — web side. */
import type { WebPlugin } from "@cxu/sdk-frontend/web";
import { COMMAND_CODE_MANIFEST } from "./manifest.js";

export const commandCodeWebPlugin: WebPlugin = {
  manifest: COMMAND_CODE_MANIFEST,
  descriptor: {
    id: "command-code",
    label: "Command Code",
    icon: "/icons/command-code.png",
    labelKeys: { name: "cliBackend.command-code" },
    builtIn: false,
  },
  installationKind: "command-code",
  providerLinkage: { providerId: null, groupId: null, model: null, skipActivation: false },
  classification: { isBuiltInMini: false, family: "command-code" },
  waterfall: { compactionLabel: "Command Code" },
};

export default commandCodeWebPlugin;
