import { alpha, createTheme } from "@mui/material/styles";
import type {} from "../../../../sdk-frontend/src/extend-theme-types";
import { themePalette } from "./core/palette";
import { typography } from "./core/typography";
import { components } from "./core/components";
import { shadows } from "./core/shadows";
import { customShadows } from "./core/custom-shadows";
import type { ThemeMode, ThemePlugin } from "./types";

export function createCodexTheme(mode: ThemeMode, customPlugins: ThemePlugin[] = []) {
  const palette = themePalette(mode, customPlugins);
  const divider = alpha(palette.dividerBase, palette.dark ? 0.14 : 0.24);

  const cursorMinimal = mode === "cursor-minimal";
  const customShadowsForMode = cursorMinimal
    ? Object.fromEntries(Object.keys(customShadows.light).map((key) => [key, "0 1px 2px rgba(30, 29, 26, 0.04)"]))
    : palette.dark ? customShadows.dark : customShadows.light;
  const shadowsForMode = cursorMinimal
    ? Array.from({ length: 25 }, (_, index) => index === 0 ? "none" : "0 1px 2px rgba(30, 29, 26, 0.04)")
    : palette.dark ? shadows.dark : shadows.light;

  return createTheme({
    palette: {
      mode: palette.dark ? "dark" : "light",
      primary: {
        main: palette.primary,
        light: palette.primaryLight,
        dark: palette.primaryDark,
        contrastText: palette.contrastText
      },
      secondary: {
        main: palette.secondary,
        light: palette.secondaryLight,
        dark: palette.secondaryDark,
        contrastText: palette.dark ? "#1C252E" : "#FFFFFF"
      },
      info: { main: cursorMinimal ? "#4389C7" : "#00B8D9" },
      success: { main: cursorMinimal ? "#16956B" : "#22C55E" },
      warning: { main: cursorMinimal ? "#C58A2A" : "#FFAB00" },
      error: { main: cursorMinimal ? "#C6534C" : "#FF5630" },
      background: {
        default: palette.defaultBg,
        paper: palette.paper
      },
      text: {
        primary: palette.textPrimary,
        secondary: palette.textSecondary
      },
      divider
    },
    shadows: shadowsForMode,
    customShadows: customShadowsForMode,
    shape: {
      borderRadius: cursorMinimal ? 10 : 8
    },
    typography,
    components: components(palette, divider)
  } as any);
}
