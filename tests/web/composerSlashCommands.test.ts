import { expect, test } from "bun:test";
import { COMPOSER_SLASH_COMMANDS, parseComposerSlashCommand } from "../../apps/web/src/composer/composerSlashCommands.ts";

test("slash command parsing preserves image, goal and workspace routing", () => {
  expect(parseComposerSlashCommand('/image --model "nano banana" --protocol geminiGenerateContent draw glass', [], [])).toEqual({
    type: "image", mode: "generate", model: "nano banana", protocol: "geminiGenerateContent", prompt: "draw glass"
  });
  expect(parseComposerSlashCommand("/goal pause", [], [])).toEqual({ type: "goal", action: "pause", objective: "" });
  expect(parseComposerSlashCommand("/ps", [], [])).toEqual({ type: "openWorkspace", tab: "terminal" });
});

test("slash command parsing leaves unknown extensions and incompatible attachments untouched", () => {
  expect(parseComposerSlashCommand("/my-extension run", [], [])).toBeNull();
  expect(parseComposerSlashCommand("/stats", [{ id: "1", name: "a.png", url: "data:image/png;base64,YQ==", size: 1, mediaType: "image/png" }], [])).toBeNull();
});

test("slash command parsing keeps compact available and hides Project group chat", () => {
  expect(parseComposerSlashCommand("/compact", [], [])).toEqual({ type: "compact" });
  expect(parseComposerSlashCommand("/group-chat", [], [])).toBeNull();
  expect(parseComposerSlashCommand("/group-chat new", [], [])).toBeNull();
});

test("unknown TUI-only slash commands classify as unsupported so Claude can forward them", () => {
  expect(parseComposerSlashCommand("/title", [], [])).toEqual({ type: "unsupported", name: "title" });
  expect(parseComposerSlashCommand("/vim", [], [])).toEqual({ type: "unsupported", name: "vim" });
});

test("Codex parity registry routes recap and app aliases", () => {
  expect(parseComposerSlashCommand("/recap", [], [])).toEqual(expect.objectContaining({ type: "assistantTurn", name: "recap" }));
  expect(parseComposerSlashCommand("/app", [], [])).toEqual({ type: "openSettings", section: "plugins", pluginTab: "apps" });
  expect(parseComposerSlashCommand("/agents", [], [])).toEqual({ type: "openSettings", section: "codex" });
  expect(COMPOSER_SLASH_COMMANDS.find((entry) => entry.name === "recap")?.mode).toBe("turn");
  expect(COMPOSER_SLASH_COMMANDS.find((entry) => entry.name === "worktree")?.mode).toBe("unsupported");
});
