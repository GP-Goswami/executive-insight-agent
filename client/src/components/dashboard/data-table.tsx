import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (row: T) => React.ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  page?: number;
  pageSize?: number;
  totalItems?: number;
  onPageChange?: (page: number) => void;
  isLoading?: boolean;
  emptyMessage?: string;
  testIdPrefix?: string;
}

export function DataTable<T extends object>({
  columns,
  data,
  page = 1,
  pageSize = 10,
  totalItems,
  onPageChange,
  isLoading = false,
  emptyMessage = "No data available",
  testIdPrefix = "table",
}: DataTableProps<T>) {
  const totalPages = totalItems ? Math.ceil(totalItems / pageSize) : 1;
  const showPagination = totalItems && totalItems > pageSize;

  const getCellValue = (row: T, column: Column<T>) => {
    if (column.render) {
      return column.render(row);
    }
    const value = row[column.key as keyof T];
    if (typeof value === "number") {
      return value.toLocaleString();
    }
    return String(value ?? "-");
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-white/10 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 bg-background/50">
              {columns.map((column, i) => (
                <TableHead
                  key={i}
                  className={cn(
                    "text-xs uppercase tracking-wide text-muted-foreground font-semibold",
                    column.align === "right" && "text-right",
                    column.align === "center" && "text-center"
                  )}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, rowIndex) => (
              <TableRow key={rowIndex} className="border-white/5">
                {columns.map((_, cellIndex) => (
                  <TableCell key={cellIndex}>
                    <div className="h-4 shimmer rounded" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 p-12 text-center">
        <p className="text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid={`${testIdPrefix}-container`}>
      <div className="rounded-xl border border-white/10 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 bg-background/50">
              {columns.map((column, i) => (
                <TableHead
                  key={i}
                  className={cn(
                    "text-xs uppercase tracking-wide text-muted-foreground font-semibold",
                    column.align === "right" && "text-right",
                    column.align === "center" && "text-center",
                    column.className
                  )}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, rowIndex) => (
              <TableRow
                key={rowIndex}
                className={cn(
                  "border-white/5 transition-colors",
                  rowIndex % 2 === 0 ? "bg-transparent" : "bg-muted/20"
                )}
                data-testid={`${testIdPrefix}-row-${rowIndex}`}
              >
                {columns.map((column, cellIndex) => (
                  <TableCell
                    key={cellIndex}
                    className={cn(
                      "py-3",
                      column.align === "right" && "text-right font-mono",
                      column.align === "center" && "text-center",
                      column.className
                    )}
                  >
                    {getCellValue(row, column)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {showPagination && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalItems)} of {totalItems} results
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(page - 1)}
              disabled={page <= 1}
              className="border-white/10"
              data-testid="button-prev-page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(page + 1)}
              disabled={page >= totalPages}
              className="border-white/10"
              data-testid="button-next-page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
