import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import DarkMode from "@mui/icons-material/DarkMode";
import LightMode from "@mui/icons-material/LightMode";
import Menu from "@mui/icons-material/Menu";
import { stockholmShortTime } from "../../helpers/time.js";

export interface TopAppBarProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  lastUpdated: number;
  onMenuClick: () => void;
  drawerWidth: number;
}

export function TopAppBar({
  darkMode,
  onToggleDarkMode,
  lastUpdated,
  onMenuClick,
  drawerWidth,
}: TopAppBarProps) {
  const lastUpdatedLabel = Number.isFinite(lastUpdated) && lastUpdated > 0
    ? `Updated ${stockholmShortTime(lastUpdated)}`
    : "";

  return (
    <AppBar
      position="fixed"
      color="primary"
      sx={{
        zIndex: (theme) => theme.zIndex.drawer + 1,
        width: { md: `calc(100% - ${drawerWidth}px)` },
        ml: { md: `${drawerWidth}px` },
      }}
    >
      <Toolbar sx={{ px: { xs: 1, sm: 2 } }}>
        <IconButton
          edge="start"
          aria-label="Open menu"
          onClick={onMenuClick}
          color="inherit"
          sx={{ mr: 1, display: { md: "none" }, width: 48, height: 48 }}
        >
          <Menu />
        </IconButton>

        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h6" noWrap sx={{ fontWeight: 500 }}>
            MeshCore MQTT
          </Typography>
          <Typography
            variant="caption"
            noWrap
            component="div"
            sx={{ color: "rgba(255,255,255,0.78)", display: { xs: "none", sm: "block" } }}
          >
            Meshat.se operations dashboard
          </Typography>
        </Box>

        {lastUpdatedLabel && (
          <Typography
            variant="body2"
            sx={{ mr: 1, color: "rgba(255,255,255,0.82)", display: { xs: "none", sm: "block" } }}
          >
            {lastUpdatedLabel}
          </Typography>
        )}

        <Tooltip title={darkMode ? "Switch to light mode" : "Switch to dark mode"}>
          <IconButton
            aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            onClick={onToggleDarkMode}
            color="inherit"
            sx={{ width: 48, height: 48 }}
          >
            {darkMode ? <LightMode /> : <DarkMode />}
          </IconButton>
        </Tooltip>
      </Toolbar>
    </AppBar>
  );
}
