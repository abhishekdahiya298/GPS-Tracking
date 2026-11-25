"use client";
import { Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";

const KEY = "rio.getAppChip.hidden";

/**
 * On a phone browser: a small "RIO GPS app · Get" chip, so a driver or fleet owner who opened a
 * link on the web can join in the app. Shown on phones only; closing it hides it for the visit.
 */
export function GetAppChip({ ios, android, label = "Drivers use the RIO GPS app", appLink }: { ios: string; android: string; label?: string; /** riogps:// link to open the app at the right place, when known. */ appLink?: string }) {
  const [platform, setPlatform] = useState<"ios" | "android" | null>(null);
  useEffect(() => {
    let hidden = false;
    try {
      hidden = window.sessionStorage.getItem(KEY) === "1";
    } catch {
      // ignore
    }
    if (hidden) return;
    const ua = navigator.userAgent;
    setPlatform(/iPhone|iPad|iPod/i.test(ua) ? "ios" : /Android/i.test(ua) ? "android" : null);
  }, []);
  if (!platform) return null;
  const store = platform === "ios" ? ios : android;
  return (
    <div role="region" aria-label="Get the RIO GPS app" className="fixed inset-x-3 top-3 z-50 flex items-center gap-2.5 rounded-2xl border border-border bg-background/95 py-2 pl-2 pr-2 shadow-pop backdrop-blur">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[linear-gradient(150deg,#2456d6,#0a2463)] text-white">
        <Smartphone className="size-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <b className="block truncate text-[13px]">RIO GPS app</b>
        <span className="block truncate text-[11.5px] text-muted-foreground">{label}</span>
      </span>
      {appLink && (
        <a href={appLink} className="inline-flex h-8 shrink-0 items-center rounded-full border border-border px-3 text-[12.5px] font-semibold text-primary no-underline">
          Open
        </a>
      )}
      <a href={store} target="_blank" rel="noreferrer" className="inline-flex h-8 shrink-0 items-center rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-primary-foreground no-underline">
        Get
      </a>
      <button
        type="button"
        aria-label="Hide"
        onClick={() => {
          try {
            window.sessionStorage.setItem(KEY, "1");
          } catch {
            // ignore
          }
          setPlatform(null);
        }}
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-muted-foreground"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
