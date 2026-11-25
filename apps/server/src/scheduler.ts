import { cron } from "@elysiajs/cron";
import { Elysia } from "elysia";
import { env } from "./config/env";
import type { Db } from "./db/client";
import type { InboxFiles } from "./inbound/inbox-files";
import { purgeInbound } from "./jobs/purge-inbound";
import { refreshDemo } from "./jobs/refresh-demo";
import { updateExchangeRates } from "./jobs/update-exchange-rates";

/** Daily schedules, all in the display time zone: exchange rates, demo refresh and inbound cleanup. */
export const scheduler = (db: Db, files: InboxFiles) => {
  const guarded = (label: string, task: () => unknown) => async () => {
    try {
      await task();
    } catch (error) {
      console.error(
        `Scheduled task ${label} failed`,
        error instanceof Error ? error.message : error,
      );
    }
  };
  const options = { timezone: env.APP_TIMEZONE, protect: true };

  return new Elysia({ name: "scheduler" })
    .use(
      cron({
        name: "update-exchange-rates",
        pattern: "0 8 * * *",
        ...options,
        run: guarded("update-exchange-rates", () => updateExchangeRates(db)),
      }),
    )
    .use(
      cron({
        name: "refresh-demo",
        pattern: "5 0 * * *",
        ...options,
        run: guarded("refresh-demo", () => refreshDemo(db)),
      }),
    )
    .use(
      cron({
        name: "purge-inbound",
        pattern: "0 3 * * *",
        ...options,
        run: guarded("purge-inbound", () => purgeInbound(db, files)),
      }),
    );
};
