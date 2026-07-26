import { Alert, Box, CircularProgress, Typography } from "@mui/material";

export interface LoaderProps {
  error?: string | null;
}

export default function Loader({ error }: LoaderProps) {
  if (error) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <Alert severity="error" sx={{ maxWidth: 500, width: "100%" }}>
          <Typography>{error}</Typography>
        </Alert>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        py: 8,
        gap: 2,
      }}
    >
      <CircularProgress />
      <Typography variant="body2" color="text.secondary">
        Loading...
      </Typography>
    </Box>
  );
}
