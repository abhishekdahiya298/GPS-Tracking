/** Client metadata for audit entries. Caddy is the only ingress and sets X-Forwarded-For. */
export function requestMeta(request: Request) {
  return {
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    userAgent: request.headers.get("user-agent")
  };
}

/** Parses a JSON body, mapping malformed JSON to null (caller turns it into a 400). */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
