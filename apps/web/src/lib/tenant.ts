/**
 * Single choke point for deriving the authenticated organizationId on the server.
 * No route handler should ever read organizationId from a request body, query
 * string, or client-supplied header — it must come from here.
 *
 * Real session verification (NextAuth/Lucia + JWT) lands in the auth milestone;
 * until then this throws so an unauthenticated code path fails loudly instead
 * of silently trusting client input.
 */
export class UnauthenticatedError extends Error {
  constructor() {
    super("No authenticated session");
  }
}

export interface AuthenticatedSession {
  userId: string;
  organizationId: string;
  role: "owner" | "admin" | "viewer";
}

export async function getAuthenticatedSession(_request: Request): Promise<AuthenticatedSession> {
  throw new UnauthenticatedError();
}
