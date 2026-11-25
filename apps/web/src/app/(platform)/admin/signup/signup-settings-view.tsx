"use client";
import { Inbox, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LocalTime } from "@/components/app/local-time";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { SignupSettings, UpgradeContact } from "@/lib/entitlements";
import type { LeadDto } from "@/lib/leads";

const ROLES = [
  { key: "fleet", label: "Fleet owner", hint: "Runs trucks; adds trucks and drivers" },
  { key: "operator", label: "Owner-operator", hint: "Owns and drives one truck" },
  { key: "broker", label: "Broker / dispatcher", hint: "Tracks loads with the driver's phone" },
  { key: "driver", label: "Driver (with company code)", hint: "Joins the company's plan" }
] as const;

/** Who can sign up, which plan they start on, protection, and how customers reach RIO to upgrade. */
export function SignupSettingsView({ signup, contact, plans, requests, smsReady, emailReady }: { signup: SignupSettings; contact: UpgradeContact; plans: { id: string; name: string; visibility: string }[]; requests: LeadDto[]; smsReady: boolean; emailReady: boolean }) {
  const router = useRouter();
  const [s, setS] = useState(signup);
  const [c, setC] = useState({ phone: contact.phone ?? "", whatsapp: contact.whatsapp ?? "", email: contact.email ?? "", message: contact.message ?? "", trialDays: String(contact.trialDays) });
  const [busy, setBusy] = useState(false);
  const publicPlan = plans.find((p) => p.visibility === "public");
  const role = (k: (typeof ROLES)[number]["key"]) => s.roles[k];
  const setRole = (k: (typeof ROLES)[number]["key"], patch: Partial<SignupSettings["roles"]["fleet"]>) => setS((x) => ({ ...x, roles: { ...x.roles, [k]: { ...x.roles[k], ...patch } } }));

  async function save() {
    setBusy(true);
    try {
      await api("/api/admin/signup-settings", { method: "PUT", json: { signup: s, contact: c } });
      toast.success("Sign-up and upgrade settings saved");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Sign-up & upgrades"
        description="Who can sign up, which plan they start on, and how customers reach you to upgrade."
        actions={
          <Button onClick={() => void save()} loading={busy}>
            <Save /> Save
          </Button>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Who can sign up</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 pt-4">
              {ROLES.map((r) => (
                <div key={r.key} className="grid items-center gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_220px_auto]">
                  <div className="min-w-0">
                    <b className="text-sm">{r.label}</b>
                    <p className="m-0 text-xs text-muted-foreground">{r.hint}</p>
                  </div>
                  {r.key === "driver" ? (
                    <span className="text-sm text-muted-foreground">Joins the company&apos;s plan</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Select aria-label={`${r.label} starts on`} className="h-9" value={role(r.key).planId ?? ""} onChange={(e) => setRole(r.key, { planId: e.target.value || null })}>
                        <option value="">{publicPlan ? `${publicPlan.name} (public)` : "The public plan"}</option>
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                      <Input aria-label={`${r.label} trial days`} title="Trial days (0 = no trial)" inputMode="numeric" className="h-9 w-14 text-center" value={String(role(r.key).trialDays)} onChange={(e) => setRole(r.key, { trialDays: Number(e.target.value.replace(/\D/g, "") || 0) })} />
                      <span className="text-xs text-muted-foreground">days trial</span>
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={role(r.key).open} onCheckedChange={(v) => setRole(r.key, { open: v })} label={`${r.label} can sign up`} /> Open
                  </label>
                </div>
              ))}
              <p className="m-0 text-xs text-muted-foreground">The number next to a plan is a trial in days (0 = none): the company starts on that plan and goes back to the public plan when it ends.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Protection</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 pt-4">
              <p className="m-0 text-xs text-muted-foreground">New companies get one 6-digit code and type it once. It goes to every way that&apos;s on below, so it still arrives if one of them fails.</p>
              <Toggle label="Send the code by email" hint="Stops fake sign-ups" checked={s.emailCheck} onChange={(v) => setS({ ...s, emailCheck: v })} />
              {s.emailCheck && !emailReady && <p className="m-0 rounded-lg bg-warning/10 px-3 py-2 text-xs">Email isn&apos;t set up on the server, so the code can&apos;t go by email.</p>}
              <Toggle label="Also send the code by text message" hint="Drivers always get it by text" checked={s.phoneCheck} onChange={(v) => setS({ ...s, phoneCheck: v })} />
              {s.phoneCheck && !smsReady && <p className="m-0 rounded-lg bg-warning/10 px-3 py-2 text-xs">Text messages aren&apos;t set up on the server yet (Twilio), so the code goes by email only for now.</p>}
              {!((s.emailCheck && emailReady) || (s.phoneCheck && smsReady)) && <p className="m-0 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">No way to send a code is working, so sign-ups skip the code. One company per phone still applies.</p>}
              <Toggle label="One free company per phone" hint="The same number can't open a second free company" checked={s.onePerPhone} onChange={(v) => setS({ ...s, onePerPhone: v })} />
              <Toggle label="Email me on every new sign-up" hint="To every platform admin" checked={s.notifyEmail} onChange={(v) => setS({ ...s, notifyEmail: v })} />
              <Field id="archive-days" label="Archive inactive free companies after (days)" description="0 = never. Archived companies can be restored.">
                <Input id="archive-days" inputMode="numeric" className="w-28" value={String(s.archiveInactiveDays)} onChange={(e) => setS({ ...s, archiveInactiveDays: Number(e.target.value.replace(/\D/g, "") || 0) })} />
              </Field>
            </CardContent>
          </Card>
        </div>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Upgrade contact</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 pt-4">
              <p className="m-0 text-xs text-muted-foreground">Shown on every lock and the customer&apos;s Plan page.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="c-phone" label="Phone">
                  <Input id="c-phone" type="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
                </Field>
                <Field id="c-wa" label="WhatsApp">
                  <Input id="c-wa" type="tel" value={c.whatsapp} onChange={(e) => setC({ ...c, whatsapp: e.target.value })} />
                </Field>
              </div>
              <Field id="c-email" label="Email">
                <Input id="c-email" type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
              </Field>
              <Field id="c-msg" label="Message under the button">
                <Input id="c-msg" maxLength={200} placeholder="We switch on upgrades for you, usually the same day." value={c.message} onChange={(e) => setC({ ...c, message: e.target.value })} />
              </Field>
              <Field id="c-trial" label="Trial length (days)" description="Default for Give a trial on a customer's page.">
                <Input id="c-trial" inputMode="numeric" className="w-28" value={c.trialDays} onChange={(e) => setC({ ...c, trialDays: e.target.value.replace(/\D/g, "") })} />
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Upgrade requests</CardTitle>
              <Link href="/admin/leads" className="text-sm font-semibold no-underline">
                Open Leads
              </Link>
            </CardHeader>
            <CardContent className="grid gap-2 pt-4">
              {requests.length === 0 ? (
                <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground">
                  <Inbox className="size-4" aria-hidden="true" /> None yet. Each request arrives in Leads with the plan, usage and what they asked for.
                </p>
              ) : (
                requests.map((r) => (
                  <div key={r.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-2.5 text-sm">
                    <div className="min-w-0">
                      <b className="block truncate">{r.company}</b>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.planName ?? "—"} · {r.message?.split("\n")[0]} {r.contactWay ? `· ${r.contactWay}` : ""} · <LocalTime iso={r.createdAt} />
                      </span>
                    </div>
                    <StatusBadge tone={r.status === "new" ? "primary" : r.status === "contacted" ? "success" : "neutral"} label={r.status === "new" ? "New" : r.status === "contacted" ? "Contacted" : "Closed"} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
      <span>
        <b className="block">{label}</b>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} label={label} />
    </label>
  );
}
