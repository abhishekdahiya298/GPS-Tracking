"use client";
import { Building2, Check, Search } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { TimeZoneSelect } from "@/components/app/time-zone-select";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";

export type FieldSpec =
  | { name: string; label: ReactNode; kind: "text" | "email" | "tel" | "textarea" | "money"; required?: boolean; placeholder?: string; description?: ReactNode; defaultValue?: string | null; maxLength?: number; minLength?: number; numeric?: boolean; half?: boolean }
  | { name: string; label: ReactNode; kind: "select"; options: { value: string; label: string }[]; defaultValue?: string; description?: ReactNode; half?: boolean }
  | { name: string; label: ReactNode; kind: "checkbox"; description?: ReactNode; defaultValue?: boolean }
  | { name: string; label: ReactNode; kind: "customer"; required?: boolean; excludeId?: string | null; description?: ReactNode }
  | { name: string; label: ReactNode; kind: "timezone"; defaultValue?: string; half?: boolean };

export type FormValues = Record<string, string | boolean>;

function initial(fields: FieldSpec[]): FormValues {
  const v: FormValues = {};
  for (const f of fields) {
    if (f.kind === "checkbox") v[f.name] = f.defaultValue ?? false;
    else if (f.kind === "customer") v[f.name] = "";
    else v[f.name] = ("defaultValue" in f ? f.defaultValue : "") ?? "";
  }
  return v;
}

/**
 * One dialog for every small platform form: fields described as data, values handed to
 * `onSubmit`; it stays open with the server's message when something fails.
 */
export function FormDialog({
  title,
  description,
  intro,
  fields,
  confirmLabel,
  danger,
  onSubmit,
  onOpenChange
}: {
  title: string;
  description?: ReactNode;
  intro?: ReactNode;
  fields: FieldSpec[];
  confirmLabel: string;
  danger?: boolean;
  onSubmit: (v: FormValues) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const [values, setValues] = useState<FormValues>(() => initial(fields));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string | boolean) => setValues((s) => ({ ...s, [k]: v }));
  const missing = fields.some((f) => "required" in f && f.required && !String(values[f.name] ?? "").trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (missing) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title={title} description={description} className="max-w-lg" role={danger ? "alertdialog" : undefined}>
        <form onSubmit={submit} className="grid gap-4">
          {intro}
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f, i) => {
              const id = `fd-${f.name}`;
              const full = !("half" in f && f.half);
              const wrap = (node: ReactNode) => (
                <div key={f.name} className={cn(full && "sm:col-span-2")}>
                  {node}
                </div>
              );
              if (f.kind === "checkbox") {
                return wrap(
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <Checkbox checked={Boolean(values[f.name])} onChange={(e) => set(f.name, e.target.checked)} className="mt-0.5" />
                    <span>
                      <span className="font-medium">{f.label}</span>
                      {f.description && <span className="block text-xs text-muted-foreground">{f.description}</span>}
                    </span>
                  </label>
                );
              }
              if (f.kind === "customer") {
                return wrap(
                  <Field id={id} label={f.label} required={f.required} description={f.description}>
                    <CustomerPicker id={id} value={String(values[f.name] ?? "")} onChange={(v) => set(f.name, v)} excludeId={f.excludeId ?? null} />
                  </Field>
                );
              }
              if (f.kind === "select") {
                return wrap(
                  <Field id={id} label={f.label} description={f.description}>
                    <Select id={id} value={String(values[f.name] ?? "")} onChange={(e) => set(f.name, e.target.value)}>
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                );
              }
              if (f.kind === "timezone") {
                return wrap(
                  <Field id={id} label={f.label}>
                    <TimeZoneSelect id={id} value={String(values[f.name] ?? "")} onChange={(e) => set(f.name, e.target.value)} />
                  </Field>
                );
              }
              const common = {
                id,
                value: String(values[f.name] ?? ""),
                placeholder: f.placeholder,
                maxLength: f.maxLength,
                required: f.required,
                autoFocus: i === 0,
                autoComplete: "off"
              };
              return wrap(
                <Field id={id} label={f.label} required={f.required} description={f.description}>
                  {f.kind === "textarea" ? (
                    <Textarea {...common} rows={3} onChange={(e) => set(f.name, e.target.value)} />
                  ) : (
                    <Input
                      {...common}
                      type={f.kind === "email" ? "email" : f.kind === "tel" ? "tel" : "text"}
                      inputMode={f.kind === "money" ? "decimal" : f.numeric ? "numeric" : undefined}
                      onChange={(e) => set(f.name, e.target.value)}
                    />
                  )}
                </Field>
              );
            })}
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant={danger ? "danger" : "primary"} loading={busy} disabled={missing}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type CustomerOption = { id: string; name: string; slug: string; status: string };

/** Search-as-you-type list of current customers (active and suspended). */
export function CustomerPicker({ id, value, onChange, excludeId }: { id: string; value: string; onChange: (id: string) => void; excludeId: string | null }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CustomerOption[] | null>(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await api<{ items: CustomerOption[] }>(`/api/admin/customers?${new URLSearchParams({ search: q, pageSize: "25", view: "current" })}`);
        if (live) setItems(res.items.filter((c) => c.id !== excludeId));
      } catch {
        if (live) setItems([]);
      }
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, excludeId]);
  return (
    <div className="grid gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers…" className="pl-8" autoComplete="off" />
      </div>
      <div role="listbox" aria-label="Customers" className="max-h-52 overflow-y-auto rounded-md border border-border">
        {items === null ? (
          <p className="m-0 px-3 py-2 text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="m-0 px-3 py-2 text-sm text-muted-foreground">No customers match</p>
        ) : (
          items.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={value === c.id}
              onClick={() => onChange(c.id)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 border-0 border-b border-border bg-transparent px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted",
                value === c.id && "bg-primary-soft font-medium text-primary"
              )}
            >
              {value === c.id ? <Check className="size-4 shrink-0" aria-hidden="true" /> : <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {c.status === "suspended" && <span className="text-xs text-warning">Suspended</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
