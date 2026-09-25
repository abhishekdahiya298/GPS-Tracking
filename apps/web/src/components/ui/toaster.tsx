"use client";
import { Toaster as Sonner } from "sonner";

/** One toast host for the whole app (mounted in the root layout). */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      richColors
      toastOptions={{ duration: 4000, className: "font-sans" }}
      // Sonner renders an aria-live region, so results are announced to screen readers.
    />
  );
}
export { toast } from "sonner";
