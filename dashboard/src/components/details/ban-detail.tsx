import CloseIcon from "@mui/icons-material/Close";
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { BanSummary, CountyLookupEntry } from "../../types.js";
import {
  formatDeniedUntilLabel,
  formatPublicMuteReason,
  formatRegionDisplay,
} from "../../helpers/format.js";
import { shortKey, optionalStockholmTime, numberFormat } from "../../helpers/time.js";
import { StatusBadge } from "../shared/status-badge.js";

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
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const regionDisplay = ban.region
    ? formatRegionDisplay(ban.region, countyLookup)
    : null;

  const deniedUntilLabel = formatDeniedUntilLabel({
    status: ban.status,
    deniedUntilText: ban.deniedUntilText,
    mutedUntil: ban.mutedUntil,
  });
  const blocked = ban.status === "denied" || ban.status === "muted";

  return (
    <Dialog
      open
      fullWidth
      fullScreen={fullScreen}
      maxWidth="sm"
      scroll="paper"
      onClose={onClose}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
        <Typography
          variant="h6"
          component="div"
          sx={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}
        >
          {ban.label || shortKey(ban.node)}
        </Typography>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          sx={{ width: 48, height: 48, flexShrink: 0, mr: -1 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: { xs: 2, sm: 3 }, overflowX: "hidden" }}>
        <Stack spacing={3}>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            <StatusBadge
              label={blocked ? "Blocked" : "Warning"}
              color={blocked ? "error" : "warning"}
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
                sx={{ maxWidth: "100%", height: "auto", minHeight: 24, "& .MuiChip-label": { whiteSpace: "normal", py: 0.25 } }}
              />
            )}
          </Box>

          <Box>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Node / public key
            </Typography>
            <Paper
              variant="outlined"
              component="code"
              sx={{
                display: "block",
                p: 1.5,
                fontSize: "0.8125rem",
                lineHeight: 1.6,
                overflowWrap: "anywhere",
                userSelect: "all",
                bgcolor: "action.hover",
              }}
            >
              {ban.node}
            </Paper>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
              gap: 2.5,
            }}
          >
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Reason
              </Typography>
              <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                {formatPublicMuteReason(ban.reason)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Action / expiry
              </Typography>
              <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                {deniedUntilLabel}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Block count
              </Typography>
              <Typography variant="body2">
                {numberFormat.format(ban.blockCount)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Last seen
              </Typography>
              <Typography variant="body2">
                {ban.lastUpdatedAt
                  ? optionalStockholmTime(ban.lastUpdatedAt)
                  : "—"}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Broker
              </Typography>
              <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                {ban.broker || "—"}
              </Typography>
            </Box>
          </Box>

          {ban.topic && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                MQTT topic
              </Typography>
              <Paper
                variant="outlined"
                component="code"
                sx={{
                  display: "block",
                  p: 1.5,
                  fontSize: "0.8125rem",
                  lineHeight: 1.6,
                  overflowWrap: "anywhere",
                  userSelect: "all",
                  bgcolor: "action.hover",
                }}
              >
                {ban.topic}
              </Paper>
            </Box>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
