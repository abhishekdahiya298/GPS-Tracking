/**
 * The one place the app talks to the server.
 *
 * - Data routes live under /api/v1; sign-in routes live under /api/auth (fixed by the auth library).
 * - The session token travels as "Authorization: Bearer ...". No cookies are sent, which is
 *   what lets the server accept a phone's POST without a browser Origin.
 * - Storage and fetch are passed in, so this file has no React Native imports and is unit-tested.
 */
export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

export type ApiErrorKind = "network" | "timeout" | "unauthorized" | "forbidden" | "not_found" | "rate_limited" | "server" | "bad_response";

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status: number | null = null
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Called when the server says the session is no longer valid, after the stored token is cleared. */
  onSignedOut?: () => void;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** "v1" for data routes (default), "auth" for sign-in routes. */
  area?: "v1" | "auth";
  /** Send the request without a token even if one is stored (sign-in). */
  anonymous?: boolean;
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return status >= 500 ? "server" : "bad_response";
}

export function buildUrl(baseUrl: string, path: string, opts: Pick<RequestOptions, "query" | "area"> = {}): string {
  const prefix = opts.area === "auth" ? "/api/auth" : "/api/v1";
  const url = `${baseUrl.replace(/\/+$/, "")}${prefix}/${path.replace(/^\/+/, "")}`;
  const pairs = Object.entries(opts.query ?? {}).filter(([, v]) => v !== null && v !== undefined);
  if (pairs.length === 0) return url;
  return `${url}?${pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")}`;
}

export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;

  /** Returns the parsed JSON body and the response headers (sign-in reads its token from a header). */
  async function send<T>(path: string, opts: RequestOptions = {}): Promise<{ data: T; headers: Headers }> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (!opts.anonymous) {
      const token = await options.tokens.get();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(buildUrl(options.baseUrl, path, opts), {
        method: opts.method ?? "GET",
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
        // Never attach cookies: the server only accepts a phone's write when none are present.
        credentials: "omit"
      });
    } catch {
      if (controller.signal.aborted) throw new ApiError("timeout", "The server took too long to answer.");
      throw new ApiError("network", "Can't reach the server. Check your connection.");
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      if (response.status === 401 && !opts.anonymous) {
        await options.tokens.clear();
        options.onSignedOut?.();
      }
      let message = `Request failed (${response.status}).`;
      try {
        const body = (await response.json()) as { error?: unknown; message?: unknown };
        const text = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : null;
        if (text) message = text;
      } catch {
        // no readable error body
      }
      throw new ApiError(kindForStatus(response.status), message, response.status);
    }

    if (response.status === 204) return { data: undefined as T, headers: response.headers };
    try {
      return { data: (await response.json()) as T, headers: response.headers };
    } catch {
      throw new ApiError("bad_response", "The server sent an answer the app can't read.", response.status);
    }
  }

  return {
    send,
    get: async <T>(path: string, query?: RequestOptions["query"]) => (await send<T>(path, { query })).data,
    post: async <T>(path: string, body?: unknown) => (await send<T>(path, { method: "POST", body })).data,
    delete: async <T>(path: string, body?: unknown) => (await send<T>(path, { method: "DELETE", body })).data
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export interface ReadyResponse {
  status: string;
  checks: Record<string, "ok" | "fail">;
  timestamp: string;
}
