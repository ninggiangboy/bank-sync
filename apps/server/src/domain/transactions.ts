import {
  type CategoryType,
  type Direction,
  MANUAL_BANK_CODE,
  type Verification,
} from "@bank-sync/shared";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  max,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { Db } from "../db/client";
import { categories, inboundAddresses, rawEmails, transactions } from "../db/schema";
import { HttpError } from "../http/errors";
import { BANKS } from "../parsing/banks-config";
import { makeParsedEmailInput } from "../parsing/email-input";
import { availableTo, color, fitting, isSystem, ordered } from "./categories";
import * as matcher from "./category-matcher";
import type { WriteContext } from "./demo";
import {
  formatMonth,
  localDate,
  localMinute,
  monthOf,
  monthRange,
  parseLocalMinute,
  type YearMonth,
} from "./time";

type TransactionRow = typeof transactions.$inferSelect;
type CategoryRow = typeof categories.$inferSelect;

export const FILTERS = ["all", "uncategorized", "in", "out"] as const;
export type Filter = (typeof FILTERS)[number];

export const notFound = (code = "not_found") => new HttpError(404, code);

export type CategoryDto = {
  id: number;
  name: string;
  icon: string | null;
  type: CategoryType;
  system: boolean;
  parentId: number | null;
  color: number;
};

export const categoryDto = (category: CategoryRow): CategoryDto => ({
  id: category.id,
  name: category.name,
  icon: category.icon,
  type: category.type,
  system: isSystem(category),
  parentId: category.parentId,
  color: color(category.id),
});

export type TransactionDto = {
  id: number;
  direction: Direction;
  amount: number;
  currency: string | null;
  originalAmount: number | null;
  amountEstimated: boolean;
  counterparty: string | null;
  description: string | null;
  bankCode: string;
  manual: boolean;
  occurredAt: string;
  category: CategoryDto | null;
  note: string | null;
  hidden: boolean;
  unverified: boolean;
};

export const transactionDto = (
  row: TransactionRow,
  category: CategoryRow | null,
): TransactionDto => ({
  id: row.id,
  direction: row.direction,
  amount: row.amount,
  currency: row.currency,
  originalAmount: row.originalAmount,
  amountEstimated: row.amountEstimated,
  counterparty: row.counterparty,
  description: row.description,
  bankCode: row.bankCode,
  manual: row.bankCode === MANUAL_BANK_CODE,
  occurredAt: row.occurredAt.toISOString(),
  category: category ? categoryDto(category) : null,
  note: row.note,
  hidden: row.deletedAt !== null,
  unverified: row.unverified,
});

/** Rows that count in totals and reports: not hidden, not unverified. */
export const counted = (): SQL =>
  and(isNull(transactions.deletedAt), eq(transactions.unverified, false)) as SQL;

/** The owner's transaction, hidden ones included; 404 for anything else, never 403. */
export function requireTransaction(db: Db, ownerId: string, id: number): TransactionRow {
  const row = db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, ownerId)))
    .get();
  if (!row) throw notFound();
  return row;
}

/** A category the owner can use: a system category or one of their own. */
export function findCategory(db: Db, ownerId: string, id: number): CategoryRow | null {
  return (
    db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), availableTo(ownerId)))
      .get() ?? null
  );
}

/** A category that fits the direction and belongs to the owner or the system, else null. */
export function findFittingCategory(
  db: Db,
  ownerId: string,
  id: number,
  direction: Direction,
): CategoryRow | null {
  return (
    db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), availableTo(ownerId), fitting(direction)))
      .get() ?? null
  );
}

export function fittingCategories(db: Db, ownerId: string, direction: Direction): CategoryDto[] {
  return db
    .select()
    .from(categories)
    .where(and(availableTo(ownerId), fitting(direction)))
    .orderBy(...ordered())
    .all()
    .map(categoryDto);
}

export type ForwardingSummary = { hasAddress: boolean; hasReceived: boolean };

