/**
 * The one client-side fetch helper. Same-origin JSON only; the server remains
 * the authority for authentication, tenancy and permissions.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
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
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
  if (!res.ok) {
    const fallback = res.status >= 500 ? "The server couldn't complete this request. Please try again." : `Request failed (${res.status})`;
    throw new ApiError(body?.error?.message ?? fallback, res.status, body?.error?.code);
  }
  return body as T;
}

/** Human message for any thrown value (never a stack trace). */
export function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Something went wrong. Please try again.";
}
