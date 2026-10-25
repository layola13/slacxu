import { createTheme, type Theme } from "@mui/material/styles";
import { alpha } from "@mui/material/styles";

/**
 * chatgptMuiTheme - a scoped MUI Theme override used only inside <ChatGptShell>.
 *
 * The codex-react-ui base MUI theme (createCodexTheme) does not know about the
 * "chatgpt" ThemeId, so the protected <ChatWaterfall>/<ChatRow> components — which
 * resolve colors via `theme.palette.divider`, `theme.palette.background.paper`,
 * `theme.palette.text.*`, etc. — receive the base light palette and leak the
 * default divider (rgba(227,227,227,0.24)) instead of the official ChatGPT token
 * border (oklab 12% of #0d0d0d).
 *
 * We don't modify ChatWaterfall/ChatRow (protected). Instead we wrap the
 * <ChatGptShell> subtree in <ThemeProvider theme={chatgptMuiTheme}> so the
 * descendant MUI components see a palette that mirrors the official ChatGPT
 * light tokens declared in chatgpt-tokens.css (`--color-token-*`).
 *
 * Values are reverse-engineered from the official Codex desktop asar bundle
 * (`__re_app_initial.js`) and `__app_main.css` (Tailwind v4 build):
 *   --color-token-foreground       #0d0d0d   -> text.primary
 *   --color-token-text-secondary   65%       -> text.secondary (#676767)
 *   --color-token-bg-primary       #ffffff    -> background.paper / .default
 *   --color-token-border-heavy     12% oklab  -> palette.divider
 *   --color-token-list-hover       4% black   -> action.hover
 *
 * The remainder (primary, secondary, shape, typography, shadows) is inherited from
 * the codex-react-ui base theme by overlaying only the palette fields via
 * `createTheme(base, overrides)`. We construct a minimal codex-react-ui-light
 * base first so the helper is self-contained and stays additive (no edits to
 * create-theme.ts / theme-config.ts).
 */

// Foreground and 65% mix used for the official ChatGPT light palette.
const CHATGPT_FOREGROUND = "#0D0D0D";
const CHATGPT_TEXT_SECONDARY = "#616161"; // ~65% of #0d0d0d toward white
const CHATGPT_BORDER_HEAVY_BASE = "#0D0D0D"; // oklab(0.159...) 12% → ≈ rgba(13,13,13,0.12)
const CHATGPT_LIST_HOVER_BASE = "#000000"; // 4% black hover

export const chatgptMuiTheme: Theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: CHATGPT_FOREGROUND,
      light: "#3D3D3D",
      dark: "#000000",
      contrastText: "#FFFFFF"
    },
    secondary: {
      main: "#676767",
      light: "#9A9A9A",
      dark: "#3E3E3E",
      contrastText: "#FFFFFF"
    },
    info: { main: "#00B8D9" },
    success: { main: "#22C55E" },
    warning: { main: "#FFAB00" },
    error: { main: "#FF5630" },
    background: {
      default: "#FFFFFF",
      paper: "#FFFFFF"
    },
    text: {
      primary: CHATGPT_FOREGROUND,
      secondary: CHATGPT_TEXT_SECONDARY
    },
    // Official border-heavy: ~12% of #0d0d0d ✓
    divider: alpha(CHATGPT_BORDER_HEAVY_BASE, 0.12),
    action: {
      hover: alpha(CHATGPT_LIST_HOVER_BASE, 0.04),
      selected: alpha(CHATGPT_LIST_HOVER_BASE, 0.08),
      disabled: alpha(CHATGPT_FOREGROUND, 0.38),
      disabledBackground: alpha(CHATGPT_FOREGROUND, 0.12)
    }
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily:
      '"Plus Jakarta Sans","Manrope","JetBrains Mono",Inter,"DM Sans",ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
  }
});

/** palette.divider usable from outside React if needed (CSS-aware). */
export const chatgptDividerColor: string = alpha(CHATGPT_BORDER_HEAVY_BASE, 0.12);