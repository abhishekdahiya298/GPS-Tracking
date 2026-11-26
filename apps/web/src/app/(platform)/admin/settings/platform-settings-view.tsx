"use client";
import { Building2, LifeBuoy, Save, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { PageHeader } from "@/components/app/page-header";
import { TimeZoneSelect } from "@/components/app/time-zone-select";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { PlatformSettings } from "@/lib/platform-settings";

function Section({ icon: Icon, color, title, hint, children }: { icon: typeof Save; color: string; title: string; hint: string; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg text-white" style={{ background: color }}>
          <Icon className="size-[18px]" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <b className="block text-[15px] text-[#0a2463] dark:text-foreground">{title}</b>
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

/** Platform → Platform settings: values the RIO team changes without a code change. */
export function PlatformSettingsView({ initial }: { initial: PlatformSettings }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v)]));
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/platform-settings", { method: "PUT", json: body });
      toast.success("Platform settings saved");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <PageHeader
        title="Platform settings"
        description="Settings for every customer, changed here instead of in code. Changes apply within a minute."
        actions={
          <Button type="submit" variant="secondary" loading={busy}>
            <Save /> Save
          </Button>
        }
      />
      {error && <Alert tone="danger" className="mb-4" title={error} />}
      <div className="grid gap-4 xl:grid-cols-2">
        <Section icon={LifeBuoy} color="#1d4ed8" title="Support contact" hint="Shown to customers on suspended accounts, Plan & billing and GPS devices.">
          <Field id="supportEmail" label="Support email" required>
            <Input id="supportEmail" name="supportEmail" type="email" required defaultValue={initial.supportEmail} />
          </Field>
          <Field id="supportPhone" label="Support phone" description="Leave empty to show email only.">
            <Input id="supportPhone" name="supportPhone" type="tel" defaultValue={initial.supportPhone} placeholder="+1 905 555 0100" />
          </Field>
        </Section>
        <Section icon={Smartphone} color="#15803d" title="Driver app" hint="How driver phones are shown and which positions are kept.">
          <Field id="driverStaleMinutes" label="Not heard from after (minutes)" description="A signed-in phone quiet this long shows Not heard from.">
            <Input id="driverStaleMinutes" name="driverStaleMinutes" type="number" min={5} max={1440} required defaultValue={initial.driverStaleMinutes} />
          </Field>
          <Field id="driverInviteDays" label="Invite links work for (days)">
            <Input id="driverInviteDays" name="driverInviteDays" type="number" min={1} max={30} required defaultValue={initial.driverInviteDays} />
          </Field>
          <Field id="driverMaxAccuracyM" label="Drop phone positions less accurate than (m)" description="Rough guesses (Wi-Fi or cell towers) are left off the map.">
            <Input id="driverMaxAccuracyM" name="driverMaxAccuracyM" type="number" min={20} max={2000} required defaultValue={initial.driverMaxAccuracyM} />
          </Field>
          <Field id="driverTestNumbers" label="Test driver numbers" description="The app fills in the sign-in code for these numbers (testing and store review). One per line. Demo numbers 555-0100 to 555-0199 always work. Never add a real driver's number.">
            <Textarea id="driverTestNumbers" name="driverTestNumbers" rows={3} maxLength={2000} defaultValue={initial.driverTestNumbers} placeholder={"+1 416 555 0142"} />
          </Field>
        </Section>
        <Section icon={Building2} color="#6d28d9" title="New companies" hint="What a company starts with when it signs up. Each company can change its own later.">
          <Field id="defaultCountry" label="Country">
            <Select id="defaultCountry" name="defaultCountry" defaultValue={initial.defaultCountry}>
              <option value="CA">Canada</option>
              <option value="US">United States</option>
            </Select>
          </Field>
          <Field id="defaultTimeZone" label="Time zone" description="Used when the browser doesn't give one.">
            <TimeZoneSelect id="defaultTimeZone" name="defaultTimeZone" defaultValue={initial.defaultTimeZone} />
          </Field>
          <Field id="defaultUnitSystem" label="Units">
            <Select id="defaultUnitSystem" name="defaultUnitSystem" defaultValue={initial.defaultUnitSystem}>
              <option value="imperial">Miles and mph</option>
              <option value="metric">Kilometres and km/h</option>
            </Select>
          </Field>
        </Section>
      </div>
    </form>
  );
}
