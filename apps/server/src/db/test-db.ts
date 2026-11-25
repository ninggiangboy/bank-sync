import { openDatabase } from "./client";
import { migrateDatabase } from "./migrate";
import { user } from "./schema";

/** A fresh in-memory database with every migration applied. */
export function createTestDb() {
  const db = openDatabase(":memory:");
  migrateDatabase(db);
  return db;
}

type TestDb = ReturnType<typeof createTestDb>;

/** Inserts a user and returns its id. */
export function createTestUser(db: TestDb, email = `${crypto.randomUUID()}@example.com`) {
  const now = new Date();
  const id = crypto.randomUUID();
  db.insert(user).values({ id, name: email, email, createdAt: now, updatedAt: now }).run();
  return id;
}
