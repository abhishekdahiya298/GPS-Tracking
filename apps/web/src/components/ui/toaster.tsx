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
import { toast as sonner } from "sonner";
import { isPlanMessageShown } from "@/lib/client/plan-events";

/**
 * sonner's toast, except errors already shown in the plan dialog (limit reached, not in plan)
 * aren't repeated as a toast.
 */
export const toast = Object.assign((...a: Parameters<typeof sonner>) => sonner(...a), sonner, {
  error: (message: Parameters<typeof sonner.error>[0], data?: Parameters<typeof sonner.error>[1]) => (typeof message === "string" && isPlanMessageShown(message) ? undefined : sonner.error(message, data))
});
