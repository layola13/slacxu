import type { CliBackend } from "@codex-ui/shared";
import type { TranslateFn } from "../../i18n";
import { backendWebPlugin } from "./pluginCatalog";

/**
 * Localized display name for a thread's CLI backend, resolved from the
 * backend's own web plugin (Phase 5): the plugin declares its name key
 * (`descriptor.labelKeys.name`) and plain label in its project; the
 * host no longer keeps a per-backend name table. An id with no plugin
 * renders as the raw id — never as another backend's name.
 */
export function describeCliBackendName(
  backend: CliBackend | string | null | undefined,
  t: TranslateFn,
): string {
  if (!backend) return "";
  const plugin = backendWebPlugin(backend);
  if (!plugin) return String(backend);
  const key = plugin.descriptor.labelKeys?.name;
  const localized = key ? t(key) : "";
  return localized && localized !== key ? localized : plugin.descriptor.label;
}

/** Full `CLI: <name>` tooltip label used by CliBackendIcon instances. */
export function describeCliBackendLabel(
  backend: CliBackend | string | null | undefined,
  t: TranslateFn,
): string {
  return `${t("newChat.cliBackend")}: ${describeCliBackendName(backend, t)}`;
}

export interface CliSwitcherTooltipInput {
  backend: CliBackend | string | null | undefined;
  versionLabel?: string | null;
  codexCliUpdateStatus?: {
    updateAvailable?: boolean;
    latestVersion?: string | null;
    currentVersion?: string | null;
  } | null;
  engineVersion?: string | null;
  engineMessage?: string | null;
  t: TranslateFn;
}

/** Resolves the topbar CLI switcher tooltip text across backends, version tags, and update status. */
export function describeCliSwitcherTooltip(input: CliSwitcherTooltipInput): string {
  const { backend, versionLabel, codexCliUpdateStatus, engineVersion, engineMessage, t } = input;
  if (backend === "claude") {
    return versionLabel ? t("app.cliSwitcherClaudeWithVersion", { version: versionLabel }) : "Claude CLI";
  }
  if (backend === "agy") {
    return versionLabel
      ? t("app.cliSwitcherAgyWithVersion", { version: versionLabel }) || `Antigravity CLI ${versionLabel}`
      : "Antigravity CLI";
  }
  if (backend === "grok") {
    return versionLabel
      ? t("app.cliSwitcherGrokWithVersion", { version: versionLabel }) || `Grok CLI ${versionLabel}`
      : "Grok CLI";
  }
  if (backend === "pi") {
    return versionLabel
      ? t("app.cliSwitcherPiWithVersion", { version: versionLabel }) || `Pi Agent ${versionLabel}`
      : "Pi Agent";
  }
  if (backend === "opencode") {
    return versionLabel
      ? t("app.cliSwitcherOpencodeWithVersion", { version: versionLabel }) || `OpenCode CLI ${versionLabel}`
      : "OpenCode CLI";
  }
  if (backend === "opencode-v2") {
    return versionLabel
      ? t("app.cliSwitcherOpencodeV2WithVersion", { version: versionLabel }) || `OpenCode v2 CLI ${versionLabel}`
      : "OpenCode v2 CLI";
  }
  if (backend === "codex") {
    if (codexCliUpdateStatus?.updateAvailable) {
      return t("app.codexCliUpdateAvailable", {
        latest: codexCliUpdateStatus.latestVersion ?? "",
        current: codexCliUpdateStatus.currentVersion ?? ""
      });
    }
    return engineVersion ?? engineMessage ?? t("app.initializing");
  }
  return versionLabel
    ? t("app.cliSwitcherMiniWithVersion", { version: versionLabel }) || `Mini ${versionLabel}`
    : "Mini";
}
