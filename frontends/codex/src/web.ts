/** Codex — web side. */
import type { WebPlugin } from "@cxu/sdk-frontend/web";
import { CODEX_MANIFEST } from "./manifest.js";

export const codexWebPlugin: WebPlugin = {
  manifest: CODEX_MANIFEST,
  descriptor: {
    id: "codex",
    label: "Codex",
    icon: "/icons/codex-color.svg",
    labelKeys: { name: "cliBackend.codex" },
    builtIn: false,
  },
  installationKind: "codex",
  providerLinkage: { providerId: null, groupId: null, model: null, skipActivation: false },
  classification: { isBuiltInMini: false, family: "codex" },
  waterfall: { compactionLabel: "Codex" },
};

export default codexWebPlugin;
