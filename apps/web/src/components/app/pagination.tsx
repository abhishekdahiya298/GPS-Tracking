"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "../ui/button";

/** "1–25 of 132" + previous/next. Pages are 1-based. */
export function Pagination({ page, pageSize, total, onPageChange }: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-sm text-muted-foreground">
      <span aria-live="polite">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <IconButton label="Previous page" size="icon-sm" variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft aria-hidden="true" />
        </IconButton>
        <span className="px-2 tabular-nums">
          {page} / {pages}
        </span>
        <IconButton label="Next page" size="icon-sm" variant="secondary" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          <ChevronRight aria-hidden="true" />
        </IconButton>
      </div>
    </nav>
  );
}
