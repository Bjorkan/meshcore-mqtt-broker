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
  formatDenialStatus,
} from "../../helpers/format.js";
import {
  shortKey,
  optionalStockholmTime,
  numberFormat,
} from "../../helpers/time.js";
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
  const banStatus = formatDenialStatus(ban.status);

  return (
    <Dialog
      open
      fullWidth
      fullScreen={fullScreen}
      maxWidth="sm"
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            display: "flex",
            flexDirection: "column",
            maxHeight: { xs: "100%", sm: "calc(100vh - 64px)" },
          },
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          minWidth: 0,
          flexShrink: 0,
        }}
      >
        <Typography
          variant="h6"
          component="div"
          sx={{
            minWidth: 0,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
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
      <DialogContent
        sx={{
          p: { xs: 2, sm: 3 },
          overflowX: "hidden",
          overflowY: "auto",
          flex: 1,
        }}
      >
        <Stack spacing={2.5}>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, pt: 0.5 }}>
            <StatusBadge label={banStatus.label} color={banStatus.color} />
            {regionDisplay && (
              <Chip
                label={
                  regionDisplay.countyName
                    ? `${regionDisplay.countyName} (${regionDisplay.code})`
                    : regionDisplay.code
                }
                size="small"
                variant="outlined"
                sx={{
                  maxWidth: "100%",
                  height: "auto",
                  minHeight: 24,
                  "& .MuiChip-label": { whiteSpace: "normal", py: 0.25 },
                }}
              />
            )}
          </Box>

          <Box>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Node / public key
            </Typography>
            <Paper
              component="code"
              sx={{
                display: "block",
                p: 1.5,
                fontSize: "0.8125rem",
                lineHeight: 1.6,
                overflowWrap: "anywhere",
                userSelect: "all",
                bgcolor: "action.hover",
                borderRadius: 1,
              }}
            >
              {ban.node}
            </Paper>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, minmax(0, 1fr))",
              },
              gap: 2,
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
            <Box sx={{ gridColumn: { sm: "1 / -1" } }}>
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
              <Typography
                variant="subtitle2"
                color="text.secondary"
                gutterBottom
              >
                MQTT topic
              </Typography>
              <Paper
                component="code"
                sx={{
                  display: "block",
                  p: 1.5,
                  fontSize: "0.8125rem",
                  lineHeight: 1.6,
                  overflowWrap: "anywhere",
                  userSelect: "all",
                  bgcolor: "action.hover",
                  borderRadius: 1,
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
