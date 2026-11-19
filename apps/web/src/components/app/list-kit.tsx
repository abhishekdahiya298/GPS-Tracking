"use client";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { IconButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Building blocks shared by every list page (trackers, SIMs, customers…), so tables look and
 * behave the same: compact coloured filter tiles, a coloured icon cell and inline row actions.
 */

export interface TileOption<T extends string> {
  value: T;
  label: string;
  count: number;
  icon: LucideIcon;
  /** Hex colour of this state; the tile is tinted with it and filled when selected. */
  color: string;
}

/** One row of compact, colour-coded filter tiles (count + label). Acts as a radio group. */
export function FilterTiles<T extends string>({ value, options, onChange, label }: { value: T; options: TileOption<T>[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="mb-3 flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            style={{
              borderColor: on ? o.color : `color-mix(in srgb, ${o.color} 28%, var(--color-border))`,
              background: on ? `linear-gradient(135deg, ${o.color}, color-mix(in srgb, ${o.color} 72%, #000))` : `linear-gradient(135deg, var(--color-background) 40%, color-mix(in srgb, ${o.color} 13%, var(--color-background)))`
            }}
            className={cn(
              "group inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl border pl-1.5 pr-3 text-left shadow-card transition-all duration-150 hover:-translate-y-px",
              on ? "text-white" : "text-foreground"
            )}
          >
            <span className="grid size-8 place-items-center rounded-lg" style={{ background: on ? "rgb(255 255 255 / 0.2)" : `color-mix(in srgb, ${o.color} 16%, transparent)`, color: on ? "#fff" : o.color }}>
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span className="text-base font-semibold tabular-nums">{o.count}</span>
            <span className={cn("whitespace-nowrap text-[13px] font-medium", on ? "text-white/90" : "text-muted-foreground")}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** First cell of a row: a tinted icon tile, a title and up to two quiet lines. */
export function IconCell({ icon: Icon, color, title, lines }: { icon: LucideIcon; color: string; title: ReactNode; lines?: ReactNode[] }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 25%, transparent)` }}>
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{title}</div>
        {lines?.filter(Boolean).map((l, i) => (
          <div key={i} className="truncate text-xs text-muted-foreground">
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface RowAction {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  /** "danger" for destructive actions (red). */
  tone?: "danger";
  /** Icon colour; defaults to a meaning-based colour from ACTION_COLOR or the brand blue. */
  color?: string;
  hidden?: boolean;
  /** Renders a link instead of a button. */
  href?: string;
}

/** One colour per kind of action, the same on every page. */
export const ACTION_COLOR = {
  map: "#1d4ed8",
  history: "#6d28d9",
  edit: "#b45309",
  link: "#0f766e",
  unlink: "#c2410c",
  share: "#0369a1",
  danger: "#b91c1c",
  neutral: "#475569"
} as const;

/** Meaning-based colour from the action's label, so every page colours the same action the same way. */
function colorFor(label: string): string {
  const l = label.toLowerCase();
  if (/unassign|take (out|off)|return|unlink|remove from/.test(l)) return ACTION_COLOR.unlink;
  if (/map/.test(l)) return ACTION_COLOR.map;
  if (/trip|history|track/.test(l)) return ACTION_COLOR.history;
  if (/edit|rename/.test(l)) return ACTION_COLOR.edit;
  if (/assign|move|put |link|stock/.test(l)) return ACTION_COLOR.link;
  if (/share/.test(l)) return ACTION_COLOR.share;
  if (/deactivate|retire|delete/.test(l)) return ACTION_COLOR.danger;
  return ACTION_COLOR.neutral;
}

/** Inline icon buttons at the end of a row (each with a tooltip and its own colour), instead of a hidden "…" menu. */
export function RowActions({ actions, children }: { actions: RowAction[]; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {actions
        .filter((a) => !a.hidden)
        .map((a) => {
          const Icon = a.icon;
          const color = a.color ?? (a.tone === "danger" ? ACTION_COLOR.danger : colorFor(a.label));
          const style = { color, background: `color-mix(in srgb, ${color} 9%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 18%, transparent)` };
          const cls = "size-8 rounded-lg transition-transform hover:-translate-y-px hover:brightness-110 [&_svg]:size-4";
          return a.href ? (
            <IconButton key={a.label} asChild label={a.label} size="icon-sm" variant="ghost" className={cls} style={style}>
              <Link href={a.href}>
                <Icon aria-hidden="true" />
              </Link>
            </IconButton>
          ) : (
            <IconButton key={a.label} label={a.label} size="icon-sm" variant="ghost" onClick={a.onClick} className={cls} style={style}>
              <Icon aria-hidden="true" />
            </IconButton>
          );
        })}
      {children}
    </div>
  );
}
