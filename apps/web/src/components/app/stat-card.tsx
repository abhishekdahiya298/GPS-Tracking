import { Activity, CircleParking, Clock, Gauge, Hash, Route, Timer, Truck, type LucideIcon, Building2, Cpu, Package, ReceiptText } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** One look per kind of number, so the same measure has the same icon and tint on every page. */
const LOOKS: { match: RegExp; icon: LucideIcon; tint: string }[] = [
  { match: /distance|mileage/i, icon: Route, tint: "bg-[#dbe4f8] text-[#133a8f] dark:bg-white/10 dark:text-foreground" },
  { match: /speed/i, icon: Gauge, tint: "bg-[#f6cdcd] text-[#ad1f1f] dark:bg-white/10 dark:text-foreground" },
  { match: /idling/i, icon: Activity, tint: "bg-[#fcd9b2] text-[#a3470a] dark:bg-white/10 dark:text-foreground" },
  { match: /stop|parked/i, icon: CircleParking, tint: "bg-[#f6cdcd] text-[#ad1f1f] dark:bg-white/10 dark:text-foreground" },
  { match: /longest|over limit/i, icon: Timer, tint: "bg-[#e3d6fb] text-[#6526d1] dark:bg-white/10 dark:text-foreground" },
  { match: /time/i, icon: Clock, tint: "bg-[#c8e8d2] text-[#136c35] dark:bg-white/10 dark:text-foreground" },
  { match: /vehicle/i, icon: Truck, tint: "bg-[#ccede6] text-[#0f766e] dark:bg-white/10 dark:text-foreground" },
  { match: /customer/i, icon: Building2, tint: "bg-[#dbe4f8] text-[#133a8f] dark:bg-white/10 dark:text-foreground" },
  { match: /tracker/i, icon: Cpu, tint: "bg-[#d6eaf7] text-[#0369a1] dark:bg-white/10 dark:text-foreground" },
  { match: /load/i, icon: Package, tint: "bg-[#c8e8d2] text-[#136c35] dark:bg-white/10 dark:text-foreground" },
  { match: /total|amount/i, icon: ReceiptText, tint: "bg-[#fde4c0] text-[#a3470a] dark:bg-white/10 dark:text-foreground" }
];
const FALLBACK = { icon: Hash, tint: "bg-[#dbe4f8] text-[#133a8f] dark:bg-white/10 dark:text-foreground" };

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
