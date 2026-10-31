"use client";
import { Copy } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import type { CustomerDetail } from "@/lib/customers";
import { FormDialog } from "../../_shared/form-dialog";

const ROLES = [
  { value: "ORG_ADMIN", label: "Org admin: everything, including users and settings" },
  { value: "FLEET_MANAGER", label: "Fleet manager: vehicles, zones, alerts, loads" },
  { value: "DISPATCHER", label: "Dispatcher: live map, loads, alerts" },
  { value: "VIEWER", label: "Viewer: read only" }
];

/** Name, short name, account contact, internal notes and the customer's display defaults. */
export function EditCustomerDialog({ c, onOpenChange, onDone }: { c: CustomerDetail; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  return (
    <FormDialog
      title="Edit customer"
      description={c.name}
      fields={[
        { name: "name", label: "Company name", kind: "text", required: true, maxLength: 120, defaultValue: c.name, half: true },
        { name: "slug", label: "Short name", kind: "text", required: true, maxLength: 50, defaultValue: c.slug, description: "Lowercase letters, digits and dashes.", half: true },
        { name: "contactName", label: "Account contact", kind: "text", maxLength: 200, defaultValue: c.contactName ?? "", half: true },
        { name: "contactPhone", label: "Contact phone", kind: "tel", maxLength: 40, defaultValue: c.contactPhone ?? "", half: true },
        { name: "contactEmail", label: "Contact email (billing)", kind: "email", maxLength: 254, defaultValue: c.contactEmail ?? "" },
        { name: "timeZone", label: "Time zone", kind: "timezone", defaultValue: c.timeZone },
        { name: "unitSystem", label: "Units", kind: "select", defaultValue: c.unitSystem, options: [{ value: "imperial", label: "Miles, mph" }, { value: "metric", label: "Kilometres, km/h" }], half: true },
        { name: "timeFormat", label: "Clock", kind: "select", defaultValue: c.timeFormat, options: [{ value: "12h", label: "12-hour (3:45 PM)" }, { value: "24h", label: "24-hour (15:45)" }], half: true },
        { name: "notes", label: "Internal notes", kind: "textarea", maxLength: 2000, defaultValue: c.notes ?? "", description: "Platform admins only; never shown to the customer." }
      ]}
      confirmLabel="Save"
      onSubmit={async (v) => {
        const out = await api<{ changed: string[] }>(`/api/admin/customers/${c.id}`, {
          method: "PATCH",
          json: {
            name: String(v.name).trim(),
            slug: String(v.slug).trim(),
            contactName: String(v.contactName),
            contactPhone: String(v.contactPhone),
            contactEmail: String(v.contactEmail).trim(),
            timeZone: v.timeZone,
            unitSystem: v.unitSystem,
            timeFormat: v.timeFormat,
            notes: String(v.notes)
          }
        });
        toast.success(out.changed.length ? "Customer updated" : "Nothing changed");
        onDone();
      }}
      onOpenChange={onOpenChange}
    />
  );
}

type Member = CustomerDetail["members"][number];
export type MemberAction = { action: "add" } | { action: "rename" | "role" | "password" | "twostep" | "remove"; m: Member };

/** Add a user, or rename / change role / reset password / turn off two-step / remove one. */
export function MemberDialog({ customer, action, onOpenChange, onDone, onClose }: { customer: CustomerDetail; action: MemberAction; onOpenChange: (o: boolean) => void; onDone: () => void; onClose: () => void }) {
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  const base = `/api/admin/customers/${customer.id}/members`;
  if (secret) return <TemporaryPassword who={secret.who} password={secret.password} onClose={onClose} />;
  const finish = (msg: string) => {
    toast.success(msg);
    onDone();
    onClose();
  };
  if (action.action === "add") {
    return (
      <FormDialog
        title={`Add a user to ${customer.name}`}
        description="They get an email with a link to set their password. If they already have a RIO GPS account, this company is added to it."
        fields={[
          { name: "name", label: "Name", kind: "text", required: true, maxLength: 200, half: true },
          { name: "email", label: "Email", kind: "email", required: true, maxLength: 254, half: true },
          { name: "role", label: "Role", kind: "select", options: ROLES, defaultValue: "ORG_ADMIN" }
        ]}
        confirmLabel="Add user"
        onSubmit={async (v) => {
          const out = await api<{ temporaryPassword: string | null; emailed: boolean }>(base, { method: "POST", json: { name: String(v.name).trim(), email: String(v.email).trim(), role: v.role } });
          onDone();
          if (out.temporaryPassword) setSecret({ who: String(v.email).trim(), password: out.temporaryPassword });
          else finish(out.emailed ? "User added and invitation emailed" : "User added");
        }}
        onOpenChange={onOpenChange}
      />
    );
  }
  const m = action.m;
  const url = `${base}/${m.userId}`;
  switch (action.action) {
    case "rename":
      return (
        <FormDialog
          title="Edit name"
          description={m.email}
          fields={[{ name: "name", label: "Name", kind: "text", required: true, maxLength: 200, defaultValue: m.name }]}
          confirmLabel="Save"
          onSubmit={async (v) => {
            await api(`${url}/name`, { method: "PATCH", json: { name: String(v.name) } });
            finish("Name updated");
          }}
          onOpenChange={onOpenChange}
        />
      );
    case "role":
      return (
        <FormDialog
          title="Change role"
          description={`${m.name} · ${m.email}`}
          fields={[{ name: "role", label: "Role", kind: "select", options: ROLES, defaultValue: m.role }]}
          confirmLabel="Save"
          onSubmit={async (v) => {
            await api(url, { method: "PATCH", json: { role: v.role } });
            finish("Role changed");
          }}
          onOpenChange={onOpenChange}
        />
      );
    case "password":
      return (
        <FormDialog
          title="Reset password"
          description={`${m.name} · ${m.email}`}
          intro={<p className="m-0 text-sm text-muted-foreground">Their current password stops working and they are signed out everywhere. They get an email to set a new one (or you get a one-time temporary password to pass on).</p>}
          fields={[]}
          confirmLabel="Reset password"
          danger
          onSubmit={async () => {
            const out = await api<{ temporaryPassword: string | null; emailed: boolean }>(`${url}/reset-password`, { method: "POST" });
            onDone();
            if (out.temporaryPassword) setSecret({ who: m.email, password: out.temporaryPassword });
            else finish("Password reset email sent");
          }}
          onOpenChange={onOpenChange}
        />
      );
    case "twostep":
      return (
        <FormDialog
          title="Turn off two-step verification"
          description={`${m.name} · ${m.email}`}
          intro={<p className="m-0 text-sm text-muted-foreground">For someone who lost their phone and backup codes. Their password is unchanged and they are signed out everywhere. Confirm who you are talking to first.</p>}
          fields={[]}
          confirmLabel="Turn off two-step"
          danger
          onSubmit={async () => {
            await api(`${url}/reset-two-step`, { method: "POST" });
            finish("Two-step verification turned off");
          }}
          onOpenChange={onOpenChange}
        />
      );
    case "remove":
      return (
        <FormDialog
          title={`Remove from ${customer.name}`}
          description={`${m.name} · ${m.email}`}
          intro={<p className="m-0 text-sm text-muted-foreground">They lose access to this company at once and are signed out. Their account and anything they did here stay in the records; access to other companies is not affected.</p>}
          fields={[]}
          confirmLabel="Remove user"
          danger
          onSubmit={async () => {
            await api(url, { method: "DELETE" });
            finish("User removed");
          }}
          onOpenChange={onOpenChange}
        />
      );
  }
}

function TemporaryPassword({ who, password, onClose }: { who: string; password: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="One-time temporary password" description={`Give this to ${who} by phone or in person. It is shown only once.`} className="max-w-md">
        <div className="grid gap-3">
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 font-mono text-base">
            <span className="min-w-0 flex-1 break-all">{password}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await navigator.clipboard.writeText(password);
                toast.success("Copied");
              }}
            >
              <Copy /> Copy
            </Button>
          </div>
          <Alert tone="info">Email isn&apos;t set up on the server, so no email was sent. They should change it under My account after signing in.</Alert>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
