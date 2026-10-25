import { readFileSync } from "node:fs";
import type { PluginManifest } from "@cxu/sdk-frontend";

/** The manifest single source of truth is this project's plugin.json. */
export const RELAY_CONFIG_MANIFEST = JSON.parse(
  readFileSync(new URL("../plugin.json", import.meta.url), "utf8"),
) as PluginManifest;
