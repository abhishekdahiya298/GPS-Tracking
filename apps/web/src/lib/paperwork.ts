import type { TenantContext } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { z } from "zod";
import { writeAudit } from "./audit";
import { deleteDocument, getDocument, MAX_DOCUMENT_BYTES, putDocument, sniffType } from "./document-store";
import { notifyDriverPhone } from "./driver-loads";
import { sendEmail, isEmailEnabled } from "./email";
import { getServerEnv } from "./env";
import { NotFoundError, ValidationError } from "./errors";
import { logger } from "./logger";

/**
 * Load paperwork (A39–A41): what the driver sends at pickup and delivery, kept with the load,
 * and the load packet (one PDF) emailed when the load is done.
 *
 * Rules the owner set: a missing required item never blocks the load; it flags the load and
 * reminds the driver. Each company chooses its list; a load can change it. A broker sees only
 * the paperwork of its own load (documents belong to the load's organization).
 */

export type PaperworkMode = "off" | "optional" | "required";
export type PaperworkStop = "pickup" | "delivery";
export interface PaperworkItem {
  key: string;
  stop: PaperworkStop;
  label: string;
  /** doc: the scanner opens first; photo: the camera opens first. */
  kind: "doc" | "photo";
  mode: PaperworkMode;
}

export const DEFAULT_PAPERWORK: PaperworkItem[] = [
  { key: "pickup_bol", stop: "pickup", label: "Bill of lading (BOL)", kind: "doc", mode: "required" },
  { key: "pickup_seal", stop: "pickup", label: "Seal photo", kind: "photo", mode: "optional" },
  { key: "pickup_freight", stop: "pickup", label: "Freight photo", kind: "photo", mode: "optional" },
  { key: "pickup_other", stop: "pickup", label: "Other document", kind: "doc", mode: "off" },
  { key: "delivery_pod", stop: "delivery", label: "Signed BOL / POD", kind: "doc", mode: "required" },
  { key: "delivery_docs", stop: "delivery", label: "Delivery documents", kind: "doc", mode: "optional" },
  { key: "delivery_empty", stop: "delivery", label: "Empty trailer photo", kind: "photo", mode: "optional" },
  { key: "delivery_freight", stop: "delivery", label: "Freight photo", kind: "photo", mode: "off" }
];

export const SEND_WHEN = ["delivered", "complete", "manual"] as const;

const ItemSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,40}$/),
  stop: z.enum(["pickup", "delivery"]),
  label: z.string().trim().min(2).max(60),
  kind: z.enum(["doc", "photo"]),
  mode: z.enum(["off", "optional", "required"])
});

export const PaperworkSettingsSchema = z.object({
  items: z
    .array(ItemSchema)
    .min(1)
    .max(20)
    .refine((a) => new Set(a.map((i) => i.key)).size === a.length, "Each item needs its own name"),
  recipients: z.array(z.string().trim().toLowerCase().email("Enter emails like billing@company.com")).max(10).default([]),
  toCreator: z.boolean().default(true),
  sendWhen: z.enum(SEND_WHEN).default("delivered")
});
export type PaperworkSettings = z.infer<typeof PaperworkSettingsSchema>;

/** A load's own list: the company's items with this load's Off/Optional/Required. */
export const LoadPaperworkSchema = z.object({ items: z.array(z.object({ key: z.string().regex(/^[a-z0-9_]{2,40}$/), mode: z.enum(["off", "optional", "required"]) })).max(20) });

export async function getPaperworkSettings(organizationId: string): Promise<PaperworkSettings> {
  const [r] = await getDb().select().from(schema.paperworkSettings).where(eq(schema.paperworkSettings.organizationId, organizationId));
  const items = PaperworkSettingsSchema.shape.items.safeParse(r?.items);
  return {
    items: items.success ? items.data : DEFAULT_PAPERWORK,
    recipients: Array.isArray(r?.recipients) ? (r!.recipients as string[]) : [],
    toCreator: r?.toCreator ?? true,
    sendWhen: (SEND_WHEN as readonly string[]).includes(r?.sendWhen ?? "") ? (r!.sendWhen as PaperworkSettings["sendWhen"]) : "delivered"
  };
}

