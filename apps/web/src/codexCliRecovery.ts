import type { DesktopRuntimeInfo, EngineStatus } from "@codex-ui/shared";

export const WINDOWS_CODEX_INSTALL_COMMAND = 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"';

export function codexCliRecoveryNotice(
  engine: EngineStatus | null | undefined,
  desktopRuntime: DesktopRuntimeInfo | null | undefined,
  activeBackend?: string | null | undefined
): { required: boolean; command: string; reason: "missing" | "startup" | null } {
  const command = desktopRuntime?.codexInstallCommand?.trim()
    || (desktopRuntime?.platform === "win32" ? WINDOWS_CODEX_INSTALL_COMMAND : "");
  if (activeBackend === "mini") {
    return { required: false, command, reason: null };
  }
  if (desktopRuntime?.codexAvailable === false) {
    if (engine?.phase === "ready") {
      return { required: false, command, reason: null };
    }
    return { required: true, command, reason: "missing" };
  }
  const message = engine?.message?.toLowerCase() ?? "";
  const startupFailure = (engine?.phase === "error" || engine?.phase === "incompatible") &&
    (!message || /(codex|app-server|app server|executable|enoent|not found|not installed|unsupported|incompatible|version|spawn)/i.test(message));
  return { required: startupFailure, command, reason: startupFailure ? "startup" : null };
}
