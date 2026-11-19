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
    <header className="relative mb-4 overflow-hidden rounded-xl bg-[linear-gradient(120deg,#0a2463_0%,#12357f_55%,#1d4fb8_100%)] px-5 py-4 text-white shadow-card sm:px-6">
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
          <h1 className="m-0 mt-0.5 text-xl font-semibold tracking-tight sm:text-2xl">{greeting} 👋</h1>
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
  moving: "bg-[linear-gradient(135deg,#0f5c2c,#166534)]",
  idle: "bg-[linear-gradient(135deg,#8f3d06,#9a3412)]",
  stopped: "bg-[linear-gradient(135deg,#9c1818,#991b1b)]",
  offline: "bg-[linear-gradient(135deg,#526079,#3b4558)]",
  alert: "bg-[linear-gradient(135deg,#c81e2b,#991b1b)]",
  calm: "bg-[linear-gradient(135deg,#0a2463,#12357f)]",
  total: "bg-[linear-gradient(135deg,#1d4ed8,#12357f)]",
  waiting: "bg-[linear-gradient(135deg,#526079,#3b4558)]",
  pickup: "bg-[linear-gradient(135deg,#5a1fc0,#4527b8)]"
} as const;

export function Tile({ label, value, total, icon: Icon, look, hint, href, className, totalNoun = "fleet" }: { label: string; value: number; total?: number; icon: typeof Truck; look: keyof typeof TILE_LOOK; hint?: string; href: string; className?: string; /** "34% of fleet" / "34% of active loads". */ totalNoun?: string }) {
  const pct = total ? Math.round((value / total) * 100) : null;
  return (
    <Link
      href={href}
      className={cn("group relative flex items-center gap-3.5 overflow-hidden rounded-xl p-4 text-white no-underline shadow-card transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-offset-2", TILE_LOOK[look], className)}
    >
      <Icon aria-hidden="true" className="pointer-events-none absolute -bottom-4 -right-3 size-24 text-white/10 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} />
      <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-white/20 ring-1 ring-white/30">
        <Icon className="size-6" />
      </span>
      <span className="relative min-w-0">
        <span className="block text-[30px] font-bold leading-8 tabular-nums">{value}</span>
        <span className="block truncate text-sm font-semibold text-white/95">{label}</span>
        <span className="block truncate text-[11px] text-white/80">{pct !== null ? `${pct}% of ${totalNoun}${hint ? ` · ${hint}` : ""}` : (hint ?? (value === 0 ? "All caught up" : "Need a look"))}</span>
      </span>
    </Link>
  );
}

export const QA_TONE = {
  navy: "bg-primary-soft text-primary group-hover:bg-primary group-hover:text-white",
  green: "bg-success-soft text-success group-hover:bg-success group-hover:text-white",
  purple: "bg-[#e3d6fb] text-[#5a1fc0] dark:bg-white/10 dark:text-foreground group-hover:bg-[#5a1fc0] group-hover:text-white",
  amber: "bg-warning-soft text-warning group-hover:bg-warning group-hover:text-white",
  red: "bg-danger-soft text-danger group-hover:bg-danger group-hover:text-white"
} as const;

export function QuickAction({ href, icon: Icon, label, hint, tone }: { href: string; icon: typeof Truck; label: string; hint: string; tone: keyof typeof QA_TONE }) {
  return (
    <Link href={href} title={hint} className="group flex flex-col items-center gap-2 rounded-xl border border-border px-2 py-3.5 text-center text-foreground no-underline transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-pop">
      <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl transition-colors duration-200", QA_TONE[tone])}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="block w-full truncate text-[13px] font-semibold text-[#0a2463] dark:text-foreground">{label}</span>
    </Link>
  );
}
