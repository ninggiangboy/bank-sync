import { CATEGORY_TYPES, type CategoryType } from "@bank-sync/shared";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { categories, categoryRules, transactions } from "../db/schema";
import { HttpError } from "../http/errors";
import { availableTo, isSystem, ordered } from "./categories";
import { type CategoryDto, categoryDto, forwardingSummary, notFound } from "./transactions";

export type SettingsCategory = CategoryDto & { transactionCount: number; editable: boolean };

export function settingsSummary(db: Db, userId: string) {
  const categoryCount =
    db.select({ value: count() }).from(categories).where(availableTo(userId)).get()?.value ?? 0;
  const ruleCount =
    db.select({ value: count() }).from(categoryRules).where(eq(categoryRules.userId, userId)).get()
      ?.value ?? 0;
  return { categoryCount, ruleCount, forwarding: forwardingSummary(db, userId) };
}

export const isCategoryType = (value: unknown): value is CategoryType =>
  CATEGORY_TYPES.some((type) => type === value);

/** Categories of one type, each parent followed by its children. Counts only the user's visible transactions. */
export function listCategories(db: Db, userId: string, type: CategoryType): SettingsCategory[] {
  const counts = new Map(
    db
      .select({ categoryId: transactions.categoryId, value: count() })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt)))
      .groupBy(transactions.categoryId)
      .all()
      .map((row) => [row.categoryId, row.value]),
  );
  const rows = db
    .select()
    .from(categories)
    .where(and(availableTo(userId), eq(categories.type, type)))
    .orderBy(...ordered())
    .all();
  const dto = (row: (typeof rows)[number]): SettingsCategory => ({
    ...categoryDto(row),
    transactionCount: counts.get(row.id) ?? 0,
    editable: !isSystem(row),
  });
  return rows
    .filter((row) => row.parentId === null)
    .flatMap((parent) => [
      dto(parent),
      ...rows.filter((child) => child.parentId === parent.id).map(dto),
    ]);
}

export type NewCategory = {
  name: string;
  icon: string | null;
  type: "expense" | "income";
  parentId: number | null;
};

export function addCategory(db: Db, userId: string, input: NewCategory) {
  if (input.parentId !== null) {
    const parent = db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          availableTo(userId),
          isNull(categories.parentId),
          eq(categories.type, input.type),
          eq(categories.id, input.parentId),
        ),
      )
      .get();
    if (!parent) throw new HttpError(422, "validation_failed", { parentId: ["invalid"] });
  }
  const row = db
    .insert(categories)
    .values({ ...input, userId, order: 1 })
    .returning()
    .get();
  return { ...categoryDto(row), transactionCount: 0, editable: true } satisfies SettingsCategory;
}

function ownCategory(db: Db, userId: string, id: number) {
  const row = db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.userId, userId)))
    .get();
  if (!row) throw notFound();
  return row;
}

export function updateCategory(
  db: Db,
  userId: string,
  id: number,
  input: { name: string; icon: string | null },
) {
  ownCategory(db, userId, id);
  const row = db.update(categories).set(input).where(eq(categories.id, id)).returning().get();
  return categoryDto(row);
}

export function deleteCategory(db: Db, userId: string, id: number) {
  ownCategory(db, userId, id);
  db.delete(categories).where(eq(categories.id, id)).run();
}

export function listRules(db: Db, userId: string) {
  return db
    .select({ rule: categoryRules, category: categories })
    .from(categoryRules)
    .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
    .where(eq(categoryRules.userId, userId))
    .orderBy(desc(categoryRules.createdAt), desc(categoryRules.id))
    .all()
    .map(({ rule, category }) => ({
      id: rule.id,
      matchField: rule.matchField,
      matchValue: rule.matchValue,
      category: categoryDto(category),
      createdAt: rule.createdAt.toISOString(),
    }));
}

export function deleteRule(db: Db, userId: string, id: number) {
  const removed = db
    .delete(categoryRules)
    .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId)))
    .returning({ id: categoryRules.id })
    .all();
  if (removed.length === 0) throw notFound();
}
