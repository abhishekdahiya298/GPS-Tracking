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
