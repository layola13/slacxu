/**
 * JEV evaluation engine — web side (kind "service"). Owns the JEV
 * client stack (`src/jev/`: jevConfig, jevClient, jevQuestions,
 * jevAutoJudge, jevTurnSnapshotDispatch) and the settings dialog
 * (`src/jev/JevSettingsDialog.tsx`), all moved verbatim from the
 * host. The composer and the settings shell import them directly
 * during staging.
 */
import type { WebFeaturePlugin } from "@cxu/sdk-frontend";
import { JEV_MANIFEST } from "./manifest.js";

export { JEV_MANIFEST } from "./manifest.js";
export { JevSettingsDialog } from "./jev/JevSettingsDialog.js";

export const jevWebPlugin: WebFeaturePlugin = {
  manifest: JEV_MANIFEST,
  contributions: {
    settingsPanels: [
      {
        id: "jev",
        titleKey: "jev.settings.title",
        render: () => {
          throw new Error("jev settings render through the host's direct JevSettingsDialog import during staging");
        },
      },
    ],
  },
};

export default jevWebPlugin;