export async function savePaperworkSettings(ctx: TenantContext, input: PaperworkSettings, meta: { ipAddress: string | null; userAgent: string | null }): Promise<PaperworkSettings> {
  const now = new Date();
  await getDb()
    .insert(schema.paperworkSettings)
    .values({ organizationId: ctx.organizationId, items: input.items, recipients: input.recipients, toCreator: input.toCreator, sendWhen: input.sendWhen, updatedAt: now })
    .onConflictDoUpdate({ target: schema.paperworkSettings.organizationId, set: { items: input.items, recipients: input.recipients, toCreator: input.toCreator, sendWhen: input.sendWhen, updatedAt: now } });
  await writeAudit({ action: "paperwork.settings_updated", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "organization", targetId: ctx.organizationId, metadata: { items: input.items.length }, ...meta });
  return input;
}

/** Every item for a load (Off included), with this load's own modes applied. */
export function itemsForLoad(company: PaperworkItem[], override: unknown): PaperworkItem[] {
  const own = LoadPaperworkSchema.shape.items.safeParse(override);
  if (!own.success) return company;
  const mode = new Map(own.data.map((i) => [i.key, i.mode]));
  return company.map((i) => (mode.has(i.key) ? { ...i, mode: mode.get(i.key)! } : i));
}

const REACHED: Record<PaperworkStop, string[]> = { pickup: ["at_pickup", "in_transit", "at_delivery", "delivered"], delivery: ["at_delivery", "delivered"] };

