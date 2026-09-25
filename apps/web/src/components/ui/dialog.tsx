"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Modal dialog (Radix): focus trap, Escape to close, focus returns to the
 * trigger, background is inert for screen readers.
 */
export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

function Overlay() {
  return <D.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in" />;
}

export function DialogContent({ className, children, title, description, hideClose, ...props }: ComponentPropsWithoutRef<typeof D.Content> & { title: ReactNode; description?: ReactNode; hideClose?: boolean }) {
  return (
    <D.Portal>
      <Overlay />
      <D.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-background shadow-pop focus:outline-none data-[state=open]:animate-in",
          className
        )}
        {...(description ? {} : { "aria-describedby": undefined })}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <D.Title className="m-0 text-base font-semibold text-foreground">{title}</D.Title>
            {description && <D.Description className="m-0 mt-1 text-sm text-muted-foreground">{description}</D.Description>}
          </div>
          {!hideClose && (
            <D.Close className="-m-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-muted" aria-label="Close">
              <X className="size-4" aria-hidden="true" />
            </D.Close>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

export function DialogFooter({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("-mx-5 -mb-4 mt-5 flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3", className)} {...props} />;
}

/** Side / bottom sheet (drawer) built on the same accessible dialog primitive. */
export function SheetContent({ className, children, title, description, side = "right", ...props }: ComponentPropsWithoutRef<typeof D.Content> & { title: ReactNode; description?: ReactNode; side?: "right" | "left" | "bottom" }) {
  const pos = {
    right: "inset-y-0 right-0 h-dvh w-full max-w-md border-l",
    left: "inset-y-0 left-0 h-dvh w-72 max-w-[85vw] border-r animate-slide-in-left",
    bottom: "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-t animate-slide-in-bottom"
  }[side];
  return (
    <D.Portal>
      <Overlay />
      <D.Content className={cn("fixed z-50 flex flex-col border-border bg-background shadow-pop focus:outline-none", pos, className)} {...(description ? {} : { "aria-describedby": undefined })} {...props}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <D.Title className="m-0 text-base font-semibold text-foreground">{title}</D.Title>
            {description && <D.Description className="m-0 mt-1 text-sm text-muted-foreground">{description}</D.Description>}
          </div>
          <D.Close className="-m-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="size-4" aria-hidden="true" />
          </D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
export const Sheet = D.Root;
export const SheetTrigger = D.Trigger;
export const SheetClose = D.Close;
