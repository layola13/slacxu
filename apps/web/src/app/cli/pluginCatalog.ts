/**
 * Installed backend web plugins, assembled from the independent plugin
 * projects under `plugins/`. This catalog is the web host's single
 * registration point: the order below is the canonical switcher order
 * (mini first — it is the only default-installed backend).
 *
 * Each plugin's web module is safe to import here: it depends on the
 * web SDK types and its own plugin.json manifest only, never on server
 * code. Classification, linkage and installation data live in the
 * plugins; the host only assembles them into the registry.
 */
import { WebPluginRegistry, type WebPlugin } from "@cxu/sdk-frontend";
import { miniWebPlugin } from "../../../../../frontends/mini/src/web.js";
import { codexWebPlugin } from "../../../../../frontends/codex/src/web.js";
import { claudeWebPlugin } from "../../../../../frontends/claude/src/web.js";
import { agyWebPlugin } from "../../../../../frontends/agy/src/web.js";
import { grokWebPlugin } from "../../../../../frontends/grok/src/web.js";
import { piWebPlugin } from "../../../../../frontends/pi/src/web.js";
import { opencodeWebPlugin } from "../../../../../frontends/opencode/src/web.js";
import { opencodeV2WebPlugin } from "../../../../../frontends/opencode-v2/src/web.js";
import { museWebPlugin } from "../../../../../frontends/muse/src/web.js";
import { auggieWebPlugin } from "../../../../../frontends/auggie/src/web.js";
import { clineWebPlugin } from "../../../../../frontends/cline/src/web.js";
import { commandCodeWebPlugin } from "../../../../../frontends/command-code/src/web.js";

export const BACKEND_WEB_PLUGINS: readonly WebPlugin[] = [
  miniWebPlugin,
  codexWebPlugin,
  claudeWebPlugin,
  agyWebPlugin,
  grokWebPlugin,
  piWebPlugin,
  opencodeWebPlugin,
  opencodeV2WebPlugin,
  museWebPlugin,
  auggieWebPlugin,
  clineWebPlugin,
  commandCodeWebPlugin,
];

export const webPluginRegistry = new WebPluginRegistry();
for (const plugin of BACKEND_WEB_PLUGINS) {
  webPluginRegistry.register(plugin);
}

/**
 * The waterfall compaction label a backend's OWN plugin declares
 * (Phase 5). Resolution is explicit: the plugin's waterfall mapping,
 * else its descriptor label, else the raw backend id — never another
 * backend's name. Unknown backends resolve to their raw id.
 */
export function waterfallCompactionLabel(backendId: string | null | undefined): string | null {
  if (!backendId) return null;
  const plugin = webPluginRegistry.get(backendId);
  if (!plugin) return backendId;
  return plugin.waterfall?.compactionLabel ?? plugin.descriptor.label ?? backendId;
}

/** The backend web plugin for an id, or undefined — never a substitute. */
export function backendWebPlugin(backendId: string | null | undefined): WebPlugin | undefined {
  return backendId ? webPluginRegistry.get(backendId) : undefined;
}
