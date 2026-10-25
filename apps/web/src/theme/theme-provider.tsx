import { useEffect, useState, type ReactNode } from "react";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { createCodexTheme } from "./create-theme";
import type { ThemeId, ThemeMode, ThemePlugin } from "./types";

type ThemeProviderProps = {
  themeMode: ThemeMode;
  customThemePlugins?: ThemePlugin[];
  children: ReactNode;
};

export function ThemeProvider({ themeMode, customThemePlugins = [], children }: ThemeProviderProps) {
  const resolvedThemeMode = useResolvedThemeMode(themeMode);
  const theme = createCodexTheme(resolvedThemeMode, customThemePlugins);

  return (
    <MuiThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </MuiThemeProvider>
  );
}

function useResolvedThemeMode(themeMode: ThemeMode): ThemeId {
  const [prefersDark, setPrefersDark] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)").matches : false
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    query.addEventListener("change", onChange);
    setPrefersDark(query.matches);
    return () => query.removeEventListener("change", onChange);
  }, []);

  if (themeMode === "system") {
    return prefersDark ? "official-black" : "official-light";
  }
  return themeMode;
}
