import { parse as parseDate } from "./date-parser";
import { vndPer } from "./exchange-rates";
import * as Money from "./money-parser";
import { fold } from "./text-normalizer";
import {
  type BankEmailParser,
  type Direction,
  type ParsedEmailInput,
  type ParsedTransaction,
  UnparseableEmailError,
} from "./types";

/** "Vietcombank <VCB@x.vn>" becomes "vcb@x.vn". */
export function senderAddress(from: string): string {
  const bracketed = from.match(/<([^>]+)>/);
  return (bracketed?.[1] ?? from).trim().toLowerCase();
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

export type TransactionFields = {
  amount: string | null;
  directionHint?: string | null;
  counterparty?: string | null;
  counterpartyAccount?: string | null;
  description?: string | null;
  reference?: string | null;
  time?: string | null;
  convertedAmount?: string | null;
};

export abstract class AbstractBankParser implements BankEmailParser {
  private readonly bankSenders: string[];

  constructor(senders: readonly string[]) {
    this.bankSenders = senders.map((sender) => sender.toLowerCase());
  }

  abstract bankCode(): string;
  abstract parse(input: ParsedEmailInput): ParsedTransaction | null;

  senders(): string[] {
    return this.bankSenders;
  }

  supports(from: string, _subject: string): boolean {
    return this.bankSenders.includes(senderAddress(from));
  }

  /** First line value after any of the given label regex fragments, e.g. "Số tiền: -50,000 VND". */
  protected field(text: string, labels: string): string | null {
    const match = text.match(new RegExp(`^\\s*(?:${labels})\\s*:?\\s*(.+?)\\s*$`, "mui"));
    return match?.[1] ?? null;
  }

  /**
   * Value on the line after a "Vietnamese label / English label" pair, as in receipts laid out as
   * "Số tiền\nAmount\n480,000 VND". Each argument may list alternatives separated by "|".
   */
  protected blockField(text: string, labels: string, englishLabels: string): string | null {
    const quote = (alternatives: string) => alternatives.split("|").map(escapeRegExp).join("|");
    const match = text.match(
      new RegExp(`^(?:${quote(labels)})\\n(?:${quote(englishLabels)})\\n(.+)$`, "mu"),
    );
    return match?.[1]?.trim() ?? null;
  }

  protected isNonTransaction(input: ParsedEmailInput): boolean {
    return /\b(otp|ma xac thuc|khuyen mai|uu dai)\b/.test(fold(`${input.subject} ${input.text}`));
  }

  protected transaction(input: ParsedEmailInput, fields: TransactionFields): ParsedTransaction {
    const money = fields.amount == null ? null : Money.parseWithCurrency(fields.amount);
    if (!money?.amount) throw new UnparseableEmailError("amount_missing");

    let signedAmount = money.amount;
    let foreign: { vnd: number; estimated: boolean } | null = null;
    if (money.currency !== "VND") {
      foreign = this.toVnd(money.currency, Math.abs(signedAmount), fields.convertedAmount ?? null);
      signedAmount = foreign.vnd;
    }

    const direction =
      this.directionFromSign(fields.amount as string) ??
      this.directionFromKeywords(fields.directionHint ?? "");
    if (direction === null) throw new UnparseableEmailError("direction_unknown");

    return {
      direction,
      amount: Math.abs(signedAmount),
      counterparty: this.cleanValue(fields.counterparty),
      counterpartyAccount: this.accountNumber(fields.counterpartyAccount),
      description: this.cleanValue(fields.description),
      reference: this.cleanValue(fields.reference),
      occurredAt: (fields.time ? parseDate(fields.time) : null) ?? input.receivedAt,
      currency: foreign ? money.currency : null,
      originalAmount: foreign ? Math.abs(money.amount) : null,
      amountEstimated: foreign?.estimated ?? false,
    };
  }

  /** VND the bank charged when the email states it, otherwise an estimate at the current rate. */
  private toVnd(currency: string, minorAmount: number, convertedAmount: string | null) {
    const charged = convertedAmount === null ? null : Money.parse(convertedAmount);
    if (charged) return { vnd: Math.abs(charged), estimated: false };

    const rate = vndPer(currency);
    if (!rate) throw new UnparseableEmailError("currency_unsupported");
    return { vnd: Math.round((minorAmount * rate) / 100), estimated: true };
  }

  protected directionFromSign(amount: string): Direction | null {
    const sign = amount.match(/(?:^|[\s:])([+\-−])\s*\d/u)?.[1];
    if (!sign) return null;
    return sign === "+" ? "in" : "out";
  }

  protected directionFromKeywords(hint: string): Direction | null {
    const folded = fold(hint);
    if (/\b(ghi no|debit|tru)\b/.test(folded)) return "out";
    if (/\b(ghi co|credit|nhan)\b/.test(folded)) return "in";
    return null;
  }

  /** Account numbers are letters and digits only; anything with other characters (".", "*", …) isn't one. */
  private accountNumber(value: string | null | undefined): string | null {
    const compact = (value ?? "").replace(/\s+/gu, "");
    return /^[A-Za-z0-9]+$/.test(compact) ? compact.toUpperCase() : null;
  }

  private cleanValue(value: string | null | undefined): string | null {
    const cleaned = (value ?? "").replace(/\s+/gu, " ").trim();
    return cleaned === "" ? null : cleaned;
  }
}
