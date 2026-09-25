import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getCustomerDetail } from "@/lib/customers";
import { getRequestContext } from "@/lib/request-context";
import { CustomerDetailView } from "./customer-detail";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer · RIO GPS" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect("/login?next=/admin/customers");
  if (!rc.user.isSuperAdmin) redirect("/dashboard");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const detail = await getCustomerDetail(id);
  if (!detail) notFound();
  return <CustomerDetailView c={detail} />;
}
