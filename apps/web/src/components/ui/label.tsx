"use client";
import {
  useEffect,
  useState,
  type LabelHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** The browser's validity state as a sentence in RIO's voice (instead of its grey pop-up bubble). */
export function validityMessage(el: Control): string {
  const v = el.validity;
  const name =
    (el.labels?.[0]?.textContent ?? "").replace(/\*/g, "").trim() ||
    "This field";
  const input = el instanceof HTMLInputElement ? el : null;
  if (v.valueMissing) {
    if (el instanceof HTMLSelectElement)
      return `Choose ${name.toLowerCase().startsWith("a ") ? name : `a ${name.toLowerCase()}`}.`;
    if (input?.type === "date" || input?.type === "datetime-local")
      return `Pick ${name.toLowerCase()}.`;
    if (input?.type === "checkbox") return "Tick this box to continue.";
    return `${name} is required.`;
  }
  if (v.typeMismatch) {
    if (input?.type === "email") return "Enter an email like name@company.com.";
    if (input?.type === "url")
      return "Enter a full link starting with https://.";
  }
  if (v.badInput)
    return input?.type === "number"
      ? "Enter a number."
      : `${name} is not valid.`;
  if (v.rangeUnderflow)
    return input?.type === "date"
      ? `Pick a date on or after ${input.min}.`
      : `Enter ${input?.min} or more.`;
  if (v.rangeOverflow)
    return input?.type === "date"
      ? `Pick a date on or before ${input.max}.`
      : `Enter ${input?.max} or less.`;
  if (v.stepMismatch)
    return input?.step === "1" || !input?.step
      ? "Use a whole number."
      : `Use steps of ${input.step}.`;
  if (v.tooShort)
    return `Use at least ${(el as HTMLInputElement).minLength} characters.`;
  if (v.tooLong)
    return `Use at most ${(el as HTMLInputElement).maxLength} characters.`;
  if (v.patternMismatch)
    return el.title || `${name} is not in the right format.`;
  return el.validationMessage;
}

/**
 * Shows the browser's own checks (required, min/max, email…) as an inline message under the
 * field, like the app's other errors, instead of the browser's pop-up bubble. Focuses the first
 * invalid field of the form and clears the message as soon as the value is fixed.
 */
function useInlineValidity(id: string) {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const el = document.getElementById(id) as Control | null;
    if (!el || !("validity" in el)) return;
    const onInvalid = (e: Event) => {
      e.preventDefault();
      setMessage(validityMessage(el));
      el.setAttribute("aria-invalid", "true");
      const active = document.activeElement as Control | null;
      if (!(
        active &&
        active.form === el.form &&
        active.validity &&
        !active.validity.valid
      ))
        el.focus();
    };
    const onEdit = () => {
      if (el.validity.valid) {
        setMessage(null);
        el.removeAttribute("aria-invalid");
      }
    };
    el.addEventListener("invalid", onInvalid);
    el.addEventListener("input", onEdit);
    el.addEventListener("change", onEdit);
    return () => {
      el.removeEventListener("invalid", onInvalid);
      el.removeEventListener("input", onEdit);
      el.removeEventListener("change", onEdit);
    };
  }, [id]);
  return message;
}

/**
 * Label + control + description/error, wired for screen readers.
 * Pass the control as children and give it id={id}; errors are announced.
 * An `error` from the form wins; otherwise the browser's own checks are shown inline.
 */
export function Field({
  id,
  label,
  description,
  error,
  required,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const native = useInlineValidity(id);
  const shown = error || native;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="text-danger" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </Label>
      {children}
      {description && !shown && (
        <p id={`${id}-desc`} className="m-0 text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {shown && (
        <p id={`${id}-error`} role="alert" className="m-0 text-xs text-danger">
          {shown}
        </p>
      )}
    </div>
  );
}
