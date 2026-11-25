export type Direction = "in" | "out";

export type ParsedEmailInput = {
  from: string;
  subject: string;
  html: string | null;
  text: string;
  receivedAt: Date;
};

export type ParsedTransaction = {
  direction: Direction;
  amount: number;
  counterparty: string | null;
  counterpartyAccount: string | null;
  description: string | null;
  reference: string | null;
  /** UTC instant; display it in APP_TIMEZONE. */
  occurredAt: Date;
  currency: string | null;
  originalAmount: number | null;
  amountEstimated: boolean;
};

export type UnparseableReason = "amount_missing" | "direction_unknown" | "currency_unsupported";

export class UnparseableEmailError extends Error {
  constructor(readonly reason: UnparseableReason) {
    super(reason);
    this.name = "UnparseableEmailError";
  }
}

export interface BankEmailParser {
  bankCode(): string;
  /** Lowercase sender addresses. */
  senders(): string[];
  supports(from: string, subject: string): boolean;
  /** Null means "bank email, but not a transaction" (OTP, promo, statement). */
  parse(input: ParsedEmailInput): ParsedTransaction | null;
}
