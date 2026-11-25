import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import type { AuthPlugin } from "../auth/plugin";
import type { Db } from "../db/client";
import { user as userTable } from "../db/schema";
import { demoUserId } from "../domain/demo";
import { HttpError } from "../http/errors";

export const demoRoutes = ({ db, authed }: { db: Db; authed: AuthPlugin }) =>
  new Elysia({ prefix: "/demo" })
    .use(authed)
    .post(
      "/",
      ({ user }) => {
        const demoId = demoUserId(db);
        if (demoId === null) throw new HttpError(404, "demo_unavailable");
        // The demo account itself is already the demo; there is nothing to switch to.
        const viewingDemo = user.id !== demoId;
        db.update(userTable).set({ viewingDemo }).where(eq(userTable.id, user.id)).run();
        return { viewingDemo };
      },
      { auth: true },
    )
    .delete(
      "/",
      ({ user }) => {
        db.update(userTable).set({ viewingDemo: false }).where(eq(userTable.id, user.id)).run();
        return { viewingDemo: false };
      },
      { auth: true },
    );
