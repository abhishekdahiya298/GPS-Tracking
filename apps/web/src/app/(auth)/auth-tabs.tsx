import { LogIn, Sparkles } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * Sign in | Create account switch at the top of /login and /signup. Both pages share the auth
 * layout, so switching feels like one page while each keeps its own address (bookmarks,
 * links from riogps.com and email links keep working).
 */
export function AuthTabs({ active, next }: { active: "signin" | "signup"; next?: string }) {
  const tabs = [
    { key: "signin" as const, href: next && next !== "/dashboard" ? `/login?next=${encodeURIComponent(next)}` : "/login", label: "Sign in", hint: "I have an account", Icon: LogIn },
    { key: "signup" as const, href: "/signup", label: "Create account", hint: "Free, no card", Icon: Sparkles }
  ];
  return (
    <nav aria-label="Sign in or create account" className="mb-6 grid grid-cols-2 gap-1.5 rounded-2xl bg-[linear-gradient(180deg,#eef3fb,#e6ecf7)] p-1.5 ring-1 ring-inset ring-[#dbe3ef] dark:bg-muted dark:ring-border">
      {tabs.map(({ key, href, label, hint, Icon }) => {
        const on = key === active;
        return (
          <Link
            key={key}
            href={href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "relative flex min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 no-underline transition-colors",
              on ? "bg-[linear-gradient(135deg,#1849c6,#0a2463)] text-white shadow-[0_8px_18px_-8px_rgb(10_36_99_/_0.7)]" : "text-foreground hover:bg-white/60 dark:hover:bg-background/40"
            )}
          >
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", on ? "bg-white/15" : "bg-background text-primary ring-1 ring-inset ring-[#dbe3ef] dark:ring-border")}>
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 leading-tight">
              <b className="block truncate text-sm">{label}</b>
              <span className={cn("block truncate text-[11.5px] font-medium", on ? "text-white/75" : "text-muted-foreground")}>{hint}</span>
            </span>
            {key === "signup" && (
              <span className="absolute -top-2 right-2 rounded-full bg-[linear-gradient(90deg,#22c55e,#15803d)] px-1.5 py-px text-[10px] font-extrabold tracking-wide text-white shadow-sm">FREE</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
