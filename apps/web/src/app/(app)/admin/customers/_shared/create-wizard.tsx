"use client";
import { ArrowLeft, ArrowRight, Check, Copy } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";

const STEPS = ["Company", "First admin", "Review"] as const;
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Company → first admin → review → create. The server re-validates everything. */
export function CreateCustomerWizard({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; password: string | null; emailed: boolean } | null>(null);

  const reset = () => {
    setStep(0);
    setName("");
    setSlug("");
    setSlugTouched(false);
    setAdminName("");
    setAdminEmail("");
    setError(null);
    setDone(null);
  };
  const close = () => {
    if (busy) return;
    onOpenChange(false);
    if (done) onCreated(done.id);
    setTimeout(reset, 200);
  };

  const step0ok = name.trim().length >= 2 && SLUG_RE.test(slug);
  const step1ok = adminName.trim().length >= 1 && EMAIL_RE.test(adminEmail.trim());

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ organizationId: string; admin: { temporaryPassword: string | null; emailed: boolean } }>("/api/admin/customers", {
        method: "POST",
        json: { name: name.trim(), slug, admin: { name: adminName.trim(), email: adminEmail.trim() } }
      });
      setDone({ id: out.organizationId, password: out.admin.temporaryPassword, emailed: out.admin.emailed });
      toast.success(`${name.trim()} created.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent title={done ? "Customer created" : "New customer"} description={done ? undefined : `Step ${step + 1} of 3: ${STEPS[step]}`}>
        {!done && (
          <ol className="m-0 mb-5 flex list-none gap-2 p-0" aria-label="Progress">
            {STEPS.map((s, i) => (
              <li key={s} className="flex flex-1 flex-col gap-1.5" aria-current={i === step ? "step" : undefined}>
                <span className={cn("h-1 rounded-full", i <= step ? "bg-primary" : "bg-muted")} />
                <span className={cn("text-xs", i === step ? "font-medium text-foreground" : "text-muted-foreground")}>{s}</span>
              </li>
            ))}
          </ol>
        )}

        {done ? (
          <div className="grid gap-3 text-sm">
            <p className="m-0">
              <strong>{name}</strong> is ready.{" "}
              {done.emailed ? `${adminEmail} was emailed a link to set their password.` : "Email couldn't be sent, so share this one-time password with the admin privately:"}
            </p>
            {done.password && (
              <div className="flex items-center gap-2">
                <code className="flex-1 select-all break-all rounded-md border border-border bg-canvas px-3 py-2 text-base">{done.password}</code>
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="Copy password"
                  onClick={() => {
                    void navigator.clipboard?.writeText(done.password!);
                    toast.success("Copied.");
                  }}
                >
                  <Copy />
                </Button>
              </div>
            )}
            <p className="m-0 text-muted-foreground">Next: register their GPS devices on the customer page.</p>
            <DialogFooter>
              <Button onClick={close}>
                Open customer <ArrowRight />
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            method="post"
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (step === 0 && step0ok) setStep(1);
              else if (step === 1 && step1ok) setStep(2);
              else if (step === 2) void create();
            }}
          >
            {step === 0 && (
              <>
                <Field id="cw-name" label="Company name" required>
                  <Input
                    id="cw-name"
                    value={name}
                    maxLength={120}
                    autoFocus
                    onChange={(e) => {
                      setName(e.target.value);
                      if (!slugTouched) setSlug(slugify(e.target.value));
                    }}
                  />
                </Field>
                <Field id="cw-slug" label="Short name" description="Lowercase letters, digits and dashes. Used internally; can't be changed later." error={slug && !SLUG_RE.test(slug) ? "Use lowercase letters, digits and dashes" : null}>
                  <Input
                    id="cw-slug"
                    value={slug}
                    maxLength={50}
                    aria-invalid={slug !== "" && !SLUG_RE.test(slug)}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(e.target.value.toLowerCase());
                    }}
                  />
                </Field>
              </>
            )}
            {step === 1 && (
              <>
                <p className="m-0 text-sm text-muted-foreground">This person becomes the customer&apos;s Org Admin and can invite the rest of their team.</p>
                <Field id="cw-an" label="Full name" required>
                  <Input id="cw-an" value={adminName} maxLength={200} autoFocus onChange={(e) => setAdminName(e.target.value)} />
                </Field>
                <Field id="cw-ae" label="Email" required>
                  <Input id="cw-ae" type="email" value={adminEmail} maxLength={254} onChange={(e) => setAdminEmail(e.target.value)} />
                </Field>
              </>
            )}
            {step === 2 && (
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border border-border p-4 text-sm">
                <dt className="text-muted-foreground">Company</dt>
                <dd className="m-0 font-medium">{name}</dd>
                <dt className="text-muted-foreground">Short name</dt>
                <dd className="m-0">{slug}</dd>
                <dt className="text-muted-foreground">First admin</dt>
                <dd className="m-0">
                  {adminName} &lt;{adminEmail}&gt;
                </dd>
              </dl>
            )}
            {error && <Alert tone="danger">{error}</Alert>}
            <DialogFooter>
              {step > 0 ? (
                <Button variant="secondary" onClick={() => setStep((s) => s - 1)} disabled={busy}>
                  <ArrowLeft /> Back
                </Button>
              ) : (
                <Button variant="secondary" onClick={close}>
                  Cancel
                </Button>
              )}
              {step < 2 ? (
                <Button type="submit" disabled={step === 0 ? !step0ok : !step1ok}>
                  Next <ArrowRight />
                </Button>
              ) : (
                <Button type="submit" loading={busy}>
                  <Check /> Create customer
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
