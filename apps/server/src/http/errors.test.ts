import { describe, expect, test } from "bun:test";
import type { ApiErrorBody } from "@bank-sync/shared";
import { Elysia, status } from "elysia";
import { z } from "zod";
import { errorHandler, HttpError } from "./errors";

const build = (development: boolean) =>
  new Elysia()
    .use(errorHandler({ development }))
    .get("/forbidden", () => {
      throw new HttpError(403, "demo_read_only");
    })
    .get("/unauthorized", () => {
      throw status(401, "unauthorized");
    })
    .get("/bad-response", () => ({ total: "oops" }) as unknown as { total: number }, {
      response: z.object({ total: z.number() }),
    })
    .get("/boom", () => {
      throw new Error("database exploded");
    })
    .post("/items", ({ body }) => body, {
      body: z.object({ amount: z.number().int().positive(), note: z.string() }),
    });

const call = async (app: ReturnType<typeof build>, path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init));
  return { status: res.status, body: (await res.json()) as ApiErrorBody };
};

describe("errorHandler", () => {
  test("maps HttpError to its status and code", async () => {
    const res = await call(build(false), "/forbidden");
    expect(res).toEqual({ status: 403, body: { error: { code: "demo_read_only" } } });
  });

  test("maps a thrown status response to its status and message code", async () => {
    const res = await call(build(false), "/unauthorized");
    expect(res).toEqual({ status: 401, body: { error: { code: "unauthorized" } } });
  });

  test("treats a response that fails its schema as a server error", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const res = await call(build(false), "/bad-response");
      expect(res).toEqual({ status: 500, body: { error: { code: "server_error" } } });
    } finally {
      console.error = original;
    }
  });

  test("returns 404 JSON for unknown routes", async () => {
    const res = await call(build(false), "/nope");
    expect(res).toEqual({ status: 404, body: { error: { code: "not_found" } } });
  });

  test("returns 422 with per-field messages on validation failure", async () => {
    const res = await call(build(false), "/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: -1 }),
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_failed");
    expect(Object.keys(res.body.error.fields ?? {}).sort()).toEqual(["amount", "note"]);
  });

  test("hides internal errors outside development", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const prod = await call(build(false), "/boom");
      expect(prod).toEqual({ status: 500, body: { error: { code: "server_error" } } });
      const dev = await call(build(true), "/boom");
      expect(dev.body.error.debug?.message).toBe("database exploded");
    } finally {
      console.error = original;
    }
  });
});
