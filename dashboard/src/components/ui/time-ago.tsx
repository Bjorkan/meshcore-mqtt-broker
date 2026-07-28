import { Typography } from "@mui/material";
import {
  isValidTimestamp,
  stockholmShortTime,
  stockholmTime,
} from "../../helpers/time.js";

export interface TimeAgoProps {
  timestamp: number;
}

export default function TimeAgo({ timestamp }: TimeAgoProps) {
  const valid = isValidTimestamp(timestamp);

  if (!valid) {
    return (
      <Typography
        component="span"
        color="text.secondary"
        variant="body2"
        sx={{ display: "inline" }}
      >
        -
      </Typography>
    );
  }

  return (
    <Typography
      component="time"
      color="text.secondary"
      dateTime={new Date(timestamp).toISOString()}
      title={stockholmTime(timestamp)}
      variant="body2"
      sx={{ display: "inline" }}
    >
      {stockholmShortTime(timestamp)}
    </Typography>
  );
}
