import { Component, type ErrorInfo, type ReactNode } from "react";
import { Box, Typography, Button } from "@mui/material";
import ErrorOutlinedIcon from "@mui/icons-material/ErrorOutlined";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const FALLBACK_MESSAGE = "An unexpected error occurred.";
const MAX_ERROR_MESSAGE_LENGTH = 500;

function safeErrorMessage(error: Error | null): string {
  const message = error?.message
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!message) return FALLBACK_MESSAGE;
  return message.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Dashboard error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box
          role="alert"
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "40vh",
            gap: 2,
            textAlign: "center",
            p: 3,
          }}
        >
          <ErrorOutlinedIcon sx={{ fontSize: 64, color: "error.main" }} />
          <Typography variant="h6">Something went wrong</Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              maxWidth: 400,
              overflowWrap: "anywhere",
              whiteSpace: "pre-wrap",
            }}
          >
            {safeErrorMessage(this.state.error)}
          </Typography>
          <Button
            variant="outlined"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            Reload dashboard
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}
