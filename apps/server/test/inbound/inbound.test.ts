import { describe, expect, test } from "bun:test";
import { count, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { forwardingConfirmations, jobs, rawEmails, transactions } from "../../src/db/schema";
import { rotateAddress } from "../../src/domain/inbound-addresses";
import { errorHandler } from "../../src/http/errors";
import { inboundRoutes, signInbound } from "../../src/inbound/route";
import { allTransactions, createDkimKey, createPipeline, fixture } from "../helpers";

const SECRET = "x".repeat(40);
const DOMAIN = "in.example.com";
const NOW = Date.parse("2026-11-12T05:00:00Z");

function setup(resolver?: Parameters<typeof createPipeline>[0]) {
  const pipeline = createPipeline(resolver);
  const app = new Elysia({ prefix: "/api" }).use(errorHandler({ development: false })).use(
    inboundRoutes({
      db: pipeline.db,
      files: pipeline.files,
      secret: SECRET,
      domain: DOMAIN,
      maxBytes: 1024 * 1024,
      now: () => NOW,
    }),
  );

  const post = (
    body: Uint8Array,
    overrides: { timestamp?: string; signature?: string; recipient?: string } = {},
  ) => {
    const timestamp = overrides.timestamp ?? String(Math.floor(NOW / 1000));
    return app.handle(
      new Request("http://localhost/api/inbound/email", {
        method: "POST",
        headers: {
          "content-type": "message/rfc822",
          "x-inbound-timestamp": timestamp,
          "x-inbound-signature": overrides.signature ?? signInbound(SECRET, timestamp, body),
          "x-inbound-recipient": overrides.recipient ?? `${pipeline.address.token}@${DOMAIN}`,
        },
        body,
      }),
    );
  };
  return { ...pipeline, post };
}

const pendingJobs = (db: ReturnType<typeof setup>["db"]) =>
  db.select({ n: count() }).from(jobs).where(eq(jobs.name, "ingest-email")).get()?.n;

describe("inbound webhook", () => {
  test("a bad signature is rejected with 401 and queues nothing", async () => {
    const { post, db } = setup();
    const res = await post(fixture("VCB/02_salary_in"), { signature: "0".repeat(64) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "unauthorized" } });
    expect(pendingJobs(db)).toBe(0);
  });

  test("a signature made with another secret is rejected", async () => {
    const { post } = setup();
    const body = fixture("VCB/02_salary_in");
    const timestamp = String(Math.floor(NOW / 1000));
    const res = await post(body, { signature: signInbound("y".repeat(40), timestamp, body) });
    expect(res.status).toBe(401);
  });

  test("a timestamp 301 seconds old is rejected, 300 is accepted", async () => {
    const { post } = setup();
    const body = fixture("VCB/02_salary_in");
    const at = (offset: number) => String(Math.floor(NOW / 1000) - offset);
    expect(
      (await post(body, { timestamp: at(301), signature: signInbound(SECRET, at(301), body) }))
        .status,
    ).toBe(401);
    expect(
      (await post(body, { timestamp: at(-301), signature: signInbound(SECRET, at(-301), body) }))
        .status,
    ).toBe(401);
    expect(
      (await post(body, { timestamp: at(300), signature: signInbound(SECRET, at(300), body) }))
        .status,
    ).toBe(200);
  });

  test("the same body twice is a no-op the second time", async () => {
    const { post, db, worker } = setup();
    const body = fixture("VCB/02_salary_in");
    expect(await (await post(body)).json()).toEqual({ status: "accepted" });
    expect(await (await post(body)).json()).toEqual({ status: "duplicate" });
    expect(pendingJobs(db)).toBe(1);
    await worker.drain();
    expect(allTransactions(db)).toHaveLength(1);
  });

  test("an unknown or replaced address is rejected with 404", async () => {
    const { post, db, userId, address } = setup();
    const body = fixture("VCB/02_salary_in");
    expect((await post(body, { recipient: `nope@${DOMAIN}` })).status).toBe(404);
    expect((await post(body, { recipient: `${address.token}@other.example.com` })).status).toBe(
      404,
    );

    rotateAddress(db, userId);
    const res = await post(body, { recipient: `${address.token}@${DOMAIN}` });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "unknown_address" } });
  });

  test("a request without a valid timestamp or signature is refused before the body is read", async () => {
    const { post } = setup();
    const big = new Uint8Array(1024 * 1024 + 1);
    expect((await post(big, { timestamp: "abc" })).status).toBe(401);
    expect((await post(big, { signature: "" })).status).toBe(401);
  });

  test("a body over the size cap is rejected", async () => {
    const { post } = setup();
    const body = new Uint8Array(1024 * 1024 + 1);
    expect((await post(body)).status).toBe(413);
  });
});

