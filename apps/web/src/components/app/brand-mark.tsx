import logo from "@/assets/logo.png";
import { cn } from "@/lib/cn";

export const BRAND = "RIO GPS";

/** The RIO GPS logo (it already contains the name, so the image alone is the brand). */
export function BrandMark({ className }: { className?: string; wordClassName?: string }) {
  return (
    // A plain <img>: the file is small, fixed-size and bundled with the app.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logo.src} alt={BRAND} width={logo.width} height={logo.height} className={cn("w-auto shrink-0", className)} />
  );
}
