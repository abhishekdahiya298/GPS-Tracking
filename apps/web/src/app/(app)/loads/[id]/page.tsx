import { contextHasPermission } from "@rio-gps/core";
import { notFound, redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { getLoad } from "@/lib/loads";
import { requireTenantPage } from "@/lib/request-context";
import { LoadDetail } from "./load-detail";

export const dynamic = "force-dynamic";
export const metadata = { title: "Load · RIO GPS" };

export default async function LoadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rc = await requireTenantPage(`/loads/${id}`);
  if (!contextHasPermission(rc.ctx, "loads.read")) redirect("/dashboard");
  const load = await getLoad(rc.ctx.organizationId, id).catch((err) => {
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  });
  return <LoadDetail initial={load} canWrite={contextHasPermission(rc.ctx, "loads.write")} />;
}
