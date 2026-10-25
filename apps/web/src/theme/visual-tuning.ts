import type { ThemePlugin } from "./types";

export type ThemeVisualTuning = {
  backgroundLayerOpacity: number;
  backgroundOverlayOpacity: number;
  effectsLayerOpacity: number;
  workspaceSurfaceOpacity: number;
  heroOverlayOpacity: number;
  panelSurfaceOpacity: number;
  blurStrength: number;
  toneColor: string;
  toneOpacity: number;
};

export const REFERENCE_BACKGROUND_TUNING: ThemeVisualTuning = {
  backgroundLayerOpacity: 1,
  backgroundOverlayOpacity: 0,
  effectsLayerOpacity: 0,
  workspaceSurfaceOpacity: 0.16,
  heroOverlayOpacity: 0.22,
  panelSurfaceOpacity: 0.78,
  blurStrength: 10,
  toneColor: "#D94F75",
  toneOpacity: 0
};

const STANDARD_SURFACE_TUNING: ThemeVisualTuning = {
  backgroundLayerOpacity: 1,
  backgroundOverlayOpacity: 0.45,
  effectsLayerOpacity: 0,
  workspaceSurfaceOpacity: 0.72,
  heroOverlayOpacity: 0.64,
  panelSurfaceOpacity: 0.82,
  blurStrength: 22,
  toneColor: "#1877F2",
  toneOpacity: 0.08
};

export function themeVisualTuning(plugin?: ThemePlugin | null): ThemeVisualTuning {
  const hasUserMedia = Boolean(
    plugin?.assets?.appBackgroundImage ||
      plugin?.assets?.appBackgroundVideo ||
      plugin?.assets?.composerBackgroundImage ||
      plugin?.assets?.welcomeBackgroundImage ||
      plugin?.assets?.historyBackgroundImage ||
      plugin?.assets?.heroImage
  );
  const defaults = hasUserMedia ? REFERENCE_BACKGROUND_TUNING : STANDARD_SURFACE_TUNING;
  const layout = plugin?.layout ?? {};
  const previewTone = plugin?.preview && isHexColor(plugin.preview.primary) ? plugin.preview.primary : defaults.toneColor;
  return {
    backgroundLayerOpacity: clampUnit(layout.backgroundLayerOpacity, defaults.backgroundLayerOpacity),
    backgroundOverlayOpacity: clampUnit(layout.backgroundOverlayOpacity, defaults.backgroundOverlayOpacity),
    effectsLayerOpacity: clampUnit(layout.effectsLayerOpacity, defaults.effectsLayerOpacity),
    workspaceSurfaceOpacity: clampUnit(layout.workspaceSurfaceOpacity, defaults.workspaceSurfaceOpacity),
    heroOverlayOpacity: clampUnit(layout.heroOverlayOpacity, defaults.heroOverlayOpacity),
    panelSurfaceOpacity: clampUnit(layout.panelSurfaceOpacity, defaults.panelSurfaceOpacity),
    blurStrength: clampRange(layout.blurStrength, defaults.blurStrength, 0, 40),
    toneColor: isHexColor(layout.toneColor) ? layout.toneColor : previewTone,
    toneOpacity: clampUnit(layout.toneOpacity, defaults.toneOpacity)
  };
}

export function percentToUnit(value: number): number {
  return clampRange(value, 0, 0, 100) / 100;
}

export function unitToPercent(value: number): number {
  return Math.round(clampRange(value, 0, 0, 1) * 100);
}

export function clampThemePercent(value: number, fallback: number): number {
  return Math.round(clampRange(value, fallback, 0, 100));
}

export function clampThemeBlur(value: number, fallback = REFERENCE_BACKGROUND_TUNING.blurStrength): number {
  return Math.round(clampRange(value, fallback, 0, 40));
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

function clampUnit(value: unknown, fallback: number): number {
  return clampRange(value, fallback, 0, 1);
}

function clampRange(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numberValue));
}
