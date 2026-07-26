import CloseIcon from "@mui/icons-material/Close";
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Typography,
} from "@mui/material";
import type { SubscriberConnectionEntry } from "../../types.js";
import { optionalStockholmTime } from "../../helpers/time.js";

export interface SubscriberDetailProps {
  sub: SubscriberConnectionEntry;
  onClose: () => void;
}

export default function SubscriberDetail({
  sub,
  onClose,
}: SubscriberDetailProps) {
  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {sub.username}
        <IconButton aria-label="Close" onClick={onClose} sx={{ ml: "auto" }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Box sx={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Active Connections
              </Typography>
              <Typography variant="body2">{sub.connectionCount}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Unique Subscriptions
              </Typography>
              <Typography variant="body2">
                {sub.subscriptions.length}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Last Active
              </Typography>
              <Typography variant="body2">
                {optionalStockholmTime(sub.lastSeenAt)}
              </Typography>
            </Box>
          </Box>

          <Box>
            <Typography variant="h6" gutterBottom>
              Subscribed Topics
            </Typography>
            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
              {sub.subscriptions.slice(0, 50).map((topic) => (
                <Chip
                  key={topic}
                  label={topic}
                  size="small"
                  variant="outlined"
                />
              ))}
              {sub.subscriptions.length > 50 && (
                <Chip
                  label={`+${sub.subscriptions.length - 50} more`}
                  size="small"
                  variant="outlined"
                  color="primary"
                />
              )}
            </Box>
            {sub.subscriptionsTruncated && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mt: 0.5, display: "block" }}
              >
                Subscription list truncated.
              </Typography>
            )}
          </Box>

          <Box>
            <Typography variant="h6" gutterBottom>
              Active Connections ({sub.connections.length})
            </Typography>
            <List dense>
              {sub.connections.map((conn) => (
                <ListItem key={conn.clientId} sx={{ px: 0 }}>
                  <ListItemText
                    primary={conn.clientId}
                    secondary={
                      <Box
                        component="span"
                        sx={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 0.5,
                        }}
                      >
                        <Box component="span">
                          Broker: {conn.brokerId} · Last seen:{" "}
                          {optionalStockholmTime(conn.lastSeenAt)}
                        </Box>
                        <Box
                          component="span"
                          sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}
                        >
                          {conn.subscriptions.map((topic) => (
                            <Chip
                              key={topic}
                              label={topic}
                              size="small"
                              variant="outlined"
                            />
                          ))}
                        </Box>
                        {conn.subscriptionsTruncated && (
                          <Box
                            component="span"
                            sx={{
                              color: "text.secondary",
                              fontSize: "0.75rem",
                            }}
                          >
                            Subscription list truncated.
                          </Box>
                        )}
                      </Box>
                    }
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
