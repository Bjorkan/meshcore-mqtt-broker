import { MenuItem, TextField } from "@mui/material";
import type { CountyLookupEntry } from "../../types.js";
import { formatRegionOptionLabel } from "../../helpers/format.js";

export interface RegionFilterProps {
  regions: string[];
  selectedRegion: string;
  onChange: (region: string) => void;
  countyLookup?: Record<string, CountyLookupEntry>;
}

export default function RegionFilter({
  regions,
  selectedRegion,
  onChange,
  countyLookup,
}: RegionFilterProps) {
  return (
    <TextField
      select
      variant="outlined"
      label="Region"
      size="small"
      fullWidth
      value={selectedRegion}
      onChange={(e) => onChange(e.target.value)}
    >
      <MenuItem value="">All regions</MenuItem>
      {regions.map((region) => (
        <MenuItem key={region} value={region}>
          {formatRegionOptionLabel(region, countyLookup)}
        </MenuItem>
      ))}
    </TextField>
  );
}
