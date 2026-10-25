import { themePlugins } from "./theme-config";
import type { ThemeId, ThemePlugin } from "./types";

export * from "./types";
export * from "./theme-config";
export * from "./create-theme";
export * from "./theme-provider";
export * from "./visual-tuning";

export function installedThemePluginDefaults(): ThemeId[] {
  return themePlugins.filter((plugin) => plugin.installedByDefault).map((plugin) => plugin.id);
}

export function isThemeId(value: string | null, customPlugins: ThemePlugin[] = []): value is ThemeId {
  if (!value) {
    return false;
  }
  if (themePlugins.some((plugin) => plugin.id === value)) {
    return true;
  }
  return customPlugins.some((plugin) => plugin.id === value);
}

export function isBuiltinThemeId(value: string | null): value is BuiltinThemeId {
  return Boolean(value && themePlugins.some((plugin) => plugin.id === value));
}

import type { BuiltinThemeId } from "./types";
