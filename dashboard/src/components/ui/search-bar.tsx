import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import { IconButton, InputAdornment, TextField, Tooltip } from "@mui/material";

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function SearchBar({
  value,
  onChange,
  placeholder,
}: SearchBarProps) {
  return (
    <TextField
      variant="outlined"
      size="small"
      fullWidth
      placeholder={placeholder}
      aria-label={placeholder || "Search"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
          endAdornment: value ? (
            <InputAdornment position="end">
              <Tooltip title="Clear search">
                <IconButton
                  aria-label="Clear search"
                  size="small"
                  edge="end"
                  onClick={() => onChange("")}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ) : undefined,
        },
      }}
    />
  );
}
