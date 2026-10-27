import { describe, expect, test } from "bun:test";
import { createCodexTheme, installedThemePluginDefaults, isBuiltinThemeId, isThemeId } from "../../apps/web/src/theme";
import { themePalette } from "../../apps/web/src/theme/core/palette";

describe("Codex theme", () => {
  test("is installed as a built-in theme", () => {
    expect(isThemeId("codex")).toBe(true);
    expect(isBuiltinThemeId("codex")).toBe(true);
    expect(installedThemePluginDefaults()).toContain("codex");
  });

  test("uses a black-and-white palette with restrained blue accents", () => {
    const palette = themePalette("codex");
    expect(palette.dark).toBe(false);
    expect(palette.primary).toBe("#339CFF");
    expect(palette.defaultBg).toBe("#FFFFFF");
    expect(palette.paper).toBe("#FFFFFF");
    expect(palette.panel).toBe("#F1F5F9");
    expect(palette.textPrimary).toBe("#1A1C1F");

    const theme = createCodexTheme("codex");
    expect(theme.palette.primary.main).toBe("#339CFF");
    expect(theme.palette.background.default).toBe("#FFFFFF");
  });
});

describe("Claude Warm theme", () => {
  test("is installed as a built-in theme", () => {
    expect(isThemeId("claude-warm")).toBe(true);
    expect(isBuiltinThemeId("claude-warm")).toBe(true);
    expect(installedThemePluginDefaults()).toContain("claude-warm");
  });

  test("uses the warm ivory and earthen palette", () => {
    const palette = themePalette("claude-warm");
    expect(palette.dark).toBe(false);
    expect(palette.primary).toBe("#C15F3C");
    expect(palette.defaultBg).toBe("#F7F6F2");
    expect(palette.textPrimary).toBe("#2F2925");

    const theme = createCodexTheme("claude-warm");
    expect(theme.palette.primary.main).toBe("#C15F3C");
    expect(theme.palette.background.default).toBe("#F7F6F2");
  });
});

describe("Cursor Minimal theme", () => {
  test("is installed as a built-in theme", () => {
    expect(isThemeId("cursor-minimal")).toBe(true);
    expect(isBuiltinThemeId("cursor-minimal")).toBe(true);
    expect(installedThemePluginDefaults()).toContain("cursor-minimal");
  });

  test("uses warm paper surfaces and low-cost minimal effects", () => {
    const palette = themePalette("cursor-minimal");
    expect(palette.primary).toBe("#C58A2A");
    expect(palette.defaultBg).toBe("#F3F2EE");
    expect(palette.textPrimary).toBe("#1E1D1A");
    const theme = createCodexTheme("cursor-minimal");
    expect(theme.palette.success.main).toBe("#16956B");
    expect(theme.palette.error.main).toBe("#C6534C");
    expect(theme.shadows[8]).toBe("0 1px 2px rgba(30, 29, 26, 0.04)");
  });
});

describe("Dollar Green theme", () => {
  test("is installed as a built-in theme", () => {
    expect(isThemeId("dollar-green")).toBe(true);
    expect(isBuiltinThemeId("dollar-green")).toBe(true);
    expect(installedThemePluginDefaults()).toContain("dollar-green");
  });

  test("uses the sage-green canvas and deep dollar-green palette", () => {
    const palette = themePalette("dollar-green");
    expect(palette.dark).toBe(false);
    expect(palette.primary).toBe("#35704A");
    expect(palette.defaultBg).toBe("#E9EEE5");
    expect(palette.paper).toBe("#FAFBF6");
    expect(palette.textPrimary).toBe("#22301F");

    const theme = createCodexTheme("dollar-green");
    expect(theme.palette.primary.main).toBe("#35704A");
    expect(theme.palette.background.default).toBe("#E9EEE5");
  });
});

describe("Setup themes", () => {
  test("registers the independently implemented quick-switch themes", () => {
    expect(isBuiltinThemeId("violet-night")).toBe(true);
    expect(isBuiltinThemeId("midnight-cyan")).toBe(true);
    expect(isBuiltinThemeId("neon-terminal")).toBe(true);
    expect(isBuiltinThemeId("clean-dawn")).toBe(true);
    expect(installedThemePluginDefaults()).toEqual(expect.arrayContaining(["violet-night", "midnight-cyan", "neon-terminal", "clean-dawn"]));
  });

  test("uses the expected dark and light palettes", () => {
    expect(themePalette("violet-night")).toMatchObject({ dark: true, primary: "#8B5CF6", defaultBg: "#121215" });
    expect(themePalette("midnight-cyan")).toMatchObject({ dark: true, primary: "#38BDF8", defaultBg: "#161B22" });
    expect(themePalette("neon-terminal")).toMatchObject({ dark: true, primary: "#FF0080", defaultBg: "#030305" });
    expect(themePalette("clean-dawn")).toMatchObject({ dark: false, primary: "#2563EB", defaultBg: "#FFFFFF" });
  });
});
