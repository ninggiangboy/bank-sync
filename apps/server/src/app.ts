import { Elysia } from "elysia";
import { env } from "./config/env";
import type { Db } from "./db/client";
import { errorHandler } from "./http/errors";
import { requestLogger } from "./http/request-logger";
import type { InboxFiles } from "./inbound/inbox-files";
import { inboundRoutes } from "./inbound/route";

export type AppDeps = { db: Db; files: InboxFiles };

const logging = env.NODE_ENV !== "test";

export const createApp = ({ db, files }: AppDeps) =>
  new Elysia({ prefix: "/api" })
    .use(errorHandler({ development: env.NODE_ENV === "development" }))
    .use(logging ? requestLogger() : new Elysia())
    .get("/up", () => ({ status: "ok" as const }))
    .use(
      inboundRoutes({
        db,
        files,
        secret: env.INBOUND_WEBHOOK_SECRET,
        domain: env.INBOUND_DOMAIN,
        maxBytes: env.INBOUND_MAX_BYTES,
      }),
    );

export type App = ReturnType<typeof createApp>;
