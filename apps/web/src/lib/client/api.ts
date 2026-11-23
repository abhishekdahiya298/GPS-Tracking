import { announcePlanRefusal } from "./plan-events";

/**
 * The one client-side fetch helper. Same-origin JSON only; the server remains
 * the authority for authentication, tenancy and permissions.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    cache: "no-store",
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    throw new ApiError("Your session has ended. Please sign in again.", 401);
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string; details?: Record<string, unknown> } } | null;
  if (!res.ok) {
    const fallback = res.status >= 500 ? "The server couldn't complete this request. Please try again." : `Request failed (${res.status})`;
    const err = new ApiError(body?.error?.message ?? fallback, res.status, body?.error?.code, body?.error?.details);
    const d = err.details ?? {};
    if (err.code === "LIMIT_REACHED") announcePlanRefusal({ code: "LIMIT_REACHED", message: err.message, limit: String(d.limit ?? ""), used: Number(d.used ?? 0), max: Number(d.max ?? 0) });
    if (err.code === "FEATURE_LOCKED") announcePlanRefusal({ code: "FEATURE_LOCKED", message: err.message, feature: String(d.feature ?? "") });
    throw err;
  }
  return body as T;
}

/** Human message for any thrown value (never a stack trace). */
export function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Something went wrong. Please try again.";
}
