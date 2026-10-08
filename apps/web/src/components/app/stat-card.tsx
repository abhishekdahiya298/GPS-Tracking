import { Activity, CircleParking, Clock, Gauge, Hash, Route, Timer, Truck, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** One look per kind of number, so the same measure has the same icon and tint on every page. */
const LOOKS: { match: RegExp; icon: LucideIcon; tint: string }[] = [
  { match: /distance|mileage/i, icon: Route, tint: "bg-[#e9eefb] text-[#133a8f]" },
  { match: /speed/i, icon: Gauge, tint: "bg-[#fdecec] text-[#c42b2b]" },
  { match: /idling/i, icon: Activity, tint: "bg-[#fff5e1] text-[#b45309]" },
  { match: /stop|parked/i, icon: CircleParking, tint: "bg-[#e8f4fb] text-[#0369a1]" },
  { match: /longest|over limit/i, icon: Timer, tint: "bg-[#f1edff] text-[#5b3fd6]" },
  { match: /time/i, icon: Clock, tint: "bg-[#e9f7ee] text-[#15803d]" },
  { match: /vehicle/i, icon: Truck, tint: "bg-[#e8f8f5] text-[#0f766e]" }
];
const FALLBACK = { icon: Hash, tint: "bg-[#e9eefb] text-[#133a8f]" };

/** Summary number with a tinted icon. Used above report tables and anywhere a page leads with totals. */
export function StatCard({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  const look = LOOKS.find((l) => l.match.test(label)) ?? FALLBACK;
  const Icon = look.icon;
  return (
    <div className={cn("flex items-center gap-3 rounded-xl border border-border bg-background p-4 shadow-card", className)}>
      <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", look.tint)}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-0.5 truncate text-2xl font-semibold leading-8 tabular-nums text-foreground">{value}</div>
      </div>
    </div>
  );
}
