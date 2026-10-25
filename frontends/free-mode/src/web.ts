/**
 * Free (money-saving) mode — web side (kind "feature"). Owns the
 * free-mode UI and pure helpers (`src/free/`: freeCompactionReadiness,
 * freeAutoCompactPreferences, VmContextSavingsTab). The compaction
 * hooks (useFreeCompaction / useFreeCompactionSelection) turned out
 * to be the workbench turn-send pipeline itself, so R2 re-homed them
 * to apps/web/src/free as host core; they consume the readiness and
 * preference helpers from here during staging.
 */
import type { WebFeaturePlugin } from "@cxu/sdk-frontend";
import { FREE_MODE_MANIFEST } from "./manifest.js";

export { FREE_MODE_MANIFEST } from "./manifest.js";
export { VmContextSavingsTab } from "./free/VmContextSavingsTab.js";

export const freeModeWebPlugin: WebFeaturePlugin = {
  manifest: FREE_MODE_MANIFEST,
  contributions: {
    slots: [
      {
        slot: "composer",
        render: () => {
          throw new Error("free-mode renders through the host's direct hook imports during staging");
        },
      },
    ],
  },
};

export default freeModeWebPlugin;
