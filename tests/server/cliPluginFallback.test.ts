import { describe, expect, test } from "bun:test";

describe("CLI plugin fallback logic", () => {
  function computeEffectiveMiniRequested(options: {
    miniBackendRequested: boolean;
    codexCompatibleCliEnabled: boolean;
    paramCliBackend?: string;
  }): boolean {
    const { miniBackendRequested, codexCompatibleCliEnabled, paramCliBackend } = options;
    return miniBackendRequested || (!codexCompatibleCliEnabled && paramCliBackend === "codex");
  }

  function shouldThrowCodexFallbackHijack(options: {
    effectiveMiniRequested: boolean;
    opencodeBackendRequested?: boolean;
    piBackendRequested?: boolean;
    agyBackendRequested?: boolean;
    grokBackendRequested?: boolean;
    claudeBridge?: boolean;
    paramCliBackend?: string;
    actualBackend: string;
  }): boolean {
    const {
      effectiveMiniRequested,
      opencodeBackendRequested = false,
      piBackendRequested = false,
      agyBackendRequested = false,
      grokBackendRequested = false,
      claudeBridge = false,
      paramCliBackend,
      actualBackend
    } = options;

    if (
      !effectiveMiniRequested &&
      !opencodeBackendRequested &&
      !piBackendRequested &&
      !agyBackendRequested &&
      !grokBackendRequested &&
      !claudeBridge &&
      paramCliBackend === "codex"
    ) {
      if (actualBackend === "mini") {
        return true;
      }
    }
    return false;
  }

  test("when Codex CLI is disabled, paramCliBackend='codex' routes to Mini and does NOT throw", () => {
    const effectiveMini = computeEffectiveMiniRequested({
      miniBackendRequested: false,
      codexCompatibleCliEnabled: false,
      paramCliBackend: "codex"
    });
    expect(effectiveMini).toBe(true);

    const wouldThrow = shouldThrowCodexFallbackHijack({
      effectiveMiniRequested: effectiveMini,
      paramCliBackend: "codex",
      actualBackend: "mini"
    });
    expect(wouldThrow).toBe(false);
  });

  test("when Codex CLI is enabled, unexpected Mini fallback throws fast", () => {
    const effectiveMini = computeEffectiveMiniRequested({
      miniBackendRequested: false,
      codexCompatibleCliEnabled: true,
      paramCliBackend: "codex"
    });
    expect(effectiveMini).toBe(false);

    const wouldThrow = shouldThrowCodexFallbackHijack({
      effectiveMiniRequested: effectiveMini,
      paramCliBackend: "codex",
      actualBackend: "mini"
    });
    expect(wouldThrow).toBe(true);
  });

  test("when Mini is explicitly requested, it does not throw", () => {
    const effectiveMini = computeEffectiveMiniRequested({
      miniBackendRequested: true,
      codexCompatibleCliEnabled: true,
      paramCliBackend: "mini"
    });
    expect(effectiveMini).toBe(true);

    const wouldThrow = shouldThrowCodexFallbackHijack({
      effectiveMiniRequested: effectiveMini,
      paramCliBackend: "mini",
      actualBackend: "mini"
    });
    expect(wouldThrow).toBe(false);
  });
});

describe("SettingsDrawer CLI plugin disabled state logic", () => {
  function isCliSettingsDisabled(currentUser: { role: string } | null): boolean {
    return currentUser != null && currentUser.role !== "admin";
  }

  test("local token / single-user mode (currentUser === null) is NOT disabled", () => {
    expect(isCliSettingsDisabled(null)).toBe(false);
  });

  test("admin user (currentUser.role === 'admin') is NOT disabled", () => {
    expect(isCliSettingsDisabled({ role: "admin" })).toBe(false);
  });

  test("regular user (currentUser.role === 'member') is disabled", () => {
    expect(isCliSettingsDisabled({ role: "member" })).toBe(true);
  });
});
