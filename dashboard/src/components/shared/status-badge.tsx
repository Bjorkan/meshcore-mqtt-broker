import Chip from "@mui/material/Chip";
import { useTheme } from "@mui/material/styles";

export type StatusColor = "success" | "error" | "warning" | "default";

export interface StatusBadgeProps {
  label: string;
  color: StatusColor;
}

export function StatusBadge({ label, color }: StatusBadgeProps) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";

  return (
    <Chip
      label={label}
      color={color}
      size="small"
      variant={color === "default" ? "outlined" : "filled"}
      sx={{
        fontWeight: 500,
        flexShrink: 0,
        ...(color !== "default" && {
          border: "1px solid",
          borderColor: dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)",
        }),
      }}
    />
  );
}
