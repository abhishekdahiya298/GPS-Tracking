"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/client/api";
import { FLEET_SIZES, LeadInputSchema } from "@/lib/schemas/lead";

type Values = z.input<typeof LeadInputSchema>;

/** Public pricing request. Same zod schema as the API; the server stays authoritative. */
export function LeadForm() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(LeadInputSchema), defaultValues: { name: "", company: "", email: "", phone: "", message: "", website: "" } });
  const { errors, isSubmitting } = form.formState;

  async function submit(values: Values) {
    setError(null);
    try {
      await api("/api/leads", { method: "POST", json: LeadInputSchema.parse(values) });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (done) {
    return (
      <div role="status" className="rounded-xl border border-border bg-background p-6 shadow-card">
        <CheckCircle2 className="size-6 text-success" aria-hidden="true" />
        <h2 className="m-0 mt-3 text-lg font-semibold">Thanks, we have your request</h2>
        <p className="m-0 mt-1.5 text-sm text-muted-foreground">We will reply by email with a quote. There is nothing else you need to do.</p>
      </div>
    );
  }

  const invalid = (k: keyof Values) => ({ "aria-invalid": Boolean(errors[k]), "aria-describedby": errors[k] ? `l-${k}-error` : undefined });
  return (
    <form method="post" noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-4 rounded-xl border border-border bg-background p-5 shadow-card sm:p-6">
      <Field id="l-name" label="Your name" required error={errors.name?.message}>
        <Input id="l-name" autoComplete="name" {...invalid("name")} {...form.register("name")} />
      </Field>
      <Field id="l-company" label="Company" required error={errors.company?.message}>
        <Input id="l-company" autoComplete="organization" {...invalid("company")} {...form.register("company")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="l-email" label="Work email" required error={errors.email?.message}>
          <Input id="l-email" type="email" autoComplete="email" {...invalid("email")} {...form.register("email")} />
        </Field>
        <Field id="l-phone" label="Phone" description="Optional" error={errors.phone?.message}>
          <Input id="l-phone" type="tel" autoComplete="tel" {...form.register("phone")} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="l-fleetSize" label="Vehicles to track" required error={errors.fleetSize?.message}>
          <Select id="l-fleetSize" defaultValue="" {...invalid("fleetSize")} {...form.register("fleetSize")}>
            <option value="" disabled>
              Choose…
            </option>
            {FLEET_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="l-country" label="Country" required error={errors.country?.message}>
          <Select id="l-country" defaultValue="" {...invalid("country")} {...form.register("country")}>
            <option value="" disabled>
              Choose…
            </option>
            <option value="CA">Canada</option>
            <option value="US">United States</option>
          </Select>
        </Field>
      </div>
      <Field id="l-message" label="Anything we should know?" description="Optional" error={errors.message?.message}>
        <Textarea id="l-message" rows={3} {...form.register("message")} />
      </Field>
      {/* Hidden from people and assistive technology; bots that fill it are ignored. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" tabIndex={-1} autoComplete="off" {...form.register("website")} />
        </label>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" size="lg" loading={isSubmitting}>
        Request pricing
      </Button>
      <p className="m-0 text-xs text-muted-foreground">
        We use these details only to reply to your request. See our <Link href="/privacy">privacy policy</Link>.
      </p>
    </form>
  );
}