export interface LoadDocumentDto {
  id: string;
  itemKey: string;
  stop: PaperworkStop;
  contentType: string;
  bytes: number;
  fileName: string | null;
  method: string | null;
  at: string;
  by: "driver" | "team";
  byName: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface LoadPaperworkDto {
  items: (PaperworkItem & { docs: LoadDocumentDto[]; due: boolean; missing: boolean })[];
  /** Documents for items no longer on the list (kept, still shown). */
  other: LoadDocumentDto[];
  requiredCount: number;
  requiredDone: number;
  /** Required items whose stop was reached and that nothing was sent for. */
  missing: number;
  packet: { sentAt: string | null; sendWhen: PaperworkSettings["sendWhen"]; recipients: string[] };
  /** The company's own list differs for this load. */
  customized: boolean;
}

type LoadForPaperwork = Pick<typeof schema.loads.$inferSelect, "id" | "organizationId" | "status" | "paperwork" | "packetSentAt" | "createdBy">;

async function loadFor(organizationId: string, loadId: string): Promise<LoadForPaperwork> {
  if (!z.string().uuid().safeParse(loadId).success) throw new NotFoundError("Load not found");
  const [l] = await getDb()
    .select({ id: schema.loads.id, organizationId: schema.loads.organizationId, status: schema.loads.status, paperwork: schema.loads.paperwork, packetSentAt: schema.loads.packetSentAt, createdBy: schema.loads.createdBy })
    .from(schema.loads)
    .where(and(eq(schema.loads.id, loadId), eq(schema.loads.organizationId, organizationId)));
  if (!l) throw new NotFoundError("Load not found");
  return l;
}

async function documentsOf(organizationId: string, loadIds: string[]): Promise<(LoadDocumentDto & { loadId: string; fileKey: string })[]> {
  if (!loadIds.length) return [];
  const d = schema.loadDocuments;
  const rows = await getDb()
    .select({ doc: d, driverName: schema.drivers.name, userName: schema.users.name })
    .from(d)
    .leftJoin(schema.drivers, eq(schema.drivers.id, d.driverId))
    .leftJoin(schema.users, eq(schema.users.id, d.userId))
    .where(and(eq(d.organizationId, organizationId), inArray(d.loadId, loadIds), isNull(d.deletedAt)))
    .orderBy(asc(d.createdAt));
  return rows.map(({ doc, driverName, userName }) => ({
    id: doc.id,
    loadId: doc.loadId,
    fileKey: doc.fileKey,
    itemKey: doc.itemKey,
    stop: doc.stop as PaperworkStop,
    contentType: doc.contentType,
    bytes: doc.bytes,
    fileName: doc.fileName,
    method: doc.method,
    at: (doc.capturedAt ?? doc.createdAt).toISOString(),
    by: doc.driverId ? "driver" : "team",
    byName: driverName ?? userName ?? null,
    latitude: doc.latitude,
    longitude: doc.longitude
  }));
}

/** What clients see: never the storage key. */
function publicDoc<T extends LoadDocumentDto & { fileKey?: string; loadId?: string }>(d: T): LoadDocumentDto {
  const { fileKey: _k, loadId: _l, ...rest } = d;
  void _k;
  void _l;
  return rest;
}

function summarize(load: LoadForPaperwork, settings: PaperworkSettings, docs: LoadDocumentDto[]): LoadPaperworkDto {
  const all = itemsForLoad(settings.items, load.paperwork);
  const active = all.filter((i) => i.mode !== "off");
  const keys = new Set(active.map((i) => i.key));
  const items = active.map((i) => {
    const mine = docs.filter((d) => d.itemKey === i.key);
    const due = REACHED[i.stop].includes(load.status);
    return { ...i, docs: mine, due, missing: i.mode === "required" && due && mine.length === 0 };
  });
  const required = items.filter((i) => i.mode === "required");
  return {
    items,
    other: docs.filter((d) => !keys.has(d.itemKey)),
    requiredCount: required.length,
    requiredDone: required.filter((i) => i.docs.length > 0).length,
    missing: items.filter((i) => i.missing).length,
    packet: { sentAt: load.packetSentAt?.toISOString() ?? null, sendWhen: settings.sendWhen, recipients: settings.recipients },
    customized: Boolean(load.paperwork)
  };
}

export async function loadPaperwork(organizationId: string, loadId: string): Promise<LoadPaperworkDto> {
  const load = await loadFor(organizationId, loadId);
  const [settings, docs] = await Promise.all([getPaperworkSettings(organizationId), documentsOf(organizationId, [loadId])]);
  return summarize(load, settings, docs.map(publicDoc));
}

/** Paperwork counts for many loads at once (lists, map cards): done / required and missing. */
export async function paperworkCounts(organizationId: string, loads: { id: string; status: string; paperwork?: unknown }[]): Promise<Map<string, { requiredDone: number; requiredCount: number; missing: number; docs: number }>> {
  const out = new Map<string, { requiredDone: number; requiredCount: number; missing: number; docs: number }>();
  if (!loads.length) return out;
  const [settings, docs] = await Promise.all([getPaperworkSettings(organizationId), documentsOf(organizationId, loads.map((l) => l.id))]);
  for (const l of loads) {
    const s = summarize({ id: l.id, organizationId, status: l.status as LoadForPaperwork["status"], paperwork: l.paperwork ?? null, packetSentAt: null, createdBy: null }, settings, docs.filter((d) => d.loadId === l.id));
    out.set(l.id, { requiredDone: s.requiredDone, requiredCount: s.requiredCount, missing: s.missing, docs: docs.filter((d) => d.loadId === l.id).length });
  }
  return out;
}

export async function setLoadPaperwork(ctx: TenantContext, loadId: string, input: z.infer<typeof LoadPaperworkSchema>): Promise<LoadPaperworkDto> {
  await loadFor(ctx.organizationId, loadId);
  await getDb()
    .update(schema.loads)
    .set({ paperwork: input.items.length ? input.items : null, updatedAt: new Date() })
    .where(and(eq(schema.loads.id, loadId), eq(schema.loads.organizationId, ctx.organizationId)));
  return loadPaperwork(ctx.organizationId, loadId);
}

export interface NewDocument {
  organizationId: string;
  loadId: string;
  itemKey: string;
  data: Buffer;
  fileName?: string | null;
  method?: "scan" | "camera" | "upload" | null;
  latitude?: number | null;
  longitude?: number | null;
  capturedAt?: Date | null;
  driverId?: string | null;
  userId?: string | null;
}

export async function addLoadDocument(input: NewDocument): Promise<LoadDocumentDto> {
  const load = await loadFor(input.organizationId, input.loadId);
  if (input.data.length === 0) throw new ValidationError("The file is empty");
  if (input.data.length > MAX_DOCUMENT_BYTES) throw new ValidationError("That file is over 15 MB. Take a photo or scan instead.");
  const type = sniffType(input.data);
  if (!type) throw new ValidationError("Send a photo (JPG, PNG, HEIC) or a PDF");
  const settings = await getPaperworkSettings(input.organizationId);
  const item = itemsForLoad(settings.items, load.paperwork).find((i) => i.key === input.itemKey);
  const stop: PaperworkStop = item?.stop ?? (input.itemKey.startsWith("pickup") ? "pickup" : "delivery");
  if (!item && input.itemKey !== "other") throw new ValidationError("That paperwork item isn't on this load");
  const count = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.loadDocuments)
    .where(and(eq(schema.loadDocuments.loadId, input.loadId), isNull(schema.loadDocuments.deletedAt)));
  if ((count[0]?.n ?? 0) >= 60) throw new ValidationError("This load already has 60 files. Remove some first.");
  const key = await putDocument(input.organizationId, input.loadId, type, input.data);
  const ext = type === "application/pdf" ? "pdf" : type.split("/")[1];
  const [row] = await getDb()
    .insert(schema.loadDocuments)
    .values({
      organizationId: input.organizationId,
      loadId: input.loadId,
      itemKey: input.itemKey,
      stop,
      fileKey: key,
      fileName: (input.fileName?.replace(/[^\w .()-]/g, "").slice(0, 80) || `${item?.label ?? "Document"}.${ext}`).trim(),
      contentType: type,
      bytes: input.data.length,
      method: input.method ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      capturedAt: input.capturedAt ?? null,
      driverId: input.driverId ?? null,
      userId: input.userId ?? null
    })
    .returning();
  await getDb()
    .insert(schema.loadEvents)
    .values({ organizationId: input.organizationId, loadId: input.loadId, type: "paperwork_added", actorUserId: input.userId ?? null, latitude: input.latitude ?? null, longitude: input.longitude ?? null, detail: { item: input.itemKey, label: item?.label ?? "Other document", by: input.driverId ? "driver" : "team" } });
  // "When all required paperwork is in": send the packet as soon as the last required item arrives.
  if (settings.sendWhen === "complete") void maybeSendPacket(input.organizationId, input.loadId, "complete");
  return publicDoc((await documentsOf(input.organizationId, [input.loadId])).find((d) => d.id === row!.id)!);
}

