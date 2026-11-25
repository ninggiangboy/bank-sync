import { expect, test } from "bun:test";
import { app } from "./app";

test("GET /api/up reports healthy", async () => {
  const res = await app.handle(new Request("http://localhost/api/up"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});
