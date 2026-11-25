"use client";

/** Four-bar strength meter under a new password (length and mix of character types). */
export function PasswordStrength({ value, min }: { value: string; min: number }) {
  if (!value) return null;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(value)).length;
  const score = value.length < min ? 1 : Math.min(4, 1 + (value.length >= 14 ? 1 : 0) + (kinds >= 3 ? 1 : 0) + (kinds === 4 || value.length >= 18 ? 1 : 0));
  const look = [
    { label: `Too short: at least ${min} characters`, color: "#b91c1c" },
    { label: "Okay password", color: "#b45309" },
    { label: "Good password", color: "#15803d" },
    { label: "Strong password", color: "#15803d" }
  ][score - 1]!;
  return (
    <div aria-live="polite" className="grid gap-1.5">
      <div aria-hidden="true" className="grid grid-cols-4 gap-1.5">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="h-1.5 rounded-full" style={{ background: i <= score ? look.color : "var(--color-border)" }} />
        ))}
      </div>
      <span className="text-xs" style={{ color: look.color }}>
        {look.label}
      </span>
    </div>
  );
}
