import type { ImageGenerationProtocol, PermissionPresetId } from "@codex-ui/shared";
import type { ComposerImageAttachment, ComposerMention } from "../state/codexClient";
import type { SettingsSectionId } from "../settings/SettingsDrawer";
import type { CodexPluginSettingsTab } from "../components/CodexPluginSettingsPanel";
import type { RightWorkspaceTab } from "../components/RightWorkspacePanel";

export type ComposerSlashCommand =
  | { type: "fast"; enabled?: boolean }
  | { type: "stats"; scope: "status" | "stats" }
  | { type: "assistantTurn"; name: "recap"; prompt: string }
  | { type: "image"; mode: "generate" | "edit"; prompt: string; model?: string; protocol?: ImageGenerationProtocol }
  | { type: "plan"; action: "toggle" | "on" | "off" | "send"; prompt: string }
  | { type: "goal"; action: "show" | "set" | "clear" | "pause" | "resume" | "complete" | "edit"; objective: string }
  | { type: "rename"; name: string } | { type: "review"; value: string } | { type: "diff" } | { type: "compact" }
  | { type: "resumeThread"; threadId?: string } | { type: "newConversation"; permission?: PermissionPresetId }
  | { type: "openSettings"; section: SettingsSectionId; pluginTab?: CodexPluginSettingsTab }
  | { type: "openWorkspace"; tab: RightWorkspaceTab }
  | { type: "unsupported"; name: string };

export type ComposerSlashCommandMode = "local" | "turn" | "ui" | "unsupported";
export type ComposerSlashCommandDefinition = { name: string; mode: ComposerSlashCommandMode; aliases?: string[] };

export const COMPOSER_SLASH_COMMANDS: readonly ComposerSlashCommandDefinition[] = [
  { name: "plan", mode: "turn" }, { name: "goal", mode: "local" }, { name: "compact", mode: "turn" },
  { name: "recap", mode: "turn" }, { name: "review", mode: "turn" }, { name: "status", mode: "local" },
  { name: "model", mode: "ui" }, { name: "permissions", mode: "ui" }, { name: "skills", mode: "ui" },
  { name: "mcp", mode: "ui" }, { name: "plugins", mode: "ui" }, { name: "apps", mode: "ui", aliases: ["app"] },
  { name: "hooks", mode: "ui" }, { name: "agents", mode: "ui", aliases: ["subagents"] },
  { name: "new", mode: "local", aliases: ["clear"] }, { name: "resume", mode: "local" },
  { name: "rename", mode: "local" }, { name: "diff", mode: "local" }, { name: "stats", mode: "ui" },
  { name: "side", mode: "ui", aliases: ["btw"] }, { name: "mention", mode: "ui" }, { name: "ps", mode: "ui" },
  { name: "archive", mode: "unsupported" }, { name: "delete", mode: "unsupported" }, { name: "fork", mode: "unsupported" },
  { name: "worktree", mode: "unsupported" }, { name: "export", mode: "unsupported" }, { name: "cd", mode: "unsupported" },
  { name: "pwd", mode: "unsupported" }, { name: "init", mode: "unsupported" }, { name: "copy", mode: "unsupported" },
  { name: "raw", mode: "unsupported" }, { name: "theme", mode: "unsupported" }, { name: "quit", mode: "unsupported" },
];

const WEB_TUI_ONLY_SLASH_COMMANDS = new Set([
  "agent", "app", "approve", "archive", "clean", "copy", "delete", "exit", "feedback", "fork", "ide", "import", "init",
  "keymap", "logout", "personality", "quit", "raw", "rollout", "sandbox-add-read-dir", "setup-default-sandbox", "statusline",
  "stop", "subagents", "test-approval", "theme", "title", "vim"
]);

