/**
 * Relay-station configuration — web side: a settings panel contribution
 * (kind "service"). Phase 1: declaration level.
 */
import type { WebFeaturePlugin } from "@cxu/sdk-frontend";
import { RELAY_CONFIG_MANIFEST } from "./manifest.js";

export const relayConfigWebPlugin: WebFeaturePlugin = {
  manifest: RELAY_CONFIG_MANIFEST,
  contributions: {
    settingsPanels: [
      {
        id: "relay-config",
        titleKey: "settings.relayStations",
        render: () => {
          throw new Error("relay-config panel is not wired to the host yet (phase 1 declaration)");
        },
      },
    ],
  },
};

export default relayConfigWebPlugin;
