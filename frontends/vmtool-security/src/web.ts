/**
 * VM tool security — web side (kind "service"). Owns the VM tools
 * settings tab (`src/security/VmToolsSettingsTab.tsx`, moved
 * verbatim from the host): the sandbox/policy configuration UI the
 * composer opens. It reads JEV config from the cxu-frontend-jev
 * plugin (cross-plugin staging edge), as before.
 */
import type { WebFeaturePlugin } from "@cxu/sdk-frontend";
import { VMTOOL_SECURITY_MANIFEST } from "./manifest.js";

export { VMTOOL_SECURITY_MANIFEST } from "./manifest.js";
export { VmToolsSettingsTab } from "./security/VmToolsSettingsTab.js";

export const vmToolSecurityWebPlugin: WebFeaturePlugin = {
  manifest: VMTOOL_SECURITY_MANIFEST,
  contributions: {
    settingsPanels: [
      {
        id: "vmtool-security",
        titleKey: "settings.nav.security",
        render: () => {
          throw new Error("vmtool-security renders through the composer's direct VmToolsSettingsTab import during staging");
        },
      },
    ],
  },
};

export default vmToolSecurityWebPlugin;
