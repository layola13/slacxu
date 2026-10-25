import { useCallback, useEffect, useState, type Dispatch } from "react";
import type { BeforeInstallPromptEvent } from "./appConstants";
import type { SettingsSectionId } from "../../settings/SettingsDrawer";
import type { CodexPluginSettingsTab } from "../../components/CodexPluginSettingsPanel";
import { clearSetupGuideCompleted, markSetupGuideCompleted } from "../../setup-guide/setupGuideState";
import { isElectronDesktopShell } from "./appUtils";
import { cleanupDesktopServiceWorkers, setupPwaServiceWorker } from "../pwa/serviceWorkerLifecycle";

export function useSettingsAndInstall(input: { codexCliEnabled: boolean }) {
  const { codexCliEnabled } = input;
  const [setupGuideOpen, setSetupGuideOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("assistant");
  const [settingsPluginTab, setSettingsPluginTab] = useState<CodexPluginSettingsTab>("marketplace");
  const [settingsRelayTarget, setSettingsRelayTarget] = useState<{ providerId?: string; groupId?: string } | null>(null);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [appInstalled, setAppInstalled] = useState(false);

  useEffect(() => {
    const desktopShell = isElectronDesktopShell();
    let serviceWorkerEffectDisposed = false;
    let releaseServiceWorkerListener: (() => void) | undefined;
    if ("serviceWorker" in navigator) {
      const serviceWorkerTask = desktopShell
        ? cleanupDesktopServiceWorkers({ navigator, document, storage: window.sessionStorage, reload: () => window.location.reload() })
        : setupPwaServiceWorker({ navigator, document, reload: () => window.location.reload() })
          .then((release: () => void) => {
            if (serviceWorkerEffectDisposed) release();
            else releaseServiceWorkerListener = release;
          });
      void serviceWorkerTask.catch((error: unknown) => {
        console.warn(desktopShell ? "[desktop] service worker cleanup failed" : "[pwa] cache refresh failed", error);
      });
    }
    if (desktopShell) return () => {
      serviceWorkerEffectDisposed = true;
      releaseServiceWorkerListener?.();
    };
    const win = window as unknown as { __deferredPwaInstallPrompt?: BeforeInstallPromptEvent | null };
    if (win.__deferredPwaInstallPrompt) {
      setInstallPromptEvent(win.__deferredPwaInstallPrompt);
    }
    const onBeforeInstallPrompt = (event: Event) => {
      win.__deferredPwaInstallPrompt = event as BeforeInstallPromptEvent;
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setAppInstalled(true);
      setInstallPromptEvent(null);
      win.__deferredPwaInstallPrompt = null;
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      serviceWorkerEffectDisposed = true;
      releaseServiceWorkerListener?.();
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const openSettings = useCallback((section: SettingsSectionId = "codex", pluginTab: CodexPluginSettingsTab = "marketplace", relayTarget?: { providerId?: string; groupId?: string }) => {
    const targetSection = section === "codex" && !codexCliEnabled ? "assistant" : section;
    setSettingsSection(targetSection);
    if (targetSection === "plugins") {
      setSettingsPluginTab(pluginTab);
    }
    setSettingsRelayTarget(targetSection === "relay" ? relayTarget ?? null : null);
    setSettingsOpen(true);
  }, [codexCliEnabled]);

  const handleOpenCommandBlacklistSettings = useCallback((providerId?: string, groupId?: string) => {
    openSettings("relay", "marketplace", { providerId, groupId });
  }, [openSettings]);

  const finishSetupGuide = useCallback(() => {
    markSetupGuideCompleted();
    setSetupGuideOpen(false);
  }, []);

  const replaySetupGuide = useCallback(() => {
    clearSetupGuideCompleted();
    setSetupGuideOpen(true);
  }, []);

  const handleInstallApp = useCallback(async () => {
    if (!installPromptEvent) {
      return;
    }
    await installPromptEvent.prompt();
    const choice = await installPromptEvent.userChoice;
    if (choice.outcome === "accepted") {
      setAppInstalled(true);
      setInstallPromptEvent(null);
    }
  }, [installPromptEvent]);
  return {
    setupGuideOpen,
    setSetupGuideOpen,
    settingsOpen,
    setSettingsOpen,
    settingsSection,
    setSettingsSection,
    settingsPluginTab,
    setSettingsPluginTab,
    settingsRelayTarget,
    setSettingsRelayTarget,
    installPromptEvent,
    setInstallPromptEvent,
    appInstalled,
    setAppInstalled,
    openSettings,
    handleOpenCommandBlacklistSettings,
    finishSetupGuide,
    replaySetupGuide,
    handleInstallApp,
  };
}
