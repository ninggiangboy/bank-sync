import {
  type CategoryType,
  categoryTypeFor,
  DEBT_LOAN_DIRECTIONS,
  type Direction,
} from "@bank-sync/shared";
import { and, asc, desc, eq, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import { categories } from "../db/schema";

type CategoryLike = { userId: string | null; name: string; type: CategoryType };

const debtLoanNames = (direction: Direction) =>
  Object.entries(DEBT_LOAN_DIRECTIONS)
    .filter(([, moves]) => moves === direction)
    .map(([name]) => name);

export const isSystem = (category: Pick<CategoryLike, "userId">) => category.userId === null;

/** Shared system categories (user_id NULL) plus the user's own. */
export const availableTo = (userId: string): SQL =>
  or(isNull(categories.userId), eq(categories.userId, userId)) as SQL;

/** Higher order first; ties keep the old order: system categories, then the user's own, oldest first. */
export const ordered = (): SQL[] => [
  desc(categories.order),
  sql`${categories.userId} is null desc`,
  asc(categories.id),
];

/** Categories that make sense for the direction: expense or income, plus the debt/loan ones going the same way. */
export const fitting = (direction: Direction): SQL =>
  or(
    eq(categories.type, categoryTypeFor(direction)),
    and(
      eq(categories.type, "debt_loan"),
      isNull(categories.userId),
      inArray(categories.name, debtLoanNames(direction)),
    ),
  ) as SQL;

export function fits(category: CategoryLike, direction: Direction): boolean {
  if (category.type === "debt_loan") {
    return isSystem(category) && DEBT_LOAN_DIRECTIONS[category.name] === direction;
  }
  return category.type === categoryTypeFor(direction);
}

/** One of the 8 chart colors, fixed per category so icons and reports match. */
export const color = (id: number) => (id % 8) + 1;
