import { Elysia } from "elysia";
import { createAuth } from "./auth/create-auth";
import { authPlugin } from "./auth/plugin";
import { createKvCache } from "./cache/kv-cache";
import { env } from "./config/env";
import type { Db } from "./db/client";
import { errorHandler } from "./http/errors";
import { requestLogger } from "./http/request-logger";
import type { InboxFiles } from "./inbound/inbox-files";
import { inboundRoutes } from "./inbound/route";
import type { Mailer } from "./mail/mailer";
import { profileRoutes } from "./routes/profile";
import { settingsRoutes } from "./routes/settings";

export type AppDeps = { db: Db; files: InboxFiles; mailer: Mailer };

const logging = env.NODE_ENV !== "test";

export function createApp({ db, files, mailer }: AppDeps) {
  const auth = createAuth({ db, mailer });
  const kv = createKvCache(db);
  const authed = authPlugin({ auth, kv });

  return new Elysia({ prefix: "/api" })
    .use(errorHandler({ development: env.NODE_ENV === "development" }))
    .use(logging ? requestLogger() : new Elysia())
    .get("/up", () => ({ status: "ok" as const }))
    .use(authed)
    .use(settingsRoutes({ db, auth, authed }))
    .use(profileRoutes({ db, auth, kv, authed }))
    .use(
      inboundRoutes({
        db,
        files,
        secret: env.INBOUND_WEBHOOK_SECRET,
        domain: env.INBOUND_DOMAIN,
        maxBytes: env.INBOUND_MAX_BYTES,
      }),
    );
}

export type App = ReturnType<typeof createApp>;
