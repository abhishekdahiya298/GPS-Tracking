"use client";
import * as T from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export const TooltipProvider = T.Provider;

/** Supplementary hint only: never the sole place important information lives. */
export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <T.Root delayDuration={300}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-50 max-w-64 rounded-md bg-foreground px-2.5 py-1.5 text-xs text-white shadow-pop data-[state=delayed-open]:animate-in">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