export function parseComposerSlashCommand(text: string, images: ComposerImageAttachment[], mentions: ComposerMention[]): ComposerSlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  const match = /^\/([a-zA-Z][\w-]*)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return null;
  const name = match[1]?.toLowerCase() ?? "";
  const rest = match[2]?.trim() ?? "";
  const hasImageAttachments = images.some((image) => (image.kind ?? "image") === "image");
  if (mentions.length > 0 && !["image", "edit-image", "image-edit", "img-edit", "plan"].includes(name)) return null;
  const empty = () => images.length === 0 && mentions.length === 0;
  switch (name) {
    case "image": case "img": return { type: "image", mode: hasImageAttachments ? "edit" : "generate", ...parseImageCommandOptions(rest) };
    case "edit-image": case "image-edit": case "img-edit": return { type: "image", mode: "edit", ...parseImageCommandOptions(rest) };
    case "fast": return empty() ? { type: "fast", enabled: parseOptionalBoolean(rest) } : null;
    case "stats": return empty() ? { type: "stats", scope: "stats" } : null;
    case "status": return empty() ? { type: "stats", scope: "status" } : null;
    case "recap": return empty() ? { type: "assistantTurn", name: "recap", prompt: "Give a concise recap of the current conversation, completed work, open items, and next steps." } : null;
    case "plan": {
      const normalized = rest.toLowerCase();
      if (!rest && empty()) return { type: "plan", action: "toggle", prompt: "" };
      if (empty() && (normalized === "on" || normalized === "true")) return { type: "plan", action: "on", prompt: "" };
      if (empty() && (normalized === "off" || normalized === "false")) return { type: "plan", action: "off", prompt: "" };
      return { type: "plan", action: "send", prompt: rest };
    }
    case "goal": {
      if (!empty()) return null;
      const action = ({ clear: "clear", pause: "pause", resume: "resume", complete: "complete", done: "complete", edit: "edit" } as const)[rest.toLowerCase() as "clear"];
      if (!rest) return { type: "goal", action: "show", objective: "" };
      return action ? { type: "goal", action, objective: "" } : { type: "goal", action: "set", objective: rest };
    }
    case "rename": return empty() ? { type: "rename", name: rest } : null;
    case "review": return empty() ? { type: "review", value: rest } : null;
    case "diff": return empty() ? { type: "diff" } : null;
    case "compact": return empty() ? { type: "compact" } : null;
    case "resume": return empty() ? { type: "resumeThread", threadId: rest || undefined } : null;
    case "new": case "clear": return empty() ? { type: "newConversation", permission: parseNewChatPermission(rest) } : null;
    case "usage": return empty() ? { type: "openSettings", section: "usage" } : null;
    case "model": case "permissions": return empty() ? { type: "openSettings", section: "session" } : null;
    case "skills": return empty() ? { type: "openSettings", section: "skills" } : null;
    case "plugins": return empty() ? { type: "openSettings", section: "plugins", pluginTab: "marketplace" } : null;
    case "mcp": case "hooks": case "apps": case "app": return empty() ? { type: "openSettings", section: "plugins", pluginTab: name === "app" ? "apps" : name } : null;
    case "agents": case "subagents": return empty() ? { type: "openSettings", section: "codex" } : null;
    case "pets": case "pet": return empty() ? { type: "openSettings", section: "pet" } : null;
    case "experimental": case "memories": case "debug-config": return empty() ? { type: "openSettings", section: "codex" } : null;
    case "side": case "btw": return empty() ? { type: "openWorkspace", tab: "sidechat" } : null;
    case "mention": return empty() ? { type: "openWorkspace", tab: "explorer" } : null;
    case "ps": return empty() ? { type: "openWorkspace", tab: "terminal" } : null;
    default: return WEB_TUI_ONLY_SLASH_COMMANDS.has(name) && empty() ? { type: "unsupported", name } : null;
  }
}

function parseImageCommandOptions(value: string): { prompt: string; model?: string; protocol?: ImageGenerationProtocol } {
  const tokens = value.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  let index = 0; let model: string | undefined; let protocol: ImageGenerationProtocol | undefined;
  const clean = (token?: string) => token?.replace(/^["']|["']$/g, "");
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (token === "--model" || token === "-m") { model = clean(tokens[index + 1]); if (!model) break; index += 2; continue; }
    if (token.startsWith("--model=")) { model = clean(token.slice(8)); index++; continue; }
    if (token === "--protocol" || token === "-p") { protocol = imageProtocolValue(clean(tokens[index + 1])); if (!protocol) break; index += 2; continue; }
    if (token.startsWith("--protocol=")) { protocol = imageProtocolValue(clean(token.slice(11))); index++; continue; }
    break;
  }
  return { prompt: tokens.slice(index).join(" " ).trim(), model, protocol };
}

function imageProtocolValue(value?: string): ImageGenerationProtocol | undefined {
  return value === "openaiImages" || value === "openaiImageEdits" || value === "geminiChatCompletions" || value === "geminiGenerateContent" || value === "deepkeyAsyncVideos" ? value : undefined;
}
function parseOptionalBoolean(value: string): boolean | undefined { const v = value.trim().toLowerCase(); return ["on", "true", "enable", "enabled"].includes(v) ? true : ["off", "false", "disable", "disabled"].includes(v) ? false : undefined; }
function parseNewChatPermission(value: string): PermissionPresetId | undefined {
  const v = value.trim().toLowerCase();
  return ["read", "readonly", "read-only", "safe"].includes(v) ? "readonlyAsk"
    : ["workspace", "default", "ask"].includes(v) ? "workspaceAsk"
      : ["full", "full-access", "fullask"].includes(v) ? "fullAsk"
        : ["danger", "bypass", "full-auto", "danger-bypass"].includes(v) ? "dangerBypass"
          : undefined;
}
