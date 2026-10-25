import { useCallback, useState } from "react";
import { installedThemePluginDefaults, type ThemeId, type ThemeMode, type ThemePlugin } from "../../theme";
import { readInstalledThemes } from "./preferenceUtils";

export function useThemePluginActions(input: {
  themeMode: ThemeMode;
  customThemePlugins: ThemePlugin[];
  onThemeModeChange: (mode: ThemeMode) => void;
  onCustomThemePluginsChange: (plugins: ThemePlugin[]) => void;
}) {
  const { themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange } = input;
  const [installedThemePluginIds, setInstalledThemePluginIds] = useState<ThemeId[]>(readInstalledThemes);
  const installThemePlugin = useCallback(
    (id: ThemeId) => {
      setInstalledThemePluginIds((current: ThemeId[]) => (current.includes(id) ? current : [...current, id]));
      onThemeModeChange(id);
    },
    [onThemeModeChange]
  );

  const uninstallThemePlugin = useCallback(
    (id: ThemeId) => {
      setInstalledThemePluginIds((current: ThemeId[]) => {
        const next = current.filter((entry: ThemeId) => entry !== id || installedThemePluginDefaults().includes(entry));
        return next.length > 0 ? next : installedThemePluginDefaults();
      });
      if (themeMode === id) {
        onThemeModeChange("official-light");
      }
    },
    [onThemeModeChange, themeMode]
  );

  const saveCustomThemePlugin = useCallback(
    (plugin: ThemePlugin) => {
      onCustomThemePluginsChange(
        customThemePlugins.some((entry: ThemePlugin) => entry.id === plugin.id)
          ? customThemePlugins.map((entry: ThemePlugin) => (entry.id === plugin.id ? plugin : entry))
          : [...customThemePlugins, plugin]
      );
      setInstalledThemePluginIds((current: ThemeId[]) => (current.includes(plugin.id) ? current : [...current, plugin.id]));
      onThemeModeChange(plugin.id);
    },
    [customThemePlugins, onCustomThemePluginsChange, onThemeModeChange]
  );

  const removeCustomThemePlugin = useCallback(
    (id: ThemeId) => {
      onCustomThemePluginsChange(customThemePlugins.filter((entry: ThemePlugin) => entry.id !== id));
      setInstalledThemePluginIds((current: ThemeId[]) => {
        const next = current.filter((entry: ThemeId) => entry !== id || installedThemePluginDefaults().includes(entry));
        return next.length > 0 ? next : installedThemePluginDefaults();
      });
      if (themeMode === id) {
        onThemeModeChange("official-light");
      }
    },
    [customThemePlugins, onCustomThemePluginsChange, onThemeModeChange, themeMode]
  );
  return {
    installedThemePluginIds,
    setInstalledThemePluginIds,
    installThemePlugin,
    uninstallThemePlugin,
    saveCustomThemePlugin,
    removeCustomThemePlugin,
  };
}
