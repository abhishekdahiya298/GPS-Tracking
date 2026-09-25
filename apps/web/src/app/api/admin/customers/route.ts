import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-guard";
import { assertSameOrigin } from "@/lib/csrf";
import { createCustomer, CreateCustomerSchema, listCustomers } from "@/lib/customers";
import { errorResponse } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireSuperAdmin(request);
    return NextResponse.json({ customers: await listCustomers() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "admin.customers.list" });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSuperAdmin(request);
    const out = await createCustomer(user.userId, parseOrThrow(CreateCustomerSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json(out, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "admin.customers.create" });
  }
}
