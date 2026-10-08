import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items, onDark }: { items: Crumb[]; onDark?: boolean }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className={cn("m-0 flex list-none flex-wrap items-center gap-1 p-0 text-xs", onDark ? "text-white/75" : "text-muted-foreground")}>
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3" aria-hidden="true" />}
            {c.href && i < items.length - 1 ? (
              <Link href={c.href} className={cn("no-underline hover:underline", onDark ? "text-white/75 hover:text-white" : "text-muted-foreground hover:text-foreground")}>
                {c.label}
              </Link>
            ) : (
              <span aria-current={i === items.length - 1 ? "page" : undefined}>{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Page title + one-line purpose + primary actions, on a slim band in the brand colours.
 * Every page starts with this, so every screen opens the same way.
 */
export function PageHeader({ title, description, actions, breadcrumbs, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumbs?: Crumb[]; className?: string }) {
  return (
    <div className={cn("page-band relative mb-5 overflow-hidden rounded-xl bg-[linear-gradient(120deg,#0a2463_0%,#12357f_60%,#1d4fb8_100%)] px-4 py-4 text-white shadow-card sm:px-6", className)}>
      <svg aria-hidden="true" viewBox="0 0 300 100" preserveAspectRatio="xMaxYMid slice" className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-1/3 md:block">
        <path d="M120 100 170 0h22l-50 100z" fill="#ffffff" opacity="0.07" />
        <path d="M162 100 212 0h14l-50 100z" fill="#d81e2c" opacity="0.8" />
        <path d="M190 100 240 0h22l-50 100z" fill="#ffffff" opacity="0.08" />
      </svg>
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {breadcrumbs && breadcrumbs.length > 1 && <div className="mb-1"><Breadcrumbs items={breadcrumbs} onDark /></div>}
          <h1 className="m-0 text-xl font-semibold leading-7 tracking-tight text-white sm:text-[22px]">{title}</h1>
          {description && <p className="m-0 mt-0.5 max-w-3xl text-sm text-white/80">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
