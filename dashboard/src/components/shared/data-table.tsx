import type { ReactNode } from "react";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import TableSortLabel from "@mui/material/TableSortLabel";
import TableContainer from "@mui/material/TableContainer";
import Paper from "@mui/material/Paper";
import type { SortDir } from "../../types.js";

export interface DataTableColumn<T> {
  field: string;
  label: string;
  render: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  sortField: string;
  sortDir: SortDir;
  onSort: (field: string) => void;
  onClickRow?: (row: T) => void;
  emptyState?: ReactNode;
  getRowId?: (row: T) => string;
}

export function DataTable<T>({
  columns,
  data,
  sortField,
  sortDir,
  onSort,
  onClickRow,
  emptyState,
  getRowId,
}: DataTableProps<T>) {
  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            {columns.map((col) => (
              <TableCell
                key={col.field}
                sortDirection={sortField === col.field ? sortDir : false}
              >
                <TableSortLabel
                  active={sortField === col.field}
                  direction={sortField === col.field ? sortDir : "asc"}
                  onClick={() => onSort(col.field)}
                >
                  {col.label}
                </TableSortLabel>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {data.map((row, index) => (
            <TableRow
              key={getRowId ? getRowId(row) : index}
              hover={!!onClickRow}
              onClick={onClickRow ? () => onClickRow(row) : undefined}
              sx={onClickRow ? { cursor: "pointer" } : undefined}
            >
              {columns.map((col) => (
                <TableCell key={col.field}>{col.render(row)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
