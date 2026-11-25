import { AbstractBankParser } from "../abstract-bank-parser";
import type { ParsedEmailInput, ParsedTransaction } from "../types";

const RIGHT_COLUMN_LABELS = "Ngày, giờ giao dịch|Số tiền trích nợ|Số tiền ghi có|Số tiền phí";
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

/**
 * VPBank NEO "Transfer successful" confirmations, built from a real redacted sample: always money
 * leaving the account. The details are a two-column table, so a line holds two fields, e.g.
 * "Tài khoản ghi có: 316QR... Số tiền ghi có: 28,000 VND"; a left-column value ends where the
 * right-column label starts.
 */
export class VpBankParser extends AbstractBankParser {
  bankCode(): string {
    return "VPB";
  }

  parse(input: ParsedEmailInput): ParsedTransaction | null {
    if (this.isNonTransaction(input)) return null;

    const text = input.text;
    const amount = this.cell(text, "Số tiền trích nợ");
    if (amount === null) return null;

    return this.transaction(input, {
      amount,
      directionHint: "ghi nợ",
      counterparty: this.cell(text, "Tên người hưởng"),
      counterpartyAccount: this.cell(text, "Tài khoản ghi có"),
      description: this.cell(text, "Nội dung chuyển tiền"),
      reference: this.cell(text, "Mã giao dịch"),
      time: this.cell(text, "Ngày, giờ giao dịch"),
    });
  }

  private cell(text: string, label: string): string | null {
    const pattern = new RegExp(
      `(?:^|\\s)${escapeRegExp(label)}:?[ \\t]+(.+?)(?=\\s+(?:${RIGHT_COLUMN_LABELS}):|[ \\t]*$)`,
      "mu",
    );
    return text.match(pattern)?.[1]?.trim() ?? null;
  }
}
