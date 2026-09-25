import type { ReactNode } from "react";

/** Centered card frame for sign-in and password pages. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-lg font-semibold text-foreground">
        <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-white">
          R
        </span>
        RIO GPS
      </div>
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-card sm:p-7">{children}</div>
      <p className="mt-6 text-xs text-muted-foreground">Fleet GPS tracking · RIO California Inc</p>
    </main>
  );
}
