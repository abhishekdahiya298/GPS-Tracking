import type { ReactNode } from "react";
import { BrandMark } from "@/components/app/brand-mark";

const STATE = { moving: "#22c55e", idle: "#f59e0b", stopped: "#3b82f6", offline: "#8a93a1" };
const ROUTE_A = "M-10 150 C 70 150 90 86 160 90 S 270 170 340 120 S 430 60 470 70";
const ROUTE_B = "M40 300 C 70 230 150 240 190 190 S 250 90 300 40 S 330 -6 340 -20";

/** A small live-map illustration for the sign-in brand panel (example data, not a real fleet). */
function MiniMap() {
  const dot = (path: string, cls: string, delay: string) => (
    <g className={cls} style={{ offsetPath: `path("${path}")`, animationDelay: delay }} aria-hidden="true">
      <circle r="9" fill={STATE.moving} opacity="0.25" />
      <circle r="5.5" fill={STATE.moving} stroke="#ffffff" strokeWidth="2" />
    </g>
  );
  return (
    <svg viewBox="0 0 460 300" className="h-auto w-full" role="img" aria-label="Illustration of vehicles moving on a live map">
      <defs>
        <clipPath id="auth-rounded">
          <rect width="460" height="300" rx="18" />
        </clipPath>
      </defs>
      <g clipPath="url(#auth-rounded)">
        <rect width="460" height="300" fill="rgba(255,255,255,0.06)" />
        <path d="M0 210 Q 120 180 220 220 T 460 200 V300 H0z" fill="rgba(56,130,246,0.18)" />
        <path d="M300 0h160v90q-80 30-160-20z" fill="rgba(34,197,94,0.14)" />
        <path d="M0 0h130v70Q60 96 0 60z" fill="rgba(34,197,94,0.12)" />
        <g fill="none" stroke="rgba(255,255,255,0.18)" strokeLinecap="round">
          <path d={ROUTE_A} strokeWidth="11" />
          <path d={ROUTE_B} strokeWidth="11" />
          <path d="M0 60 C 120 40 200 60 460 30" strokeWidth="7" />
          <path d="M110 0 C 120 110 90 200 130 300" strokeWidth="7" />
          <path d="M380 0 C 370 100 400 190 380 300" strokeWidth="7" />
        </g>
        <path d={ROUTE_A} fill="none" stroke="#9db9ff" strokeWidth="2.5" strokeDasharray="2 10" strokeLinecap="round" className="auth-dash" opacity="0.8" />
        <path d="M214 96 l46 0 l22 38 l-22 38 l-46 0 l-22 -38z" fill="rgba(157,185,255,0.12)" stroke="#9db9ff" strokeWidth="1.5" strokeDasharray="5 4" />
        <text x="237" y="138" textAnchor="middle" fontSize="11" fontWeight="600" fill="#cdd9ff">Yard</text>
        {dot(ROUTE_A, "auth-drive", "0s")}
        {dot(ROUTE_A, "auth-drive", "-9s")}
        {dot(ROUTE_B, "auth-drive-2", "-4s")}
        <circle cx="246" cy="152" r="5.5" fill={STATE.stopped} stroke="#ffffff" strokeWidth="2" aria-hidden="true" />
        <circle cx="96" cy="228" r="5.5" fill={STATE.idle} stroke="#ffffff" strokeWidth="2" aria-hidden="true" />
      </g>
    </svg>
  );
}

const STATS = [
  ["Moving", "12", STATE.moving],
  ["Idling", "3", STATE.idle],
  ["Stopped", "8", STATE.stopped],
  ["Offline", "1", STATE.offline]
] as const;

/** Split sign-in frame: a brand panel on the left (large screens), the form on the right. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh bg-background">
      <aside className="relative hidden w-1/2 max-w-xl flex-col justify-between overflow-hidden bg-[linear-gradient(150deg,#071a4a_0%,#0a2463_45%,#1d4fb8_100%)] px-10 py-12 text-white lg:flex xl:px-14">
        {/* Logo stripes, faint, in the corner. */}
        <svg aria-hidden="true" viewBox="0 0 400 300" preserveAspectRatio="xMaxYMin slice" className="pointer-events-none absolute right-0 top-0 h-80 w-2/3 opacity-60">
          <path d="M150 300 290 0h46L196 300z" fill="#ffffff" opacity="0.05" />
          <path d="M226 300 366 0h26L272 300z" fill="#d81e2c" opacity="0.7" />
          <path d="M274 300 414 0h46L320 300z" fill="#ffffff" opacity="0.06" />
        </svg>
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-24 size-96 rounded-full bg-[#2f5bea] opacity-25 blur-3xl" />

        <div className="relative">
          <span className="inline-flex items-center rounded-xl bg-white px-4 py-2.5 shadow-pop">
            <BrandMark className="h-12" />
          </span>
        </div>

        <div className="relative my-8">
          <h2 className="auth-rise m-0 max-w-md text-[34px] font-semibold leading-[1.1] tracking-tight xl:text-[40px]">
            Know where every truck and trailer is, <span className="bg-[linear-gradient(90deg,#ffffff,#9db9ff)] bg-clip-text text-transparent">right now.</span>
          </h2>
          <p className="auth-rise auth-rise-1 m-0 mt-4 max-w-md text-[15px] leading-7 text-white/75">
            One live map for your whole fleet, the history of every trip, and an alert the moment something needs attention.
          </p>
          <div className="auth-rise auth-rise-2 auth-float mt-8 rounded-2xl border border-white/15 bg-white/[0.07] p-3 shadow-[0_24px_60px_rgb(3_12_40_/_0.45)] backdrop-blur">
            <MiniMap />
            <div className="mt-3 grid grid-cols-4 gap-2">
              {STATS.map(([label, n, color]) => (
                <div key={label} className="rounded-lg bg-white/[0.06] px-2 py-2 text-center">
                  <div className="text-lg font-semibold leading-6 tabular-nums" style={{ color }}>
                    {n}
                  </div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-white/60">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <ul className="auth-rise auth-rise-3 relative m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-sm text-white/70">
          {["Canada and United States", "Miles or kilometres", "Works on any screen"].map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7ee2a8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m5 12 5 5 9-10" />
              </svg>
              {t}
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex w-full flex-col items-center justify-center px-5 py-10 lg:w-1/2 lg:flex-1">
        <div className="mb-8 lg:hidden">
          <BrandMark className="h-16" />
        </div>
        <div className="auth-rise w-full max-w-sm">{children}</div>
        <p className="mt-8 text-xs text-muted-foreground">Fleet GPS tracking for Canada and the United States</p>
      </div>
    </main>
  );
}
