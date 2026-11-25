import type { LucideIcon } from "lucide-react";

const TONE = {
  blue: "linear-gradient(150deg,#2456d6,#12357f)",
  green: "linear-gradient(150deg,#1d8a47,#0f5c2c)",
  orange: "linear-gradient(150deg,#d4560f,#8f3d06)",
  red: "linear-gradient(150deg,#d81e2c,#991b1b)"
} as const;

export function AuthHeading({ title, description, compact, icon: Icon, tone = "blue" }: { title: string; description?: string; compact?: boolean; icon?: LucideIcon; tone?: keyof typeof TONE }) {
  return (
    <div className={compact ? "mb-1" : "mb-5"}>
      {Icon && (
        <span className="mb-3 grid size-12 place-items-center rounded-xl text-white shadow-card" style={{ background: TONE[tone] }}>
          <Icon className="size-6" aria-hidden="true" />
        </span>
      )}
      <h1 className={`m-0 font-semibold tracking-tight text-[#0a2463] dark:text-foreground ${compact ? "text-[22px]" : "text-2xl"}`}>{title}</h1>
      {description && <p className="m-0 mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
