"use client";
import { EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { HIDE_DEMO_COOKIE } from "@/lib/demo-pref-shared";

/** "Hide demo accounts" switch for the platform console. Remembered in this browser; the server filters the lists. */
export function HideDemoToggle({ hidden, className, onDark }: { hidden: boolean; className?: string; onDark?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const change = (v: boolean) => {
    document.cookie = `${HIDE_DEMO_COOKIE}=${v ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
    start(() => router.refresh());
  };
  return (
    <label
      className={cn(
        "inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13px] font-medium",
        onDark ? "border-white/25 bg-white/10 text-white" : hidden ? "border-[#5a1fc0]/40 bg-[#5a1fc0]/10 text-[#5a1fc0] dark:text-[#c4b0f5]" : "border-border bg-background",
        pending && "opacity-60",
        className
      )}
    >
      <EyeOff className="size-4" aria-hidden="true" />
      Hide demo accounts
      <Switch checked={hidden} onCheckedChange={change} label="Hide demo accounts" disabled={pending} />
    </label>
  );
}

/** Small violet tag marking a demo / test customer. */
export function DemoTag({ className }: { className?: string }) {
  return <span className={cn("inline-flex h-5 items-center rounded-md bg-[#5a1fc0]/12 px-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#5a1fc0] dark:bg-[#5a1fc0]/30 dark:text-[#d9ccfa]", className)}>Demo</span>;
}
