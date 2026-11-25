import { Elysia, status } from "elysia";
import type { createKvCache } from "../cache/kv-cache";
import type { Auth } from "./create-auth";

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_DECAY_SECONDS = 60;

type Kv = ReturnType<typeof createKvCache>;

/**
 * Mounts Better Auth at `/api/auth/*` and adds an `auth: true` route option that resolves
 * `{ user, session }` or answers 401. Sign-in is throttled to 5 failures per email and address per
 * minute, like the original app.
 */
export const authPlugin = ({ auth, kv }: { auth: Auth; kv: Kv }) =>
  new Elysia({ name: "auth" })
    .all(
      "/auth/*",
      async ({ request, server }) => {
        const isSignIn =
          request.method === "POST" && new URL(request.url).pathname === "/api/auth/sign-in/email";
        if (!isSignIn) return auth.handler(request);

        const body = (await request
          .clone()
          .json()
          .catch(() => null)) as { email?: unknown } | null;
        const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
        const key = `login:${email}|${server?.requestIP(request)?.address ?? "unknown"}`;

        if (kv.tooManyAttempts(key, LOGIN_MAX_ATTEMPTS)) {
          const seconds = kv.availableIn(key);
          return Response.json(
            { error: { code: "auth.throttle", seconds } },
            { status: 429, headers: { "retry-after": String(seconds) } },
          );
        }
        const response = await auth.handler(request);
        if (response.ok) kv.clear(key);
        else kv.hit(key, LOGIN_DECAY_SECONDS);
        return response;
      },
      { parse: "none" },
    )
    .macro({
      auth: {
        async resolve({ request }) {
          const found = await auth.api.getSession({ headers: request.headers });
          if (!found) throw status(401, "unauthenticated");
          return { user: found.user, session: found.session };
        },
      },
    });

export type AuthPlugin = ReturnType<typeof authPlugin>;
