import { alpha, createTheme } from "@mui/material/styles";

const MESHAT_GREEN = "#00796b";
const MESHAT_GREEN_DARK = "#00574f";
const MESHAT_GREEN_LIGHT = "#4db6ac";

export function createAppTheme(prefersDark: boolean) {
  const mode = prefersDark ? "dark" : "light";
  const backgroundDefault = prefersDark ? "#121212" : "#f4f6f5";
  const backgroundPaper = prefersDark ? "#1e1e1e" : "#ffffff";

  return createTheme({
    palette: {
      mode,
      primary: {
        main: prefersDark ? MESHAT_GREEN_LIGHT : MESHAT_GREEN,
        dark: MESHAT_GREEN_DARK,
        contrastText: prefersDark ? "#00251f" : "#ffffff",
      },
      secondary: { main: prefersDark ? "#90a4ae" : "#455a64" },
      error: { main: prefersDark ? "#ef5350" : "#c62828" },
      warning: { main: prefersDark ? "#ffb74d" : "#ed6c02" },
      success: { main: prefersDark ? "#66bb6a" : "#2e7d32" },
      background: {
        default: backgroundDefault,
        paper: backgroundPaper,
      },
      text: {
        secondary: prefersDark ? alpha("#ffffff", 0.7) : alpha("#263238", 0.68),
        disabled: prefersDark ? alpha("#ffffff", 0.5) : alpha("#263238", 0.42),
      },
      divider: prefersDark ? alpha("#ffffff", 0.12) : alpha("#263238", 0.14),
      action: {
        hover: prefersDark ? alpha("#ffffff", 0.06) : alpha("#263238", 0.05),
        selected: prefersDark
          ? alpha(MESHAT_GREEN, 0.24)
          : alpha(MESHAT_GREEN, 0.12),
      },
    },
    shape: { borderRadius: 4 },
    typography: {
      fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif',
      h1: { fontSize: "2rem", fontWeight: 500, lineHeight: 1.2 },
      h2: { fontSize: "1.75rem", fontWeight: 500, lineHeight: 1.25 },
      h3: { fontSize: "1.5rem", fontWeight: 500, lineHeight: 1.3 },
      h4: { fontSize: "1.375rem", fontWeight: 500, lineHeight: 1.35 },
      h5: { fontSize: "1.25rem", fontWeight: 500, lineHeight: 1.4 },
      h6: { fontSize: "1rem", fontWeight: 500, lineHeight: 1.5 },
      subtitle1: { fontSize: "1rem", fontWeight: 500 },
      subtitle2: { fontSize: "0.875rem", fontWeight: 500 },
      body1: { fontSize: "1rem" },
      body2: { fontSize: "0.875rem" },
      button: {
        fontSize: "0.875rem",
        fontWeight: 500,
        letterSpacing: "0.02em",
      },
      caption: { fontSize: "0.75rem", lineHeight: 1.45 },
      overline: {
        fontSize: "0.75rem",
        fontWeight: 500,
        letterSpacing: "0.08em",
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: { overflowX: "hidden" },
          body: {
            minWidth: 320,
            backgroundColor: backgroundDefault,
          },
          "::selection": {
            backgroundColor: alpha(MESHAT_GREEN, prefersDark ? 0.45 : 0.24),
          },
          code: {
            fontFamily:
              '"Roboto Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 4 },
        styleOverrides: {
          root: {
            backgroundImage: "none",
            backgroundColor: MESHAT_GREEN_DARK,
            color: "#ffffff",
          },
        },
      },
      MuiToolbar: {
        styleOverrides: {
          root: {
            minHeight: 56,
            "@media (min-width:600px)": { minHeight: 64 },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          rounded: { borderRadius: 4 },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 1 },
        styleOverrides: {
          root: {
            backgroundImage: "none",
            borderRadius: 4,
          },
        },
      },
      MuiCardContent: {
        styleOverrides: {
          root: {
            padding: 16,
            "&:last-child": { paddingBottom: 16 },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 4,
            minHeight: 36,
          },
          sizeSmall: { minHeight: 32 },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: "50%",
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            height: 28,
            borderRadius: 14,
          },
          sizeSmall: {
            height: 24,
            borderRadius: 12,
          },
          label: {
            variants: [
              {
                props: { size: "small" },
                style: { paddingLeft: 8, paddingRight: 8 },
              },
            ],
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: 4 },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: {
            "&.Mui-disabled": {
              color: prefersDark
                ? alpha("#ffffff", 0.5)
                : alpha("#263238", 0.5),
            },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 4,
            backgroundImage: "none",
          },
          paperFullScreen: { borderRadius: 0 },
        },
      },
      MuiBackdrop: {
        styleOverrides: {
          root: {
            backgroundColor: prefersDark
              ? "rgba(0, 0, 0, 0.62)"
              : "rgba(0, 0, 0, 0.42)",
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            padding: "16px 24px",
            borderBottom: `1px solid ${
              prefersDark ? alpha("#ffffff", 0.12) : alpha("#263238", 0.14)
            }`,
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: { padding: 24 },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            padding: "10px 16px",
            borderBottomColor: prefersDark
              ? alpha("#ffffff", 0.12)
              : alpha("#263238", 0.12),
          },
          sizeSmall: {
            padding: "8px 12px",
          },
          head: {
            fontWeight: 500,
            color: prefersDark ? alpha("#ffffff", 0.88) : "#263238",
            backgroundColor: prefersDark ? "#252525" : "#f7f9f8",
            whiteSpace: "nowrap",
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            "&.MuiTableRow-hover:hover": {
              backgroundColor: prefersDark
                ? alpha(MESHAT_GREEN, 0.12)
                : alpha(MESHAT_GREEN, 0.06),
            },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 0,
          },
        },
      },
      MuiTooltip: {
        defaultProps: { arrow: true },
      },
    },
  });
}
