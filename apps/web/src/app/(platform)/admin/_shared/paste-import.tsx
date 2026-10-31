"use client";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { errorMessage } from "@/lib/client/api";
import { parseInventoryLines } from "@/lib/inventory-parse";
import { cn } from "@/lib/cn";

export type ImportRow = { line: number; key: string | null; status: string; message?: string };
export type ImportResult = { rows: ImportRow[]; done: { label: string; value: number; good?: boolean }[] };
type Extra = { name: string; label: string; kind: "text" | "select" | "money"; defaultValue: string; required?: boolean; options?: { value: string; label: string }[]; placeholder?: string };

/**
 * Paste a list (from a spreadsheet, a supplier's packing list or a carrier's activation sheet),
 * preview what was recognized on each line, import, then see a result per line.
 */
export function PasteImportDialog({
  title,
  description,
  placeholder,
  needs,
  extras,
  okStatuses,
  statusLabels,
  submit,
  onOpenChange,
  onDone
}: {
  title: string;
  description: string;
  placeholder: string;
  needs: "imei" | "iccid";
  extras: Extra[];
  okStatuses: string[];
  statusLabels: Record<string, string>;
  submit: (text: string, values: Record<string, string>) => Promise<ImportResult>;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(extras.map((e) => [e.name, e.defaultValue])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const lines = parseInventoryLines(text);
  const ready = lines.filter((l) => (needs === "imei" ? l.imei : l.iccid) && !l.problem);
  const problems = lines.filter((l) => !(needs === "imei" ? l.imei : l.iccid) || l.problem);

  function close() {
    if (busy) return;
    if (result) onDone();
    onOpenChange(false);
  }
  async function go(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await submit(text, values));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const attention = result?.rows.filter((r) => !okStatuses.includes(r.status)) ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent title={title} description={description} className="max-w-2xl">
        {result ? (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {result.done.map((d) => (
                <div key={d.label} className={cn("rounded-lg border p-3", d.good && d.value > 0 ? "border-success/30 bg-success-soft" : "border-border")}>
                  <div className="text-xs text-muted-foreground">{d.label}</div>
                  <div className="text-xl font-semibold tabular-nums">{d.value}</div>
                </div>
              ))}
            </div>
            {attention.length > 0 && (
              <div className="max-h-60 overflow-y-auto rounded-md border border-border text-sm">
                {attention.map((r) => (
                  <div key={`${r.line}-${r.key}`} className="flex gap-3 border-b border-border px-3 py-2 last:border-b-0">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">Line {r.line}</span>
                    <span className="min-w-0">
                      <span className="block font-medium">{statusLabels[r.status] ?? r.status}{r.key ? ` · ${r.key}` : ""}</span>
                      {r.message && <span className="block text-xs text-muted-foreground">{r.message}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={go} className="grid gap-4">
            <Field id="pi-text" label="List" required description="One per line. Values can be separated by commas, tabs or spaces, in any order; a column copied from a spreadsheet works as is.">
              <Textarea id="pi-text" value={text} onChange={(e) => setText(e.target.value)} rows={8} spellCheck={false} autoFocus placeholder={placeholder} className="font-mono text-xs" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              {extras.map((x) => (
                <Field key={x.name} id={`pi-${x.name}`} label={x.label} required={x.required}>
                  {x.kind === "select" ? (
                    <Select id={`pi-${x.name}`} value={values[x.name]} onChange={(e) => setValues((v) => ({ ...v, [x.name]: e.target.value }))}>
                      {x.options!.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input id={`pi-${x.name}`} value={values[x.name]} placeholder={x.placeholder} inputMode={x.kind === "money" ? "decimal" : undefined} onChange={(e) => setValues((v) => ({ ...v, [x.name]: e.target.value }))} required={x.required} />
                  )}
                </Field>
              ))}
            </div>
            {lines.length > 0 && (
              <div className="rounded-md bg-muted px-3 py-2 text-sm" aria-live="polite">
                <span className="font-medium">{ready.length} ready</span>
                {problems.length > 0 && (
                  <span className="text-warning">
                    {" "}
                    · {problems.length} with a problem (line {problems.slice(0, 5).map((p) => p.line).join(", ")}
                    {problems.length > 5 ? "…" : ""})
                  </span>
                )}
                {ready.length > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    {ready.filter((l) => l.iccid && l.imei).length} with both a tracker and a SIM, {ready.filter((l) => l.msisdn).length} with a phone number.
                  </span>
                )}
              </div>
            )}
            {error && <Alert tone="danger">{error}</Alert>}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} disabled={ready.length === 0 || extras.some((x) => x.required && !values[x.name]?.trim())}>
                Import {ready.length || ""}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
