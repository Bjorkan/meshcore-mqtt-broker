import { type ReactNode, useCallback, useState } from "react";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import useMediaQuery from "@mui/material/useMediaQuery";
import { alpha, useTheme } from "@mui/material/styles";
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
  const isDesktop = useMediaQuery(theme.breakpoints.up("lg"));
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
    <Box sx={{ minHeight: "100%" }}>
      <Box
        sx={{
          px: 2.5,
          height: 64,
          display: { xs: "none", lg: "flex" },
          flexDirection: "column",
          justifyContent: "center",
          bgcolor: "primary.dark",
          color: "#ffffff",
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 500 }}>
          Meshat.se
        </Typography>
        <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.76)" }}>
          Operations
        </Typography>
      </Box>
      <Divider sx={{ display: { xs: "none", lg: "block" } }} />
      <List sx={{ py: 1 }}>
        {NAV_ITEMS.map(({ view, label, icon: Icon }) => {
          const selected = route === view;
          return (
            <ListItemButton
              key={view}
              selected={selected}
              data-nav={view}
              aria-current={selected ? "page" : undefined}
              onClick={() => handleNav(view)}
              sx={{
                minHeight: 48,
                px: 2,
                borderLeft: 4,
                borderLeftColor: selected ? "primary.main" : "transparent",
                "&:hover": {
                  bgcolor: alpha(
                    theme.palette.primary.main,
                    darkMode ? 0.08 : 0.04,
                  ),
                },
                "&.Mui-selected": {
                  bgcolor: alpha(
                    theme.palette.primary.main,
                    darkMode ? 0.22 : 0.12,
                  ),
                  color: "primary.main",
                  "&:hover": {
                    bgcolor: alpha(
                      theme.palette.primary.main,
                      darkMode ? 0.28 : 0.16,
                    ),
                  },
                },
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: 40,
                  color: selected ? "primary.main" : "text.secondary",
                }}
              >
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={label}
                slotProps={{
                  primary: { sx: { fontWeight: selected ? 500 : 400 } },
                }}
              />
            </ListItemButton>
          );
        })}
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
        drawerWidth={DRAWER_WIDTH}
      />

      <Box
        component="nav"
        sx={{
          width: { lg: DRAWER_WIDTH },
          flexShrink: { lg: 0 },
        }}
      >
        {isDesktop ? (
          <Drawer
            variant="permanent"
            open
            sx={{
              display: { xs: "none", lg: "block" },
              "& .MuiDrawer-paper": {
                width: DRAWER_WIDTH,
                boxSizing: "border-box",
                top: 0,
                height: "100%",
                borderRightColor: "divider",
              },
            }}
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
              display: { xs: "block", lg: "none" },
              "& .MuiDrawer-paper": {
                width: DRAWER_WIDTH,
                boxSizing: "border-box",
                top: { xs: 56, sm: 64 },
                height: { xs: "calc(100% - 56px)", sm: "calc(100% - 64px)" },
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
          minWidth: 0,
          width: { lg: `calc(100% - ${DRAWER_WIDTH}px)` },
          pt: { xs: 7, sm: 8 },
        }}
      >
        <Box
          sx={{
            width: "100%",
            maxWidth: 1600,
            mx: "auto",
            px: { xs: 2, sm: 3, lg: 4 },
            py: { xs: 2, sm: 3 },
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
