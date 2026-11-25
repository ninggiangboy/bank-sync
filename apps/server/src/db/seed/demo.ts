import { join } from "node:path";
import { and, eq, isNull, max } from "drizzle-orm";
import { createAuth } from "../../auth/create-auth";
import { COMMANDS } from "../../cli/commands";
import { env } from "../../config/env";
import { refreshDemo } from "../../jobs/refresh-demo";
import type { Mailer } from "../../mail/mailer";
import { fold } from "../../parsing/text-normalizer";
import type { Db } from "../client";
import { categories, categoryRules, transactions, user } from "../schema";
import { DemoLedger } from "./demo-ledger";

const RULES = [
  ["counterparty", "CONG TY TNHH CONG NGHE ABC", "Salary"],
  ["counterparty", "CONG TY TNHH SHOPEE", "Shopping"],
  ["counterparty", "LE THI HOA", "Rentals"],
  ["description", "grab", "Taxi"],
  ["description", "highlands", "Coffee"],
  ["description", "tien dien", "Electricity bill"],
  ["counterparty", "TRAN THI BICH", "Rentals"],
  ["counterparty", "QUAN AN NHAT", "Restaurants"],
  ["counterparty", "PAYOO Aeon Mall Binh Tan", "Shopping"],
  ["counterparty", "CONG AN THANH PHO DA NANG", "Other"],
  ["description", "topup viettel", "Phone bill"],
] as const;

/** Imported fixtures that would skew the reports: a test transfer, transfers between own accounts, a cancelled card charge. */
const HIDDEN_COUNTERPARTIES: Record<string, string> = {
  "LE VAN CUONG": "Cho anh Cường mượn, theo dõi riêng",
  "NGUYEN VAN AN": "Chuyển giữa tài khoản của tôi",
  "ANTHROPIC* CLAUDE SUB +14152360599 US": "Giao dịch thẻ đã bị hủy và hoàn tiền",
};

const FIXTURES = join(import.meta.dir, "../../../test/fixtures/emails");

const silentMailer: Mailer = { send: async () => {} };

/**
 * (Re)creates the read-only demo account: the user, 11 rules, every fixture email run through the
 * real parsing pipeline, three hidden and annotated counterparties and a generated ledger. The
 * password is `password` in development and random elsewhere, so only the "view demo" switch
 * reaches the account in production.
 */
export async function seedDemo(
  db: Db,
  options: { fixtures?: string; log?: (line: string) => void } = {},
) {
  const log = options.log ?? (() => {});
  const email = env.DEMO_USER_EMAIL.toLowerCase();
  db.delete(user).where(eq(user.email, email)).run();

  const password =
    env.NODE_ENV === "development"
      ? "password"
      : Buffer.from(crypto.getRandomValues(new Uint8Array(30))).toString("base64url");
  const created = await createAuth({ db, mailer: silentMailer }).api.signUpEmail({
    body: { name: "Demo User", email, password },
  });
  const userId = created.user.id;
  db.update(user).set({ emailVerified: true }).where(eq(user.id, userId)).run();

  const systemIds = new Map(
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(isNull(categories.userId))
      .all()
      .map((row) => [row.name, row.id]),
  );
  for (const [matchField, matchValue, category] of RULES) {
    const categoryId = systemIds.get(category);
    if (categoryId === undefined) throw new Error(`System category "${category}" is missing`);
    db.insert(categoryRules)
      .values({ userId, matchField, matchValue: fold(matchValue), categoryId })
      .run();
  }

  const command = COMMANDS["import-eml"];
  if (!command) throw new Error("import-eml command is missing");
  await command.run(
    { db, out: log, err: log },
    { positional: [userId, options.fixtures ?? FIXTURES], flags: {} },
  );

  for (const [counterparty, note] of Object.entries(HIDDEN_COUNTERPARTIES)) {
    db.update(transactions)
      .set({ note, deletedAt: new Date() })
      .where(and(eq(transactions.userId, userId), eq(transactions.counterparty, counterparty)))
      .run();
  }

  const newest =
    db
      .select({ value: max(transactions.occurredAt) })
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .get()?.value ?? new Date();
  const rows = new DemoLedger().build(newest);
  for (const row of rows) {
    const categoryId = row.category === null ? null : systemIds.get(row.category);
    if (categoryId === undefined) throw new Error(`System category "${row.category}" is missing`);
    db.insert(transactions)
      .values({
        userId,
        bankCode: row.bankCode,
        direction: row.direction,
        amount: row.amount,
        counterparty: row.counterparty,
        description: row.description,
        occurredAt: row.occurredAt,
        categoryId,
        note: row.note,
      })
      .run();
  }

  refreshDemo(db);
  return { userId, ledgerRows: rows.length };
}
