import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import DarkMode from "@mui/icons-material/DarkMode";
import LightMode from "@mui/icons-material/LightMode";
import Menu from "@mui/icons-material/Menu";
import {
  isValidTimestamp,
  stockholmShortTime,
  stockholmTime,
} from "../../helpers/time.js";

export interface TopAppBarProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  lastUpdated: number;
  mobileDrawerId: string;
  mobileDrawerOpen: boolean;
  onMenuClick: () => void;
  drawerWidth: number;
}

export function TopAppBar({
  darkMode,
  onToggleDarkMode,
  lastUpdated,
  mobileDrawerId,
  mobileDrawerOpen,
  onMenuClick,
  drawerWidth,
}: TopAppBarProps) {
  const lastUpdatedLabel =
    isValidTimestamp(lastUpdated) && lastUpdated > 0
      ? `Updated ${stockholmShortTime(lastUpdated)}`
      : "";
  const lastUpdatedTitle = lastUpdatedLabel
    ? `Dashboard data updated ${stockholmTime(lastUpdated)}`
    : undefined;

  return (
    <AppBar
      position="fixed"
      color="primary"
      sx={{
        zIndex: (theme) => theme.zIndex.drawer + 1,
        width: { lg: `calc(100% - ${drawerWidth}px)` },
        ml: { lg: `${drawerWidth}px` },
      }}
    >
      <Toolbar sx={{ px: { xs: 1, sm: 2 } }}>
        <IconButton
          edge="start"
          aria-controls={mobileDrawerId}
          aria-expanded={mobileDrawerOpen}
          aria-label={
            mobileDrawerOpen ? "Close navigation menu" : "Open navigation menu"
          }
          color="inherit"
          sx={{ mr: 1, display: { lg: "none" }, width: 48, height: 48 }}
          onClick={onMenuClick}
        >
          <Menu />
        </IconButton>

        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h6" noWrap sx={{ fontWeight: 500 }}>
            MeshCore MQTT
          </Typography>
          {lastUpdatedLabel ? (
            <Typography
              noWrap
              title={lastUpdatedTitle}
              variant="caption"
              component="div"
              sx={{
                color: "rgba(255,255,255,0.82)",
                display: { xs: "block", sm: "none" },
              }}
            >
              {lastUpdatedLabel}
            </Typography>
          ) : null}
          <Typography
            noWrap
            variant="caption"
            component="div"
            sx={{
              color: "rgba(255,255,255,0.78)",
              display: { xs: "none", sm: "block" },
            }}
          >
            Meshat.se operations dashboard
          </Typography>
        </Box>

        {lastUpdatedLabel && (
          <Typography
            variant="body2"
            title={lastUpdatedTitle}
            sx={{
              mr: 1,
              color: "rgba(255,255,255,0.82)",
              display: { xs: "none", sm: "block" },
            }}
          >
            {lastUpdatedLabel}
          </Typography>
        )}

        <Tooltip
          title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        >
          <IconButton
            aria-label={
              darkMode ? "Switch to light mode" : "Switch to dark mode"
            }
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
