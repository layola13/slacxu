/**
 * Mini Agent — web side. Mirrors the descriptor the host's central plugin
 * table used to hard-code for mini (built-in, default backend).
 */
import type { WebPlugin } from "@cxu/sdk-frontend/web";
import { MINI_MANIFEST } from "./manifest.js";

export const miniWebPlugin: WebPlugin = {
  manifest: MINI_MANIFEST,
  descriptor: {
    id: "mini",
    label: "Mini",
    icon: "/icons/mini.svg",
    labelKeys: { name: "cliBackend.mini" },
    builtIn: true,
    defaultBackend: true,
  },
  installationKind: null,
  providerLinkage: { providerId: null, groupId: null, model: null, skipActivation: false },
  classification: { isBuiltInMini: true, family: "mini" },
  waterfall: { compactionLabel: "Mini" },
};

export default miniWebPlugin;
