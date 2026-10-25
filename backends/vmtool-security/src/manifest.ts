import type { PluginManifest } from "@cxu/sdk-backend";
import manifestJson from "../plugin.json" with { type: "json" };

/** The manifest single source of truth is this project's plugin.json. */
export const VMTOOL_SECURITY_MANIFEST: PluginManifest = manifestJson as PluginManifest;
