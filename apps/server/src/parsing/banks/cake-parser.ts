import { AbstractBankParser } from "../abstract-bank-parser";
import type { ParsedEmailInput, ParsedTransaction } from "../types";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

/**
 * "[CAKE] Thông báo giao dịch thành công", built from real redacted samples: each label on its own
 * line with the value on the next, the amount signed ("+2.000 đ" in, "-2.000 đ" out). The other
 * party is the sender for money in and the receiver for money out.
 */
export class CakeParser extends AbstractBankParser {
  bankCode(): string {
    return "CAKE";
  }

  parse(input: ParsedEmailInput): ParsedTransaction | null {
    if (this.isNonTransaction(input)) return null;

    const text = input.text;
    const amount = this.nextLine(text, "Số tiền");
    if (amount === null) return null;

    const party = amount.startsWith("+") ? "chuyển" : "nhận";
    return this.transaction(input, {
      amount,
      counterparty: this.nextLine(text, `Tên người ${party}`),
      counterpartyAccount: this.nextLine(text, `Tài khoản ${party}`),
      description: this.nextLine(text, "Nội dung giao dịch"),
      reference: this.nextLine(text, "Mã giao dịch"),
      time: this.nextLine(text, "Ngày giờ giao dịch"),
    });
  }

  private nextLine(text: string, label: string): string | null {
    const match = text.match(new RegExp(`^${escapeRegExp(label)}\\n(.+)$`, "mu"));
    return match?.[1]?.trim() ?? null;
  }
}
