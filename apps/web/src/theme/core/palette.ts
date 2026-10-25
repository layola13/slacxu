import type { ThemeMode, ThemePalette, ThemePlugin } from "../types";

function mix(color: string, target: string, amount: number): string {
  const from = parseHex(color);
  const to = parseHex(target);
  if (!from || !to) {
    return color;
  }
  const mixChannel = (a: number, b: number) => Math.round(a + (b - a) * amount);
  return `#${[mixChannel(from[0], to[0]), mixChannel(from[1], to[1]), mixChannel(from[2], to[2])]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function parseHex(value: string): [number, number, number] | null {
  const raw = value.trim().replace("#", "");
  if (raw.length === 3) {
    const channels = raw.split("").map((part) => parseInt(part + part, 16));
    if (channels.length !== 3 || channels.some((channel) => Number.isNaN(channel))) {
      return null;
    }
    return [channels[0]!, channels[1]!, channels[2]!];
  }
  if (raw.length !== 6) {
    return null;
  }
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  if ([r, g, b].some((channel) => Number.isNaN(channel))) {
    return null;
  }
  return [r, g, b];
}

export function themePaletteFromPlugin(plugin: ThemePlugin): ThemePalette {
  const dark = Boolean(plugin.dark);
  const primary = plugin.preview.primary;
  const secondary = plugin.preview.secondary;
  const background = plugin.preview.background;
  return {
    dark,
    primary,
    primaryLight: mix(primary, "#FFFFFF", 0.35),
    primaryDark: mix(primary, "#000000", 0.28),
    secondary,
    secondaryLight: mix(secondary, "#FFFFFF", 0.32),
    secondaryDark: mix(secondary, "#000000", 0.28),
    defaultBg: background,
    paper: dark ? mix(background, "#FFFFFF", 0.08) : "#FFFFFF",
    panel: dark ? mix(background, "#FFFFFF", 0.05) : mix(background, "#FFFFFF", 0.55),
    textPrimary: dark ? "#F9FAFB" : "#1C252E",
    textSecondary: dark ? "#A8B3BF" : "#637381",
    dividerBase: dark ? "#FFFFFF" : "#919EAB",
    contrastText: dark ? "#0B1220" : "#FFFFFF"
  };
}

export function themePalette(mode: ThemeMode, customPlugins: ThemePlugin[] = []): ThemePalette {
  const custom = customPlugins.find((plugin) => plugin.id === mode);
  if (custom) {
    return themePaletteFromPlugin(custom);
  }

  switch (mode) {
    case "violet-night":
      return { dark: true, primary: "#8B5CF6", primaryLight: "#C4B5FD", primaryDark: "#6D28D9", secondary: "#C4B5FD", secondaryLight: "#DDD6FE", secondaryDark: "#8B5CF6", defaultBg: "#121215", paper: "#1A1A20", panel: "#22222A", textPrimary: "#F2F2F7", textSecondary: "#B9B9CD", dividerBase: "#4A4A58", contrastText: "#FFFFFF" };
    case "midnight-cyan":
      return { dark: true, primary: "#38BDF8", primaryLight: "#A5F3FC", primaryDark: "#0284C7", secondary: "#A5F3FC", secondaryLight: "#CFFAFE", secondaryDark: "#0891B2", defaultBg: "#161B22", paper: "#1C212A", panel: "#252B36", textPrimary: "#DCE5F1", textSecondary: "#A8B2C2", dividerBase: "#3D4654", contrastText: "#082F49" };
    case "neon-terminal":
      return { dark: true, primary: "#FF0080", primaryLight: "#FF66B3", primaryDark: "#BE185D", secondary: "#22D3EE", secondaryLight: "#A5F3FC", secondaryDark: "#0891B2", defaultBg: "#030305", paper: "#0A0A10", panel: "#141420", textPrimary: "#FFFFFF", textSecondary: "#B8B8CE", dividerBase: "#3C1A4D", contrastText: "#FFFFFF" };
    case "clean-dawn":
      return { dark: false, primary: "#2563EB", primaryLight: "#93C5FD", primaryDark: "#1D4ED8", secondary: "#64748B", secondaryLight: "#CBD5E1", secondaryDark: "#475569", defaultBg: "#FFFFFF", paper: "#FFFFFF", panel: "#F8FAFC", textPrimary: "#212529", textSecondary: "#495057", dividerBase: "#DEE2E6", contrastText: "#FFFFFF" };
    case "codex":
      return {
        dark: false,
        primary: "#339CFF",
        primaryLight: "#8CC8FF",
        primaryDark: "#1677D2",
        secondary: "#5F6368",
        secondaryLight: "#A9ADB2",
        secondaryDark: "#35383C",
        defaultBg: "#FFFFFF",
        paper: "#FFFFFF",
        panel: "#F1F5F9",
        textPrimary: "#1A1C1F",
        textSecondary: "#62676D",
        dividerBase: "#B8BEC5",
        contrastText: "#FFFFFF"
      };
    case "codex-light":
      return {
        dark: false,
        primary: "#339CFF",
        primaryLight: "#8CC8FF",
        primaryDark: "#1677D2",
        secondary: "#5F6368",
        secondaryLight: "#A9ADB2",
        secondaryDark: "#35383C",
        defaultBg: "#FFFFFF",
        paper: "#FFFFFF",
        panel: "#F5F5F5",
        textPrimary: "#1A1C1F",
        textSecondary: "#62676D",
        dividerBase: "#D8D8D8",
        contrastText: "#FFFFFF"
      };
    case "codex-dark":
      return {
        dark: true,
        primary: "#339CFF",
        primaryLight: "#80BFFF",
        primaryDark: "#1677D2",
        secondary: "#A6ADB5",
        secondaryLight: "#D6D9DE",
        secondaryDark: "#717982",
        defaultBg: "#181818",
        paper: "#202020",
        panel: "#242424",
        textPrimary: "#FFFFFF",
        textSecondary: "#A6A6A6",
        dividerBase: "#3A3A3A",
        contrastText: "#FFFFFF"
      };
    case "official-black":
      return {
        dark: true,
        primary: "#61F3F3",
        primaryLight: "#CAFDF5",
        primaryDark: "#00B8D9",
        secondary: "#FFAB00",
        secondaryLight: "#FFD666",
        secondaryDark: "#B76E00",
        defaultBg: "#070A0E",
        paper: "#10161D",
        panel: "#0D1218",
        textPrimary: "#F9FAFB",
        textSecondary: "#A8B3BF",
        dividerBase: "#FFFFFF",
        contrastText: "#06202A"
      };
    case "atmospheric-codex":
      return {
        dark: false,
        primary: "#00361a",
        primaryLight: "#9dd3aa",
        primaryDark: "#00210e",
        secondary: "#5a605d",
        secondaryLight: "#dfe4e1",
        secondaryDark: "#171d1b",
        defaultBg: "#f8faf5",
        paper: "#ffffff",
        panel: "#f3f4ef",
        textPrimary: "#191c19",
        textSecondary: "#414942",
        dividerBase: "#c1c9bf",
        contrastText: "#ffffff"
      };
    case "claude-warm":
      return {
        dark: false,
        primary: "#C15F3C",
        primaryLight: "#D99076",
        primaryDark: "#914329",
        secondary: "#75675E",
        secondaryLight: "#B7AAA0",
        secondaryDark: "#4E433C",
        defaultBg: "#F7F6F2",
        paper: "#FEFDFB",
        panel: "#F0EEE9",
        textPrimary: "#2F2925",
        textSecondary: "#756B63",
        dividerBase: "#9A8E84",
        contrastText: "#FFFFFF"
      };
    case "cursor-minimal":
      return {
        dark: false,
        primary: "#C58A2A",
        primaryLight: "#E8C98E",
        primaryDark: "#8D5D16",
        secondary: "#6F6A63",
        secondaryLight: "#B9B5AE",
        secondaryDark: "#44413D",
        defaultBg: "#F3F2EE",
        paper: "#FAFAF8",
        panel: "#F7F6F2",
        textPrimary: "#1E1D1A",
        textSecondary: "#817B73",
        dividerBase: "#B8B3AB",
        contrastText: "#FFFFFF"
      };
    case "sakura-pink":
      return {
        dark: false,
        primary: "#d46b7a",
        primaryLight: "#ffb2bb",
        primaryDark: "#380b15",
        secondary: "#8e5e6e",
        secondaryLight: "#fcecee",
        secondaryDark: "#6d3748",
        defaultBg: "#fbf2f4",
        paper: "#ffffff",
        panel: "#faf0f2",
        textPrimary: "#3d2b2d",
        textSecondary: "#414942",
        dividerBase: "#c1c9bf",
        contrastText: "#ffffff"
      };
    case "developer-leaf":
      return {
        dark: true,
        primary: "#d97736",
        primaryLight: "#f09e6c",
        primaryDark: "#ab5118",
        secondary: "#5a605d",
        secondaryLight: "#dfe4e1",
        secondaryDark: "#171d1b",
        defaultBg: "#12100e",
        paper: "#1a1715",
        panel: "#24201c",
        textPrimary: "#e4e4e4",
        textSecondary: "#9ca3af",
        dividerBase: "#4b5563",
        contrastText: "#ffffff"
      };
    case "dream-rose":
      return {
        dark: false,
        primary: "#D84F7A",
        primaryLight: "#F7B9C8",
        primaryDark: "#9E2F55",
        secondary: "#8E5E6E",
        secondaryLight: "#D9A4B4",
        secondaryDark: "#6D3748",
        defaultBg: "#FFF7F8",
        paper: "#FFFFFF",
        panel: "#FFFDFD",
        textPrimary: "#2F2028",
        textSecondary: "#7B5F68",
        dividerBase: "#D9A4B4",
        contrastText: "#FFFFFF"
      };
    case "studio-black-gold":
      return {
        dark: true,
        primary: "#D6A85D",
        primaryLight: "#F1D29A",
        primaryDark: "#8D6A3F",
        secondary: "#8B5E34",
        secondaryLight: "#C99A64",
        secondaryDark: "#5C391D",
        defaultBg: "#080706",
        paper: "#15110D",
        panel: "#1B1510",
        textPrimary: "#FFF7E8",
        textSecondary: "#C8B89C",
        dividerBase: "#F1D29A",
        contrastText: "#15110D"
      };
    case "glass-blue":
      return {
        dark: false,
        primary: "#0284C7",
        primaryLight: "#7DD3FC",
        primaryDark: "#075985",
        secondary: "#2563EB",
        secondaryLight: "#93C5FD",
        secondaryDark: "#1D4ED8",
        defaultBg: "#EEF8FF",
        paper: "#FFFFFF",
        panel: "#F8FCFF",
        textPrimary: "#102033",
        textSecondary: "#52677D",
        dividerBase: "#93C5FD",
        contrastText: "#FFFFFF"
      };
    case "chatgpt":
      return {
        dark: false,
        primary: "#10a37f",
        primaryLight: "#3ecdb0",
        primaryDark: "#0b7c5f",
        secondary: "#6e6f80",
        secondaryLight: "#9d9eac",
        secondaryDark: "#4f505e",
        defaultBg: "#ffffff",
        paper: "#ffffff",
        panel: "#f7f7f8",
        textPrimary: "#0d0d0d",
        textSecondary: "#6e6f80",
        dividerBase: "#e3e3e3",
        contrastText: "#ffffff"
      };
    case "dollar-green":
      return {
        dark: false,
        primary: "#35704A",
        primaryLight: "#8CC39C",
        primaryDark: "#24573A",
        secondary: "#6E8461",
        secondaryLight: "#BCCAB2",
        secondaryDark: "#47573F",
        defaultBg: "#E9EEE5",
        paper: "#FAFBF6",
        panel: "#F2F4EC",
        textPrimary: "#22301F",
        textSecondary: "#5F6F60",
        dividerBase: "#BCC8B4",
        contrastText: "#FFFFFF"
      };
    case "official-light":
    default:
      return {
        dark: false,
        primary: "#1877F2",
        primaryLight: "#73BAFB",
        primaryDark: "#0C44AE",
        secondary: "#8E33FF",
        secondaryLight: "#C684FF",
        secondaryDark: "#5119B7",
        defaultBg: "#F4F6F8",
        paper: "#FFFFFF",
        panel: "#FFFFFF",
        textPrimary: "#1C252E",
        textSecondary: "#637381",
        dividerBase: "#919EAB",
        contrastText: "#FFFFFF"
      };
  }
}
