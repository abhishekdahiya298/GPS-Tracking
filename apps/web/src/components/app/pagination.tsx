"use client";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "../ui/button";

/** Page numbers to show: always the first and last, the current one with a neighbour each side, "…" for gaps. */
export function pageList(page: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  if (page <= 3) [2, 3, 4].forEach((n) => keep.add(n));
  if (page >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((n) => keep.add(n));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1]! > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

/**
 * "1–25 of 132", page numbers and first / previous / next / last. Pages are 1-based. With
 * `onPageSizeChange`, a rows-per-page picker is shown too.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizes = [25, 50, 100]
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizes?: number[];
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-sm text-muted-foreground">
      <span className="flex items-center gap-3">
        <span aria-live="polite" className="tabular-nums">
          <span className="font-semibold text-foreground">
            {from.toLocaleString("en-US")}–{to.toLocaleString("en-US")}
          </span>{" "}
          of {total.toLocaleString("en-US")}
        </span>
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5">
            <span className="hidden sm:inline">Rows</span>
            <select
              aria-label="Rows per page"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
            >
              {pageSizes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <IconButton label="First page" size="icon-sm" variant="secondary" disabled={page <= 1} onClick={() => onPageChange(1)} className="hidden sm:inline-flex">
            <ChevronsLeft aria-hidden="true" />
          </IconButton>
          <IconButton label="Previous page" size="icon-sm" variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft aria-hidden="true" />
          </IconButton>
          <span className="hidden items-center gap-1 sm:flex">
            {pageList(page, pages).map((n, i) =>
              n === "gap" ? (
                <span key={`g${i}`} aria-hidden="true" className="px-1">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  aria-label={`Page ${n}`}
                  aria-current={n === page ? "page" : undefined}
                  onClick={() => n !== page && onPageChange(n)}
                  className={cn(
                    "h-8 min-w-8 cursor-pointer rounded-md border-0 px-2 text-sm font-semibold tabular-nums",
                    n === page ? "bg-primary text-primary-foreground" : "bg-transparent text-foreground hover:bg-muted"
                  )}
                >
                  {n}
                </button>
              )
            )}
          </span>
          <span className="px-2 tabular-nums sm:hidden">
            {page} / {pages}
          </span>
          <IconButton label="Next page" size="icon-sm" variant="secondary" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
            <ChevronRight aria-hidden="true" />
          </IconButton>
          <IconButton label="Last page" size="icon-sm" variant="secondary" disabled={page >= pages} onClick={() => onPageChange(pages)} className="hidden sm:inline-flex">
            <ChevronsRight aria-hidden="true" />
          </IconButton>
        </div>
      )}
    </nav>
  );
}
