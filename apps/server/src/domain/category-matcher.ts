import type { MatchField } from "@bank-sync/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { categories, categoryRules, transactions } from "../db/schema";
import { fold } from "../parsing/text-normalizer";
import { fits } from "./categories";

type TransactionRow = typeof transactions.$inferSelect;
export type RuleRow = typeof categoryRules.$inferSelect;
type MatchTarget = Pick<
  TransactionRow,
  "userId" | "direction" | "counterparty" | "counterpartyAccount" | "description"
>;
type RuleKey = { userId: string; matchField: MatchField; matchValue: string };

/**
 * Account rules match the counterparty's account number, counterparty rules the whole normalized
 * name, and description rules a normalized substring, checked in that order (most stable identifier
 * first). A rule only applies when its category type fits the direction.
 */
const FIELD_ORDER: readonly MatchField[] = ["account", "counterparty", "description"];

type RuleWithCategory = { rule: RuleRow; category: typeof categories.$inferSelect };

function rulesOf(db: DbOrTx, userId: string): RuleWithCategory[] {
  return db
    .select({ rule: categoryRules, category: categories })
    .from(categoryRules)
    .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
    .where(eq(categoryRules.userId, userId))
    .all();
}

function matches({ rule, category }: RuleWithCategory, target: MatchTarget): boolean {
  if (rule.matchValue === "") return false;
  if (!fits(category, target.direction)) return false;
  if (rule.matchField === "account") return fold(target.counterpartyAccount) === rule.matchValue;
  if (rule.matchField === "counterparty") return fold(target.counterparty) === rule.matchValue;
  return fold(target.description).includes(rule.matchValue);
}

export function ruleField(target: MatchTarget): MatchField {
  if (/^\d+$/.test(target.counterpartyAccount ?? "")) return "account";
  if ((target.counterparty ?? "").trim() !== "") return "counterparty";
  return "description";
}

function ruleKey(target: MatchTarget): RuleKey {
  const field = ruleField(target);
  const value =
    field === "account"
      ? target.counterpartyAccount
      : field === "counterparty"
        ? target.counterparty
        : target.description;
  return { userId: target.userId, matchField: field, matchValue: fold(value) };
}

const keyFilter = (key: RuleKey) =>
  and(
    eq(categoryRules.userId, key.userId),
    eq(categoryRules.matchField, key.matchField),
    eq(categoryRules.matchValue, key.matchValue),
  );

export function match(db: DbOrTx, target: MatchTarget): RuleRow | null {
  const candidates = rulesOf(db, target.userId);
  for (const field of FIELD_ORDER) {
    const found = candidates.find((c) => c.rule.matchField === field && matches(c, target));
    if (found) return found.rule;
  }
  return null;
}

/** Sets the category from the first matching rule. Returns whether one applied. */
export function apply(db: DbOrTx, transaction: Pick<TransactionRow, "id"> & MatchTarget): boolean {
  const rule = match(db, transaction);
  if (!rule) return false;
  db.update(transactions)
    .set({ categoryId: rule.categoryId })
    .where(eq(transactions.id, transaction.id))
    .run();
  return true;
}

/** Creates or updates the rule that maps this transaction's account (or name, or description) to the category. */
export function remember(db: DbOrTx, transaction: MatchTarget, categoryId: number): RuleRow {
  const key = ruleKey(transaction);
  return db
    .insert(categoryRules)
    .values({ ...key, categoryId })
    .onConflictDoUpdate({
      target: [categoryRules.userId, categoryRules.matchField, categoryRules.matchValue],
      set: { categoryId, updatedAt: new Date() },
    })
    .returning()
    .get();
}

/** Deletes the rule only when it points to this transaction's category, so an exception never removes the usual rule. */
export function forget(db: DbOrTx, transaction: MatchTarget & Pick<TransactionRow, "categoryId">) {
  if (transaction.categoryId === null) return;
  db.delete(categoryRules)
    .where(
      and(keyFilter(ruleKey(transaction)), eq(categoryRules.categoryId, transaction.categoryId)),
    )
    .run();
}

export function ruleFor(db: DbOrTx, transaction: MatchTarget): RuleRow | null {
  return (
    db
      .select()
      .from(categoryRules)
      .where(keyFilter(ruleKey(transaction)))
      .get() ?? null
  );
}

export function follows(db: DbOrTx, transaction: MatchTarget & Pick<TransactionRow, "categoryId">) {
  const rule = ruleFor(db, transaction);
  return rule !== null && rule.categoryId === transaction.categoryId;
}

/** An unsaved rule mapping this transaction's account (or name, or description) to its category. */
export function draft(transaction: MatchTarget & Pick<TransactionRow, "categoryId">) {
  return { ...ruleKey(transaction), categoryId: transaction.categoryId };
}

/**
 * The user's uncategorized transactions a rule would fill in. Filters in code because SQL cannot
 * strip Vietnamese accents; fine for one user's history.
 */
function uncategorizedMatching(db: DbOrTx, rule: RuleRow): number[] {
  const category = db.select().from(categories).where(eq(categories.id, rule.categoryId)).get();
  if (!category) return [];
  const pair: RuleWithCategory = { rule, category };
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, rule.userId),
        isNull(transactions.categoryId),
        isNull(transactions.deletedAt),
      ),
    )
    .all()
    .filter((row) => matches(pair, row))
    .map((row) => row.id);
}

/** Applies a rule to the user's existing uncategorized transactions. Returns how many were updated. */
export function backfill(db: DbOrTx, rule: RuleRow): number {
  const ids = uncategorizedMatching(db, rule);
  for (let start = 0; start < ids.length; start += 500) {
    db.update(transactions)
      .set({ categoryId: rule.categoryId })
      .where(inArray(transactions.id, ids.slice(start, start + 500)))
      .run();
  }
  return ids.length;
}

/** How many uncategorized transactions the rule would fill in. */
export function backfillCount(db: DbOrTx, rule: RuleRow): number {
  return uncategorizedMatching(db, rule).length;
}
