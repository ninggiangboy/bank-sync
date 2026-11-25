import type { CategoryType } from "@bank-sync/shared";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../client";
import { categories, categoryRules, transactions } from "../schema";

type SystemCategory = {
  name: string;
  icon: string;
  type: CategoryType;
  /** Higher shows first. */
  order: number;
  /** Name of a system category of the same type, listed earlier. */
  parent?: string;
};

const line = (
  name: string,
  icon: string,
  type: CategoryType,
  order: number,
  parent?: string,
): SystemCategory => ({ name, icon, type, order, parent });

/**
 * The shared system categories (user_id NULL), the single source of truth for defaults.
 * Names are English translation keys; add the Vietnamese name to the web translations for each new line.
 * Changing a line's icon, order or parent does nothing to an existing row, and renaming creates a
 * new category; do those in a migration instead.
 */
export const SYSTEM_CATEGORIES: readonly SystemCategory[] = [
  line("Food & drink", "🍜", "expense", 120),
  line("Coffee", "☕", "expense", 30, "Food & drink"),
  line("Restaurants", "🍽️", "expense", 20, "Food & drink"),
  line("Delivery", "🥡", "expense", 10, "Food & drink"),
  line("Transport", "🛵", "expense", 110),
  line("Flights", "✈️", "expense", 30, "Transport"),
  line("Taxi", "🚕", "expense", 20, "Transport"),
  line("Vehicle maintenance", "🔧", "expense", 10, "Transport"),
  line("Shopping", "🛍️", "expense", 100),
  line("Houseware", "🧴", "expense", 20, "Shopping"),
  line("Beauty", "💄", "expense", 10, "Shopping"),
  line("Bills", "🧾", "expense", 90),
  line("Rentals", "🔑", "expense", 70, "Bills"),
  line("Water bill", "🚿", "expense", 60, "Bills"),
  line("Phone bill", "📱", "expense", 50, "Bills"),
  line("Electricity bill", "⚡", "expense", 40, "Bills"),
  line("Gas bill", "🔥", "expense", 30, "Bills"),
  line("Internet bill", "🌐", "expense", 20, "Bills"),
  line("TV & streaming", "📺", "expense", 10, "Bills"),
  line("Entertainment", "🎮", "expense", 70),
  line("Movies", "🎬", "expense", 30, "Entertainment"),
  line("Games", "🕹️", "expense", 20, "Entertainment"),
  line("Music & concerts", "🎵", "expense", 10, "Entertainment"),
  line("Health", "💊", "expense", 60),
  line("Medicine", "💉", "expense", 40, "Health"),
  line("Doctor & hospital", "🏥", "expense", 30, "Health"),
  line("Dental", "🦷", "expense", 20, "Health"),
  line("Gym & fitness", "🏋️", "expense", 10, "Health"),
  line("Education", "📚", "expense", 50),
  line("Transfers", "🔁", "expense", 40),
  line("Gifts & Donations", "💝", "expense", 35),
  line("Wedding", "💍", "expense", 30),
  line("Cash withdrawal", "🏧", "expense", 20),
  line("Investment", "📈", "expense", 10),
  line("Other", "📦", "expense", 0),
  line("Salary", "💰", "income", 30),
  line("Gifts", "🎁", "income", 20),
  line("Sales", "🏷️", "income", 10),
  line("Refund", "↩️", "income", 5),
  line("Other income", "🤑", "income", 0),
  line("Lending", "🤝", "debt_loan", 30),
  line("Debt collection", "💵", "debt_loan", 20),
  line("Borrowing", "🏦", "debt_loan", 10),
  line("Debt repayment", "💸", "debt_loan", 0),
];

/**
 * Creates the system categories that don't exist yet (matched by name and type) and never
 * changes existing rows, so it is safe to run again. When a category is created, users' own
 * categories with the same name and type are merged into it: their transactions (hidden ones
 * included) and rules move to the system row, then the copies are deleted.
 * Returns the number of categories created. The transaction takes the write lock up front so a
 * concurrent writer (the running server) makes it wait instead of failing with SQLITE_BUSY.
 */
export function seedSystemCategories(db: Db, lines: readonly SystemCategory[] = SYSTEM_CATEGORIES) {
  return db.transaction(
    (tx) => {
      let created = 0;
      const systemId = (name: string, type: CategoryType) =>
        tx
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(isNull(categories.userId), eq(categories.name, name), eq(categories.type, type)),
          )
          .get()?.id;

      for (const { name, icon, type, order, parent } of lines) {
        if (systemId(name, type) !== undefined) continue;

        const parentId = parent === undefined ? null : (systemId(parent, type) ?? null);
        const system = tx
          .insert(categories)
          .values({ userId: null, parentId, name, icon, type, order })
          .returning({ id: categories.id })
          .get();
        created++;

        const copies = tx
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(isNotNull(categories.userId), eq(categories.name, name), eq(categories.type, type)),
          )
          .all()
          .map((row) => row.id);
        if (copies.length === 0) continue;

        tx.update(transactions)
          .set({ categoryId: system.id })
          .where(inArray(transactions.categoryId, copies))
          .run();
        tx.update(categoryRules)
          .set({ categoryId: system.id })
          .where(inArray(categoryRules.categoryId, copies))
          .run();
        tx.delete(categories).where(inArray(categories.id, copies)).run();
      }
      return created;
    },
    { behavior: "immediate" },
  );
}
