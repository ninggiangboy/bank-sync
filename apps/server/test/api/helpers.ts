import { env } from "../../src/config/env";
import { type categories, rawEmails, transactions } from "../../src/db/schema";
import { seedSystemCategories } from "../../src/db/seed/system-categories";
import { createAuthApp } from "../auth/helpers";

type NewTransaction = Partial<typeof transactions.$inferInsert>;

/** The app with system categories seeded, plus helpers to add users and rows. */
export function createApiApp() {
  const harness = createAuthApp();
  seedSystemCategories(harness.db);
  const { db } = harness;

  const categoryId = (name: string) => {
    const row = db.query.categories.findFirst({
      where: (c, { and, eq, isNull }) => and(eq(c.name, name), isNull(c.userId)),
    });
    const found = row.sync();
    if (!found) throw new Error(`no system category ${name}`);
    return found.id;
  };

  function addTransaction(userId: string, values: NewTransaction = {}) {
    return db
      .insert(transactions)
      .values({
        userId,
        bankCode: "VCB",
        direction: "out",
        amount: 100_000,
        counterparty: "SHOP",
        description: "THANH TOAN",
        occurredAt: new Date(),
        ...values,
      })
      .returning()
      .get();
  }

  function addRawEmail(userId: string, values: Partial<typeof rawEmails.$inferInsert> = {}) {
    return db
      .insert(rawEmails)
      .values({
        userId,
        source: "forward",
        verification: "dkim_pass",
        messageId: crypto.randomUUID(),
        fromAddress: "vcbdigibank@info.vietcombank.com.vn",
        subject: "Biên lai",
        receivedAt: new Date(),
        bodyHtml: "<p>SECRET-HTML</p>",
        bodyText: "SECRET-TEXT body",
        bankCode: "VCB",
        ...values,
      })
      .returning()
      .get();
  }

  async function demoUser() {
    const demo = await harness.register(env.DEMO_USER_EMAIL);
    return demo;
  }

  return { ...harness, categoryId, addTransaction, addRawEmail, demoUser };
}

export type CategoryRow = typeof categories.$inferSelect;
