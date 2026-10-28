import { contextHasPermission, isLoadEnded } from "@rio-gps/core";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { AppError } from "@/lib/errors";
import { getLoad } from "@/lib/loads";
import { getRequestContext } from "@/lib/request-context";
import { smsConfigured } from "@/lib/sms";
import { LoadForm } from "../../load-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit load · RIO GPS" };

export default async function EditLoadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rc = await getRequestContext();
  if (rc.status !== "ok") redirect(`/login?next=/loads/${id}/edit`);
  if (!contextHasPermission(rc.ctx, "loads.write")) redirect(`/loads/${id}`);
  const load = await getLoad(rc.ctx.organizationId, id).catch((err) => {
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  });
  if (isLoadEnded(load.status)) redirect(`/loads/${id}`);
  return (
    <>
      <PageHeader title={`Edit load ${load.reference}`} breadcrumbs={[{ label: "Loads", href: "/loads" }, { label: load.reference, href: `/loads/${id}` }, { label: "Edit" }]} />
      <LoadForm initial={load} smsAvailable={smsConfigured()} />
    </>
  );
}
