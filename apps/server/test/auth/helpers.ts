import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app";
import { env } from "../../src/config/env";
import { createTestDb } from "../../src/db/test-db";
import { createInboxFiles } from "../../src/inbound/inbox-files";
import type { MailMessage } from "../../src/mail/mailer";

export const PASSWORD = "correct horse battery";
const ORIGIN = new URL(env.APP_URL).origin;

/** The app on an in-memory database, with captured mail and a cookie jar per "browser". */
export function createAuthApp() {
  const db = createTestDb();
  const mails: MailMessage[] = [];
  const app = createApp({
    db,
    files: createInboxFiles(mkdtempSync(join(tmpdir(), "inbox-"))),
    mailer: { send: async (message) => void mails.push(message) },
  });

  function browser() {
    const jar = new Map<string, string>();
    const cookieHeader = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

    async function request(
      path: string,
      init: { method?: string; json?: unknown; headers?: Record<string, string> } = {},
    ) {
      const headers: Record<string, string> = { origin: ORIGIN, ...init.headers };
      if (jar.size > 0) headers.cookie = cookieHeader();
      if (init.json !== undefined) headers["content-type"] = "application/json";
      const response = await app.handle(
        new Request(`${ORIGIN}${path}`, {
          method: init.method ?? (init.json === undefined ? "GET" : "POST"),
          headers,
          redirect: "manual",
          ...(init.json === undefined ? {} : { body: JSON.stringify(init.json) }),
        }),
      );
      for (const line of response.headers.getSetCookie()) {
        const [pair = "", ...attributes] = line.split(";");
        const [name = "", ...value] = pair.split("=");
        const expired = attributes.some((a) => /max-age=0/i.test(a)) || value.join("=") === "";
        if (expired) jar.delete(name.trim());
        else jar.set(name.trim(), value.join("="));
      }
      return response;
    }

    return {
      request,
      jar,
      /** `request` that also parses the JSON body. */
      async json(path: string, init: Parameters<typeof request>[1] = {}) {
        const response = await request(path, init);
        const text = await response.text();
        return {
          status: response.status,
          body: text ? JSON.parse(text) : null,
          headers: response.headers,
        };
      },
    };
  }

  async function register(
    email = `${crypto.randomUUID()}@example.com`,
    options: { name?: string; password?: string } = {},
  ) {
    const user = browser();
    const result = await user.json("/api/auth/sign-up/email", {
      json: { name: options.name ?? "Test User", email, password: options.password ?? PASSWORD },
    });
    return { ...user, email, result, id: result.body?.user?.id as string };
  }

  return { app, db, mails, browser, register };
}
