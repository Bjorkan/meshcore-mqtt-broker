import { type ReactNode, useCallback, useState } from "react";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import HomeOutlined from "@mui/icons-material/HomeOutlined";
import PeopleOutlined from "@mui/icons-material/PeopleOutlined";
import CloudUploadOutlined from "@mui/icons-material/CloudUploadOutlined";
import ShieldOutlined from "@mui/icons-material/ShieldOutlined";
import GroupOutlined from "@mui/icons-material/GroupOutlined";
import type { View } from "../../types.js";
import { TopAppBar } from "./top-app-bar.js";

const DRAWER_WIDTH = 240;

const NAV_ITEMS: {
  view: View;
  label: string;
  icon: typeof HomeOutlined;
}[] = [
  { view: "overview", label: "Overview", icon: HomeOutlined },
  { view: "observers", label: "Observers", icon: PeopleOutlined },
  { view: "meshcoreio", label: "MeshCore.io", icon: CloudUploadOutlined },
  { view: "bans", label: "Bans", icon: ShieldOutlined },
  { view: "subscribers", label: "Subscribers", icon: GroupOutlined },
];

export interface AppShellProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  lastUpdated: number;
  route: View;
  onNavigate: (view: View) => void;
  children: ReactNode;
}

export function AppShell({
  darkMode,
  onToggleDarkMode,
  lastUpdated,
  route,
  onNavigate,
  children,
}: AppShellProps) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleDrawerToggle = useCallback(() => {
    setMobileOpen((prev: boolean) => !prev);
  }, []);

  const handleNav = useCallback(
    (view: View) => {
      onNavigate(view);
      if (!isDesktop) setMobileOpen(false);
    },
    [onNavigate, isDesktop],
  );

  const drawerContent = (
    <Box sx={{ overflow: "auto" }}>
      <Box
        sx={{
          px: 2,
          py: 2.5,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Typography variant="h6" noWrap sx={{ fontWeight: 700 }}>
          Meshat.se
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap>
          MeshCore MQTT
        </Typography>
      </Box>
      <List sx={{ pt: 1 }}>
        {NAV_ITEMS.map(({ view, label, icon: Icon }) => (
          <ListItemButton
            key={view}
            selected={route === view}
            data-nav={view}
            onClick={() => handleNav(view)}
            sx={{
              mx: 1,
              borderRadius: 2,
              "&.Mui-selected": {
                bgcolor: "action.selected",
                "&:hover": { bgcolor: "action.selected" },
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>
              <Icon />
            </ListItemIcon>
            <ListItemText primary={label} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <TopAppBar
        darkMode={darkMode}
        onToggleDarkMode={onToggleDarkMode}
        lastUpdated={lastUpdated}
        onMenuClick={handleDrawerToggle}
      />

      <Box
        component="nav"
        sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}
      >
        {isDesktop ? (
          <Drawer
            variant="permanent"
            sx={{
              display: { xs: "none", md: "block" },
              "& .MuiDrawer-paper": {
                width: DRAWER_WIDTH,
                boxSizing: "border-box",
              },
            }}
            open
          >
            {drawerContent}
          </Drawer>
        ) : (
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={handleDrawerToggle}
            ModalProps={{ keepMounted: true }}
            sx={{
              display: { xs: "block", md: "none" },
              "& .MuiDrawer-paper": {
                width: DRAWER_WIDTH,
                boxSizing: "border-box",
              },
            }}
          >
            {drawerContent}
          </Drawer>
        )}
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          mt: 8,
          p: { xs: 2, sm: 3 },
          overflow: "auto",
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
