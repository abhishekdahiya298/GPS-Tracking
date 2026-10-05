import Link from "next/link";
import { cn } from "@/lib/cn";

export const REPORT_TABS = [
  { id: "trips", label: "Trips", href: "/reports" },
  { id: "stops", label: "Stops", href: "/reports/stops" },
  { id: "idling", label: "Idling", href: "/reports/idling" },
  { id: "speeding", label: "Speeding", href: "/reports/speeding" },
  { id: "mileage", label: "Mileage", href: "/reports/mileage" }
] as const;
export type ReportTabId = (typeof REPORT_TABS)[number]["id"];

/** Report picker. Plain links: each report has its own shareable URL and works without JS. */
export function ReportTabs({ active }: { active: ReportTabId }) {
  return (
    <nav aria-label="Report type" className="mb-4 overflow-x-auto">
      <ul className="m-0 inline-flex list-none gap-1 rounded-lg bg-muted p-1">
        {REPORT_TABS.map((t) => (
          <li key={t.id}>
            <Link
              href={t.href}
              aria-current={t.id === active ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center whitespace-nowrap rounded-md px-3 text-sm font-medium no-underline transition-colors",
                t.id === active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
