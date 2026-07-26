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
            sx={{ maxWidth: 400 }}
          >
            {this.state.error?.message || "An unexpected error occurred."}
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
