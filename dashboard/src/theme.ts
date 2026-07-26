import { createTheme } from "@mui/material/styles";

export function createAppTheme(prefersDark: boolean) {
  return createTheme({
    palette: {
      mode: prefersDark ? "dark" : "light",
      primary: { main: "#006c4c" },
      secondary: { main: "#48665a" },
      error: { main: "#ba1a1a" },
      warning: { main: "#805600" },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    },
  });
}
