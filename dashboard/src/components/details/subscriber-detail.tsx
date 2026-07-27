import CloseIcon from "@mui/icons-material/Close";
import {
  Box,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { SubscriberConnectionEntry } from "../../types.js";
import { optionalStockholmTime, numberFormat } from "../../helpers/time.js";

export interface SubscriberDetailProps {
  sub: SubscriberConnectionEntry;
  onClose: () => void;
}

function TopicList({ topics }: { topics: string[] }) {
  if (topics.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No topics reported.
      </Typography>
    );
  }

  return (
    <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
      {topics.map((topic, index) => (
        <Chip
          key={`${topic}-${index}`}
          label={topic}
          size="small"
          variant="outlined"
          title={topic}
          sx={{
            maxWidth: "100%",
            height: "auto",
            minHeight: 24,
            "& .MuiChip-label": {
              py: 0.25,
              whiteSpace: "normal",
              overflowWrap: "anywhere",
            },
          }}
        />
      ))}
    </Box>
  );
}

export default function SubscriberDetail({
  sub,
  onClose,
}: SubscriberDetailProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));

  return (
    <Dialog
      open
      fullWidth
      fullScreen={fullScreen}
      maxWidth="md"
      scroll="paper"
      onClose={onClose}
    >
      <DialogTitle
        sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}
      >
        <Typography
          variant="h6"
          component="div"
          sx={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}
        >
          {sub.username}
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
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(3, minmax(0, 1fr))",
              },
              gap: 2,
            }}
          >
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Active connections
              </Typography>
              <Typography variant="body2">
                {numberFormat.format(sub.connectionCount)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Unique subscriptions
              </Typography>
              <Typography variant="body2">
                {numberFormat.format(sub.subscriptions.length)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Last active
              </Typography>
              <Typography variant="body2">
                {optionalStockholmTime(sub.lastSeenAt)}
              </Typography>
            </Box>
          </Box>

          <Box>
            <Typography variant="h6" gutterBottom>
              Subscribed topics
            </Typography>
            <TopicList topics={sub.subscriptions.slice(0, 50)} />
            {sub.subscriptions.length > 50 && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mt: 1, display: "block" }}
              >
                {sub.subscriptions.length - 50} additional topics are not shown.
              </Typography>
            )}
            {sub.subscriptionsTruncated && (
              <Typography
                variant="caption"
                color="warning.main"
                sx={{ mt: 0.5, display: "block" }}
              >
                The broker truncated the subscription list.
              </Typography>
            )}
          </Box>

          <Box>
            <Typography variant="h6" gutterBottom>
              Active connections ({sub.connections.length})
            </Typography>
            {sub.connections.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No active connection details were reported.
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {sub.connections.map((connection, index) => (
                  <Card
                    key={`${connection.brokerId}-${connection.clientId}-${index}`}
                    variant="outlined"
                  >
                    <CardContent>
                      <Typography
                        variant="subtitle1"
                        sx={{ overflowWrap: "anywhere", mb: 0.5 }}
                      >
                        {connection.clientId}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Broker: {connection.brokerId || "—"}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 1.5 }}
                      >
                        Last seen:{" "}
                        {optionalStockholmTime(connection.lastSeenAt)}
                      </Typography>
                      <TopicList topics={connection.subscriptions} />
                      {connection.subscriptionsTruncated && (
                        <Typography
                          variant="caption"
                          color="warning.main"
                          sx={{ mt: 1, display: "block" }}
                        >
                          The broker truncated this connection’s subscription
                          list.
                        </Typography>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
