import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider, isThemeId, type ThemeMode, type ThemePlugin } from "./theme";
import { migrateLegacyBrowserStorage } from "./storageNamespace";
import { installGlobalErrorDiagnostics, showMountFailure, StartupErrorBoundary } from "./StartupErrorBoundary";

installGlobalErrorDiagnostics();

const THEME_STORAGE_KEY = "codex-ultra.theme-mode";
const CUSTOM_THEMES_KEY = "codex-ultra.custom-theme-plugins";

function readCustomThemePlugins(): ThemePlugin[] {
  const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is ThemePlugin => {
      if (!entry || typeof entry !== "object") {
        return false;
      }
      return (
        typeof entry.id === "string" &&
        typeof entry.name === "string" &&
        typeof entry.description === "string" &&
        entry.source === "user-defined" &&
        entry.preview &&
        typeof entry.preview.primary === "string" &&
        typeof entry.preview.secondary === "string" &&
        typeof entry.preview.background === "string"
      );
    });
  } catch {
    return [];
  }
}

function Root() {
  const [customThemePlugins, setCustomThemePlugins] = useState<ThemePlugin[]>(readCustomThemePlugins);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    const customs = readCustomThemePlugins();
    if (stored === "system") return "system";
    if (stored === "black") return "official-black";
    if (stored === "light") return "official-light";
    return isThemeId(stored, customs) ? stored : "official-light";
  });

  useEffect(() => {
    document.documentElement.dataset.colorScheme = themeMode;
  }, [themeMode]);

  return (
    <ThemeProvider themeMode={themeMode} customThemePlugins={customThemePlugins}>
      <App
        themeMode={themeMode}
        customThemePlugins={customThemePlugins}
        onThemeModeChange={setThemeMode}
        onCustomThemePluginsChange={setCustomThemePlugins}
      />
    </ThemeProvider>
  );
}

try {
  migrateLegacyBrowserStorage();
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error('Mount node "#root" was not found');
  createRoot(rootElement).render(
    <React.StrictMode>
      <StartupErrorBoundary>
        <Root />
      </StartupErrorBoundary>
    </React.StrictMode>
  );
} catch (error) {
  showMountFailure(error);
}
