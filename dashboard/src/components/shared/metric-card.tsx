import type { ReactNode } from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { alpha } from "@mui/material/styles";

export interface MetricCardProps {
  label: string;
  value: string;
  note?: string;
  icon: ReactNode;
}

export function MetricCard({ label, value, note, icon }: MetricCardProps) {
  return (
    <Card sx={{ height: "100%" }}>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, minHeight: 64 }}>
          <Box
            sx={{
              color: "primary.main",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
              width: 40,
              height: 40,
              borderRadius: "50%",
              bgcolor: (theme) =>
                alpha(
                  theme.palette.primary.main,
                  theme.palette.mode === "dark" ? 0.18 : 0.1,
                ),
            }}
          >
            {icon}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h4" component="div" sx={{ fontWeight: 500 }}>
              {value}
            </Typography>
            <Typography variant="body2">{label}</Typography>
            {note && (
              <Typography variant="caption" color="text.secondary" component="div">
                {note}
              </Typography>
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
