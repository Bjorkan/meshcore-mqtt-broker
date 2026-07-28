import { Typography } from "@mui/material";
import { stockholmShortTime } from "../../helpers/time.js";

export interface TimeAgoProps {
  timestamp: number;
}

export default function TimeAgo({ timestamp }: TimeAgoProps) {
  return (
    <Typography variant="body2" color="text.secondary">
      {stockholmShortTime(timestamp)}
    </Typography>
  );
}
