import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";
import { createTestDb } from "./db/test-db";
import { createInboxFiles } from "./inbound/inbox-files";

const app = createApp({
  db: createTestDb(),
  files: createInboxFiles(mkdtempSync(join(tmpdir(), "inbox-"))),
});

test("GET /api/up reports healthy", async () => {
  const res = await app.handle(new Request("http://localhost/api/up"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});
