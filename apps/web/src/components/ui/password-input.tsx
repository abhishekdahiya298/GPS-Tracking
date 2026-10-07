"use client";
import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useState, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";
import { Input } from "./input";

/** Shortest password the server accepts (keep in sync with `minPasswordLength` in lib/auth.ts). */
export const MIN_PASSWORD_LENGTH = 6;

/** Password field with a show/hide button. The button is a real toggle for keyboards and screen readers. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<ComponentPropsWithoutRef<typeof Input>, "type">>(function PasswordInput({ className, ...props }, ref) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={shown ? "text" : "password"} className={cn("pr-11", className)} {...props} />
      <button
        type="button"
        aria-label="Show password"
        aria-pressed={shown}
        onClick={() => setShown((s) => !s)}
        className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-r-md border-0 bg-transparent text-muted-foreground hover:text-foreground"
      >
        {shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
});
