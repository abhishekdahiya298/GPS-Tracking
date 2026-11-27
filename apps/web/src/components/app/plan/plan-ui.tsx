"use client";
import { FEATURE_LABEL, LIMIT_NOUN, isFeature, type Feature, type LimitKey } from "@rio-gps/core/plan-features";
import { CheckCircle2, Lock, Mail, MessageCircle, Phone, Sparkles } from "lucide-react";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Input, Textarea } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Field } from "@/components/ui/label";
import { api, ApiError, errorMessage } from "@/lib/client/api";
import { onPlanRefusal, planDialogMounted, type PlanRefusal } from "@/lib/client/plan-events";
import { cn } from "@/lib/cn";
import type { PlanAccessDto, UpgradeContact } from "@/lib/entitlements";

/** The company's plan, locks and limits, for any screen that wants to show them. */
const PlanCtx = createContext<{ plan: PlanAccessDto | null; requestUpgrade: (preset?: Need[]) => void }>({ plan: null, requestUpgrade: () => {} });
export const usePlan = () => useContext(PlanCtx);

const NEEDS = ["more_vehicles", "gps_trackers", "trip_history", "alerts", "reports", "zones", "maintenance", "loads", "shipper_links", "team"] as const;
type Need = (typeof NEEDS)[number];
const NEED_LABEL: Record<Need, string> = {
  more_vehicles: "More trucks or drivers",
  gps_trackers: "GPS hardware trackers",
  trip_history: "Trip history",
  alerts: "Alerts",
  reports: "Reports",
  zones: "Zones",
  maintenance: "Maintenance",
  loads: "More loads",
  shipper_links: "Shipper tracking links",
  team: "More team members"
};
const LIMIT_NEED: Partial<Record<LimitKey, Need>> = { vehicles: "more_vehicles", drivers: "more_vehicles", members: "team", loadsPerMonth: "loads", trackers: "gps_trackers" };
const needFor = (feature: string): Need | null => ((NEEDS as readonly string[]).includes(feature) ? (feature as Need) : feature === "emailed_reports" ? "reports" : null);

/**
 * Mounted once in the app frame: provides the plan to every screen, and opens the right dialog
 * when the server says a limit is reached or a feature isn't in the plan.
 */
