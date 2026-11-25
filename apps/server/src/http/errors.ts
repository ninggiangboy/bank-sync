import type { ApiErrorBody } from "@bank-sync/shared";
import { Elysia } from "elysia";

/** An expected failure with a stable error code that clients can translate. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields?: Record<string, string[]>,
  ) {
    super(code);
  }
}

type ValidationIssue = { path?: string; message?: string; summary?: string };

/** Groups validation issues by field path ("/amount" becomes "amount"). */
function fieldsOf(issues: ValidationIssue[]): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of issues) {
    const field = (issue.path ?? "").replace(/^\//, "").replaceAll("/", ".") || "_";
    const message = issue.summary ?? issue.message ?? "invalid";
    fields[field] ??= [];
    fields[field].push(message);
  }
  return fields;
}

const body = (code: string, fields?: Record<string, string[]>): ApiErrorBody => ({
  error: fields ? { code, fields } : { code },
});

/**
 * Turns every thrown error into `{ error: { code, fields? } }` JSON.
 * Unexpected errors are logged and, outside development, never expose a message or stack.
 */
export const errorHandler = (options: { development: boolean }) =>
  new Elysia({ name: "error-handler" }).onError({ as: "global" }, ({ code, error, set }) => {
    if (error instanceof HttpError) {
      set.status = error.status;
      return body(error.code, error.fields);
    }
    switch (code) {
      case "VALIDATION":
        set.status = 422;
        return body("validation_failed", fieldsOf(error.all as ValidationIssue[]));
      case "PARSE":
        set.status = 400;
        return body("invalid_body");
      case "NOT_FOUND":
        set.status = 404;
        return body("not_found");
    }
    console.error(error);
    set.status = 500;
    const response: ApiErrorBody = body("server_error");
    if (options.development && error instanceof Error) {
      response.error.debug = { message: error.message, stack: error.stack };
    }
    return response;
  });
