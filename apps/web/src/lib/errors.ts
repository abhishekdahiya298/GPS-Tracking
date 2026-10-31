import { NextResponse } from "next/server";
import { logger } from "./logger";

/**
 * Application errors with a stable machine-readable code. Everything else is
 * reported to clients as a generic INTERNAL_ERROR — never a stack trace or a
 * database message.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHENTICATED", 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this resource") {
    super("FORBIDDEN", 403, message);
  }
}

/** A platform admin with no customer selected: platform pages only (they are never an organization member). */
export class PlatformOnlyError extends AppError {
  constructor() {
    super("PLATFORM_ADMIN", 403, "Choose a customer to view first");
  }
}

/** Every organization this person belongs to is suspended or archived. */
export class OrganizationUnavailableError extends AppError {
  constructor(public readonly organizationStatus: "suspended" | "archived") {
    super("ORGANIZATION_UNAVAILABLE", 403, "Your company's RIO GPS account is not active. Contact RIO GPS support.");
  }
}

/** Also used for resources in another tenant, so existence is never leaked. */
export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super("NOT_FOUND", 404, message);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid request", public readonly details?: unknown) {
    super("VALIDATION_ERROR", 400, message);
  }
}

export function errorResponse(err: unknown, fields: Record<string, unknown> = {}): NextResponse {
  if (err instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(err instanceof ValidationError && err.details ? { details: err.details } : {})
        }
      },
      { status: err.status }
    );
  }
  logger.error("api.unhandled_error", fields, err);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } },
    { status: 500 }
  );
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests") {
    super("TOO_MANY_REQUESTS", 429, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super("CONFLICT", 409, message);
  }
}