export async function removeLoadDocument(ctx: TenantContext, loadId: string, documentId: string, meta: { ipAddress: string | null; userAgent: string | null }): Promise<void> {
  await loadFor(ctx.organizationId, loadId);
  const [row] = await getDb()
    .update(schema.loadDocuments)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.loadDocuments.id, documentId), eq(schema.loadDocuments.loadId, loadId), eq(schema.loadDocuments.organizationId, ctx.organizationId), isNull(schema.loadDocuments.deletedAt)))
    .returning({ key: schema.loadDocuments.fileKey });
  if (!row) throw new NotFoundError("Document not found");
  await deleteDocument(row.key).catch(() => undefined);
  await writeAudit({ action: "paperwork.document_removed", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "load", targetId: loadId, metadata: { documentId }, ...meta });
}

export async function documentFile(organizationId: string, loadId: string, documentId: string): Promise<{ data: Buffer; contentType: string; fileName: string }> {
  if (!z.string().uuid().safeParse(documentId).success) throw new NotFoundError("Document not found");
  const [row] = await getDb()
    .select()
    .from(schema.loadDocuments)
    .where(and(eq(schema.loadDocuments.id, documentId), eq(schema.loadDocuments.loadId, loadId), eq(schema.loadDocuments.organizationId, organizationId), isNull(schema.loadDocuments.deletedAt)));
  if (!row) throw new NotFoundError("Document not found");
  return { data: await getDocument(row.fileKey), contentType: row.contentType, fileName: row.fileName ?? "document" };
}

// ---------- the load packet ----------

/** Helvetica only knows Western European characters: keep the text readable in the PDF. */
function pdfText(s: string): string {
  return s
    .replace(/[→⟶]/g, "->")
    .replace(/[·•]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "");
}

