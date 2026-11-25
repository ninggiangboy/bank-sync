import { join } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { Db } from "./client";

const migrationsFolder = join(import.meta.dir, "../../drizzle");

/** Applies every pending migration from `apps/server/drizzle`. */
export function migrateDatabase(db: Db) {
  migrate(db, { migrationsFolder });
}

if (import.meta.main) {
  const { db } = await import("./index");
  migrateDatabase(db);
  console.info("Migrations applied.");
}
