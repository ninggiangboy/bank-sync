import { Elysia } from "elysia";
import { env } from "../config/env";
import { bankSenders } from "../domain/forwarding";

export const publicRoutes = () =>
  new Elysia({ prefix: "/public" }).get("/config", () => ({
    appName: env.APP_NAME,
    sourceUrl: env.APP_SOURCE_URL,
    analyticsEnabled: env.SIMPLE_ANALYTICS_ENABLED,
    banks: bankSenders(),
  }));
