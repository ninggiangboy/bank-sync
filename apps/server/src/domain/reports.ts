import { and, desc, eq, gte, isNotNull, lt, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { categories, transactions } from "../db/schema";
import { availableTo } from "./categories";
import { addMonths, formatMonth, monthOf, monthRange, type YearMonth } from "./time";
import { type CategoryDto, categoryDto, counted } from "./transactions";

/** PHP `round`: halves go away from zero. */
const roundHalfAway = (value: number) => Math.sign(value) * Math.round(Math.abs(value));

const spending = (ownerId: string, start: Date, end: Date): SQL =>
  and(
    eq(transactions.userId, ownerId),
    eq(transactions.direction, "out"),
    gte(transactions.occurredAt, start),
    lt(transactions.occurredAt, end),
    counted(),
  ) as SQL;

/** A month in progress is compared with the same stretch of the previous month, so early days don't always look cheaper. */
function previousSpending(db: Db, ownerId: string, month: YearMonth, now: number) {
  const { start: monthStart } = monthRange(month);
  const { start: previousStart } = monthRange(addMonths(month, -1));
  const isCurrent = formatMonth(monthOf(new Date(now))) === formatMonth(month);
  const end = isCurrent
    ? new Date(
        Math.min(previousStart.getTime() + (now - monthStart.getTime()), monthStart.getTime()),
      )
    : monthStart;
  const row = db
    .select({ total: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(spending(ownerId, previousStart, end))
    .get();
  return { total: Number(row?.total ?? 0), isCurrent };
}

export type CategoryTotal = { category: CategoryDto | null; total: number; count: number };

export function monthlyReport(db: Db, ownerId: string, month: YearMonth, now = Date.now()) {
  const { start, end } = monthRange(month);
  const where = spending(ownerId, start, end);
  const known = new Map(
    db
      .select()
      .from(categories)
      .where(availableTo(ownerId))
      .all()
      .map((category) => [category.id, category]),
  );

  const rows = db
    .select({
      categoryId: transactions.categoryId,
      total: sql<number>`sum(${transactions.amount})`,
      count: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(where)
    .groupBy(transactions.categoryId)
    .all();

  // Children roll up into their parent; uncategorized rows form one group of their own.
  const groups = new Map<number | null, CategoryTotal>();
  for (const row of rows) {
    const own = row.categoryId === null ? undefined : known.get(row.categoryId);
    const key = own?.parentId ?? row.categoryId;
    const top = key === null ? undefined : known.get(key);
    const group = groups.get(key) ?? {
      category: top ? categoryDto(top) : null,
      total: 0,
      count: 0,
    };
    group.total += Number(row.total);
    group.count += Number(row.count);
    groups.set(key, group);
  }
  const byCategory = [...groups.values()].sort((a, b) => b.total - a.total);
  const total = byCategory.reduce((sum, group) => sum + group.total, 0);

  const topCounterparties = db
    .select({
      counterparty: transactions.counterparty,
      total: sql<number>`sum(${transactions.amount})`,
      count: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(and(where, isNotNull(transactions.counterparty)))
    .groupBy(transactions.counterparty)
    .orderBy(desc(sql`sum(${transactions.amount})`))
    .limit(5)
    .all()
    .map((row) => ({
      counterparty: row.counterparty as string,
      total: Number(row.total),
      count: Number(row.count),
    }));

  const previous = previousSpending(db, ownerId, month, now);
  return {
    month: formatMonth(month),
    total,
    change:
      previous.total > 0 ? roundHalfAway((100 * (total - previous.total)) / previous.total) : null,
    comparedTo: previous.isCurrent ? ("same_period" as const) : ("full_month" as const),
    byCategory,
    topCounterparties,
  };
}
