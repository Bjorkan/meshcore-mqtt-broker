import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import DarkMode from "@mui/icons-material/DarkMode";
import LightMode from "@mui/icons-material/LightMode";
import Menu from "@mui/icons-material/Menu";
import { stockholmShortTime } from "../../helpers/time.js";

export interface TopAppBarProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  lastUpdated: number;
  onMenuClick: () => void;
}

export function TopAppBar({
  darkMode,
  onToggleDarkMode,
  lastUpdated,
  onMenuClick,
}: TopAppBarProps) {
  const lastUpdatedLabel = Number.isFinite(lastUpdated)
    ? `Updated ${stockholmShortTime(lastUpdated)}`
    : "";

  return (
    <AppBar
      position="fixed"
      elevation={0}
      sx={{
        zIndex: (theme) => theme.zIndex.drawer + 1,
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: "background.default",
        color: "text.primary",
      }}
    >
      <Toolbar>
        <IconButton
          edge="start"
          aria-label="Open menu"
          onClick={onMenuClick}
          sx={{ mr: 1, display: { md: "none" } }}
        >
          <Menu />
        </IconButton>

        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h6" noWrap sx={{ fontWeight: 700 }}>
            MeshCore MQTT
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            component="div"
          >
            Meshat.se operations dashboard
          </Typography>
        </Box>

        {lastUpdatedLabel && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mr: 1, display: { xs: "none", sm: "block" } }}
          >
            {lastUpdatedLabel}
          </Typography>
        )}

        <IconButton
          aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          onClick={onToggleDarkMode}
          color="inherit"
        >
          {darkMode ? <LightMode /> : <DarkMode />}
        </IconButton>
      </Toolbar>
    </AppBar>
  );
}
