import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { categoryRules, jobs, rawEmails, transactions } from "../../src/db/schema";
import { createTestUser } from "../../src/db/test-db";
import { storeEmail } from "../../src/domain/raw-emails";
import { parseRawEmail } from "../../src/jobs/parse-raw-email";
import { fromEml } from "../../src/mail/fetched-message";
import { allTransactions, createPipeline, fixture, fixtureNames } from "../helpers";

async function store(
  pipeline: ReturnType<typeof createPipeline>,
  bytes: Uint8Array,
  userId = pipeline.userId,
) {
  return storeEmail(pipeline.db, {
    userId,
    source: "upload",
    verification: "user_upload",
    message: await fromEml(bytes),
  });
}

const rawRows = (p: ReturnType<typeof createPipeline>) => p.db.select().from(rawEmails).all();

describe("parse job", () => {
  test("every fixture is stored, parsed and turned into a transaction (15 of 20)", async () => {
    const pipeline = createPipeline();
    for (const name of fixtureNames()) await store(pipeline, fixture(name));
    await pipeline.worker.drain();

    expect(rawRows(pipeline)).toHaveLength(20);
    expect(rawRows(pipeline).filter((row) => row.parsedAt === null)).toHaveLength(0);
    expect(allTransactions(pipeline.db)).toHaveLength(15);
  });

  test("transaction times are stored in UTC", async () => {
    const pipeline = createPipeline();
    await store(pipeline, fixture("VCB/02_salary_in"));
    await pipeline.worker.drain();
    expect(allTransactions(pipeline.db)[0]?.occurredAt.toISOString()).toBe(
      "2026-11-05T02:30:00.000Z",
    );
  });

  test("the same email for two users is stored for each", async () => {
    const pipeline = createPipeline();
    const other = createTestUser(pipeline.db);
    await store(pipeline, fixture("VCB/02_salary_in"));
    await store(pipeline, fixture("VCB/02_salary_in"), other);
    await pipeline.worker.drain();
    expect(allTransactions(pipeline.db)).toHaveLength(2);
  });

  test("storing a duplicate returns the existing row and queues nothing new", async () => {
    const pipeline = createPipeline();
    const first = await store(pipeline, fixture("CAKE/01_transfer_in"));
    const second = await store(pipeline, fixture("CAKE/01_transfer_in"));
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, row: { id: first.row.id } });
    expect(pipeline.db.select().from(jobs).all()).toHaveLength(1);
  });

  test("balances never reach the database", async () => {
    const pipeline = createPipeline();
    await store(pipeline, fixture("VCB/02_salary_in"));
    const [row] = rawRows(pipeline);
    expect(row?.bodyHtml).toContain("***");
    expect(`${row?.bodyHtml}${row?.bodyText}`).not.toContain("40,420,000");
  });

  test("unparseable emails keep a reason and log ids without the body", async () => {
    const pipeline = createPipeline();
    const mail = (amount: string) =>
      new TextEncoder().encode(
        `From: vcbdigibank@info.vietcombank.com.vn\r\nSubject: Alert\r\nMessage-ID: <m-${amount.length}@x>\r\nContent-Type: text/plain\r\n\r\nSố tiền: ${amount}\r\nNội dung: SECRET NOTE\r\n`,
      );
    await store(pipeline, mail("***"));
    await store(pipeline, mail("100,000 VND"));
    const logged: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => logged.push(args);
    try {
      await pipeline.worker.drain();
    } finally {
      console.warn = warn;
    }

    const errors = rawRows(pipeline)
      .map((row) => row.parseError)
      .sort();
    expect(errors).toEqual(["amount_missing", "direction_unknown"]);
    expect(allTransactions(pipeline.db)).toHaveLength(0);
    expect(logged).toHaveLength(2);
    expect(JSON.stringify(logged)).not.toContain("SECRET NOTE");
    expect(JSON.stringify(logged)).toMatch(/rawEmailId/);
  });

  test("an unexpected parser exception is recorded as parser_error with its class", async () => {
    const pipeline = createPipeline();
    const { row } = await store(pipeline, fixture("VPB/01_qr_payment"));
    pipeline.db.update(rawEmails).set({ bodyHtml: null, bodyText: null }).run();
    const { BANKS } = await import("../../src/parsing/banks-config");
    const original = BANKS.VPB.parser.parse;
    BANKS.VPB.parser.parse = () => {
      throw new RangeError("boom");
    };
    const warn = console.warn;
    console.warn = () => {};
    try {
      parseRawEmail(pipeline.db, { rawEmailId: row.id });
    } finally {
      BANKS.VPB.parser.parse = original;
      console.warn = warn;
    }
    expect(rawRows(pipeline)[0]?.parseError).toBe("parser_error: RangeError");
  });

  test("an email without a parser is marked unsupported_sender", async () => {
    const pipeline = createPipeline();
    const { row } = await store(
      pipeline,
      new TextEncoder().encode(
        "From: nobody@example.com\r\nSubject: x\r\nMessage-ID: <z@x>\r\n\r\nhello",
      ),
    );
    parseRawEmail(pipeline.db, { rawEmailId: row.id });
    expect(rawRows(pipeline)[0]).toMatchObject({
      parseError: "unsupported_sender",
      parsedAt: null,
    });
  });

  test("non-transaction bank emails are parsed with no transaction", async () => {
    const pipeline = createPipeline();
    await store(pipeline, fixture("VCB/90_otp"));
    await pipeline.worker.drain();
    expect(rawRows(pipeline)[0]).toMatchObject({ parseError: null });
    expect(rawRows(pipeline)[0]?.parsedAt).not.toBeNull();
    expect(allTransactions(pipeline.db)).toHaveLength(0);
  });

  test("a missing raw email is ignored", () => {
    const pipeline = createPipeline();
    expect(() => parseRawEmail(pipeline.db, { rawEmailId: 999 })).not.toThrow();
  });

  test("reparsing keeps a hidden transaction hidden instead of duplicating it", async () => {
    const pipeline = createPipeline();
    const { row } = await store(pipeline, fixture("VCB/02_salary_in"));
    await pipeline.worker.drain();
    pipeline.db.update(transactions).set({ deletedAt: new Date() }).run();
    parseRawEmail(pipeline.db, { rawEmailId: row.id });
    const all = allTransactions(pipeline.db);
    expect(all).toHaveLength(1);
    expect(all[0]?.deletedAt).not.toBeNull();
  });

  test("reparsing keeps the category and note", async () => {
    const pipeline = createPipeline();
    const { row } = await store(pipeline, fixture("VCB/02_salary_in"));
    await pipeline.worker.drain();
    const food = pipeline.db.query.categories
      .findFirst({ where: (c, { isNull }) => isNull(c.userId) })
      .sync();
    pipeline.db
      .update(transactions)
      .set({ categoryId: food?.id ?? null, note: "keep me" })
      .run();
    pipeline.db.update(transactions).set({ amount: 1 }).run();
    parseRawEmail(pipeline.db, { rawEmailId: row.id });
    expect(allTransactions(pipeline.db)[0]).toMatchObject({
      categoryId: food?.id,
      note: "keep me",
      amount: 25000000,
    });
  });

  test("a remembered rule categorizes the next matching email", async () => {
    const pipeline = createPipeline();
    const salary = pipeline.db.query.categories
      .findFirst({ where: (c, { eq: is, and }) => and(is(c.name, "Salary")) })
      .sync();
    expect(salary).toBeDefined();
    pipeline.db
      .insert(categoryRules)
      .values({
        userId: pipeline.userId,
        matchField: "counterparty",
        matchValue: "cong ty tnhh cong nghe abc",
        categoryId: salary?.id ?? 0,
      })
      .run();
    await store(pipeline, fixture("VCB/02_salary_in"));
    await pipeline.worker.drain();
    expect(allTransactions(pipeline.db)[0]?.categoryId).toBe(salary?.id ?? null);
  });

  test("the unverified flag follows the raw email's verification", async () => {
    const pipeline = createPipeline();
    const { row } = await storeEmail(pipeline.db, {
      userId: pipeline.userId,
      source: "forward",
      verification: "unverified",
      message: await fromEml(fixture("VCB/02_salary_in")),
    });
    await pipeline.worker.drain();
    expect(allTransactions(pipeline.db)[0]?.unverified).toBe(true);
    pipeline.db
      .update(rawEmails)
      .set({ verification: "user_confirmed" })
      .where(eq(rawEmails.id, row.id))
      .run();
    parseRawEmail(pipeline.db, { rawEmailId: row.id });
    expect(allTransactions(pipeline.db)[0]?.unverified).toBe(false);
  });
});
