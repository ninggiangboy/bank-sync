export const DIRECTIONS = ["in", "out"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const CATEGORY_TYPES = ["expense", "income", "debt_loan"] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const MATCH_FIELDS = ["account", "counterparty", "description"] as const;
export type MatchField = (typeof MATCH_FIELDS)[number];

/** How a raw email reached the app. */
export const EMAIL_SOURCES = ["forward", "upload"] as const;
export type EmailSource = (typeof EMAIL_SOURCES)[number];

/** Whether a raw email is trusted to come from the bank. Only `unverified` is excluded from totals. */
export const VERIFICATIONS = ["dkim_pass", "unverified", "user_confirmed", "user_upload"] as const;
export type Verification = (typeof VERIFICATIONS)[number];

export const LOCALES = ["vi", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** Debt/loan categories are fixed system rows (users can't add them), and each one moves money one way. */
export const DEBT_LOAN_DIRECTIONS: Readonly<Record<string, Direction>> = {
  Lending: "out",
  "Debt repayment": "out",
  Borrowing: "in",
  "Debt collection": "in",
};

/** Bank code of transactions the user entered by hand. */
export const MANUAL_BANK_CODE = "manual";

/** Money out is an expense, money in is income. */
export const categoryTypeFor = (direction: Direction): CategoryType =>
  direction === "in" ? "income" : "expense";
