import { alpha } from "@mui/material/styles";
import type { Components, Theme } from "@mui/material/styles";
import type { ThemePalette } from "../types";

export function components(palette: ThemePalette, divider: string): Components<Theme> {
  return {
    MuiCssBaseline: {
      styleOverrides: {
        html: {
          height: "100%",
          overflow: "hidden"
        },
        body: {
          backgroundColor: palette.defaultBg,
          color: palette.textPrimary,
          margin: 0,
          fontFamily: '"Plus Jakarta Sans", "Manrope", sans-serif',
          height: "100%",
          minHeight: "100%",
          overflow: "hidden",
          backgroundImage: palette.dark
            ? "radial-gradient(ellipse at top right, rgba(97, 243, 243, 0.05), transparent 70%)"
            : "radial-gradient(ellipse at top right, rgba(0, 54, 26, 0.03), transparent 70%)",
          backgroundAttachment: "fixed"
        },
        "#root": {
          height: "100%",
          minHeight: 0,
          overflow: "hidden"
        },
        "*": {
          boxSizing: "border-box"
        },
        "html[data-performance-pressure='true'] *, html[data-performance-pressure='true'] *::before, html[data-performance-pressure='true'] *::after": {
          animationPlayState: "paused !important",
          transition: "none !important",
          backdropFilter: "none !important",
          filter: "none !important"
        },
        "html[data-software-rendering='true'] *, html[data-software-rendering='true'] *::before, html[data-software-rendering='true'] *::after": {
          backdropFilter: "none !important"
        },
        "*::-webkit-scrollbar": {
          width: 8,
          height: 8
        },
        "*::-webkit-scrollbar-thumb": {
          backgroundColor: alpha(palette.dark ? "#FFFFFF" : "#637381", 0.16),
          borderRadius: 999,
          border: `2px solid ${palette.defaultBg}`
        },
        "*::-webkit-scrollbar-thumb:hover": {
          backgroundColor: alpha(palette.dark ? "#FFFFFF" : "#637381", 0.28)
        },
        "*::-webkit-scrollbar-track": {
          backgroundColor: "transparent"
        }
      }
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          backgroundColor: alpha(palette.paper, 0.96),
          borderBottom: `1px solid ${divider}`
        }
      }
    },
    MuiButtonBase: {
      styleOverrides: {
        root: {
          borderRadius: 12
        }
      }
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true
      },
      styleOverrides: {
        root: {
          minHeight: 36,
          borderRadius: 8,
          paddingInline: 16,
          fontWeight: 700,
          transition: "all 0.2s ease-in-out"
        },
        contained: {
          boxShadow: "none",
          "&:hover": {
            boxShadow: "none"
          }
        },
        containedPrimary: {
          boxShadow: `0 8px 20px -4px ${alpha(palette.primary, 0.24)}`,
          "&:hover": {
            boxShadow: `0 12px 24px -4px ${alpha(palette.primary, 0.38)}`,
            backgroundColor: palette.primaryDark
          }
        },
        outlined: {
          backgroundColor: alpha(palette.panel, 0.4),
          borderColor: alpha(palette.dividerBase, 0.24),
          "&:hover": {
            backgroundColor: alpha(palette.panel, 0.85),
            borderColor: palette.primary
          }
        }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 600,
          fontSize: "0.75rem"
        }
      }
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: divider
        }
      }
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          marginInline: 8,
          marginBlock: 4,
          paddingBlock: 10,
          paddingInline: 12,
          transition: "all 0.15s ease-in-out",
          "&.Mui-selected": {
            backgroundColor: alpha(palette.primary, palette.dark ? 0.18 : 0.08),
            color: palette.primary,
            "& .MuiListItemIcon-root": {
              color: palette.primary
            }
          },
          "&.Mui-selected:hover": {
            backgroundColor: alpha(palette.primary, palette.dark ? 0.24 : 0.14)
          }
        }
      }
    },
    MuiPaper: {
      defaultProps: {
        elevation: 0
      },
      styleOverrides: {
        root: {
          backgroundImage: "none",
          borderRadius: 8,
          backgroundColor: alpha(palette.paper, 0.96),
          border: `1px solid ${alpha(palette.dividerBase, 0.12)}`
        },
        outlined: {
          borderColor: divider
        }
      }
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: alpha(palette.panel, 0.4),
          borderRadius: 8,
          "& .MuiOutlinedInput-notchedOutline": {
            borderColor: alpha(palette.dividerBase, 0.16)
          },
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: alpha(palette.primary, 0.48)
          },
          "&.MuiFocused .MuiOutlinedInput-notchedOutline": {
            borderColor: palette.primary
          }
        }
      }
    },
    MuiSelect: {
      styleOverrides: {
        select: {
          display: "flex",
          alignItems: "center"
        }
      }
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 700,
          minHeight: 44,
          borderRadius: 8,
          margin: "4px 2px",
          transition: "all 0.2s ease"
        }
      }
    },
    MuiTabs: {
      styleOverrides: {
        root: {
          minHeight: 44
        },
        indicator: {
          height: 3,
          borderRadius: 999
        }
      }
    }
  };
}
