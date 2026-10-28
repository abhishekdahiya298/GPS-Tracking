import { contextHasPermission } from "@rio-gps/core";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { getRequestContext } from "@/lib/request-context";
import { smsConfigured } from "@/lib/sms";
import { LoadForm } from "../load-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New load · RIO GPS" };

export default async function NewLoadPage() {
  const rc = await getRequestContext();
  if (rc.status !== "ok") redirect("/login?next=/loads/new");
  if (!contextHasPermission(rc.ctx, "loads.write")) redirect("/loads");
  return (
    <>
      <PageHeader title="New load" description="The driver gets a link; tracking starts when they accept and stops when the load is delivered." breadcrumbs={[{ label: "Loads", href: "/loads" }, { label: "New load" }]} />
      <LoadForm smsAvailable={smsConfigured()} />
    </>
  );
}
