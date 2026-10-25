import type { PluginManifest } from "@cxu/sdk-frontend";
import manifestJson from "../plugin.json" with { type: "json" };

/** The manifest single source of truth is this project's plugin.json
 * (JSON import — inlined at bundle time; never a runtime file read). */
export const ENHANCE_MANIFEST = manifestJson as PluginManifest;
