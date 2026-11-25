import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { env } from "../../src/config/env";
import { forwardingConfirmations, inboundAddresses, rawEmails } from "../../src/db/schema";
import { findActiveByToken } from "../../src/domain/inbound-addresses";
import { BANKS } from "../../src/parsing/banks-config";
import { FIXTURES } from "../helpers";
import { createApiApp } from "./helpers";

describe("forwarding", () => {
  test("the first request creates exactly one address, later ones reuse it", async () => {
    const api = createApiApp();
    const me = await api.register();
    const first = await me.json("/api/forwarding");
    const second = await me.json("/api/forwarding");
    expect(first.body.address).toMatch(new RegExp(`^[^@]+@${env.INBOUND_DOMAIN}$`));
    expect(second.body.address).toBe(first.body.address);
    expect(
      api.db.select().from(inboundAddresses).where(eq(inboundAddresses.userId, me.id)).all(),
    ).toHaveLength(1);
  });

  test("rotating replaces the address and the old token stops receiving", async () => {
    const api = createApiApp();
    const me = await api.register();
    const before = (await me.json("/api/forwarding")).body.address as string;
    const rotated = await me.json("/api/forwarding/rotate", { method: "POST" });
    expect(rotated.body.address).not.toBe(before);
    expect((await me.json("/api/forwarding")).body.address).toBe(rotated.body.address);
    expect(findActiveByToken(api.db, before.split("@")[0] as string)).toBeNull();
  });

  test("rotation is limited to five a day", async () => {
    const api = createApiApp();
    const me = await api.register();
    for (let i = 0; i < 5; i++) {
      expect((await me.json("/api/forwarding/rotate", { method: "POST" })).status).toBe(200);
    }
    const sixth = await me.json("/api/forwarding/rotate", { method: "POST" });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe("too_many_attempts");
  });

  test("returns the latest Gmail confirmation from the last 24 hours only", async () => {
    const api = createApiApp();
    const me = await api.register();
    await me.json("/api/forwarding");
    const address = api.db
      .select()
      .from(inboundAddresses)
      .where(eq(inboundAddresses.userId, me.id))
      .get();
    if (!address) throw new Error("no address");
    const add = (code: string, ageHours: number) =>
      api.db
        .insert(forwardingConfirmations)
        .values({
          userId: me.id,
          inboundAddressId: address.id,
          gmailAddress: "me@gmail.com",
          code,
          confirmUrl: "https://mail.google.com/confirm",
          receivedAt: new Date(Date.now() - ageHours * 3_600_000),
        })
        .run();
    add("111111", 30);
    expect((await me.json("/api/forwarding")).body.confirmation).toBeNull();
    add("222222", 5);
    add("333333", 1);
    const { body } = await me.json("/api/forwarding");
    expect(body.confirmation).toMatchObject({ code: "333333", gmailAddress: "me@gmail.com" });
  });

  test("lists the last received email per bank and the unverified count", async () => {
    const api = createApiApp();
    const me = await api.register();
    api.addRawEmail(me.id, { bankCode: "VCB", receivedAt: new Date("2024-05-01T00:00:00Z") });
    api.addRawEmail(me.id, { bankCode: "VCB", receivedAt: new Date("2024-06-01T00:00:00Z") });
    api.addTransaction(me.id, { unverified: true });
    const { body } = await me.json("/api/forwarding");
    const vcb = body.banks.find((bank: { bankCode: string }) => bank.bankCode === "VCB");
    expect(vcb.lastReceivedAt).toBe("2024-06-01T00:00:00.000Z");
    expect(
      body.banks.find((bank: { bankCode: string }) => bank.bankCode === "CAKE").lastReceivedAt,
    ).toBeNull();
    expect(body.unverifiedCount).toBe(1);
  });

  test("filter.xml is a download with every sender and the active address", async () => {
    const api = createApiApp();
    const me = await api.register();
    const address = (await me.json("/api/forwarding")).body.address as string;
    const response = await me.request("/api/forwarding/filter.xml");
    const xml = await response.text();
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("content-type")).toContain("xml");
    for (const bank of Object.values(BANKS)) {
      for (const sender of bank.senders) expect(xml).toContain(sender);
    }
    expect(xml).toContain(`name='forwardTo' value='${address}'`);
    expect(xml).toContain("name='shouldNeverSpam' value='true'");
    expect(xml).toContain(" OR ");
  });
});

describe("POST /api/imports", () => {
  const eml = (name: string) =>
    new File([readFileSync(join(FIXTURES, `${name}.eml`))], `${name.split("/")[1]}.eml`);

  async function upload(
    api: ReturnType<typeof createApiApp>,
    user: { jar: Map<string, string> },
    files: File[],
    headers: Record<string, string> = {},
  ) {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    const cookie = [...user.jar].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await api.app.handle(
      new Request(`${new URL(env.APP_URL).origin}/api/imports`, {
        method: "POST",
        headers: { origin: new URL(env.APP_URL).origin, cookie, ...headers },
        body: form,
      }),
    );
    return { status: response.status, body: await response.json() };
  }

  test("imports bank emails once, counts duplicates and skips other senders", async () => {
    const api = createApiApp();
    const me = await api.register();
    const stranger = new File(
      ["From: a@example.com\nSubject: hi\nMessage-ID: <x@y>\n\nhello"],
      "other.eml",
    );

    const first = await upload(api, me, [eml("VCB/03_qr_payment_text"), stranger]);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ imported: 1, duplicates: 0, skipped: 1 });
    const again = await upload(api, me, [eml("VCB/03_qr_payment_text")]);
    expect(again.body).toEqual({ imported: 0, duplicates: 1, skipped: 0 });
    const stored = api.db.select().from(rawEmails).where(eq(rawEmails.userId, me.id)).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.source).toBe("upload");
  });

  test("rejects unsupported files and oversized uploads", async () => {
    const api = createApiApp();
    const me = await api.register();
    const bad = await upload(api, me, [new File(["x"], "notes.txt")]);
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("unsupported_file");

    const huge = await upload(api, me, [eml("VCB/03_qr_payment_text")], {
      "content-length": String(env.UPLOAD_MAX_BYTES + 2 * 1024 * 1024),
    });
    expect(huge.status).toBe(413);
    expect(huge.body.error.code).toBe("file_too_large");
  });

  test("is limited to ten uploads an hour", async () => {
    const api = createApiApp();
    const me = await api.register();
    for (let i = 0; i < 10; i++) {
      expect((await upload(api, me, [eml("VCB/03_qr_payment_text")])).status).toBe(200);
    }
    const eleventh = await upload(api, me, [eml("VCB/03_qr_payment_text")]);
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.error.code).toBe("too_many_attempts");
  });
});
