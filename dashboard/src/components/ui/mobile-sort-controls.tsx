import { useId } from "react";
import ArrowDownward from "@mui/icons-material/ArrowDownward";
import ArrowUpward from "@mui/icons-material/ArrowUpward";
import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Tooltip from "@mui/material/Tooltip";
import type { SortDir } from "../../types.js";

export interface MobileSortOption {
  value: string;
  label: string;
}

export interface MobileSortControlsProps {
  field: string;
  direction: SortDir;
  options: MobileSortOption[];
  onFieldChange: (field: string) => void;
  onDirectionToggle: () => void;
}

export function MobileSortControls({
  field,
  direction,
  options,
  onFieldChange,
  onDirectionToggle,
}: MobileSortControlsProps) {
  const labelId = useId();

  return (
    <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
      <FormControl size="small" fullWidth>
        <InputLabel id={labelId}>Sort by</InputLabel>
        <Select
          labelId={labelId}
          value={field}
          label="Sort by"
          onChange={(event) => onFieldChange(event.target.value)}
        >
          {options.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Tooltip
        title={direction === "asc" ? "Sort descending" : "Sort ascending"}
      >
        <IconButton
          aria-label={
            direction === "asc" ? "Sort descending" : "Sort ascending"
          }
          onClick={onDirectionToggle}
          color="primary"
          sx={{ width: 48, height: 48, flexShrink: 0 }}
        >
          {direction === "asc" ? <ArrowUpward /> : <ArrowDownward />}
        </IconButton>
      </Tooltip>
    </Box>
  );
}
