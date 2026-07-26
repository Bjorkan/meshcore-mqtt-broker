import Chip from "@mui/material/Chip";

export type StatusColor = "success" | "error" | "warning" | "default";

export interface StatusBadgeProps {
  label: string;
  color: StatusColor;
}

export function StatusBadge({ label, color }: StatusBadgeProps) {
  return (
    <Chip
      label={label}
      color={color}
      size="small"
      variant={color === "default" ? "outlined" : "filled"}
    />
  );
}
