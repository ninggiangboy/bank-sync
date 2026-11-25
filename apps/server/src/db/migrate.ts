import { join } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { Db } from "./client";

const defaultFolder = join(import.meta.dir, "../../drizzle");

/**
 * Applies every pending migration. Foreign keys are switched off first: drizzle-kit rewrites
 * SQLite column changes as a table rebuild (`DROP TABLE` + rename) inside one transaction,
 * where its own `PRAGMA foreign_keys=OFF` is ignored, so the drop would otherwise run every
 * ON DELETE CASCADE / SET NULL against live rows. Any reference left dangling afterwards fails loudly.
 */
export function migrateDatabase(db: Db, migrationsFolder = defaultFolder) {
  const sqlite = db.$client;
  sqlite.exec("PRAGMA foreign_keys = OFF");
  try {
    migrate(db, { migrationsFolder });
    const violations = sqlite.query("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`Migration left broken foreign keys: ${JSON.stringify(violations)}`);
    }
  } finally {
    sqlite.exec("PRAGMA foreign_keys = ON");
  }
}

if (import.meta.main) {
  const { db } = await import("./index");
  migrateDatabase(db);
  console.info("Migrations applied.");
}
