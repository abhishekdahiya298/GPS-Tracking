import { Package, Users } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";

type Stat = { label: string; tone: "green" | "orange" | "red" | "blue" };
const TONE: Record<Stat["tone"], string> = {
  green: "bg-success-soft text-success",
  orange: "bg-warning-soft text-warning",
  red: "bg-danger-soft text-danger",
  blue: "bg-primary-soft text-primary"
};
const THEME = {
  drivers: { from: "#14b8a6", to: "#0f766e", tint: "#ecfdf8", ring: "#99e6d4", text: "#0f766e" },
  loads: { from: "#7c3aed", to: "#4338ca", tint: "#f3f0ff", ring: "#c9bdfb", text: "#4338ca" }
} as const;

/**
 * Drivers | Loads switch at the top of the Drivers page. On plans without Loads in the side
 * menu (RIO Fleet), this is where a carrier finds the loads of their own drivers.
 * Each side shows its count and what needs attention, so the user knows before switching.
 */
export function DriversTabs({ active, drivers, loads }: { active: "drivers" | "loads"; drivers: { count: number; stats: Stat[] }; loads: { count: number; stats: Stat[] } | null }) {
  const tabs = [
    { key: "drivers" as const, label: "Drivers", href: "/drivers", icon: Users, ...drivers },
    ...(loads ? [{ key: "loads" as const, label: "Loads", href: "/drivers/loads", icon: Package, ...loads }] : [])
  ];
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Drivers and loads" className="mb-4 flex flex-wrap items-center gap-3">
      <div className="inline-flex flex-wrap gap-2 rounded-2xl bg-card p-1.5 shadow-[0_1px_2px_rgba(15,23,42,.05),inset_0_0_0_1px_var(--color-border)]">
        {tabs.map((t) => {
          const on = t.key === active;
          const th = THEME[t.key];
          const Icon = t.icon;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={cn("flex items-center gap-3 rounded-xl py-2 pl-2.5 pr-4 no-underline transition-[background,box-shadow,opacity] duration-200 hover:opacity-100", !on && "opacity-80 hover:bg-muted/60")}
              style={on ? { background: `linear-gradient(135deg, ${th.tint}, transparent 70%)`, boxShadow: `inset 0 0 0 1.5px ${th.ring}, 0 8px 18px -8px ${th.to}66` } : undefined}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: `linear-gradient(135deg, ${th.from}, ${th.to})`, boxShadow: `0 4px 10px -3px ${th.to}88` }}>
                <Icon className="size-[18px]" aria-hidden="true" />
              </span>
              <span className="grid min-w-0 gap-1">
                <span className="flex items-center gap-2">
                  <b className="text-[15px]" style={{ color: on ? th.text : "var(--color-foreground)" }}>
                    {t.label}
                  </b>
                  <span className={cn("grid h-5 min-w-[22px] place-items-center rounded-full px-1.5 text-[11.5px] font-extrabold", on ? "text-white" : "bg-muted text-muted-foreground")} style={on ? { background: th.text } : undefined}>
                    {t.count}
                  </span>
                </span>
                {t.stats.length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {t.stats.map((s) => (
                      <span key={s.label} className={cn("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-bold", TONE[s.tone])}>
                        {s.label}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
