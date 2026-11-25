import { Elysia } from "elysia";
import { env } from "./config/env";
import { errorHandler } from "./http/errors";
import { requestLogger } from "./http/request-logger";

const logging = env.NODE_ENV !== "test";

export const app = new Elysia({ prefix: "/api" })
  .use(errorHandler({ development: env.NODE_ENV === "development" }))
  .use(logging ? requestLogger() : new Elysia())
  .get("/up", () => ({ status: "ok" as const }));

export type App = typeof app;
