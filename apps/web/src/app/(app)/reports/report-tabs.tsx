import { CircleParking, Gauge, Milestone, Power, Route, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";

export const REPORT_TABS = [
  { id: "trips", label: "Trips", href: "/reports", icon: Route },
  { id: "stops", label: "Stops", href: "/reports/stops", icon: CircleParking },
  { id: "idling", label: "Idling", href: "/reports/idling", icon: Power },
  { id: "speeding", label: "Speeding", href: "/reports/speeding", icon: Gauge },
  { id: "mileage", label: "Mileage", href: "/reports/mileage", icon: Milestone }
] as const satisfies readonly { id: string; label: string; href: string; icon: LucideIcon }[];
export type ReportTabId = (typeof REPORT_TABS)[number]["id"];

/** Report picker. Plain links: each report has its own shareable URL and works without JS. */
export function ReportTabs({ active }: { active: ReportTabId }) {
  return (
    <nav aria-label="Report type" className="mb-4 overflow-x-auto pb-1">
      <ul className="m-0 inline-flex list-none gap-2 p-0">
        {REPORT_TABS.map((t) => {
          const Icon = t.icon;
          const on = t.id === active;
          return (
            <li key={t.id}>
              <Link
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-xl border px-4 text-sm font-semibold no-underline shadow-card transition-all",
                  on ? "border-[#0a2463] bg-[linear-gradient(135deg,#12357f,#0a2463)] text-white" : "border-border bg-background text-foreground hover:-translate-y-px hover:border-primary/40"
                )}
              >
                <Icon className={cn("size-4", on ? "text-white" : "text-primary")} aria-hidden="true" />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
