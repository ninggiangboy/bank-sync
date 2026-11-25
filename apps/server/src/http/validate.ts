import type { z } from "zod";
import { HttpError } from "./errors";

/**
 * Parses a request body with a schema whose issue messages are error codes the client translates
 * ("required", "max", "min", "confirmed", …). Failure is a 422 `validation_failed` with the codes
 * grouped by field.
 */
export function validate<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const field = issue.path.join(".") || "_";
    fields[field] = [...(fields[field] ?? []), issue.message];
  }
  throw new HttpError(422, "validation_failed", fields);
}
