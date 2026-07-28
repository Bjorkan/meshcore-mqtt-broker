import { useId, useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Pagination,
  Paper,
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

const TOPICS_PER_PAGE = 20;

function TopicList({ topics, label }: { topics: string[]; label: string }) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(topics.length / TOPICS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * TOPICS_PER_PAGE;
  const visibleTopics = topics.slice(pageStart, pageStart + TOPICS_PER_PAGE);

  if (topics.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No topics reported.
      </Typography>
    );
  }

  return (
    <Box>
      <Box
        component="ul"
        aria-label={label}
        sx={{
          display: "flex",
          gap: 0.75,
          flexWrap: "wrap",
          listStyle: "none",
          m: 0,
          p: 0,
        }}
      >
        {visibleTopics.map((topic, index) => (
          <Box
            component="li"
            key={`${topic}-${pageStart + index}`}
            sx={{ maxWidth: "100%", minWidth: 0 }}
          >
            <Chip
              label={topic}
              size="small"
              variant="outlined"
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
          </Box>
        ))}
      </Box>
      {pageCount > 1 && (
        <Pagination
          count={pageCount}
          page={currentPage}
          onChange={(_, nextPage) => setPage(nextPage)}
          showFirstButton
          showLastButton
          size="small"
          aria-label={`${label} pages`}
          sx={{
            mt: 1,
            "& .MuiPaginationItem-root": { minWidth: 44, height: 44 },
          }}
        />
      )}
    </Box>
  );
}

export default function SubscriberDetail({
  sub,
  onClose,
}: SubscriberDetailProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const titleId = useId();

  return (
    <Dialog
      open
      fullWidth
      fullScreen={fullScreen}
      maxWidth="md"
      onClose={onClose}
      aria-labelledby={titleId}
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
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          minWidth: 0,
          flexShrink: 0,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <DialogTitle
          id={titleId}
          sx={{
            minWidth: 0,
            flex: 1,
            overflowWrap: "anywhere",
            borderBottom: 0,
            pr: 1,
          }}
        >
          {sub.username}
        </DialogTitle>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          sx={{ width: 48, height: 48, flexShrink: 0, mr: 1 }}
        >
          <CloseIcon />
        </IconButton>
      </Box>
      <DialogContent
        sx={{
          p: { xs: 2, sm: 3 },
          overflowY: "auto",
          flex: 1,
        }}
      >
        <Stack spacing={2.5}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(3, minmax(0, 1fr))",
              },
              gap: 1.5,
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
            <TopicList topics={sub.subscriptions} label="Subscriber topics" />
            {sub.subscriptionsTruncated && (
              <Typography
                variant="caption"
                color="warning.main"
                sx={{ mt: 0.5, display: "block", overflowWrap: "anywhere" }}
              >
                The broker truncated the subscription list.
              </Typography>
            )}
          </Box>

          <Box>
            <Typography variant="h6" gutterBottom>
              Subscriber brokers ({sub.brokers.length})
            </Typography>
            {sub.brokers.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No broker summaries were reported.
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {sub.brokers.map((broker, index) => (
                  <Paper
                    key={`${broker.brokerId}-${index}`}
                    variant="outlined"
                    sx={{ p: 2 }}
                  >
                    <Typography
                      variant="subtitle1"
                      sx={{ overflowWrap: "anywhere" }}
                    >
                      {broker.brokerId || "Unknown broker"}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 0.5, overflowWrap: "anywhere" }}
                    >
                      Connections: {numberFormat.format(broker.connectionCount)}
                      <br />
                      Last seen: {optionalStockholmTime(broker.lastSeenAt)}
                    </Typography>
                    <Box sx={{ mt: 1.5 }}>
                      <Typography
                        variant="subtitle2"
                        color="text.secondary"
                        gutterBottom
                      >
                        Subscriptions
                      </Typography>
                      <TopicList
                        topics={broker.subscriptions}
                        label={`Subscriptions for broker ${broker.brokerId || "unknown"}`}
                      />
                    </Box>
                    {broker.subscriptionsTruncated && (
                      <Typography
                        variant="caption"
                        color="warning.main"
                        sx={{
                          mt: 1,
                          display: "block",
                          overflowWrap: "anywhere",
                        }}
                      >
                        The broker truncated this broker's subscription list.
                      </Typography>
                    )}
                  </Paper>
                ))}
              </Stack>
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
                  <Paper
                    key={`${connection.brokerId}-${connection.clientId}-${index}`}
                    variant="outlined"
                    sx={{ p: 2 }}
                  >
                    <Typography variant="subtitle2" color="text.secondary">
                      Client ID
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ overflowWrap: "anywhere", mb: 0.5 }}
                    >
                      {connection.clientId || "—"}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ overflowWrap: "anywhere" }}
                    >
                      Broker: {connection.brokerId || "—"}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mb: 1.5 }}
                    >
                      Last seen: {optionalStockholmTime(connection.lastSeenAt)}
                    </Typography>
                    <Typography
                      variant="subtitle2"
                      color="text.secondary"
                      gutterBottom
                    >
                      Subscriptions
                    </Typography>
                    <TopicList
                      topics={connection.subscriptions}
                      label={`Subscriptions for client ${connection.clientId || "unknown"}`}
                    />
                    {connection.subscriptionsTruncated && (
                      <Typography
                        variant="caption"
                        color="warning.main"
                        sx={{
                          mt: 1,
                          display: "block",
                          overflowWrap: "anywhere",
                        }}
                      >
                        The broker truncated this connection's subscription
                        list.
                      </Typography>
                    )}
                  </Paper>
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
