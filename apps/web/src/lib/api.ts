import type { App } from "@bank-sync/server";
import type { ApiErrorBody } from "@bank-sync/shared";
import { treaty } from "@elysiajs/eden";

/** Typed API client. Requests go to the same origin, so cookies stay first-party. */
export const api = treaty<App>(window.location.origin, {
  fetch: { credentials: "same-origin" },
}).api;

/** A failed API call, normalized to the server's `{ code, fields }` error body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields: Record<string, string[]> = {},
    readonly seconds?: number,
  ) {
    super(code);
  }
}

type ErrorBody = Partial<ApiErrorBody> & { error?: { seconds?: number } };

/** Builds an ApiError from a status and whatever body the server sent. */
export function toApiError(status: number, body: unknown): ApiError {
  const error = (body as ErrorBody | null)?.error;
  const code =
    typeof error?.code === "string" ? error.code : status === 0 ? "network" : `http_${status}`;
  return new ApiError(status, code, error?.fields ?? {}, error?.seconds);
}

type TreatyResult<T> =
  | { data: T; error: null }
  | { data: null; error: { status: unknown; value: unknown } };

/** Returns the data of an Eden call, or throws an ApiError. */
export async function unwrap<T>(call: Promise<TreatyResult<T>>): Promise<T> {
  let result: TreatyResult<T>;
  try {
    result = await call;
  } catch {
    throw new ApiError(0, "network");
  }
  if (result.error) {
    const status = typeof result.error.status === "number" ? result.error.status : 0;
    throw toApiError(status, result.error.value);
  }
  return result.data as T;
}

export const isApiError = (error: unknown, code?: string): error is ApiError =>
  error instanceof ApiError && (code === undefined || error.code === code);
