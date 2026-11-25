import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { Elysia, status } from "elysia";
import { z } from "zod";
import type { Auth } from "../auth/create-auth";
import { MAX_NAME_LENGTH, MIN_PASSWORD_LENGTH } from "../auth/create-auth";
import type { AuthPlugin } from "../auth/plugin";
import type { createKvCache } from "../cache/kv-cache";
import { env } from "../config/env";
import type { Db } from "../db/client";
import { account, user as userTable } from "../db/schema";
import { deleteUserData } from "../domain/user-data";
import { HttpError } from "../http/errors";
import { validate } from "../http/validate";

const RESEND_MAX = 6;
const RESEND_DECAY_SECONDS = 60;

const nameSchema = z.object({
  name: z.string({ error: "required" }).trim().min(1, "required").max(MAX_NAME_LENGTH, "max"),
});

const passwordOnly = z.object({ password: z.string({ error: "required" }).min(1, "required") });

const changePasswordSchema = z
  .object({
    currentPassword: z.string({ error: "required" }).min(1, "required"),
    newPassword: z.string({ error: "required" }).min(MIN_PASSWORD_LENGTH, "min"),
    newPasswordConfirmation: z.string({ error: "required" }),
  })
  .refine((value) => value.newPassword === value.newPasswordConfirmation, {
    path: ["newPassword"],
    error: "confirmed",
  });

type Kv = ReturnType<typeof createKvCache>;

export const profileRoutes = ({
  db,
  auth,
  kv,
  authed,
}: {
  db: Db;
  auth: Auth;
  kv: Kv;
  authed: AuthPlugin;
}) => {
  async function passwordMatches(userId: string, password: string): Promise<boolean> {
    const credential = db
      .select({ hash: account.password })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
      .get();
    if (!credential?.hash) return false;
    return (await auth.$context).password.verify({ hash: credential.hash, password });
  }

  /** The seeded demo account is read-only for everyone. */
  function refuseDemo(email: string) {
    if (email.toLowerCase() === env.DEMO_USER_EMAIL.toLowerCase())
      throw status(403, "demo_read_only");
  }

  async function requirePassword(userId: string, password: string, field = "password") {
    if (!(await passwordMatches(userId, password))) {
      throw new HttpError(422, "validation_failed", { [field]: ["current_password"] });
    }
  }

  return new Elysia({ prefix: "/profile" })
    .use(authed)
    .patch(
      "/",
      ({ user, body }) => {
        refuseDemo(user.email);
        const { name } = validate(nameSchema, body);
        db.update(userTable).set({ name }).where(eq(userTable.id, user.id)).run();
        return { name };
      },
      { auth: true },
    )
    .post(
      "/verification",
      async ({ user }) => {
        if (user.emailVerified) return { status: "already-verified" as const };
        const key = `verification:${user.id}`;
        if (kv.tooManyAttempts(key, RESEND_MAX)) throw status(429, "auth.throttle");
        kv.hit(key, RESEND_DECAY_SECONDS);
        await auth.api.sendVerificationEmail({
          body: { email: user.email, callbackURL: "/transactions" },
        });
        return { status: "sent" as const };
      },
      { auth: true },
    )
    .put(
      "/password",
      async ({ user, body, request }) => {
        refuseDemo(user.email);
        const input = validate(changePasswordSchema, body);
        await requirePassword(user.id, input.currentPassword, "currentPassword");
        await auth.api.changePassword({
          body: {
            currentPassword: input.currentPassword,
            newPassword: input.newPassword,
            revokeOtherSessions: true,
          },
          headers: request.headers,
        });
        return { status: "updated" as const };
      },
      { auth: true },
    )
    .post(
      "/delete-data",
      async ({ user, body }) => {
        refuseDemo(user.email);
        const { password } = validate(passwordOnly, body);
        await requirePassword(user.id, password);
        deleteUserData(db, user.id);
        return { status: "deleted" as const };
      },
      { auth: true },
    )
    .delete(
      "/",
      async ({ user, body, request }) => {
        refuseDemo(user.email);
        const { password } = validate(passwordOnly, body);
        await requirePassword(user.id, password);
        let response: Response;
        try {
          response = await auth.api.deleteUser({
            body: { password },
            headers: request.headers,
            asResponse: true,
          });
        } catch (error) {
          if (error instanceof APIError)
            throw new HttpError(422, "validation_failed", { password: ["current_password"] });
          throw error;
        }
        if (!response.ok) throw status(500, "server_error");
        // Forward the cookies that sign the browser out.
        const headers = new Headers();
        for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
        return new Response(null, { status: 204, headers });
      },
      { auth: true },
    );
};
