export {};

declare global {
  interface Window {
    codexUltraDesktop?: {
      cliPrerequisitesRequired?: boolean;
      claimContextMenu(): void;
      getPathForFile?(file: File): string | undefined;
      notify(payload: { title: string; body: string; tag?: string }): Promise<boolean>;
      openExternal(url: string): Promise<boolean>;
      checkCliPrerequisites?(): Promise<{
        installDirectory: string;
        codex: { available: boolean; path?: string; version?: string };
        claude: { available: boolean; path?: string; version?: string };
        agy?: { available: boolean; path?: string; version?: string };
        grok?: { available: boolean; path?: string; version?: string };
      } | null>;
      installCodexCli(): Promise<{ ok: boolean; error?: string }>;
      installClaudeCli(): Promise<{ ok: boolean; error?: string }>;
      installAgyCli(): Promise<{ ok: boolean; error?: string }>;
      restartApp(): Promise<boolean>;
      openWebPreview(url: string): Promise<boolean>;
      pickDirectory(defaultPath?: string): Promise<string | null>;
      openTerminal(payload: { cwd?: string; sshCommand?: string; sshCwd?: string; shell?: string }): Promise<boolean>;
      openVscode(payload: { cwd?: string; sshCommand?: string; sshCwd?: string }): Promise<boolean>;
      listOpenWithApps(): Promise<Array<{ id: string; label: string }>>;
      openWith(payload: { appId: string; cwd?: string; sshCommand?: string; sshCwd?: string }): Promise<boolean>;
      closeWebPreview(): Promise<boolean>;
      detachTask(payload: { threadId: string; title: string; snapshot?: unknown }): Promise<boolean>;
      takeDetachedTaskSnapshot(threadId: string): Promise<unknown | null>;
      attachTask(threadId: string): Promise<boolean>;
      listDetachedTasks(): Promise<string[]>;
      gpuFeatureStatus(): Promise<{
        features: Record<string, string>;
        devices: Array<{ active: boolean; vendorId: number; deviceId: number; driverVendor: string; driverVersion: string }>;
      } | null>;
      promptGpuRecovery(): Promise<"ignored" | "later" | "restarting" | "error">;
      onDetachedTasksChanged(listener: (threadIds: string[]) => void): () => void;
      onTaskAttached(listener: (threadId: string) => void): () => void;
    };
  }
}
