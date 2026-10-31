import { updateCustomer, UpdateCustomerSchema } from "@/lib/customers";
import { platformWrite } from "@/lib/admin-route";

export const dynamic = "force-dynamic";

/** PATCH a customer's name, short name, contact details, notes or display defaults. */
export const PATCH = platformWrite("admin.customers.update", UpdateCustomerSchema, ({ user, ids, body, meta }) => updateCustomer(user.userId, ids.id!, body, meta), { notFound: "Customer not found" });
