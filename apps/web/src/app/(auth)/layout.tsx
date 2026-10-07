import type { ReactNode } from "react";
import { BrandMark } from "@/components/app/brand-mark";

/** Centered card frame for sign-in and password pages. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="mb-6">
        <BrandMark className="h-12" wordClassName="text-2xl" />
      </div>
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-card sm:p-7">{children}</div>
      <p className="mt-6 text-xs text-muted-foreground">Fleet GPS tracking for Canada and the United States</p>
    </main>
  );
}
