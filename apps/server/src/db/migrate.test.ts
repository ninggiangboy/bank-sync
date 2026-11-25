import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./client";
import { migrateDatabase } from "./migrate";
import { userSettings } from "./schema";
import { createTestUser } from "./test-db";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** The statements drizzle-kit emits when a column of `user` changes. */
function rebuildUserSql(initialSql: string) {
  const createUser = initialSql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .find((statement) => statement.startsWith("CREATE TABLE `user`"));
  if (!createUser) throw new Error("initial migration has no user table");
  return [
    "PRAGMA foreign_keys=OFF",
    createUser.replace("CREATE TABLE `user`", "CREATE TABLE `__new_user`").replace(/;$/, ""),
    "INSERT INTO `__new_user` SELECT * FROM `user`",
    "DROP TABLE `user`",
    "ALTER TABLE `__new_user` RENAME TO `user`",
    "PRAGMA foreign_keys=ON",
  ].join(";--> statement-breakpoint\n");
}

test("a table-rebuild migration keeps the rows that reference the rebuilt table", () => {
  const folder = mkdtempSync(join(tmpdir(), "bank-sync-migrations-"));
  folders.push(folder);
  cpSync(join(import.meta.dir, "../../drizzle"), folder, { recursive: true });

  const db = openDatabase(":memory:");
  migrateDatabase(db, folder);
  const userId = createTestUser(db);
  db.insert(userSettings).values({ userId }).run();

  const journalPath = join(folder, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  journal.entries.push({
    idx: 1,
    version: "6",
    when: Date.now(),
    tag: "0001_rebuild_user",
    breakpoints: true,
  });
  writeFileSync(journalPath, JSON.stringify(journal));
  const initialSql = readFileSync(join(folder, `${journal.entries[0].tag}.sql`), "utf8");
  writeFileSync(join(folder, "0001_rebuild_user.sql"), rebuildUserSql(initialSql));

  migrateDatabase(db, folder);

  expect(db.select().from(userSettings).all()).toHaveLength(1);
  expect(db.$client.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
});
