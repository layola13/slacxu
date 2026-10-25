/** Claude Code — web side. */
import type { WebPlugin } from "@cxu/sdk-frontend/web";
import { CLAUDE_MANIFEST } from "./manifest.js";

export const claudeWebPlugin: WebPlugin = {
  manifest: CLAUDE_MANIFEST,
  descriptor: {
    id: "claude",
    label: "Claude",
    icon: "/icons/claudecode-color.svg",
    labelKeys: { name: "cliBackend.claude" },
    builtIn: false,
  },
  installationKind: "claude",
  providerLinkage: { providerId: null, groupId: null, model: null, skipActivation: false },
  classification: { isBuiltInMini: false, family: "claude" },
  waterfall: { compactionLabel: "Claude" },
};

export default claudeWebPlugin;
