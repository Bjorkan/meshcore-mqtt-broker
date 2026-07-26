import CloseIcon from "@mui/icons-material/Close";
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from "@mui/material";
import type { BanSummary, CountyLookupEntry } from "../../types.js";
import {
  formatDeniedUntilLabel,
  formatRegionDisplay,
} from "../../helpers/format.js";
import { shortKey, optionalStockholmTime } from "../../helpers/time.js";

export interface BanDetailProps {
  ban: BanSummary;
  countyLookup?: Record<string, CountyLookupEntry>;
  onClose: () => void;
}

export default function BanDetail({
  ban,
  countyLookup,
  onClose,
}: BanDetailProps) {
  const regionDisplay = ban.region
    ? formatRegionDisplay(ban.region, countyLookup)
    : null;

  const deniedUntilLabel = formatDeniedUntilLabel({
    status: ban.status,
    deniedUntilText: ban.deniedUntilText,
    mutedUntil: ban.mutedUntil,
  });

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {ban.label || shortKey(ban.node)}
        <IconButton aria-label="Close" onClick={onClose} sx={{ ml: "auto" }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            <Chip
              label={ban.status}
              color={
                ban.status === "denied"
                  ? "error"
                  : ban.status === "muted"
                    ? "warning"
                    : "default"
              }
              size="small"
            />
            {regionDisplay && (
              <Chip
                label={
                  regionDisplay.countyName
                    ? `${regionDisplay.countyName} (${regionDisplay.code})`
                    : regionDisplay.code
                }
                size="small"
                variant="outlined"
              />
            )}
          </Box>

          <Box>
            <Typography variant="subtitle2" color="text.secondary">
              Node / Public Key
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
              {ban.node}
            </Typography>
          </Box>

          <Box>
            <Typography variant="subtitle2" color="text.secondary">
              Reason
            </Typography>
            <Typography
              variant="body2"
              sx={{ wordBreak: "break-word", overflowWrap: "break-word" }}
            >
              {ban.reason}
            </Typography>
          </Box>

          <Box>
            <Typography variant="subtitle2" color="text.secondary">
              Action / Expiry
            </Typography>
            <Typography variant="body2">{deniedUntilLabel}</Typography>
          </Box>

          <Box sx={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Block Count
              </Typography>
              <Typography variant="body2">{ban.blockCount}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Last Seen
              </Typography>
              <Typography variant="body2">
                {ban.lastUpdatedAt
                  ? optionalStockholmTime(ban.lastUpdatedAt)
                  : "-"}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Broker
              </Typography>
              <Typography variant="body2">{ban.broker}</Typography>
            </Box>
          </Box>

          {ban.topic && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                MQTT Topic
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontFamily: "monospace", wordBreak: "break-all" }}
              >
                {ban.topic}
              </Typography>
            </Box>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
