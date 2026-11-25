import { Elysia } from "elysia";
import type { AuthPlugin } from "../auth/plugin";
import type { Db } from "../db/client";
import { resolveOwner } from "../domain/demo";
import { monthlyReport } from "../domain/reports";
import { parseMonth } from "../domain/time";

export const reportRoutes = ({ db, authed }: { db: Db; authed: AuthPlugin }) =>
  new Elysia().use(authed).get(
    "/reports",
    ({ user, query }) => {
      const now = Date.now();
      return monthlyReport(db, resolveOwner(db, user), parseMonth(query.month, now), now);
    },
    { auth: true },
  );
