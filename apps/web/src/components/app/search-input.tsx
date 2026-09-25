"use client";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/** Debounced search box (default 250 ms) with a clear button. */
export function SearchInput({ value, onChange, placeholder = "Search…", label = "Search", debounceMs = 250, className }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; debounceMs?: number; className?: string }) {
  const [text, setText] = useState(value);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => cb.current(text), debounceMs);
    return () => clearTimeout(t);
  }, [text, value, debounceMs]);
  return (
    <div className={cn("relative w-full sm:w-64", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="box-border block h-9 w-full rounded-md border border-input bg-background pl-8 pr-8 text-sm text-foreground shadow-card placeholder:text-muted-foreground focus-visible:border-ring [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <button type="button" aria-label="Clear search" onClick={() => { setText(""); cb.current(""); }} className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-muted-foreground hover:bg-muted">
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
