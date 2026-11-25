import { Elysia } from "elysia";
import { env } from "../config/env";
import { bankSenders } from "../domain/forwarding";

/** What the SPA needs before anyone signs in: branding, display time zone and the bank list. */
export const publicRoutes = () =>
  new Elysia({ prefix: "/public" }).get("/config", () => ({
    appName: env.APP_NAME,
    sourceUrl: env.APP_SOURCE_URL,
    timeZone: env.APP_TIMEZONE,
    analyticsEnabled: env.SIMPLE_ANALYTICS_ENABLED,
    banks: bankSenders(),
  }));
