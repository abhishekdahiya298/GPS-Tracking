import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const field =
  "block w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-card placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/30 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 aria-[invalid=true]:border-danger box-border";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(field, "h-9", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(field, "min-h-20 py-2", className)} {...props} />;
});

/** Native select: best mobile UX and accessibility; styled to match inputs. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        field,
        // Chevron comes from the `select-chevron` utility in globals.css (an arbitrary
        // url() class was dropped by the compiler and confused tailwind-merge).
        "h-9 appearance-none pr-8 select-chevron",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
});

export const Checkbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(function Checkbox({ className, ...props }, ref) {
  return <input ref={ref} type="checkbox" className={cn("size-4 shrink-0 cursor-pointer accent-primary align-middle", className)} {...props} />;
});
