/**
 * Auggie manifest — the single source is ../plugin.json; both sides
 * import it from here so the web side never pulls in server code.
 */
import type { PluginManifest } from "@cxu/sdk-frontend";
import manifestJson from "../plugin.json" with { type: "json" };

export const AUGGIE_MANIFEST: PluginManifest = manifestJson as PluginManifest;
