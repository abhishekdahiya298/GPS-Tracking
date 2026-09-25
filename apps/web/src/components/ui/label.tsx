import type { LabelHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("block text-sm font-medium text-foreground", className)} {...props} />;
}

/**
 * Label + control + description/error, wired for screen readers.
 * Pass the control as children and give it id={id}; errors are announced.
 */
export function Field({ id, label, description, error, required, children, className }: { id: string; label: ReactNode; description?: ReactNode; error?: string | null; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-danger" aria-hidden="true"> *</span>}
      </Label>
      {children}
      {description && !error && <p id={`${id}-desc`} className="m-0 text-xs text-muted-foreground">{description}</p>}
      {error && <p id={`${id}-error`} role="alert" className="m-0 text-xs text-danger">{error}</p>}
    </div>
  );
}
