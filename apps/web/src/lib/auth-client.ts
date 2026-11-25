import { createAuthClient } from "better-auth/client";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { ApiError } from "./api";

/** Better Auth on the same origin under /api/auth. */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/auth",
  plugins: [
    inferAdditionalFields({
      user: { viewingDemo: { type: "boolean", required: true, input: false } },
    }),
  ],
});

export type Session = NonNullable<Awaited<ReturnType<typeof authClient.getSession>>["data"]>;
export type SessionUser = Session["user"];

type AuthResult<T> = {
  data: T | null;
  error: { status: number; code?: string; error?: { code?: string; seconds?: number } } | null;
};

/**
 * Returns the data of a Better Auth call, or throws an ApiError. Better Auth's own errors carry an
 * upper-case code (INVALID_EMAIL_OR_PASSWORD, …); the sign-in throttle answers our `{ error }` body.
 */
export async function authCall<T>(call: Promise<AuthResult<T>>): Promise<T> {
  let result: AuthResult<T>;
  try {
    result = await call;
  } catch {
    throw new ApiError(0, "network");
  }
  const { error } = result;
  if (error) {
    const code = error.error?.code ?? error.code ?? `http_${error.status}`;
    throw new ApiError(error.status, code, {}, error.error?.seconds);
  }
  return result.data as T;
}
