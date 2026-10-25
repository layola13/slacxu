/**
 * Feature & framework plugins (kinds "feature" / "framework"): web
 * functionality that is not an agent backend — the main framework shell,
 * the chat waterfall, the composer, settings panels (e.g. the web side
 * of relay-station configuration), …
 *
 * A feature plugin contributes routes, settings panels and named slot
 * renderers. Renderers are host-agnostic factories: the SDK does not
 * depend on any UI framework; the host passes its rendering context and
 * receives back whatever its framework mounts.
 */
import type { PluginManifest } from "./index.js";

/** Opaque rendering context supplied by the web host (framework-specific). */
export type WebRenderContext = Readonly<Record<string, unknown>>;

/** A slot renderer factory: called by the shell, returns a mountable node. */
export type SlotRenderer = (ctx: WebRenderContext) => unknown;

export interface SlotContribution {
  /** Region declared by the shell plugin, e.g. "waterfall", "composer". */
  slot: string;
  render: SlotRenderer;
  /** Ordering within the slot; lower renders first. Default 0. */
  order?: number;
}

export interface RouteContribution {
  path: string;
  render: SlotRenderer;
}

export interface PanelContribution {
  /** Panel id, unique within the settings surface. */
  id: string;
  titleKey: string;
  render: SlotRenderer;
}

export interface WebFeatureContributions {
  slots?: SlotContribution[];
  routes?: RouteContribution[];
  settingsPanels?: PanelContribution[];
}

export interface WebFeaturePlugin {
  readonly manifest: PluginManifest;
  readonly contributions: WebFeatureContributions;
}

/**
 * The main framework (kind "framework", id "web-shell"). Owns the layout
 * and declares the slot regions every other web plugin renders into.
 */
export interface WebShellPlugin extends WebFeaturePlugin {
  /** Slot region names this shell provides, e.g. "sidebar", "waterfall". */
  readonly regions: readonly string[];
  /** Mount the shell itself; region contents arrive via contributions. */
  renderShell(ctx: WebRenderContext): unknown;
}
