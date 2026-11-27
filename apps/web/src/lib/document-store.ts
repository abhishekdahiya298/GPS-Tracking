import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getServerEnv } from "./env";

/**
 * Where load paperwork files live: a private folder (a Docker volume in production), never
 * served directly. Files are read back only through checked routes. Keys are
 * <organization>/<load>/<random>.<ext>, so nothing user-typed ever becomes a path.
 */
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf" };
export const DOCUMENT_TYPES = Object.keys(EXT);
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

function root(): string {
  return path.resolve(getServerEnv().DOCUMENTS_DIR);
}

function fullPath(key: string): string {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z]{3,4}$/.test(key)) throw new Error("Bad document key");
  return path.join(root(), key);
}

export async function putDocument(organizationId: string, loadId: string, contentType: string, data: Buffer): Promise<string> {
  const ext = EXT[contentType];
  if (!ext) throw new Error("Unsupported document type");
  const key = `${organizationId}/${loadId}/${randomUUID()}.${ext}`;
  const file = fullPath(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data, { mode: 0o600 });
  return key;
}

export async function getDocument(key: string): Promise<Buffer> {
  return readFile(fullPath(key));
}

export async function deleteDocument(key: string): Promise<void> {
  await rm(fullPath(key), { force: true });
}

/** The file type from the first bytes, so a renamed file can't pretend to be something else. */
export function sniffType(data: Buffer): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (data.length >= 12 && data.subarray(4, 8).toString("ascii") === "ftyp" && /^(heic|heix|hevc|mif1|msf1)$/.test(data.subarray(8, 12).toString("ascii"))) return "image/heic";
  if (data.length >= 5 && data.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  return null;
}
