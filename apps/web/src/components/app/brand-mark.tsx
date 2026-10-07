import logo from "@/assets/logo.png";
import { cn } from "@/lib/cn";

export const BRAND = "RIO Tracking";

/**
 * The company logo followed by the word "Tracking". The logo already reads "Rio", so the
 * image is described once, as the full name, and the word beside it is hidden from screen readers.
 */
export function BrandMark({ className, wordClassName }: { className?: string; wordClassName?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      {/* A plain <img>: the file is small, fixed-size and bundled with the app. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo.src} alt={BRAND} width={logo.width} height={logo.height} className={cn("w-auto shrink-0", className)} />
      <span aria-hidden="true" className={cn("font-semibold tracking-tight text-[#0a2463]", wordClassName)}>
        Tracking
      </span>
    </span>
  );
}