export async function buildLoadPacket(organizationId: string, loadId: string): Promise<{ pdf: Buffer; filename: string; reference: string }> {
  const db = getDb();
  const [l] = await db
    .select({ l: schema.loads, org: schema.organizations.name, tz: schema.organizations.timeZone, vehicle: schema.vehicles.name })
    .from(schema.loads)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.loads.organizationId))
    .leftJoin(schema.vehicles, eq(schema.vehicles.id, schema.loads.vehicleId))
    .where(and(eq(schema.loads.id, loadId), eq(schema.loads.organizationId, organizationId)));
  if (!l) throw new NotFoundError("Load not found");
  const pw = await loadPaperwork(organizationId, loadId);
  const docs = await documentsOf(organizationId, [loadId]);
  const events = await db.select().from(schema.loadEvents).where(eq(schema.loadEvents.loadId, loadId)).orderBy(asc(schema.loadEvents.at));
  const tz = l.tz ?? "America/Toronto";
  const when = (d: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(d));

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Load ${l.l.reference}`);
  pdf.setProducer("RIO GPS");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  let page = pdf.addPage([W, H]);
  let y = H - 56;
  const line = (text: string, opts: { f?: PDFFont; size?: number; color?: [number, number, number]; x?: number; gap?: number } = {}) => {
    const size = opts.size ?? 11;
    if (y < 60) {
      page = pdf.addPage([W, H]);
      y = H - 56;
    }
    page.drawText(pdfText(text), { x: opts.x ?? 48, y, size, font: opts.f ?? font, color: rgb(...(opts.color ?? [0.06, 0.09, 0.16])), maxWidth: W - 96 });
    y -= opts.gap ?? size + 7;
  };
  page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: rgb(0.04, 0.14, 0.39) });
  line(l.org, { f: bold, size: 12, color: [0.36, 0.39, 0.46] });
  line(`Load ${l.l.reference}`, { f: bold, size: 22, gap: 30 });
  line(`Pickup: ${[l.l.pickupName, l.l.pickupAddress].filter(Boolean).join(", ")}`);
  line(`Delivery: ${[l.l.deliveryName, l.l.deliveryAddress].filter(Boolean).join(", ")}`);
  line(`Driver: ${l.l.driverName ?? "-"}${l.l.driverPhone ? ` (${l.l.driverPhone})` : ""}${l.vehicle ? `   Truck: ${l.vehicle}` : ""}`);
  line(`Status: ${l.l.status.replace(/_/g, " ")}${l.l.endedAt ? ` (${when(l.l.endedAt)})` : ""}`, { gap: 26 });

  line("Timeline", { f: bold, size: 14, gap: 20 });
  for (const e of events.filter((e) => !["updated"].includes(e.type))) line(`${when(e.at)}   ${e.type.replace(/_/g, " ")}`, { size: 10, gap: 15 });
  y -= 10;
  line("Paperwork", { f: bold, size: 14, gap: 20 });
  for (const i of pw.items) {
    const status = i.docs.length ? `${i.docs.length} file${i.docs.length > 1 ? "s" : ""}` : i.missing ? "MISSING" : i.mode === "required" ? "not yet" : "not sent";
    line(`${i.stop === "pickup" ? "Pickup" : "Delivery"} - ${i.label}${i.mode === "required" ? " (required)" : ""}: ${status}`, { size: 10, gap: 15, color: i.missing ? [0.73, 0.11, 0.11] : undefined });
  }

  // Each document on its own page(s), with what it is and when/where it was taken.
  for (const d of docs) {
    const label = pw.items.find((i) => i.key === d.itemKey)?.label ?? "Other document";
    const caption = `${label} - ${when(d.at)}${d.byName ? ` - ${d.byName}` : ""}${d.latitude != null && d.longitude != null ? ` - ${d.latitude.toFixed(4)}, ${d.longitude.toFixed(4)}` : ""}`;
    try {
      const data = await getDocument(d.fileKey);
      if (d.contentType === "application/pdf") {
        const src = await PDFDocument.load(data, { ignoreEncryption: true });
        const pages = await pdf.copyPages(src, src.getPageIndices().slice(0, 20));
        pages.forEach((p, i) => {
          pdf.addPage(p);
          if (i === 0) p.drawText(pdfText(caption), { x: 24, y: 12, size: 8, font, color: rgb(0.36, 0.39, 0.46) });
        });
      } else if (d.contentType === "image/jpeg" || d.contentType === "image/png") {
        const img = d.contentType === "image/jpeg" ? await pdf.embedJpg(data) : await pdf.embedPng(data);
        const p = pdf.addPage([W, H]);
        const scale = Math.min((W - 72) / img.width, (H - 110) / img.height, 1);
        p.drawText(pdfText(caption), { x: 36, y: H - 40, size: 10, font: bold, color: rgb(0.06, 0.09, 0.16) });
        p.drawImage(img, { x: (W - img.width * scale) / 2, y: (H - 60 - img.height * scale) / 2 + 10, width: img.width * scale, height: img.height * scale });
      } else {
        const p: PDFPage = pdf.addPage([W, H]);
        p.drawText(pdfText(`${caption}: ${d.contentType.split("/")[1]?.toUpperCase()} photo, open it in RIO GPS.`), { x: 36, y: H - 40, size: 10, font });
      }
    } catch (err) {
      logger.error("paperwork.packet_file_failed", { loadId, documentId: d.id }, err);
    }
  }
  const bytes = Buffer.from(await pdf.save());
  const safeRef = l.l.reference.replace(/[^\w.-]+/g, "-");
  return { pdf: bytes, filename: `${safeRef}-packet.pdf`, reference: l.l.reference };
}

/** Who gets the packet: the company's list, plus the person who created the load when chosen. */
async function packetRecipients(organizationId: string, createdBy: string | null, settings: PaperworkSettings): Promise<string[]> {
  const to = new Set(settings.recipients.map((e) => e.toLowerCase()));
  if (settings.toCreator && createdBy) {
    const [u] = await getDb().select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, createdBy));
    if (u?.email) to.add(u.email.toLowerCase());
  }
  return [...to];
}

export async function sendLoadPacket(organizationId: string, loadId: string, actorUserId: string | null, reason: "manual" | "delivered" | "complete", extra: string[] = []): Promise<{ sentTo: string[] }> {
  const load = await loadFor(organizationId, loadId);
  const settings = await getPaperworkSettings(organizationId);
  const to = [...new Set([...(await packetRecipients(organizationId, load.createdBy, settings)), ...extra.map((e) => e.toLowerCase())])];
  if (!to.length) throw new ValidationError("Add who gets the load packet in Settings → Load paperwork");
  if (!isEmailEnabled()) throw new ValidationError("Email isn't set up on this server yet");
  const { pdf, filename, reference } = await buildLoadPacket(organizationId, loadId);
  const link = `${getServerEnv().AUTH_URL}/loads/${loadId}`;
  const big = pdf.length > 18 * 1024 * 1024;
  for (const email of to) {
    await sendEmail({
      to: email,
      subject: `Load ${reference}: paperwork packet`,
      template: "load_packet",
      text: `The paperwork packet for load ${reference} is ${big ? "too large to attach. Open it here" : "attached. The load is here"}: ${link}`,
      html: `<p>The paperwork packet for load <b>${reference.replace(/[<>&]/g, "")}</b> is ${big ? "too large to attach" : "attached"}.</p><p><a href="${link}">Open the load in RIO GPS</a></p>`,
      ...(big ? {} : { attachments: [{ filename, content: pdf }] })
    });
  }
  const now = new Date();
  await getDb().update(schema.loads).set({ packetSentAt: now }).where(eq(schema.loads.id, loadId));
  await getDb().insert(schema.loadEvents).values({ organizationId, loadId, type: "packet_sent", actorUserId, detail: { to: to.length, reason } });
  return { sentTo: to };
}

/** After delivery (or once all required paperwork is in), send the packet once, if the company wants that. Never throws. */
export async function maybeSendPacket(organizationId: string, loadId: string, trigger: "delivered" | "complete"): Promise<void> {
  try {
    const settings = await getPaperworkSettings(organizationId);
    if (settings.sendWhen !== trigger) return;
    const load = await loadFor(organizationId, loadId);
    if (load.packetSentAt) return;
    if (trigger === "complete") {
      const pw = await loadPaperwork(organizationId, loadId);
      if (pw.requiredCount === 0 || pw.requiredDone < pw.requiredCount) return;
    }
    await sendLoadPacket(organizationId, loadId, null, trigger);
  } catch (err) {
    logger.error("paperwork.auto_packet_failed", { loadId }, err);
  }
}

// ---------- reminders ----------

/**
 * Reminds the driver about missing required paperwork: 15 minutes after arriving at the stop,
 * then every hour for 4 hours. The load is never blocked.
 */
export async function runPaperworkReminders(now = new Date()): Promise<number> {
  const db = getDb();
  const rows = await db.execute<{ id: string; organization_id: string; reference: string; status: string; driver_phone: string | null; paperwork: unknown; arrived_at: Date | string; reminded_at: Date | string | null }>(sql`
    select l.id, l.organization_id, l.reference, l.status, l.driver_phone, l.paperwork, l.paperwork_reminded_at as reminded_at,
           (select max(e.at) from load_events e where e.load_id = l.id and e.type in ('arrived_pickup', 'arrived_delivery')) as arrived_at
    from loads l
    where l.status in ('at_pickup', 'in_transit', 'at_delivery', 'delivered') and l.driver_phone is not null
      and coalesce(l.ended_at, now()) > now() - interval '6 hours'
      and exists (select 1 from load_events e where e.load_id = l.id and e.type in ('arrived_pickup', 'arrived_delivery') and e.at < now() - interval '15 minutes' and e.at > now() - interval '5 hours')
    limit 200`);
  let sent = 0;
  for (const r of rows) {
    const last = r.reminded_at ? new Date(r.reminded_at).getTime() : 0;
    const arrived = new Date(r.arrived_at).getTime();
    if (last > arrived && now.getTime() - last < 60 * 60_000) continue;
    const pw = await loadPaperwork(r.organization_id, r.id).catch(() => null);
    if (!pw || pw.missing === 0) continue;
    const first = pw.items.find((i) => i.missing)!;
    const n = await notifyDriverPhone(r.driver_phone!, `Load ${r.reference}: paperwork needed`, pw.missing === 1 ? `Add the ${first.label.toLowerCase()} in RIO GPS.` : `${pw.missing} items are still missing, starting with the ${first.label.toLowerCase()}.`, { type: "paperwork", loadId: r.id });
    await db.update(schema.loads).set({ paperworkRemindedAt: now }).where(eq(schema.loads.id, r.id));
    await db.insert(schema.loadEvents).values({ organizationId: r.organization_id, loadId: r.id, type: "paperwork_reminder", detail: { missing: pw.missing, pushed: n > 0 } });
    sent++;
  }
  return sent;
}

const g = globalThis as unknown as { __rioPaperworkScheduler?: NodeJS.Timeout };

export function startPaperworkScheduler(intervalMs = 5 * 60_000) {
  if (g.__rioPaperworkScheduler) return;
  const tick = () =>
    runPaperworkReminders().then(
      (n) => n > 0 && logger.info("paperwork.reminders", { sent: n }),
      (err) => logger.error("paperwork.reminders_failed", {}, err)
    );
  g.__rioPaperworkScheduler = setInterval(tick, intervalMs);
  g.__rioPaperworkScheduler.unref?.();
}

/** The newest documents a driver sent, across their loads in this company (driver page, A42). */
export async function driverDocuments(organizationId: string, driverId: string, limit = 24): Promise<(LoadDocumentDto & { loadId: string; reference: string })[]> {
  const d = schema.loadDocuments;
  const rows = await getDb()
    .select({ id: d.id, loadId: d.loadId, reference: schema.loads.reference })
    .from(d)
    .innerJoin(schema.loads, eq(schema.loads.id, d.loadId))
    .where(and(eq(d.organizationId, organizationId), eq(d.driverId, driverId), isNull(d.deletedAt)))
    .orderBy(desc(d.createdAt))
    .limit(limit);
  if (!rows.length) return [];
  const docs = await documentsOf(organizationId, [...new Set(rows.map((r) => r.loadId))]);
  const ref = new Map(rows.map((r) => [r.id, r.reference]));
  return docs
    .filter((x) => ref.has(x.id))
    .map((x) => ({ ...publicDoc(x), loadId: x.loadId, reference: ref.get(x.id)! }))
    .sort((a, b) => b.at.localeCompare(a.at));
}
