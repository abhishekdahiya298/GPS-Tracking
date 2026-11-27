"use client";
import { checkPhone, displayPhone, formatNational, nationalDigits, PHONE_COUNTRIES, PHONE_EXAMPLE, type PhoneCountry } from "@rio-gps/core/phone";
import { AlertTriangle, Check } from "lucide-react";
import { forwardRef, useEffect, useState, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type"> & {
  /** Controlled value (any format; shown as (416) 555-0142). */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Error from the form (e.g. on Save); shown under the field. */
  error?: string;
  /** Country the picker starts on when the number has no area code yet. */
  defaultCountry?: PhoneCountry;
  /** Show the "looks right" line under a valid number. */
  hint?: boolean;
};

/**
 * Mobile number field for Canada and the US (A44): country picker with +1, formats as you type,
 * pasting "+1 416 555 0142" or "4165550142" works, and the same rules as the server
 * (@rio-gps/core/phone) explain what's wrong. The picker follows the area code once it's typed.
 * The input keeps its `name`, so forms that read FormData get the typed number.
 */
export const PhoneInput = forwardRef<HTMLInputElement, Props>(function PhoneInput({ value, defaultValue, onChange, error, defaultCountry = "CA", hint = false, className, onBlur, id, ...rest }, ref) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(() => display(defaultValue ?? ""));
  const raw = controlled ? display(value) : inner;
  const [touched, setTouched] = useState(false);
  const [country, setCountry] = useState<PhoneCountry>(defaultCountry);
  const check = raw ? checkPhone(raw) : null;
  const detected = check?.ok ? check.country : null;

  // The picker follows the area code once it's typed.
  useEffect(() => {
    if (detected && detected !== country) setCountry(detected);
  }, [detected, country]);

  const shownError = error ?? (touched && check && !check.ok && !(check.incomplete && !raw) ? check.error : undefined);
  const ok = Boolean(check?.ok) && !error;

  function set(next: string) {
    const formatted = display(next);
    if (!controlled) setInner(formatted);
    onChange?.(formatted);
  }

  return (
    <div className="grid gap-1">
      <div
        className={cn(
          "flex h-9 min-w-0 items-center overflow-hidden rounded-md border bg-background shadow-card transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25",
          shownError ? "border-danger ring-2 ring-danger/15" : ok ? "border-success/70" : "border-input",
          className
        )}
      >
        <label className="relative flex h-full shrink-0 items-center gap-1 border-r border-border bg-muted/60 pl-2 pr-1 text-sm font-semibold">
          <span className="sr-only">Country</span>
          <span aria-hidden="true">{PHONE_COUNTRIES.find((c) => c.code === country)?.flag}</span>
          <span>+1</span>
          <select value={country} onChange={(e) => setCountry(e.target.value as PhoneCountry)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Country">
            {PHONE_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name} (+1)
              </option>
            ))}
          </select>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className="text-muted-foreground">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </label>
        <input
          ref={ref}
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder={PHONE_EXAMPLE[country]}
          value={raw}
          aria-invalid={Boolean(shownError) || undefined}
          aria-describedby={shownError && id ? `${id}-phone-msg` : undefined}
          onChange={(e) => set(e.target.value)}
          onBlur={(e) => {
            setTouched(true);
            onBlur?.(e);
          }}
          maxLength={20}
          className="h-full min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          {...rest}
        />
        {ok ? <Check className="mr-2 size-4 shrink-0 text-success" aria-hidden="true" /> : shownError ? <AlertTriangle className="mr-2 size-4 shrink-0 text-danger" aria-hidden="true" /> : null}
      </div>
      {shownError ? (
        <span id={id ? `${id}-phone-msg` : undefined} role="alert" className="text-xs font-semibold text-danger">
          {shownError}
        </span>
      ) : ok && hint && detected && detected !== defaultCountry ? (
        <span className="text-xs text-success">{detected === "US" ? "US number" : "Canadian number"}</span>
      ) : null}
    </div>
  );
});

/** Whatever was typed or stored, shown the friendly way: (416) 555-0142. */
function display(v: string): string {
  if (!v) return "";
  if (v.startsWith("+1") && /^\+1\d{10}$/.test(v)) return displayPhone(v);
  const d = nationalDigits(v);
  // Keep what the person typed when it isn't a +1 number at all (the message explains).
  if (v.trim().startsWith("+") && !v.replace(/\D/g, "").startsWith("1")) return v;
  return formatNational(d);
}
