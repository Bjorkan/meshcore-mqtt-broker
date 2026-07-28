import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import { IconButton, InputAdornment, TextField, Tooltip } from "@mui/material";
import { useId, useRef } from "react";

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
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClear = () => {
    onChange("");
    inputRef.current?.focus();
  };

  return (
    <TextField
      fullWidth
      id={inputId}
      inputRef={inputRef}
      label="Search"
      placeholder={placeholder}
      size="small"
      variant="outlined"
      value={value}
      slotProps={{
        input: {
          sx: { minHeight: 44 },
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
                  edge="end"
                  sx={{ width: 48, height: 48 }}
                  onClick={handleClear}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ) : undefined,
        },
        inputLabel: { shrink: true },
      }}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
