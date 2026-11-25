import { describe, expect, test } from "bun:test";
import { MASK, redact } from "../../src/parsing/balance-redactor";
import { parse as parseDate, toIsoInZone } from "../../src/parsing/date-parser";
import { parse as parseMoney, parseWithCurrency } from "../../src/parsing/money-parser";
import { clean, fold, htmlToText } from "../../src/parsing/text-normalizer";

const ZONE = "Asia/Ho_Chi_Minh";

describe("money parser", () => {
  test.each([
    ["1,250,000 VND", 1250000],
    ["-1.250.000 VND", -1250000],
    ["+500,000đ", 500000],
    ["1.250.000,00", 1250000],
    ["1,250,000.00", 1250000],
    ["1.250.000,00 VND", 1250000],
    ["50.000₫", 50000],
    ["50.000 ₫", 50000],
    ["- 75,000 VNĐ", -75000],
    ["−200.000 VND", -200000],
    ["1250000", 1250000],
    ["+1 250 000 VND", 1250000],
    ["999", 999],
    ["1.000", 1000],
    ["12,500,000,000 VND", 12500000000],
    ["Số tiền: -35,000 VND.", -35000],
    ["1.234,56", 1235],
    ["VND 2,000,000", 2000000],
    ["abc", null],
    ["", null],
  ])("parses %p", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  test.each([
    ["12.50 USD", { amount: 1250, currency: "USD" }],
    ["USD 1,234.56", { amount: 123456, currency: "USD" }],
    ["$9.99", { amount: 999, currency: "USD" }],
    ["-20 USD", { amount: -2000, currency: "USD" }],
    ["12.50 USD (325,000 VND)", { amount: 1250, currency: "USD" }],
    ["15,00 EUR", { amount: 1500, currency: "EUR" }],
    ["1.250.000 VND", { amount: 1250000, currency: "VND" }],
    ["500.000đ", { amount: 500000, currency: "VND" }],
    ["-35,000", { amount: -35000, currency: "VND" }],
    ["abc", null],
  ])("detects the currency of %p", (input, expected) => {
    expect(parseWithCurrency(input)).toEqual(expected);
  });
});

describe("date parser", () => {
  test.each([
    ["12/11/2026 14:03:21", "2026-11-12T14:03:21+07:00"],
    ["12-11-2026 14:03", "2026-11-12T14:03:00+07:00"],
    ["14:03 12/11/2026", "2026-11-12T14:03:00+07:00"],
    ["14:03:21 12/11/2026", "2026-11-12T14:03:21+07:00"],
    ["Thời gian: 05/01/2026 08:00", "2026-01-05T08:00:00+07:00"],
    ["2026-11-12 14:03:21", "2026-11-12T14:03:21+07:00"],
    ["1/2/26 9:05", "2026-02-01T09:05:00+07:00"],
    ["12.11.2026 23:59:59", "2026-11-12T23:59:59+07:00"],
    ["12/11/2026", "2026-11-12T00:00:00+07:00"],
  ])("reads %p in %s", (input, expected) => {
    const date = parseDate(input, ZONE);
    expect(date && toIsoInZone(date, ZONE)).toBe(expected);
  });

  test("converts to UTC correctly", () => {
    expect(parseDate("12/11/2026 14:03:21", ZONE)?.toISOString()).toBe("2026-11-12T07:03:21.000Z");
  });

  test("uses the zone it is given, including one with daylight saving", () => {
    expect(parseDate("15/07/2026 12:00", "America/New_York")?.toISOString()).toBe(
      "2026-07-15T16:00:00.000Z",
    );
    expect(parseDate("15/01/2026 12:00", "America/New_York")?.toISOString()).toBe(
      "2026-01-15T17:00:00.000Z",
    );
  });

  test.each(["31/02/2026 10:00", "no date here", "12/13/2026", "12/11/2026 25:00"])(
    "rejects %p",
    (input) => {
      expect(parseDate(input, ZONE)).toBeNull();
    },
  );
});

describe("text normalizer", () => {
  test("converts html to clean lines", () => {
    const html = `
      <html><head><style>td{color:red}</style></head><body>
      <table><tr><td>Số tiền:</td><td>&nbsp;-1,250,000&nbsp;VND</td></tr>
      <tr><td>Nội   dung:</td><td>CHUYEN&#32;TIEN</td></tr></table>
      <p>Cảm ơn<br>Quý khách</p><!-- hidden --></body></html>`;
    expect(htmlToText(html)).toBe(
      "Số tiền: -1,250,000 VND\nNội dung: CHUYEN TIEN\nCảm ơn\nQuý khách",
    );
  });

  test("composes decomposed unicode to NFC", () => {
    expect(clean("Nguyễn")).toBe("Nguyễn");
  });

  test.each([
    ["NGUYỄN VĂN ĐỨC", "nguyen van duc"],
    ["Cà phê   Highlands", "ca phe highlands"],
    ["Điện lực EVN", "dien luc evn"],
    ["Nguyễn", "nguyen"],
    ["ơ ư ă â ê ô", "o u a a e o"],
  ])("folds %p", (input, expected) => {
    expect(fold(input)).toBe(expected);
  });
});

describe("balance redactor", () => {
  test("keeps the label and leaves other amounts alone", () => {
    expect(redact("PS: -150,000VND|SD: 10,345,678VND|ND: QR")).toBe(
      "PS: -150,000VND|SD: ***|ND: QR",
    );
    expect(redact("Số dư cuối: 15,331,000 VND")).toBe("Số dư cuối: ***");
    expect(redact("<td>Số dư/Balance:</td><td><b>VND 8,500,000</b></td>")).toBe(
      "<td>Số dư/Balance:</td><td><b>***</b></td>",
    );
    expect(redact(null)).toBeNull();
    expect(MASK).toBe("***");
  });
});
