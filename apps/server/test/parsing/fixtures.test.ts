import { describe, expect, test } from "bun:test";
import { basename, dirname, join } from "node:path";
import { Glob } from "bun";
import { env } from "../../src/config/env";
import { fromEml } from "../../src/mail/fetched-message";
import { redact } from "../../src/parsing/balance-redactor";
import { BANKS } from "../../src/parsing/banks-config";
import { toIsoInZone } from "../../src/parsing/date-parser";
import { makeParsedEmailInput } from "../../src/parsing/email-input";
import { allParsers, bankSenders, findParser } from "../../src/parsing/parser-registry";
import type { ParsedTransaction } from "../../src/parsing/types";

const ROOT = join(import.meta.dir, "../fixtures/emails");
const emlPaths = [...new Glob("*/*.eml").scanSync(ROOT)].sort().map((path) => join(ROOT, path));

/** The shape the fixtures were recorded in: snake_case keys, time in the display zone. */
function toExpectedShape(result: ParsedTransaction | null) {
  if (!result) return null;
  return {
    direction: result.direction,
    amount: result.amount,
    counterparty: result.counterparty,
    counterparty_account: result.counterpartyAccount,
    description: result.description,
    reference: result.reference,
    occurred_at: toIsoInZone(result.occurredAt, env.APP_TIMEZONE),
    currency: result.currency,
    original_amount: result.originalAmount,
    amount_estimated: result.amountEstimated,
  };
}

const expectedFor = async (emlPath: string) =>
  Bun.file(emlPath.replace(/\.eml$/, ".expected.json")).json();

describe("bank fixtures", () => {
  test("finds every upstream fixture", () => {
    expect(emlPaths).toHaveLength(20);
  });

  test.each(
    emlPaths.map((path) => [`${basename(dirname(path))}/${basename(path)}`, path] as const),
  )("%s parses to its expected transaction", async (_name, path) => {
    const message = await fromEml(await Bun.file(path).bytes());
    const parser = findParser(message.from, message.subject);

    expect(parser).not.toBeNull();
    expect(parser?.bankCode()).toBe(basename(dirname(path)));

    const result = parser?.parse(
      makeParsedEmailInput(
        message.from,
        message.subject,
        message.html,
        message.text,
        message.receivedAt,
      ),
    );
    expect(toExpectedShape(result ?? null)).toEqual(await expectedFor(path));
  });

  test("each bank has at least three transaction fixtures and one non-transaction fixture", async () => {
    for (const code of Object.keys(BANKS)) {
      const files = [...new Glob(`${code}/*.expected.json`).scanSync(ROOT)];
      const expectations = await Promise.all(
        files.map((file) => Bun.file(join(ROOT, file)).json()),
      );
      expect(expectations.filter(Boolean).length).toBeGreaterThanOrEqual(3);
      expect(expectations.includes(null)).toBe(true);
    }
  });
});

describe("balance redaction on stored bodies", () => {
  test.each([
    ["VCB/02_salary_in", "40,420,000"],
    ["VCB/03_qr_payment_text", "15,331,000"],
  ])("%s keeps parsing the same without the balance", async (fixture, balance) => {
    const path = join(ROOT, `${fixture}.eml`);
    const message = await fromEml(await Bun.file(path).bytes());
    expect((message.html ?? "") + (message.text ?? "")).toContain(balance);

    const html = message.html === null ? null : redact(message.html);
    const text = message.text === null ? null : redact(message.text);
    expect((html ?? "") + (text ?? "")).not.toContain(balance);
    expect((html ?? "") + (text ?? "")).toContain("***");

    const parser = findParser(message.from, message.subject);
    const result = parser?.parse(
      makeParsedEmailInput(message.from, message.subject, html, text, message.receivedAt),
    );
    expect(toExpectedShape(result ?? null)).toEqual(await expectedFor(path));
  });
});

describe("parser registry", () => {
  test("exposes all configured senders and matches display-name senders", () => {
    expect(bankSenders()).toEqual(
      expect.arrayContaining([
        "vcbdigibank@info.vietcombank.com.vn",
        "no-reply@cake.vn",
        "vpbankonline@vpb.com.vn",
      ]),
    );
    expect(findParser("Vietcombank <VCBDigibank@info.vietcombank.com.vn>", "x")?.bankCode()).toBe(
      "VCB",
    );
    expect(findParser("scam@vietcombank.com.vn.evil.io", "x")).toBeNull();
    expect(allParsers()).toHaveLength(3);
  });
});

describe("fromEml", () => {
  test("falls back to a sha1 message id and lowercases the sender", async () => {
    const message = await fromEml(
      "From: Bank <NO-REPLY@Cake.vn>\r\nSubject: Hi\r\nDate: Wed, 18 Nov 2026 08:05:15 +0700\r\n\r\nbody",
    );
    expect(message.messageId).toMatch(/^sha1-[0-9a-f]{40}$/);
    expect(message.from).toBe("no-reply@cake.vn");
    expect(message.receivedAt.toISOString()).toBe("2026-11-18T01:05:15.000Z");
  });
});
