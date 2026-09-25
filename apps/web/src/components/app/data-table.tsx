"use client";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type VisibilityState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Pagination } from "./pagination";

/**
 * Server-driven table (TanStack Table in manual mode): the server does search,
 * sort and paging; this component renders one page, sort headers, column
 * visibility, a mobile card layout and pagination.
 */
export interface ColumnMeta {
  /** Server sort key; the header becomes a sort button when set. */
  sortKey?: string;
  className?: string;
  /** Column can be hidden via the Columns menu. */
  hideable?: boolean;
  label?: string;
}

export function DataTable<T>({
  columns,
  data,
  getRowId,
  total,
  page,
  pageSize,
  sort,
  direction,
  onSort,
  onPage,
  onRowClick,
  rowLabel,
  mobileRow,
  loading,
  empty,
  toolbar
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  getRowId: (row: T) => string;
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  direction: "asc" | "desc";
  onSort: (key: string, direction: "asc" | "desc") => void;
  onPage: (page: number) => void;
  onRowClick?: (row: T) => void;
  /** Accessible name for a clickable row (e.g. "Open Truck 7"). */
  rowLabel?: (row: T) => string;
  /** Card rendering below the md breakpoint. */
  mobileRow?: (row: T) => ReactNode;
  loading?: boolean;
  empty: ReactNode;
  toolbar?: ReactNode;
}) {
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const table = useReactTable({
    data,
    columns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    state: { columnVisibility: visibility },
    onColumnVisibilityChange: setVisibility
  });
  const hideable = table.getAllLeafColumns().filter((c) => (c.columnDef.meta as ColumnMeta | undefined)?.hideable);

  return (
    <div aria-busy={loading || undefined} className={cn("transition-opacity", loading && "opacity-60")}>
      {(toolbar || hideable.length > 0) && (
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center">
          {toolbar}
          {hideable.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" className="hidden md:inline-flex sm:ml-auto">
                  <Columns3 aria-hidden="true" /> Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                {hideable.map((c) => (
                  <DropdownMenuItem
                    key={c.id}
                    onSelect={(e) => {
                      e.preventDefault();
                      c.toggleVisibility();
                    }}
                  >
                    <input type="checkbox" readOnly checked={c.getIsVisible()} className="size-4 accent-primary" aria-hidden="true" tabIndex={-1} />
                    {(c.columnDef.meta as ColumnMeta | undefined)?.label ?? c.id}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {data.length === 0 ? (
        empty
      ) : (
        <>
          {/* Desktop / tablet: table */}
          <div className={cn("w-full overflow-x-auto", mobileRow && "hidden md:block")}>
            <table className="w-full border-collapse text-sm">
              <thead className="bg-canvas">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => {
                      const meta = h.column.columnDef.meta as ColumnMeta | undefined;
                      const active = meta?.sortKey && meta.sortKey === sort;
                      return (
                        <th
                          key={h.id}
                          scope="col"
                          aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined}
                          className={cn("h-10 whitespace-nowrap border-b border-border px-3 text-left text-xs font-medium text-muted-foreground first:pl-4 last:pr-4", meta?.className)}
                        >
                          {h.isPlaceholder ? null : meta?.sortKey ? (
                            <button
                              type="button"
                              onClick={() => onSort(meta.sortKey!, active && direction === "asc" ? "desc" : "asc")}
                              className="-mx-1 inline-flex cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-1 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                            >
                              {flexRender(h.column.columnDef.header, h.getContext())}
                              {active ? direction === "asc" ? <ArrowUp className="size-3.5" aria-hidden="true" /> : <ArrowDown className="size-3.5" aria-hidden="true" /> : <ArrowUpDown className="size-3.5 opacity-40" aria-hidden="true" />}
                            </button>
                          ) : (
                            flexRender(h.column.columnDef.header, h.getContext())
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={onRowClick ? (e) => {
                      // Don't hijack clicks on buttons/links/menus inside the row.
                      if ((e.target as HTMLElement).closest("button, a, input, [role=menuitem]")) return;
                      onRowClick(row.original);
                    } : undefined}
                    className={cn("border-b border-border last:border-b-0", onRowClick && "cursor-pointer hover:bg-canvas")}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={cn("px-3 py-2.5 align-middle first:pl-4 last:pr-4", (cell.column.columnDef.meta as ColumnMeta | undefined)?.className)}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Phone: cards */}
          {mobileRow && (
            <ul className="m-0 list-none divide-y divide-border p-0 md:hidden">
              {data.map((row) => (
                <li key={getRowId(row)}>
                  {onRowClick ? (
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={rowLabel?.(row)}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("button, a")) return;
                        onRowClick(row);
                      }}
                      onKeyDown={(e) => {
                        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }}
                      className="cursor-pointer px-4 py-3 hover:bg-canvas"
                    >
                      {mobileRow(row)}
                    </div>
                  ) : (
                    <div className="px-4 py-3">{mobileRow(row)}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={onPage} />}
    </div>
  );
}
