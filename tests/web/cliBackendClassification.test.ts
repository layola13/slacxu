/**
 * Classification conformance (no-fallback rule): every backend in
 * the web plugin catalog must classify as ITSELF in the thread
 * normalizers. A backend added to the catalog but not to
 * cliBackendKind would otherwise be silently reclassified as Mini.
 */
import { expect, test } from "bun:test";
import { BACKEND_WEB_PLUGINS } from "../../apps/web/src/app/cli/pluginCatalog";
import { normalizeCliBackendFilter, normalizeThreadCliBackend } from "../../apps/web/src/app/cli/cliBackendKind";

const catalogIds = BACKEND_WEB_PLUGINS.map((plugin) => plugin.manifest.id);

test("every catalog backend normalizes to itself", () => {
  expect(catalogIds.length).toBeGreaterThanOrEqual(12);
  for (const id of catalogIds) {
    expect(normalizeThreadCliBackend(id)).toBe(id);
    expect(normalizeCliBackendFilter(id)).toBe(id);
  }
});

test("absent stamps read as the built-in default; unknown filters stay unassigned", () => {
  expect(normalizeThreadCliBackend(undefined)).toBe("mini");
  expect(normalizeThreadCliBackend(null)).toBe("mini");
  expect(normalizeThreadCliBackend("")).toBe("mini");
  expect(normalizeCliBackendFilter("no-such-backend")).toBeUndefined();
});

/**
 * Picker-wiring conformance: every catalog backend must be selectable
 * in the new-conversation pickers. The picker chain gates each backend
 * behind an explicit enabled flag threaded through the workbench; a
 * backend registered in the catalog but not threaded through shows up
 * in Settings yet can never be chosen for a new conversation (this is
 * how auggie/cline/command-code were stranded at Phase 8). Source scan
 * in the repo's source-corpus test idiom.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pickerPropByBackend: Record<string, string> = {
  codex: "codexEnabled",
  claude: "claudeEnabled",
  agy: "agyEnabled",
  auggie: "auggieEnabled",
  cline: "clineEnabled",
  "command-code": "commandCodeEnabled",
  grok: "grokEnabled",
  muse: "museEnabled",
  pi: "piEnabled",
  opencode: "opencodeEnabled",
  "opencode-v2": "opencodeV2Enabled",
};

function readWebSource(rel: string): string {
  return readFileSync(join(import.meta.dir, "../../apps/web/src", rel), "utf8");
}

test("every catalog backend is wired through the new-conversation pickers", () => {
  const picker = readWebSource("components/CliBackendPicker.tsx");
  const newChatDialog = readWebSource("components/dialogs/NewChatSetupDialog.tsx");
  const centerPanel = readWebSource("shell/CenterPanelView.tsx");
  const dangerDialog = readWebSource("components/dialogs/DangerNewChatDialog.tsx");
  for (const id of catalogIds) {
    if (id === "mini") continue; // built-in, always offered
    const prop = pickerPropByBackend[id];
    expect(prop, `no picker prop mapping recorded for ${id}`).toBeTruthy();
    expect(picker).toContain(`${prop} ?`);
    expect(newChatDialog).toContain(`${prop}={`);
    expect(centerPanel).toContain(`${prop}={`);
    expect(dangerDialog).toContain(`value="${id}"`);
  }
});
