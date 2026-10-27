import { expect, test } from "bun:test";
import { codexCliRecoveryNotice, WINDOWS_CODEX_INSTALL_COMMAND } from "../../apps/web/src/codexCliRecovery";

test("does not block when engine is ready even if Codex is missing (mini fallback)", () => {
  const result = codexCliRecoveryNotice(
    { phase: "ready" },
    { platform: "win32", codexAvailable: false, codexInstallCommand: "" }
  );
  expect(result).toEqual({ required: false, command: WINDOWS_CODEX_INSTALL_COMMAND, reason: null });
});

test("shows the install command when Codex is missing and engine is not ready", () => {
  const result = codexCliRecoveryNotice(
    { phase: "error", message: "spawn codex ENOENT" },
    { platform: "win32", codexAvailable: false, codexInstallCommand: "" }
  );
  expect(result).toEqual({ required: true, command: WINDOWS_CODEX_INSTALL_COMMAND, reason: "missing" });
});

test("never blocks the mini backend on a missing Codex CLI", () => {
  const result = codexCliRecoveryNotice(
    { phase: "error", message: "spawn codex ENOENT" },
    { platform: "win32", codexAvailable: false, codexInstallCommand: "" },
    "mini"
  );
  expect(result).toEqual({ required: false, command: WINDOWS_CODEX_INSTALL_COMMAND, reason: null });
});

test("shows recovery guidance when app-server startup is incompatible", () => {
  const result = codexCliRecoveryNotice(
    { phase: "incompatible", message: "Codex app-server version is unsupported" },
    { platform: "win32", codexAvailable: true, codexInstallCommand: WINDOWS_CODEX_INSTALL_COMMAND }
  );
  expect(result.required).toBe(true);
  expect(result.reason).toBe("startup");
});

test("does not treat relay failures as a CLI installation problem", () => {
  const result = codexCliRecoveryNotice(
    { phase: "error", message: "Relay returned HTTP 503" },
    { platform: "win32", codexAvailable: true, codexInstallCommand: WINDOWS_CODEX_INSTALL_COMMAND }
  );
  expect(result).toEqual({ required: false, command: WINDOWS_CODEX_INSTALL_COMMAND, reason: null });
});