export function PlanProvider({ plan, children }: { plan: PlanAccessDto | null; children: ReactNode }) {
  const [refusal, setRefusal] = useState<PlanRefusal | null>(null);
  const [request, setRequest] = useState<Need[] | null>(null);
  useEffect(() => {
    const unmount = planDialogMounted();
    const off = onPlanRefusal(setRefusal);
    return () => {
      off();
      unmount();
    };
  }, []);
  const requestUpgrade = (preset: Need[] = []) => {
    setRefusal(null);
    setRequest(preset);
  };
  return (
    <PlanCtx.Provider value={{ plan, requestUpgrade }}>
      {children}
      {refusal && (
        <Dialog open onOpenChange={(o) => !o && setRefusal(null)}>
          <DialogContent title={refusal.code === "LIMIT_REACHED" ? limitTitle(refusal) : "Not in your plan"} className="max-w-md">
            <div className="grid gap-4 px-5 py-4">
              <p className="m-0 text-sm text-muted-foreground">
                {refusal.code === "LIMIT_REACHED"
                  ? `${plan?.planName ?? "Your plan"} includes ${refusal.max} ${LIMIT_NOUN[refusal.limit as LimitKey] ?? ""}. Ask us to move you to a paid plan to add more.`
                  : refusal.message}
              </p>
              {refusal.code === "LIMIT_REACHED" && refusal.max > 0 && (
                <div className="grid gap-1.5 rounded-xl bg-muted/60 p-3">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{cap(LIMIT_NOUN[refusal.limit as LimitKey] ?? refusal.limit)} on {plan?.planName ?? "your plan"}</span>
                    <span className="tabular-nums">
                      <b className="text-lg">{refusal.used}</b> of {refusal.max}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-background" aria-hidden="true">
                    <div className="h-full rounded-full bg-warning" style={{ width: "100%" }} />
                  </div>
                  <p className="m-0 text-xs text-muted-foreground">Everything you added keeps working as it is.</p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <Button variant="secondary" onClick={() => setRefusal(null)}>
                Not now
              </Button>
              <Button
                onClick={() => {
                  const n = refusal.code === "LIMIT_REACHED" ? LIMIT_NEED[refusal.limit as LimitKey] : needFor(refusal.feature);
                  requestUpgrade(n ? [n] : []);
                }}
              >
                <Sparkles /> Request upgrade
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {request && <RequestUpgradeDialog preset={request} contact={plan?.contact ?? null} onClose={() => setRequest(null)} />}
    </PlanCtx.Provider>
  );
}

function limitTitle(r: Extract<PlanRefusal, { code: "LIMIT_REACHED" }>) {
  return `You've added ${r.used} of ${r.max} ${LIMIT_NOUN[r.limit as LimitKey] ?? r.limit}`;
}

/** "Tell us what you need" → a lead in the platform console; RIO switches it on. */
export function RequestUpgradeDialog({ preset, contact, onClose }: { preset: Need[]; contact: UpgradeContact | null; onClose: () => void }) {
  const [needs, setNeeds] = useState<Need[]>(preset);
  const [trucks, setTrucks] = useState("");
  const [way, setWay] = useState<"whatsapp" | "phone" | "email">("whatsapp");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const toggle = (n: Need) => setNeeds((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]));

  async function send() {
    if (needs.length === 0) return setError("Pick at least one thing you need.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/upgrade-request", { method: "POST", json: { needs, trucks, contactWay: way, phone, message } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {sent ? (
        <DialogContent title="Request sent" className="max-w-md">
          <div className="grid justify-items-center gap-3 px-5 py-6 text-center">
            <CheckCircle2 className="size-12 text-success" aria-hidden="true" />
            <p className="m-0 text-sm">
              We&apos;ll contact you {way === "whatsapp" ? "on WhatsApp" : way === "phone" ? "by phone" : "by email"} soon.
              <br />
              You asked for <b>{needs.map((n) => NEED_LABEL[n].toLowerCase()).join(", ")}</b>
              {trucks ? ` (${trucks} trucks)` : ""}. Keep using RIO GPS as normal.
            </p>
          </div>
          <div className="flex justify-end border-t border-border px-5 py-3">
            <Button onClick={onClose}>Done</Button>
          </div>
        </DialogContent>
      ) : (
        <DialogContent title="Request an upgrade" description="Tell us what you need. We'll contact you and switch it on." className="max-w-lg">
          <form
            className="grid min-h-0 gap-4 overflow-y-auto px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-medium">What do you need?</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {NEEDS.map((n) => (
                  <label key={n} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", needs.includes(n) ? "border-primary bg-primary/5" : "border-border")}>
                    <Checkbox checked={needs.includes(n)} onChange={() => toggle(n)} />
                    {NEED_LABEL[n]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="up-trucks" label="How many trucks?">
                <Input id="up-trucks" type="number" min={1} inputMode="numeric" value={trucks} onChange={(e) => setTrucks(e.target.value)} placeholder="e.g. 12" />
              </Field>
              <Field id="up-phone" label="Your phone" description="Optional if we have it">
                <PhoneInput id="up-phone" value={phone} onChange={setPhone} />
              </Field>
            </div>
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-medium">Best way to reach you</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup">
                {(
                  [
                    ["whatsapp", "WhatsApp", MessageCircle],
                    ["phone", "Phone", Phone],
                    ["email", "Email", Mail]
                  ] as const
                ).map(([v, l, Icon]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={way === v}
                    onClick={() => setWay(v)}
                    className={cn("inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold", way === v ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground")}
                  >
                    <Icon className="size-4" aria-hidden="true" /> {l}
                  </button>
                ))}
              </div>
            </fieldset>
            <Field id="up-msg" label="Anything else? (optional)">
              <Textarea id="up-msg" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Adding 7 trucks in January, want trackers on the trailers." />
            </Field>
            {error && (
              <p role="alert" className="m-0 text-sm text-danger">
                {error}
              </p>
            )}
            {contact && <ContactLine contact={contact} />}
            <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-border bg-background px-5 pt-3">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                Send request
              </Button>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}

export function ContactLine({ contact, className }: { contact: UpgradeContact; className?: string }) {
  const parts = [contact.phone, contact.whatsapp && `WhatsApp ${contact.whatsapp}`, contact.email].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className={cn("m-0 text-xs text-muted-foreground", className)}>Your plan is set by RIO GPS · {parts.join(" · ")}</p>;
}

/** "Request upgrade" anywhere (opens the dialog from the plan context). */
export function RequestUpgradeButton({ need, children = "Request upgrade", ...props }: { need?: Feature | Need; children?: ReactNode } & Omit<React.ComponentProps<typeof Button>, "onClick">) {
  const { requestUpgrade } = usePlan();
  const n = need ? needFor(need) : null;
  return (
    <Button {...props} onClick={() => requestUpgrade(n ? [n] : [])}>
      {children}
    </Button>
  );
}

/** Small lock chip for a feature that isn't in the plan. */
export function LockChip({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2 text-[11px] font-bold text-muted-foreground", className)}>
      <Lock className="size-3" aria-hidden="true" /> Locked
    </span>
  );
}

export function featureName(f: string): string {
  return isFeature(f) ? FEATURE_LABEL[f] : f;
}



const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
