import type { ThemePlugin } from "./types";

export const themePlugins: ThemePlugin[] = [
  {
    id: "official-light",
    name: "Official Light",
    description: "Clean Minimal/MUI-inspired default for daily work.",
    source: "official",
    installedByDefault: true,
    preview: { primary: "#1877F2", secondary: "#8E33FF", background: "#F4F6F8" }
  },
  {
    id: "codex",
    name: "Codex",
    description: "Crisp black-and-white workspace with cool gray navigation and restrained Codex blue accents.",
    source: "official",
    installedByDefault: true,
    preview: { primary: "#339CFF", secondary: "#5F6368", background: "#FFFFFF" },
    layout: {
      decorationIntensity: "none",
      backgroundLayerOpacity: 0,
      backgroundOverlayOpacity: 0,
      effectsLayerOpacity: 0,
      workspaceSurfaceOpacity: 1,
      heroOverlayOpacity: 1,
      panelSurfaceOpacity: 1,
      blurStrength: 0,
      toneColor: "#339CFF",
      toneOpacity: 0
    }
  },
  {
    id: "codex-light",
    name: "Codex Light",
    description: "Codex light theme with a white canvas, blue controls, and compact neutral surfaces.",
    source: "official",
    installedByDefault: true,
    preview: { primary: "#339CFF", secondary: "#5F6368", background: "#FFFFFF" },
    layout: {
      decorationIntensity: "none",
      backgroundLayerOpacity: 0,
      backgroundOverlayOpacity: 0,
      effectsLayerOpacity: 0,
      workspaceSurfaceOpacity: 1,
      heroOverlayOpacity: 1,
      panelSurfaceOpacity: 1,
      blurStrength: 0,
      toneColor: "#339CFF",
      toneOpacity: 0
    }
  },
  {
    id: "codex-dark",
    name: "Codex Dark",
    description: "Codex dark theme with graphite surfaces, white text, and the same focused blue accent.",
    source: "official",
    installedByDefault: true,
    dark: true,
    preview: { primary: "#339CFF", secondary: "#A6ADB5", background: "#181818" },
    layout: {
      decorationIntensity: "none",
      backgroundLayerOpacity: 0,
      backgroundOverlayOpacity: 0,
      effectsLayerOpacity: 0,
      workspaceSurfaceOpacity: 1,
      heroOverlayOpacity: 1,
      panelSurfaceOpacity: 1,
      blurStrength: 0,
      toneColor: "#339CFF",
      toneOpacity: 0
    }
  },
  {
    id: "official-black",
    name: "Official Black",
    description: "Dark workbench with cyan accents and high contrast code surfaces.",
    source: "official",
    installedByDefault: true,
    preview: { primary: "#61F3F3", secondary: "#FFAB00", background: "#070A0E" }
  },
  {
    id: "claude-warm",
    name: "Claude Warm",
    description: "Warm ivory surfaces, earthen orange accents, and restrained contrast inspired by Claude.",
    source: "official",
    installedByDefault: true,
    preview: { primary: "#C15F3C", secondary: "#75675E", background: "#F7F6F2" },
    layout: {
      backgroundOverlayOpacity: 0,
      effectsLayerOpacity: 0,
      workspaceSurfaceOpacity: 0.96,
      heroOverlayOpacity: 0.92,
      panelSurfaceOpacity: 0.98,
      blurStrength: 2,
      toneColor: "#C15F3C",
      toneOpacity: 0.025
    }
  },
  {
    id: "cursor-minimal",
    name: "Cursor Minimal",
    description: "Warm paper surfaces, hairline borders, compact contrast, and restrained amber and green accents inspired by Cursor.",
    source: "official",
    installedByDefault: true,
    preview: { primary: "#C58A2A", secondary: "#6F6A63", background: "#F3F2EE" },
    layout: {
      decorationIntensity: "none",
      backgroundLayerOpacity: 0,
      backgroundOverlayOpacity: 0,
      effectsLayerOpacity: 0,
      workspaceSurfaceOpacity: 1,
      heroOverlayOpacity: 1,
      panelSurfaceOpacity: 1,
      blurStrength: 0,
      toneColor: "#C58A2A",
      toneOpacity: 0
    }
  },
  {
    id: "atmospheric-codex",
    name: "Atmospheric Codex",
    description: "Mint green Soccer Stadium brand direction with glassmorphic layers.",
    source: "official",
    installedByDefault: true,
    preview: { primary: "#00361a", secondary: "#5a605d", background: "#f8faf5" }
  },
  {
    id: "dollar-green",
    name: "Dollar Green",
    description: "Soft sage-green canvas with deep dollar-green controls, inspired by the Junction Lab traffic-console palette.",
    source: "official",
    installedByDefault: true,
    preview: { primary: "#35704A", secondary: "#6E8461", background: "#E9EEE5" },
    layout: {
      backgroundOverlayOpacity: 0,
      effectsLayerOpacity: 0,
      workspaceSurfaceOpacity: 0.96,
      heroOverlayOpacity: 0.92,
      panelSurfaceOpacity: 0.98,
      blurStrength: 2,
      toneColor: "#35704A",
      toneOpacity: 0.03
    }
  },
  {
    id: "sakura-pink",
    name: "Sakura Pink",
    description: "Serene cherry blossom theme featuring soft rose surfaces and shadows.",
    source: "official",
    installedByDefault: true,
    preview: { primary: "#d46b7a", secondary: "#8e5e6e", background: "#fbf2f4" }
  },
  {
    id: "developer-leaf",
    name: "Developer (Hidden Leaf)",
    description: "Charcoal workspace with vibrant Fox Spirit orange accents.",
    source: "official",
    installedByDefault: true,
    preview: { primary: "#d97736", secondary: "#5a605d", background: "#12100e" },
    dark: true
  },
  {
    id: "violet-night",
    name: "Violet Night",
    description: "Low-light workspace with violet controls and calm neutral surfaces.",
    source: "official",
    installedByDefault: true,
    dark: true,
    preview: { primary: "#8B5CF6", secondary: "#C4B5FD", background: "#121215" },
    layout: { decorationIntensity: "none", backgroundLayerOpacity: 0, backgroundOverlayOpacity: 0, effectsLayerOpacity: 0, workspaceSurfaceOpacity: 1, heroOverlayOpacity: 1, panelSurfaceOpacity: 1, blurStrength: 0, toneColor: "#8B5CF6", toneOpacity: 0 }
  },
  {
    id: "midnight-cyan",
    name: "Midnight Cyan",
    description: "Deep blue-gray workbench with a clean cyan emphasis.",
    source: "official",
    installedByDefault: true,
    dark: true,
    preview: { primary: "#38BDF8", secondary: "#A5F3FC", background: "#161B22" },
    layout: { decorationIntensity: "none", backgroundLayerOpacity: 0, backgroundOverlayOpacity: 0, effectsLayerOpacity: 0, workspaceSurfaceOpacity: 1, heroOverlayOpacity: 1, panelSurfaceOpacity: 1, blurStrength: 0, toneColor: "#38BDF8", toneOpacity: 0 }
  },
  {
    id: "neon-terminal",
    name: "Neon Terminal",
    description: "High-contrast dark terminal palette with magenta and cyan accents.",
    source: "official",
    installedByDefault: true,
    dark: true,
    preview: { primary: "#FF0080", secondary: "#22D3EE", background: "#030305" },
    layout: { decorationIntensity: "none", backgroundLayerOpacity: 0, backgroundOverlayOpacity: 0, effectsLayerOpacity: 0, workspaceSurfaceOpacity: 1, heroOverlayOpacity: 1, panelSurfaceOpacity: 1, blurStrength: 0, toneColor: "#FF0080", toneOpacity: 0 }
  },
  {
    id: "clean-dawn",
    name: "Clean Dawn",
    description: "Bright neutral workspace with focused blue controls for daily work.",
    source: "official",
    installedByDefault: true,
    preview: { primary: "#2563EB", secondary: "#64748B", background: "#FFFFFF" },
    layout: { decorationIntensity: "none", backgroundLayerOpacity: 0, backgroundOverlayOpacity: 0, effectsLayerOpacity: 0, workspaceSurfaceOpacity: 1, heroOverlayOpacity: 1, panelSurfaceOpacity: 1, blurStrength: 0, toneColor: "#2563EB", toneOpacity: 0 }
  },
  {
    id: "dream-rose",
    name: "Dream Rose",
    description: "Soft rose skin plugin inspired by local Dream Skin concepts.",
    source: "local-plugin",
    installedByDefault: false,
    preview: { primary: "#D84F7A", secondary: "#B76E79", background: "#FFF7F8" }
  },
  {
    id: "studio-black-gold",
    name: "Studio Black Gold",
    description: "Warm studio skin for low-light work with gold controls.",
    source: "local-plugin",
    installedByDefault: false,
    preview: { primary: "#D6A85D", secondary: "#8D6A3F", background: "#080706" }
  },
  {
    id: "glass-blue",
    name: "Glass Blue",
    description: "Cool translucent blue direction reserved for customer themes.",
    source: "customer-slot",
    installedByDefault: false,
    preview: { primary: "#38BDF8", secondary: "#7DD3FC", background: "#EEF8FF" }
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    description: "Official ChatGPT-style centered chat with streaming assistant prose + reasoning + tool runs (reverse-engineered from the Codex desktop app).",
    source: "official",
    installedByDefault: true,
    preview: { primary: "#10a37f", secondary: "#6e6f80", background: "#ffffff" },
    layout: {
      decorationIntensity: "none",
      backgroundLayerOpacity: 0,
      backgroundOverlayOpacity: 0,
      effectsLayerOpacity: 0,
      workspaceSurfaceOpacity: 1,
      heroOverlayOpacity: 1,
      panelSurfaceOpacity: 1,
      blurStrength: 0,
      toneColor: "#10a37f",
      toneOpacity: 0
    }
  },
];

export const grey = {
  50: "#FCFDFD",
  100: "#F9FAFB",
  200: "#F4F6F8",
  300: "#DFE3E8",
  400: "#C4CDD5",
  500: "#919EAB",
  600: "#637381",
  700: "#454F5B",
  800: "#1C252E",
  900: "#141A21"
} as const;
