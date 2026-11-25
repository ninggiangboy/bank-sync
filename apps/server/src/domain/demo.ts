import { eq } from "drizzle-orm";
import { env } from "../config/env";
import type { DbOrTx } from "../db/client";
import { user } from "../db/schema";
import { HttpError } from "../http/errors";

/** Refused write on the seeded demo account's data. Maps to `403 demo_read_only`. */
export class DemoReadOnlyError extends HttpError {
  constructor() {
    super(403, "demo_read_only");
  }
}

/** The signed-in person making a request. Background jobs and the CLI act as `system` instead. */
export type Actor = { id: string; viewingDemo: boolean };
export type WriteContext = { actor: Actor | "system"; ownerId: string };

export function demoUserId(db: DbOrTx, email = env.DEMO_USER_EMAIL): string | null {
  return (
    db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase())).get()?.id ??
    null
  );
}

/**
 * Whose data a request reads: the demo account while the user is viewing it, else the user.
 * A user who never opted in cannot reach demo rows.
 */
export function resolveOwner(db: DbOrTx, actor: Actor): string {
  if (!actor.viewingDemo) return actor.id;
  return demoUserId(db) ?? actor.id;
}

/**
 * Throws when a signed-in actor writes demo-owned data, whether through demo viewing or by being the
 * demo account itself. Writes with `system` (jobs, CLI, seeding) are never refused.
 */
export function assertWritable(db: DbOrTx, ctx: WriteContext, rowUserId = ctx.ownerId): void {
  if (ctx.actor === "system") return;
  const demoId = demoUserId(db);
  if (demoId === null) return;
  if (rowUserId === demoId || ctx.actor.id === demoId) throw new DemoReadOnlyError();
}

/** The context of an HTTP write: refuses while viewing demo data or signed in as the demo account. */
export function writeContext(db: DbOrTx, actor: Actor): WriteContext {
  const ctx: WriteContext = { actor, ownerId: resolveOwner(db, actor) };
  assertWritable(db, ctx);
  return ctx;
}
