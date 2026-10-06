import Link from "next/link";
import { cn } from "@/lib/cn";

const TABS = [
  { id: "service", label: "Service", href: "/maintenance" },
  { id: "renewals", label: "Renewals", href: "/maintenance/renewals" }
] as const;

/** Service reminders (by distance/time since service) and renewals (fixed expiry dates). */
export function MaintenanceTabs({ active, renewalsDue = 0 }: { active: "service" | "renewals"; renewalsDue?: number }) {
  return (
    <nav aria-label="Maintenance sections" className="mb-4">
      <ul className="m-0 inline-flex list-none gap-1 rounded-lg bg-muted p-1">
        {TABS.map((t) => (
          <li key={t.id}>
            <Link
              href={t.href}
              aria-current={t.id === active ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium no-underline transition-colors",
                t.id === active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
              {t.id === "renewals" && renewalsDue > 0 && (
                <span className="rounded-full bg-danger px-1.5 text-[11px] font-semibold leading-4 text-white">
                  {renewalsDue}
                  <span className="sr-only"> due or overdue</span>
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
