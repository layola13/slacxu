/**
 * Code enhancement tools (kind "feature"). Owns the enhancement
 * dialog (`src/enhance/EnhanceToolsDialog.tsx`, moved verbatim from
 * the host) that the composer opens: per-tool toggles and prompts
 * for the JEV-powered active tools. Execution lives in the
 * cxu-backend-jev plugin; this plugin is the configuration surface.
 */
import type { WebFeaturePlugin } from "@cxu/sdk-frontend";
import { ENHANCE_MANIFEST } from "./manifest.js";

export { ENHANCE_MANIFEST } from "./manifest.js";
export { EnhanceToolsDialog } from "./enhance/EnhanceToolsDialog.js";

export const enhanceWebPlugin: WebFeaturePlugin = {
  manifest: ENHANCE_MANIFEST,
  contributions: {
    slots: [
      {
        slot: "composer",
        render: () => {
          throw new Error("enhance renders through the composer's direct EnhanceToolsDialog import during staging");
        },
      },
    ],
  },
};

export default enhanceWebPlugin;
