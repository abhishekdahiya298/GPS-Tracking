"use client";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";

/** Switch the session into a customer's organization (audited server-side), then open their dashboard. */
export async function viewAs(organizationId: string | null) {
  try {
    await api("/api/admin/view-as", { method: "POST", json: { organizationId } });
    window.location.assign(organizationId ? "/dashboard" : "/admin/customers");
  } catch (err) {
    toast.error(errorMessage(err));
  }
}
