import type { ReactNode } from "react";
import { BrandMark } from "@/components/app/brand-mark";

const STATE = { moving: "#22c55e", idle: "#f59e0b", stopped: "#3b82f6", offline: "#8a93a1" };
const ROUTE_A = "M-10 150 C 70 150 90 86 160 90 S 270 170 340 120 S 430 60 470 70";
const ROUTE_B = "M40 300 C 70 230 150 240 190 190 S 250 90 300 40 S 330 -6 340 -20";

/** Small live-map illustration for the brand panel (example data, fills its box). */
function MiniMap() {
  const dot = (path: string, cls: string, delay: string) => (
    <g className={cls} style={{ offsetPath: `path("${path}")`, animationDelay: delay }} aria-hidden="true">
      <circle r="9" fill={STATE.moving} opacity="0.25" />
      <circle r="5.5" fill={STATE.moving} stroke="#ffffff" strokeWidth="2" />
    </g>
  );
  return (
    <svg viewBox="0 0 460 300" preserveAspectRatio="xMidYMid slice" className="h-full w-full" role="img" aria-label="Illustration of vehicles moving on a live map">
      <rect width="460" height="300" fill="rgba(255,255,255,0.05)" />
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
    </svg>
  );
}

const ICON = {
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5M12 8v4l3 2",
  zone: "m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3z",
  chart: "M6 3h9l4 4v14H6zM9 17v-3M12 17v-6M15 17v-4"
};
const FEATURES: [keyof typeof ICON, string][] = [
  ["map", "Live tracking"],
  ["history", "Trip history"],
  ["zone", "Zones & alerts"],
  ["chart", "Reports"]
];
const STATS = [
  ["Moving", "12", STATE.moving],
  ["Idling", "3", STATE.idle],
  ["Stopped", "8", STATE.stopped],
  ["Offline", "1", STATE.offline]
] as const;

/** Split sign-in frame, locked to one viewport (no page scroll): brand panel left, form right. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex h-dvh overflow-hidden bg-background">
      <aside className="relative hidden w-[46%] max-w-[860px] flex-col overflow-hidden bg-[linear-gradient(150deg,#071a4a_0%,#0a2463_45%,#1d4fb8_100%)] px-8 py-8 text-white lg:flex xl:px-12 2xl:px-16">
        <svg aria-hidden="true" viewBox="0 0 400 300" preserveAspectRatio="xMaxYMin slice" className="pointer-events-none absolute right-0 top-0 h-72 w-2/3 opacity-60">
          <path d="M150 300 290 0h46L196 300z" fill="#ffffff" opacity="0.05" />
          <path d="M226 300 366 0h26L272 300z" fill="#d81e2c" opacity="0.7" />
          <path d="M274 300 414 0h46L320 300z" fill="#ffffff" opacity="0.06" />
        </svg>
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-24 size-96 rounded-full bg-[#2f5bea] opacity-25 blur-3xl" />

        {/* Logo */}
        <div className="relative shrink-0">
          <span className="inline-flex items-center rounded-xl bg-white px-3.5 py-2 shadow-pop">
            <BrandMark className="h-10" />
          </span>
        </div>

        {/* Headline + subtext */}
        <div className="relative mt-7 shrink-0">
          <h2 className="auth-rise m-0 max-w-md text-[30px] font-semibold leading-[1.1] tracking-tight xl:text-[36px] 2xl:text-[42px]">
            Know where every truck and trailer is, <span className="bg-[linear-gradient(90deg,#ffffff,#9db9ff)] bg-clip-text text-transparent">right now.</span>
          </h2>
          <p className="auth-rise auth-rise-1 m-0 mt-3 max-w-md text-sm leading-6 text-white/75">
            One live map for your whole fleet, the history of every trip, and an alert the moment something needs attention.
          </p>
        </div>

        {/* Feature tiles */}
        <ul className="auth-rise auth-rise-2 relative mt-6 grid shrink-0 list-none grid-cols-2 gap-2.5 p-0">
          {FEATURES.map(([icon, label]) => (
            <li key={label} className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/10 text-[#9db9ff]">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={ICON[icon]} />
                </svg>
              </span>
              <span className="text-[13px] font-medium">{label}</span>
            </li>
          ))}
        </ul>

        {/* Live-map card fills the remaining height, so the panel always fits one screen */}
        <div className="auth-rise auth-rise-3 relative mt-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/15 bg-white/[0.06] p-2.5 shadow-[0_24px_60px_rgb(3_12_40_/_0.45)] backdrop-blur">
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl">
            <MiniMap />
          </div>
          <div className="mt-2.5 grid shrink-0 grid-cols-4 gap-2">
            {STATS.map(([label, n, color]) => (
              <div key={label} className="rounded-lg bg-white/[0.06] py-1.5 text-center">
                <div className="text-base font-semibold leading-5 tabular-nums" style={{ color }}>
                  {n}
                </div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-white/60">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Form column: scrolls on its own only if a small phone needs it, never the whole page */}
      <div className="flex w-full flex-col overflow-y-auto px-5 py-8 lg:w-1/2 lg:flex-1">
        <div className="m-auto w-full max-w-sm 2xl:max-w-md">
          <div className="mb-8 flex justify-center lg:hidden">
            <BrandMark className="h-14" />
          </div>
          <div className="auth-rise">{children}</div>
          <div className="mt-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3 4 6v6c0 5 3.5 7.5 8 9 4.5-1.5 8-4 8-9V6l-8-3z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            Your data is encrypted and private
          </div>
        </div>
      </div>
    </main>
  );
}
