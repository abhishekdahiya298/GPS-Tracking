import { MAX_DOCUMENT_BYTES } from "./document-store";
import { ValidationError } from "./errors";

/**
 * Reads one file from a multipart form (field "file") plus its text fields, with the size
 * checked before the whole body is buffered when the client says how big it is.
 */
export async function readUpload(request: Request): Promise<{ data: Buffer; fileName: string | null; itemKey: string | null; fields: Record<string, string> }> {
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > MAX_DOCUMENT_BYTES + 64 * 1024) throw new ValidationError("That file is over 15 MB. Take a photo or scan instead.");
  if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) throw new ValidationError("Send the file as a form upload");
  const form = await request.formData().catch(() => {
    throw new ValidationError("The upload didn't arrive in one piece. Try again.");
  });
  const file = form.get("file");
  if (!file || typeof file === "string") throw new ValidationError("Choose a file");
  if (file.size > MAX_DOCUMENT_BYTES) throw new ValidationError("That file is over 15 MB. Take a photo or scan instead.");
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v.slice(0, 200);
  return { data: Buffer.from(await file.arrayBuffer()), fileName: file.name || null, itemKey: fields.itemKey ?? null, fields };
}
