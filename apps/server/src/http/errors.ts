import type { ApiErrorBody } from "@bank-sync/shared";
import { Elysia, ElysiaCustomStatusResponse } from "elysia";

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

/**
 * Turns every thrown error into `{ error: { code, fields? } }` JSON.
 * Unexpected errors, including responses that fail their own schema, are logged and,
 * outside development, never expose a message or stack.
 * Handlers return a plain Response so error bodies do not leak into route success types.
 */
export const errorHandler = (options: { development: boolean }) =>
  new Elysia({ name: "error-handler" }).onError({ as: "global" }, ({ code, error, set }) => {
    const reply = (status: number, body: ApiErrorBody["error"]) => {
      set.status = status;
      return Response.json({ error: body } satisfies ApiErrorBody, { status });
    };

    if (error instanceof HttpError) {
      return reply(
        error.status,
        error.fields ? { code: error.code, fields: error.fields } : { code: error.code },
      );
    }
    // `throw status(401, "unauthorized")`: the message becomes the error code.
    if (error instanceof ElysiaCustomStatusResponse) {
      const status = Number(error.code);
      const message = error.response;
      return reply(status, { code: typeof message === "string" ? message : `http_${status}` });
    }
    switch (code) {
      case "VALIDATION":
        if (error.type === "response") break;
        return reply(422, {
          code: "validation_failed",
          fields: fieldsOf(error.all as ValidationIssue[]),
        });
      case "PARSE":
        return reply(400, { code: "invalid_body" });
      case "NOT_FOUND":
        return reply(404, { code: "not_found" });
    }
    console.error(error);
    const debug =
      options.development && error instanceof Error
        ? { message: error.message, stack: error.stack }
        : undefined;
    return reply(500, debug ? { code: "server_error", debug } : { code: "server_error" });
  });
