import { useState, useMemo } from "react";
import type { BanSummary, SortDir } from "../types.js";
import { StatusBadge } from "../components/shared/status-badge.js";
import { shortKey, numberFormat } from "../helpers/time.js";
import { formatDeniedUntilLabel } from "../helpers/format.js";
import {
  Box,
  Paper,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableSortLabel,
  TableContainer,
} from "@mui/material";

interface BansProps {
  bans: BanSummary[];
  onSelectBan: (ban: BanSummary) => void;
}

function formatPublicMuteReason(reason: string): string {
  const map: Record<string, string> = {
    spam: "Spam/high rate",
    flood: "Message flood",
    invalid_json: "Invalid JSON",
    empty_payload: "Empty payload",
    missing_origin_id: "Missing origin_id",
    origin_mismatch: "origin_id mismatch",
    invalid_origin_length: "Invalid origin length",
    key_length: "Invalid key length",
    encoded_origin: "Encoded origin",
    invalid_topic: "Invalid topic",
    subscription_limit: "Subscription limit",
    spoofed_region: "Spoofed region",
    invalid_iata: "Invalid IATA",
    duplicate: "Duplicate message",
    rapid_publish: "Rapid publishing",
    excessive_messages: "Excessive messages",
    retry_storm: "Retry storm",
    no_subtopic: "No subtopic",
    blocked_origin: "Blocked origin",
  };
  return map[reason] ?? reason;
}

export default function BansView({ bans, onSelectBan }: BansProps) {
  const [sortField, setSortField] = useState("blockCount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const s = [...bans].sort((a, b) => {
      let av: any = (a as any)[sortField];
      let bv: any = (b as any)[sortField];
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av < bv) return -1;
      if (av > bv) return 1;
      return 0;
    });
    if (sortDir === "desc") s.reverse();
    return s;
  }, [bans, sortField, sortDir]);

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function renderSortLabel(field: string, label: string) {
    return (
      <TableSortLabel
        active={sortField === field}
        direction={sortField === field ? sortDir : "asc"}
        onClick={() => handleSort(field)}
      >
        {label}
      </TableSortLabel>
    );
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3, fontWeight: 600 }}>
        Bans
      </Typography>

      {bans.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <Typography variant="h6" color="text.secondary">
            No active bans
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            All observers are currently operating within acceptable limits.
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined">
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>
                    {renderSortLabel("node", "Observer / Key")}
                  </TableCell>
                  <TableCell>{renderSortLabel("reason", "Reason")}</TableCell>
                  <TableCell>
                    <TableSortLabel
                      active={sortField === "blockCount"}
                      direction={sortField === "blockCount" ? sortDir : "asc"}
                      onClick={() => handleSort("blockCount")}
                    >
                      Blocks
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>{renderSortLabel("status", "Status")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sorted.map((ban, idx) => (
                  <TableRow
                    key={`${ban.node}-${idx}`}
                    hover
                    onClick={() => onSelectBan(ban)}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {ban.label || shortKey(ban.node)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {shortKey(ban.node)}
                      </Typography>
                      {ban.region && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          component="div"
                        >
                          {ban.region}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {formatPublicMuteReason(ban.reason)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {numberFormat.format(ban.blockCount)} blocks
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        component="div"
                      >
                        {formatDeniedUntilLabel(ban)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {ban.status === "muted" || ban.status === "denied" ? (
                        <StatusBadge label="Blocked" color="error" />
                      ) : (
                        <StatusBadge label="Warning" color="warning" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  );
}
