import { ArrowRight, Map as MapIcon, Truck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Building blocks shared by every dashboard (GPS, Loads, GPS + Loads), so the three look and
 * behave the same: brand banner, solid status tiles, quick actions.
 */

/** "Good morning" by the clock in the viewer's time zone. */
export function greeting(now: Date, timeZone: string): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Page banner in the brand colours: navy field, red and white stripes echoing the logo. */
export function Hero({ greeting, orgName, dateLabel, summary, action }: { greeting: string; orgName: string; dateLabel: string; summary: ReactNode; action?: { href: string; label: string; icon?: typeof Truck } }) {
  return (
    <header className="relative mb-5 overflow-hidden rounded-xl bg-[linear-gradient(120deg,#0a2463_0%,#12357f_55%,#1d4fb8_100%)] px-5 py-5 text-white shadow-card sm:px-7 sm:py-6">
      <svg aria-hidden="true" viewBox="0 0 400 160" preserveAspectRatio="xMaxYMid slice" className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-1/2 sm:block">
        <path d="M150 160 230 0h34l-80 160z" fill="#ffffff" opacity="0.07" />
        <path d="M214 160 294 0h22l-80 160z" fill="#d81e2c" opacity="0.85" />
        <path d="M258 160 338 0h34l-80 160z" fill="#ffffff" opacity="0.1" />
        <path d="M322 160 402 0h60v160z" fill="#ffffff" opacity="0.05" />
      </svg>
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-medium text-white/75">
            {dateLabel} · {orgName}
          </p>
          <h1 className="m-0 mt-1 text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">{greeting}</h1>
          <p className="m-0 mt-1.5 text-sm text-white/85">{summary}</p>
        </div>
        {action && (
          <Link href={action.href} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-[#0a2463] no-underline shadow-card transition-transform duration-150 hover:bg-white/90 active:scale-[0.97]">
            {(() => {
              const Icon = action.icon ?? MapIcon;
              return <Icon className="size-4" aria-hidden="true" />;
            })()}{" "}
            {action.label}
          </Link>
        )}
      </div>
    </header>
  );
}

/** Solid colour per status. Every pair is white text on a background of at least 4.5:1 contrast. */
export const TILE_LOOK = {
  moving: "bg-[linear-gradient(135deg,#15803d,#166534)]",
  idle: "bg-[linear-gradient(135deg,#b45309,#92400e)]",
  stopped: "bg-[linear-gradient(135deg,#0369a1,#075985)]",
  offline: "bg-[linear-gradient(135deg,#526079,#3b4558)]",
  alert: "bg-[linear-gradient(135deg,#c81e2b,#991b1b)]",
  calm: "bg-[linear-gradient(135deg,#0a2463,#12357f)]",
  waiting: "bg-[linear-gradient(135deg,#526079,#3b4558)]",
  pickup: "bg-[linear-gradient(135deg,#5b3fd6,#4527b8)]"
} as const;

export function Tile({ label, value, total, icon: Icon, look, hint, href, className, totalNoun = "fleet" }: { label: string; value: number; total?: number; icon: typeof Truck; look: keyof typeof TILE_LOOK; hint?: string; href: string; className?: string; /** "34% of fleet" / "34% of active loads". */ totalNoun?: string }) {
  const pct = total ? Math.round((value / total) * 100) : null;
  return (
    <Link
      href={href}
      className={cn("group relative block overflow-hidden rounded-xl p-4 text-white no-underline shadow-card transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-offset-2", TILE_LOOK[look], className)}
    >
      <Icon aria-hidden="true" className="pointer-events-none absolute -bottom-3 -right-2 size-20 text-white/15 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} />
      <p className="m-0 text-xs font-semibold uppercase tracking-wide text-white/85">{label}</p>
      <p className="m-0 mt-1.5 text-[34px] font-semibold leading-10 tabular-nums">{value}</p>
      <p className="m-0 mt-1 min-h-4 text-xs text-white/85">{pct !== null ? `${pct}% of ${totalNoun}${hint ? ` · ${hint}` : ""}` : value === 0 ? "All caught up" : "Need a look"}</p>
      {pct !== null && (
        <span aria-hidden="true" className="relative mt-2.5 block h-1 overflow-hidden rounded-full bg-white/25">
          <span className="block h-full origin-left animate-grow-x rounded-full bg-white" style={{ width: `${pct}%` }} />
        </span>
      )}
    </Link>
  );
}

export const QA_TONE = {
  navy: "bg-primary-soft text-primary group-hover:bg-primary group-hover:text-white",
  green: "bg-success-soft text-success group-hover:bg-success group-hover:text-white",
  purple: "bg-[#f1edff] text-[#5b3fd6] group-hover:bg-[#5b3fd6] group-hover:text-white",
  amber: "bg-warning-soft text-warning group-hover:bg-warning group-hover:text-white",
  red: "bg-danger-soft text-danger group-hover:bg-danger group-hover:text-white"
} as const;

export function QuickAction({ href, icon: Icon, label, hint, tone }: { href: string; icon: typeof Truck; label: string; hint: string; tone: keyof typeof QA_TONE }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-xl border border-border p-3 text-foreground no-underline transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-pop">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg transition-colors duration-200", QA_TONE[tone])}>
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-[#0a2463]">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
    </Link>
  );
}