export function forwardingSummary(db: Db, userId: string): ForwardingSummary {
  const hasAddress =
    db
      .select({ id: inboundAddresses.id })
      .from(inboundAddresses)
      .where(and(eq(inboundAddresses.userId, userId), isNull(inboundAddresses.replacedAt)))
      .get() !== undefined;
  const hasReceived =
    db.select({ id: rawEmails.id }).from(rawEmails).where(eq(rawEmails.userId, userId)).get() !==
    undefined;
  return { hasAddress, hasReceived };
}

export type ListQuery = {
  month: YearMonth;
  filter: Filter;
  categoryId: number | null;
  payee: string;
};

export function listTransactions(db: Db, ownerId: string, query: ListQuery, actorId: string) {
  const { start, end } = monthRange(query.month);
  const inMonth = and(
    eq(transactions.userId, ownerId),
    gte(transactions.occurredAt, start),
    lt(transactions.occurredAt, end),
  ) as SQL;

  const totals = db
    .select({
      spent: sql<number>`coalesce(sum(case when ${transactions.direction} = 'out' then ${transactions.amount} else 0 end), 0)`,
      income: sql<number>`coalesce(sum(case when ${transactions.direction} = 'in' then ${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .where(and(inMonth, counted()))
    .get();

  let scope: CategoryRow | null = null;
  let scopeIds: number[] = [];
  if (query.categoryId !== null) {
    scope = findCategory(db, ownerId, query.categoryId);
    if (!scope) throw notFound("category_not_found");
    scopeIds = db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          availableTo(ownerId),
          or(eq(categories.id, scope.id), eq(categories.parentId, scope.id)),
        ),
      )
      .all()
      .map((row) => row.id);
  }

  const conditions: (SQL | undefined)[] = [
    inMonth,
    query.filter === "uncategorized" ? isNull(transactions.categoryId) : undefined,
    query.filter === "in" || query.filter === "out"
      ? eq(transactions.direction, query.filter)
      : undefined,
    scope ? inArray(transactions.categoryId, scopeIds) : undefined,
    query.payee !== "" ? eq(transactions.counterparty, query.payee) : undefined,
  ];
  const rows = db
    .select({ transaction: transactions, category: categories })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(...conditions.filter((condition) => condition !== undefined)))
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .all();

  const days: { date: string; transactions: TransactionDto[] }[] = [];
  for (const { transaction, category } of rows) {
    const date = localDate(transaction.occurredAt);
    let day = days.at(-1);
    if (day?.date !== date) {
      day = { date, transactions: [] };
      days.push(day);
    }
    day.transactions.push(transactionDto(transaction, category));
  }

  const unverifiedCount =
    db
      .select({ value: count() })
      .from(transactions)
      .where(and(inMonth, eq(transactions.unverified, true), isNull(transactions.deletedAt)))
      .get()?.value ?? 0;

  const anyTransaction =
    rows.length > 0 ||
    db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.userId, ownerId))
      .get() !== undefined;

  return {
    month: formatMonth(query.month),
    spent: Number(totals?.spent ?? 0),
    income: Number(totals?.income ?? 0),
    unverifiedCount,
    days,
    scope: {
      category: scope ? categoryDto(scope) : null,
      payee: query.payee === "" ? null : query.payee,
    },
    latestMonth: rows.length === 0 ? latestMonthWithData(db, ownerId, query.month) : null,
    hasAnyTransactions: anyTransaction,
    forwarding: forwardingSummary(db, actorId),
  };
}

function latestMonthWithData(db: Db, ownerId: string, current: YearMonth): string | null {
  const latest = db
    .select({ value: max(transactions.occurredAt) })
    .from(transactions)
    .where(eq(transactions.userId, ownerId))
    .get()?.value;
  if (!latest) return null;
  const month = formatMonth(monthOf(latest));
  return month === formatMonth(current) ? null : month;
}

export type RuleTarget =
  | { field: "account"; counterparty: string | null; account: string }
  | { field: "counterparty" | "description"; value: string };

/** What a rule would be created for: the account number (with the name), else the name, else the description. */
export function ruleTarget(row: TransactionRow): RuleTarget | null {
  const field = matcher.ruleField(row);
  if (field === "account") {
    return {
      field,
      counterparty: row.counterparty,
      account: row.counterpartyAccount ?? "",
    };
  }
  const value = field === "counterparty" ? row.counterparty : row.description;
  return value && value.trim() !== "" ? { field, value } : null;
}

export function transactionDetail(db: Db, ownerId: string, id: number) {
  const row = requireTransaction(db, ownerId, id);
  const category =
    row.categoryId === null
      ? null
      : (db.select().from(categories).where(eq(categories.id, row.categoryId)).get() ?? null);
  const raw =
    row.rawEmailId === null
      ? null
      : (db.select().from(rawEmails).where(eq(rawEmails.id, row.rawEmailId)).get() ?? null);
  const target = ruleTarget(row);
  const canRule = row.categoryId !== null && target !== null;
  const bank = (BANKS as Record<string, { name: string }>)[row.bankCode];

  const verification: Verification | null = raw?.verification ?? null;
  return {
    transaction: {
      ...transactionDto(row, category),
      counterpartyAccount: row.counterpartyAccount,
      occurredAtLocal: localMinute(row.occurredAt),
      reference: row.reference,
    },
    bankName: row.bankCode === MANUAL_BANK_CODE ? null : (bank?.name ?? row.bankCode),
    verification,
    dkimDomain: raw?.dkimDomain ?? null,
    ruleTarget: target,
    followsRule: canRule && matcher.follows(db, row),
    backfillCount: canRule ? matcher.backfillCount(db, ruleRow(row)) : 0,
    rawEmail: raw
      ? {
          fromAddress: raw.fromAddress,
          subject: raw.subject,
          receivedAt: raw.receivedAt.toISOString(),
          source: raw.source,
        }
      : null,
    categories: fittingCategories(db, ownerId, row.direction),
  };
}

/** The draft rule for a categorized transaction, shaped like a stored rule so the matcher can use it. */
function ruleRow(row: TransactionRow): matcher.RuleRow {
  const now = new Date();
  return { id: 0, createdAt: now, updatedAt: now, ...matcher.draft(row) } as matcher.RuleRow;
}

/** Normalized plain text of the stored email; never the raw HTML or text parts. */
export function rawEmailText(db: Db, ownerId: string, id: number): string {
  const row = requireTransaction(db, ownerId, id);
  const raw =
    row.rawEmailId === null
      ? undefined
      : db.select().from(rawEmails).where(eq(rawEmails.id, row.rawEmailId)).get();
  if (!raw) throw notFound("raw_email_not_found");
  return makeParsedEmailInput(
    raw.fromAddress,
    raw.subject,
    raw.bodyHtml,
    raw.bodyText,
    raw.receivedAt,
  ).text;
}

export function setCategory(db: Db, ctx: WriteContext, id: number, categoryId: number) {
  const row = requireTransaction(db, ctx.ownerId, id);
  const category = findFittingCategory(db, ctx.ownerId, categoryId, row.direction);
  if (!category) throw notFound("category_not_found");
  const updated = db
    .update(transactions)
    .set({ categoryId: category.id })
    .where(eq(transactions.id, row.id))
    .returning()
    .get();
  return { category: categoryDto(category), followsRule: matcher.follows(db, updated) };
}

function requireRulable(row: TransactionRow) {
  if (row.categoryId === null || ruleTarget(row) === null) {
    throw new HttpError(422, "rule_unavailable");
  }
  return row.categoryId;
}

/** Remembers or forgets the rule for this transaction's category. */
export function setRule(db: Db, ctx: WriteContext, id: number, enabled: boolean) {
  const row = requireTransaction(db, ctx.ownerId, id);
  const categoryId = requireRulable(row);
  if (enabled) matcher.remember(db, row, categoryId);
  else matcher.forget(db, row);
  return { followsRule: matcher.follows(db, row) };
}

export function backfillRule(db: Db, ctx: WriteContext, id: number) {
  const row = requireTransaction(db, ctx.ownerId, id);
  requireRulable(row);
  return { count: matcher.backfill(db, ruleRow(row)) };
}

export function setNote(db: Db, ctx: WriteContext, id: number, note: string | null) {
  const row = requireTransaction(db, ctx.ownerId, id);
  db.update(transactions).set({ note }).where(eq(transactions.id, row.id)).run();
  return { note };
}

export function toggleHidden(db: Db, ctx: WriteContext, id: number) {
  const row = requireTransaction(db, ctx.ownerId, id);
  const deletedAt = row.deletedAt === null ? new Date() : null;
  db.update(transactions).set({ deletedAt }).where(eq(transactions.id, row.id)).run();
  return { hidden: deletedAt !== null };
}

/** Manual transactions only: the others belong to an email and would come back on reparse. */
export function deleteManual(db: Db, ctx: WriteContext, id: number) {
  const row = requireTransaction(db, ctx.ownerId, id);
  if (row.bankCode !== MANUAL_BANK_CODE) throw notFound();
  db.delete(transactions).where(eq(transactions.id, row.id)).run();
  return { month: formatMonth(monthOf(row.occurredAt)) };
}

/** Marks an unverified bank email as trusted; from now on its transaction counts in totals. */
export function confirmUnverified(db: Db, ctx: WriteContext, id: number) {
  const row = requireTransaction(db, ctx.ownerId, id);
  if (!row.unverified) throw new HttpError(409, "not_unverified");
  db.transaction(
    (tx) => {
      tx.update(transactions).set({ unverified: false }).where(eq(transactions.id, row.id)).run();
      if (row.rawEmailId !== null) {
        tx.update(rawEmails)
          .set({ verification: "user_confirmed" })
          .where(eq(rawEmails.id, row.rawEmailId))
          .run();
      }
    },
    { behavior: "immediate" },
  );
  return { unverified: false as const };
}

export type ManualInput = {
  direction: Direction;
  /** Digits grouped with dots, e.g. "1.250.000". */
  amount: string;
  /** Local time as `YYYY-MM-DDTHH:mm`. */
  occurredAt: string;
  counterparty: string;
  categoryId: number | null;
  note: string | null;
};

function manualFields(db: Db, ownerId: string, input: ManualInput) {
  const occurredAt = parseLocalMinute(input.occurredAt);
  if (!occurredAt) throw new HttpError(422, "validation_failed", { occurredAt: ["invalid"] });
  if (
    input.categoryId !== null &&
    !findFittingCategory(db, ownerId, input.categoryId, input.direction)
  ) {
    throw new HttpError(422, "validation_failed", { categoryId: ["invalid"] });
  }
  const amount = Number(input.amount.replaceAll(".", ""));
  if (!Number.isSafeInteger(amount)) {
    throw new HttpError(422, "validation_failed", { amount: ["amount"] });
  }
  return {
    direction: input.direction,
    amount,
    occurredAt,
    counterparty: input.counterparty,
    categoryId: input.categoryId,
    note: input.note,
  };
}

export function createManual(db: Db, ctx: WriteContext, input: ManualInput) {
  const fields = manualFields(db, ctx.ownerId, input);
  const row = db
    .insert(transactions)
    .values({ ...fields, userId: ctx.ownerId, bankCode: MANUAL_BANK_CODE })
    .returning()
    .get();
  if (row.categoryId === null) matcher.apply(db, row);
  return { id: row.id };
}

export function updateManual(db: Db, ctx: WriteContext, id: number, input: ManualInput) {
  const row = requireTransaction(db, ctx.ownerId, id);
  if (row.bankCode !== MANUAL_BANK_CODE) throw notFound();
  db.update(transactions)
    .set(manualFields(db, ctx.ownerId, input))
    .where(eq(transactions.id, row.id))
    .run();
  return { id: row.id };
}
