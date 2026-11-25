import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "../../src/config/env";
import { VietcombankParser } from "../../src/parsing/banks/vietcombank-parser";
import { toIsoInZone } from "../../src/parsing/date-parser";
import { makeParsedEmailInput } from "../../src/parsing/email-input";
import { UnparseableEmailError } from "../../src/parsing/types";

const parser = new VietcombankParser(["info@vietcombank.com.vn"]);
const RECEIVED = new Date("2026-11-12T03:00:00Z");
const input = (text: string, subject = "Thông báo") =>
  makeParsedEmailInput("x@bank.vn", subject, null, text, RECEIVED);

const rejects = (text: string, reason: string) => {
  try {
    parser.parse(input(text));
  } catch (error) {
    expect(error).toBeInstanceOf(UnparseableEmailError);
    expect((error as UnparseableEmailError).reason).toBe(reason);
    return;
  }
  throw new Error("expected the parser to throw");
};

describe("vietcombank balance notifications", () => {
  test("a redacted amount throws amount_missing", () => {
    rejects("Số tiền: *** VND\nNội dung: ABC", "amount_missing");
  });

  test("no sign and no type throws direction_unknown", () => {
    rejects("Số tiền: 100,000 VND\nNội dung: X", "direction_unknown");
  });

  test.each([
    ["Ghi nợ", "out"],
    ["GHI CÓ", "in"],
    ["Debit", "out"],
    ["Credit", "in"],
    ["Nhận tiền", "in"],
    ["Trừ tiền", "out"],
  ])("direction comes from the type %p", (type, direction) => {
    expect(parser.parse(input(`Loại giao dịch: ${type}\nSố tiền: 100.000đ`))?.direction).toBe(
      direction,
    );
  });

  test("falls back to the received time in local time when the body has none", () => {
    const result = parser.parse(input("Số tiền: -10,000 VND"));
    expect(result && toIsoInZone(result.occurredAt, env.APP_TIMEZONE)).toBe(
      "2026-11-12T10:00:00+07:00",
    );
  });

  test("bank emails without an amount field are not transactions", () => {
    expect(parser.parse(input("Sao kê tài khoản tháng 10 đã sẵn sàng.", "Sao kê"))).toBeNull();
    expect(parser.parse(input("Ưu đãi hoàn tiền. Số tiền: +50,000 VND", "Khuyến mãi"))).toBeNull();
  });

  test("an amount label without a colon inside html table cells is parsed", () => {
    const html = "<table><tr><td>Số tiền</td><td>-12.000 VND</td></tr></table>";
    expect(parser.parse(makeParsedEmailInput("x", "s", html, null, new Date()))?.amount).toBe(
      12000,
    );
  });
});

describe("vietcombank receipts", () => {
  test("read the amount block, not the fee block", () => {
    const text =
      "Biên lai chuyển tiền qua tài khoản\nSố tiền\nAmount\n480,000 VND\nSố tiền phí\nCharge Amount\nNet income\nVAT\n0 VND";
    const result = parser.parse(input(text));
    expect(result?.amount).toBe(480000);
    expect(result?.direction).toBe("out");
  });

  test("a blank amount throws amount_missing", () => {
    rejects("Số tiền\nAmount\n*** VND\nSố tiền phí\nCharge Amount\n0 VND", "amount_missing");
  });

  test.each([
    ["0451000555666", "0451000555666"],
    ["VQRQA1B2C3 ", "VQRQA1B2C3"],
    ["abc123", "ABC123"],
    ["MBVCB.123", null],
    ["GRAB*123", null],
  ])("credit account %p becomes %p", (account, expected) => {
    const text = `Biên lai thanh toán\nTài khoản hưởng\nCredit Account\n${account}\nSố tiền\nAmount\n100,000 VND`;
    expect(parser.parse(input(text))?.counterpartyAccount).toBe(expected);
  });
});

describe("foreign currency", () => {
  let dir: string;
  const original = env.STORAGE_PATH;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fx-"));
    (env as { STORAGE_PATH: string }).STORAGE_PATH = dir;
  });
  afterEach(() => {
    (env as { STORAGE_PATH: string }).STORAGE_PATH = original;
    rmSync(dir, { recursive: true, force: true });
  });

  test("uses the VND the bank charged when the email states it", () => {
    const result = parser.parse(
      input("Số tiền: -12.50 USD\nSố tiền quy đổi: 330,000 VND\nNội dung: NETFLIX.COM"),
    );
    expect(result).toMatchObject({
      amount: 330000,
      currency: "USD",
      originalAmount: 1250,
      amountEstimated: false,
    });
  });

  test("estimates at the configured rate when no VND figure is stated", () => {
    const result = parser.parse(input("Số tiền: -12.50 USD\nNội dung: NETFLIX.COM"));
    expect(result).toMatchObject({
      amount: Math.round((1250 * env.FX_USD_VND) / 100),
      direction: "out",
      amountEstimated: true,
    });
  });

  test("the downloaded rate table wins over the fallback", () => {
    writeFileSync(join(dir, "fx-rates.json"), JSON.stringify({ USD: 30000, EUR: 28000 }));
    expect(parser.parse(input("Số tiền: -12.50 USD"))?.amount).toBe(375000);
    expect(parser.parse(input("Số tiền: -15.00 EUR"))?.amount).toBe(420000);
  });

  test("a currency with no rate and no stated VND figure is rejected, never saved as VND", () => {
    rejects("Số tiền: -15.00 EUR\nNội dung: SPOTIFY", "currency_unsupported");
  });

  test("a card alert that did not succeed is not a transaction", () => {
    const text =
      "Số tiền\nTransaction Amount\n22.22 USD\nSử dụng tại\nAt\nSHOP\nTình trạng giao dịch\nStatus of Transaction\nKhông thành công";
    expect(parser.parse(input(text))).toBeNull();
  });
});
