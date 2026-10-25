/**
 * Web side of the plugin SDK. A plugin's web entry point exports a
 * `WebPlugin`; the web host renders the workbench shell purely from these
 * descriptors for the plugins that are installed.
 */
import type { PluginManifest } from "./index.js";
import type { WebFeatureContributions } from "./feature.js";

export interface WebPluginDescriptor {
  /** Backend id (== manifest.id). */
  id: string;
  /** Fallback display name; localized names come from `labelKeys`. */
  label: string;
  /** Icon URL served by the host (e.g. "/icons/opencode-v2.svg"). */
  icon: string;
  /** i18n keys for the backend name / switcher section / tooltip. */
  labelKeys: { name: string; section?: string; tooltip?: string };
  /** True only for the built-in default backend (mini). */
  builtIn: boolean;
  /** True when this backend is the one a fresh workspace starts with. */
  defaultBackend?: boolean;
}

/** Default provider wiring applied when a thread is created. */
export interface ProviderLinkage {
  /** Provider id to preselect (e.g. "opencode-local"); null = host default. */
  providerId: string | null;
  groupId: string | null;
  /** Model id to preselect; null = provider default. */
  model: string | null;
  /** Skip relay/provider activation flows for this backend. */
  skipActivation: boolean;
}

/**
 * How this backend's turns map onto the shared waterfall (Phase 5).
 * Every backend renders differently, so the mapping lives in the
 * backend's own plugin — the waterfall never hard-codes a CLI name
 * and never substitutes another backend's label: a backend without a
 * mapping renders its rows unbranded.
 */
export interface WaterfallMapping {
  /** Label for this backend's context-compaction rows. Defaults to the descriptor label. */
  compactionLabel?: string;
}

export interface WebPlugin {
  readonly manifest: PluginManifest;
  readonly descriptor: WebPluginDescriptor;
  /** This backend's waterfall mapping; absent = rows render unbranded. */
  readonly waterfall?: WaterfallMapping;
  /** Links the UI to server-side installation discovery for this plugin. */
  readonly installationKind: string | null;
  /** Provider/group/model defaults for new threads of this backend. */
  readonly providerLinkage: ProviderLinkage;
  /**
   * Classification answers the shell used to hard-code per backend:
   * whether this backend IS the built-in mini agent, and which plugin
   * family it belongs to for shared affordances ("" = its own family).
   * A backend not in the registry is never classified as anything.
   */
  readonly classification: { isBuiltInMini: boolean; family: string };
  /**
   * Optional feature contributions — above all `settingsPanels`: a
   * backend's settings live in its own plugin and are rendered by the
   * web-settings shell only while the plugin is installed.
   */
  readonly contributions?: WebFeatureContributions;
}
