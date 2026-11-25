import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

/** Opens an SQLite database with the pragmas every connection needs. */
export function openDatabase(path: string) {
  const inMemory = path === ":memory:";
  if (!inMemory) mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path, { create: true, strict: true });
  if (!inMemory) sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA busy_timeout = 5000");
  return drizzle({ client: sqlite, schema });
}

export type Db = ReturnType<typeof openDatabase>;

/** The transaction handle Drizzle passes to `db.transaction` callbacks. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either the database or an open transaction, for functions that work inside both. */
export type DbOrTx = Db | Tx;
