/**
 * OpenCode v2 manifest — the single source is ../plugin.json; both sides
 * import it from here so the web side never pulls in server code.
 */
import type { PluginManifest } from "@cxu/sdk-backend";
import manifestJson from "../plugin.json" with { type: "json" };

export const OPENCODE_V2_MANIFEST: PluginManifest = manifestJson as PluginManifest;
