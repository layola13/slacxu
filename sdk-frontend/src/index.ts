/**
 * @cxu/sdk-frontend — the web-side plugin contract.
 *
 * An independent project (own repo, own version), separate from the
 * server SDK (@cxu/sdk-backend). The two SDKs agree only on
 * the `plugin.json` manifest file format below. A plugin's web side
 * implements this SDK; the web host renders the workbench purely from
 * the descriptors of installed plugins.
 */

/** The `plugin.json` manifest schema (shared file format of both SDKs). */
export interface PluginManifest {
  id: string;
  /** Plugin kind: "backend" | "service" | "framework" | "feature". */
  kind: string;
  version: string;
  displayName: string;
  sides: { server: boolean; web: boolean };
  /** Only "mini" is true: installed and enabled on a fresh install. */
  defaultInstalled: boolean;
  /** Optional web presentation hints (single source: plugin.json). */
  presentation?: { label: string; icon: string; labelKey?: string };
  capabilities: {
    history: boolean;
    compaction: boolean;
    slashCommandForwarding: boolean;
    skills: boolean;
    mcp: boolean;
    fileParts: boolean;
    permissionRoundTrips: boolean;
  };
}

export type { ProviderLinkage, WebPlugin, WebPluginDescriptor } from "./web.js";
export type {
  PanelContribution,
  RouteContribution,
  SlotContribution,
  WebFeatureContributions,
  WebFeaturePlugin,
  WebShellPlugin,
} from "./feature.js";

import type { WebPlugin } from "./web.js";

/** Registry of INSTALLED web plugins — no entry, no UI surface. */
export class WebPluginRegistry {
  readonly #plugins = new Map<string, WebPlugin>();

  register(plugin: WebPlugin): void {
    const { id } = plugin.manifest;
    if (this.#plugins.has(id)) throw new Error(`web plugin "${id}" is already registered`);
    this.#plugins.set(id, plugin);
  }

  unregister(id: string): boolean {
    return this.#plugins.delete(id);
  }

  /** The installed plugin for an id, or undefined — never a substitute. */
  get(id: string): WebPlugin | undefined {
    return this.#plugins.get(id);
  }

  has(id: string): boolean {
    return this.#plugins.has(id);
  }

  ids(): string[] {
    return [...this.#plugins.keys()];
  }

  defaultPlugin(): WebPlugin | undefined {
    for (const plugin of this.#plugins.values()) {
      if (plugin.manifest.defaultInstalled) return plugin;
    }
    return undefined;
  }
}
export * from "./workbenchTypes.js";
export * from "./waterfallTypes.js";
export * from "./jevConfig.js";
/** Translation function shape every web plugin receives from the host. */
export type TranslationKey = string;
export type TranslateFn = (key: TranslationKey, values?: Record<string, string | number>) => string;
