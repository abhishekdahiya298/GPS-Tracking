"use client";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { FormDialog, type FieldSpec, type FormValues } from "./form-dialog";

export type TrackerAction = "assign" | "move" | "return" | "retire" | "unretire" | "edit";

export interface TrackerRef {
  id: string;
  imei: string;
  label: string;
  customerId: string | null;
  customerName?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  notes?: string | null;
}

const REASON: FieldSpec = { name: "reason", label: "Reason", kind: "textarea", required: true, maxLength: 300, description: "Kept in the activity log." };

/** Assign / move / return / retire / edit one tracker. Every action is audited on the server. */
export function TrackerActionDialog({ action, tracker, onOpenChange, onDone }: { action: TrackerAction; tracker: TrackerRef; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const who = `${tracker.label} (IMEI ${tracker.imei})`;
  const post = (path: string, json: unknown) => api(`/api/admin/trackers/${tracker.id}${path}`, { method: "POST", json });
  const done = (msg: string) => {
    toast.success(msg);
    onDone();
  };
  const cfg: Record<TrackerAction, { title: string; intro?: string; fields: FieldSpec[]; confirm: string; danger?: boolean; run: (v: FormValues) => Promise<void> }> = {
    assign: {
      title: "Assign to a customer",
      intro: "The tracker starts storing positions for this customer as soon as it reports. It appears on their Devices page, ready to put on a vehicle.",
      fields: [
        { name: "organizationId", label: "Customer", kind: "customer", required: true },
        { name: "name", label: "Name the customer sees", kind: "text", maxLength: 80, placeholder: "e.g. Truck 7 tracker", description: "Optional." }
      ],
      confirm: "Assign",
      run: async (v) => {
        await post("/assign", { organizationId: v.organizationId, ...(String(v.name).trim() ? { name: String(v.name).trim() } : {}) });
        done("Tracker assigned");
      }
    },
    move: {
      title: "Move to another customer",
      intro: `Taken off its vehicle at ${tracker.customerName ?? "the current customer"} and given to the new customer. Their past trips and positions stay with ${tracker.customerName ?? "them"}; the new customer only sees what the tracker records from now on.`,
      fields: [{ name: "organizationId", label: "New customer", kind: "customer", required: true, excludeId: tracker.customerId }, REASON],
      confirm: "Move tracker",
      run: async (v) => {
        await post("/move", { organizationId: v.organizationId, reason: String(v.reason).trim() });
        done("Tracker moved");
      }
    },
    return: {
      title: "Return to stock",
      intro: `Taken back from ${tracker.customerName ?? "the customer"} (their history stays with them). Its SIM stays in it; suspend the SIM on the SIMs page if it will sit in stock for a while.`,
      fields: [REASON, { name: "retire", label: "Retire it instead (faulty, lost or end of life)", kind: "checkbox" }],
      confirm: "Return tracker",
      run: async (v) => {
        await post("/return", { reason: String(v.reason).trim(), retire: Boolean(v.retire) });
        done(v.retire ? "Tracker returned and retired" : "Tracker back in stock");
      }
    },
    retire: {
      title: "Retire tracker",
      intro: "Retired trackers can't be given to customers until they are put back in stock.",
      fields: [REASON],
      confirm: "Retire",
      danger: true,
      run: async (v) => {
        await post("/retire", { retired: true, reason: String(v.reason).trim() });
        done("Tracker retired");
      }
    },
    unretire: {
      title: "Put back in stock",
      fields: [REASON],
      confirm: "Put back in stock",
      run: async (v) => {
        await post("/retire", { retired: false, reason: String(v.reason).trim() });
        done("Tracker back in stock");
      }
    },
    edit: {
      title: "Edit tracker details",
      intro: "Platform details only; the customer's name for the tracker is changed on their Devices page.",
      fields: [
        { name: "model", label: "Model", kind: "text", required: true, maxLength: 60, defaultValue: tracker.model ?? "", half: true },
        { name: "serialNumber", label: "Serial number", kind: "text", maxLength: 60, defaultValue: tracker.serialNumber ?? "", half: true },
        { name: "notes", label: "Notes", kind: "textarea", maxLength: 500, defaultValue: tracker.notes ?? "", description: "Never shown to customers." }
      ],
      confirm: "Save",
      run: async (v) => {
        await api(`/api/admin/trackers/${tracker.id}`, { method: "PATCH", json: { model: String(v.model).trim(), serialNumber: String(v.serialNumber).trim() || null, notes: String(v.notes).trim() || null } });
        done("Tracker updated");
      }
    }
  };
  const c = cfg[action];
  return (
    <FormDialog
      title={c.title}
      description={who}
      intro={c.intro ? <p className="m-0 text-sm text-muted-foreground">{c.intro}</p> : undefined}
      fields={c.fields}
      confirmLabel={c.confirm}
      danger={c.danger}
      onSubmit={c.run}
      onOpenChange={onOpenChange}
    />
  );
}