describe("ingest pipeline", () => {
  test("a bank email with a valid DKIM signature becomes a verified transaction", async () => {
    const key = createDkimKey("info.vietcombank.com.vn");
    const { post, db, worker } = setup(key.resolver);
    await post(await key.sign(fixture("VCB/02_salary_in")));
    await worker.drain();

    const raw = db.select().from(rawEmails).get();
    expect(raw).toMatchObject({
      verification: "dkim_pass",
      dkimDomain: "info.vietcombank.com.vn",
      source: "forward",
    });
    expect(raw?.bodyHtml).not.toContain("40,420,000");
    const [transaction] = allTransactions(db);
    expect(transaction).toMatchObject({ amount: 25000000, unverified: false });
  });

  test("a signature by a parent of the From domain counts", async () => {
    const key = createDkimKey("vietcombank.com.vn");
    const { post, db, worker } = setup(key.resolver);
    await post(await key.sign(fixture("VCB/02_salary_in")));
    await worker.drain();
    expect(db.select().from(rawEmails).get()?.verification).toBe("dkim_pass");
  });

  test("a signature from another domain leaves the email unverified", async () => {
    const key = createDkimKey("evil.example");
    const { post, db, worker } = setup(key.resolver);
    await post(await key.sign(fixture("VCB/02_salary_in")));
    await worker.drain();

    expect(db.select().from(rawEmails).get()).toMatchObject({
      verification: "unverified",
      dkimDomain: null,
    });
    expect(allTransactions(db)[0]?.unverified).toBe(true);
  });

  test("a body altered after signing is unverified", async () => {
    const key = createDkimKey("info.vietcombank.com.vn");
    const { post, db, worker } = setup(key.resolver);
    const signed = Buffer.from(await key.sign(fixture("VCB/02_salary_in")));
    const tampered = Buffer.from(
      signed.toString("latin1").replace("PGh0bWw+", "PGh0bWw/"),
      "latin1",
    );
    await post(new Uint8Array(tampered));
    await worker.drain();
    expect(db.select().from(rawEmails).get()?.verification).toBe("unverified");
  });

  test("a signature that covers only part of the body (l=) is unverified", async () => {
    const key = createDkimKey("info.vietcombank.com.vn");
    const { post, db, worker } = setup(key.resolver);
    await post(await key.sign(fixture("VCB/02_salary_in"), { bodyLength: true }));
    await worker.drain();
    expect(db.select().from(rawEmails).get()?.verification).toBe("unverified");
  });

  test("an unsigned bank email is unverified and counts in no total", async () => {
    const { post, db, worker } = setup();
    await post(fixture("CAKE/01_transfer_in"));
    await worker.drain();
    expect(allTransactions(db)[0]).toMatchObject({ unverified: true });
  });

  test("an email from a non-bank sender stores nothing and logs only the reason", async () => {
    const { post, db, worker, files } = setup();
    const logged: unknown[][] = [];
    const info = console.info;
    console.info = (...args: unknown[]) => logged.push(args);
    try {
      const mail =
        "From: Someone <friend@example.com>\r\nSubject: Secret subject\r\nMessage-ID: <a@b>\r\n\r\nBody text 123";
      await post(new TextEncoder().encode(mail));
      await worker.drain();
    } finally {
      console.info = info;
    }
    expect(db.select({ n: count() }).from(rawEmails).get()?.n).toBe(0);
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged)).not.toContain("Secret subject");
    expect(JSON.stringify(logged)).toContain("not_bank_sender");
    expect(files.purgeOlderThan(-1)).toBe(0);
  });

  test("a Gmail confirmation saves the code and a Google link, and ignores other links", async () => {
    const key = createDkimKey("google.com");
    const { post, db, worker } = setup(key.resolver);
    const mail = [
      "From: Gmail Team <forwarding-noreply@google.com>",
      "Subject: Gmail Forwarding Confirmation - Receive Mail from owner@gmail.com",
      "Message-ID: <confirm-1@google.com>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "owner@gmail.com has requested to automatically forward mail to your email address abc@in.example.com.",
      "",
      "Confirmation code: 123456789",
      "",
      "To allow owner@gmail.com to automatically forward mail to your address, please click the link below to confirm the request:",
      "",
      "https://evil.example/phish?x=1",
      "https://mail-settings.google.com/mail/vf-%5BANGjdJ%5D-abc?x=1&y=2",
      "",
    ].join("\r\n");
    await post(await key.sign(new TextEncoder().encode(mail)));
    await worker.drain();

    const [saved] = db.select().from(forwardingConfirmations).all();
    expect(saved).toMatchObject({
      gmailAddress: "owner@gmail.com",
      code: "123456789",
      confirmUrl: "https://mail-settings.google.com/mail/vf-%5BANGjdJ%5D-abc?x=1&y=2",
    });
    expect(db.select({ n: count() }).from(rawEmails).get()?.n).toBe(0);
  });

  test("a confirmation whose only link is not Google's saves nothing", async () => {
    const key = createDkimKey("google.com");
    const { post, db, worker } = setup(key.resolver);
    const mail = [
      "From: forwarding-noreply@google.com",
      "Subject: Gmail Forwarding Confirmation - Receive Mail from owner@gmail.com",
      "Message-ID: <confirm-2@google.com>",
      "",
      "Confirmation code: 123456789",
      "https://evil.example/mail-settings.google.com/x",
    ].join("\r\n");
    await post(await key.sign(new TextEncoder().encode(mail)));
    await worker.drain();
    expect(db.select({ n: count() }).from(forwardingConfirmations).get()?.n).toBe(0);
  });

  test("only the five newest confirmations are kept", async () => {
    const key = createDkimKey("google.com");
    const { post, db, worker } = setup(key.resolver);
    for (let i = 1; i <= 7; i++) {
      const mail = [
        "From: forwarding-noreply@google.com",
        "Subject: Gmail Forwarding Confirmation - Receive Mail from owner@gmail.com",
        `Message-ID: <c-${i}@google.com>`,
        `Date: Thu, 12 Nov 2026 0${i}:00:00 +0000`,
        "",
        `Confirmation code: 11111111${i}`,
        "https://mail.google.com/mail/vf-abc",
      ].join("\r\n");
      await post(await key.sign(new TextEncoder().encode(mail)));
    }
    await worker.drain();
    const codes = db
      .select()
      .from(forwardingConfirmations)
      .all()
      .map((row) => row.code)
      .sort();
    expect(codes).toEqual(["111111113", "111111114", "111111115", "111111116", "111111117"]);
  });

  test("an unsigned or wrongly signed Gmail confirmation is dropped", async () => {
    const key = createDkimKey("evil.example");
    const { post, db, worker } = setup(key.resolver);
    const mail = new TextEncoder().encode(
      [
        "From: forwarding-noreply@google.com",
        "Subject: Gmail Forwarding Confirmation - Receive Mail from owner@gmail.com",
        "Message-ID: <fake@google.com>",
        "",
        "Confirmation code: 123456789",
        "https://mail.google.com/mail/vf-abc",
      ].join("\r\n"),
    );
    await post(mail);
    await post(await key.sign(mail));
    await worker.drain();
    expect(db.select({ n: count() }).from(forwardingConfirmations).get()?.n).toBe(0);
  });

  test("a DNS failure is retried, and on the last attempt the email is stored unverified", async () => {
    const down = async () => {
      throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
    };
    const { post, db, worker } = setup(down);
    await post(await createDkimKey("info.vietcombank.com.vn").sign(fixture("VCB/02_salary_in")));
    for (let i = 0; i < 4; i++) await worker.runOnce();
    expect(db.select({ n: count() }).from(rawEmails).get()?.n).toBe(0);
    expect(db.select().from(jobs).get()).toMatchObject({ attempts: 4, failedAt: null });
    await worker.runOnce();
    expect(db.select().from(rawEmails).get()?.verification).toBe("unverified");
  });

  test("the pending file is removed after handling", async () => {
    const { post, worker, files } = setup();
    await post(fixture("VPB/01_qr_payment"));
    await worker.drain();
    expect(files.purgeOlderThan(-1)).toBe(0);
  });

  test("all non-OTP forwarded fixtures become transactions", async () => {
    const { post, db, worker } = setup();
    const names = [
      "VCB/02_salary_in",
      "VCB/05_receipt_transfer",
      "CAKE/02_transfer_out",
      "VPB/01_qr_payment",
    ];
    for (const name of names) await post(fixture(name));
    await worker.drain();
    expect(db.select({ n: count() }).from(transactions).get()?.n).toBe(names.length);
  });
});
