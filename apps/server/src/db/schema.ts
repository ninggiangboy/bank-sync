import {
  CATEGORY_TYPES,
  DIRECTIONS,
  EMAIL_SOURCES,
  LOCALES,
  MATCH_FIELDS,
  THEMES,
  VERIFICATIONS,
} from "@bank-sync/shared";
import { relations, sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

// Timestamps are integer milliseconds since the epoch, in UTC.
const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const createdAt = () =>
  timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date());
const timestamps = () => ({
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
});
const id = () => integer("id").primaryKey({ autoIncrement: true });
const userId = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });

export const userSettings = sqliteTable("user_settings", {
  id: id(),
  userId: userId().unique(),
  locale: text("locale", { enum: LOCALES }).notNull().default("vi"),
  theme: text("theme", { enum: THEMES }).notNull().default("system"),
  ...timestamps(),
});

/** Per-user forwarding address `<token>@INBOUND_DOMAIN`. Rotating sets `replaced_at` and adds a new row. */
export const inboundAddresses = sqliteTable(
  "inbound_addresses",
  {
    id: id(),
    userId: userId(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    replacedAt: timestamp("replaced_at"),
  },
  (t) => [
    uniqueIndex("inbound_addresses_active_user_unique")
      .on(t.userId)
      .where(sql`"replaced_at" is null`),
  ],
);

/** Gmail forwarding confirmation emails, shown to the user so they can finish the Gmail setup. */
export const forwardingConfirmations = sqliteTable(
  "forwarding_confirmations",
  {
    id: id(),
    userId: userId(),
    inboundAddressId: integer("inbound_address_id")
      .notNull()
      .references(() => inboundAddresses.id, { onDelete: "cascade" }),
    gmailAddress: text("gmail_address").notNull(),
    code: text("code").notNull(),
    confirmUrl: text("confirm_url").notNull(),
    receivedAt: timestamp("received_at").notNull(),
  },
  (t) => [index("forwarding_confirmations_user_received_index").on(t.userId, t.receivedAt)],
);

export const rawEmails = sqliteTable(
  "raw_emails",
  {
    id: id(),
    userId: userId(),
    inboundAddressId: integer("inbound_address_id").references(() => inboundAddresses.id, {
      onDelete: "set null",
    }),
    source: text("source", { enum: EMAIL_SOURCES }).notNull(),
    verification: text("verification", { enum: VERIFICATIONS }).notNull(),
    dkimDomain: text("dkim_domain"),
    messageId: text("message_id").notNull(),
    fromAddress: text("from_address").notNull(),
    subject: text("subject").notNull().default(""),
    receivedAt: timestamp("received_at").notNull(),
    bodyHtml: text("body_html"),
    bodyText: text("body_text"),
    bankCode: text("bank_code"),
    parsedAt: timestamp("parsed_at"),
    parseError: text("parse_error"),
    ...timestamps(),
  },
  (t) => [
    unique("raw_emails_user_message_unique").on(t.userId, t.messageId),
    index("raw_emails_bank_code_index").on(t.bankCode),
  ],
);

/** System categories have no owner (`user_id` NULL) and are shared by everyone. */
export const categories = sqliteTable("categories", {
  id: id(),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  parentId: integer("parent_id").references((): AnySQLiteColumn => categories.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  icon: text("icon", { length: 16 }),
  type: text("type", { enum: CATEGORY_TYPES }).notNull().default("expense"),
  order: integer("order").notNull().default(0),
  ...timestamps(),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: id(),
    userId: userId(),
    rawEmailId: integer("raw_email_id")
      .unique()
      .references(() => rawEmails.id, { onDelete: "set null" }),
    bankCode: text("bank_code").notNull(),
    direction: text("direction", { enum: DIRECTIONS }).notNull(),
    /** Whole VND. */
    amount: integer("amount").notNull(),
    currency: text("currency", { length: 3 }),
    originalAmount: integer("original_amount"),
    amountEstimated: integer("amount_estimated", { mode: "boolean" }).notNull().default(false),
    /** Mirrors `raw_emails.verification = 'unverified'`; unverified rows count in no total. */
    unverified: integer("unverified", { mode: "boolean" }).notNull().default(false),
    counterparty: text("counterparty"),
    counterpartyAccount: text("counterparty_account"),
    description: text("description"),
    reference: text("reference"),
    occurredAt: timestamp("occurred_at").notNull(),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    note: text("note"),
    deletedAt: timestamp("deleted_at"),
    ...timestamps(),
  },
  (t) => [index("transactions_user_occurred_index").on(t.userId, t.occurredAt)],
);

/** `match_value` is stored folded (lowercase, no diacritics) so matching is accent-insensitive. */
export const categoryRules = sqliteTable(
  "category_rules",
  {
    id: id(),
    userId: userId(),
    matchField: text("match_field", { enum: MATCH_FIELDS }).notNull(),
    matchValue: text("match_value").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [
    unique("category_rules_user_field_value_unique").on(t.userId, t.matchField, t.matchValue),
  ],
);

/** Replay protection for the inbound webhook: `id` is the sha256 of the raw message. */
export const inboundReceipts = sqliteTable(
  "inbound_receipts",
  {
    id: text("id").primaryKey(),
    receivedAt: timestamp("received_at").notNull(),
  },
  (t) => [index("inbound_receipts_received_index").on(t.receivedAt)],
);

/** Key-value store with expiry, used for rate limits. `expires_at` is epoch milliseconds. */
export const cache = sqliteTable(
  "cache",
  {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("cache_expires_index").on(t.expiresAt)],
);

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(user, { fields: [userSettings.userId], references: [user.id] }),
}));

export const inboundAddressesRelations = relations(inboundAddresses, ({ one, many }) => ({
  user: one(user, { fields: [inboundAddresses.userId], references: [user.id] }),
  confirmations: many(forwardingConfirmations),
  rawEmails: many(rawEmails),
}));

export const forwardingConfirmationsRelations = relations(forwardingConfirmations, ({ one }) => ({
  inboundAddress: one(inboundAddresses, {
    fields: [forwardingConfirmations.inboundAddressId],
    references: [inboundAddresses.id],
  }),
}));

export const rawEmailsRelations = relations(rawEmails, ({ one }) => ({
  user: one(user, { fields: [rawEmails.userId], references: [user.id] }),
  inboundAddress: one(inboundAddresses, {
    fields: [rawEmails.inboundAddressId],
    references: [inboundAddresses.id],
  }),
  transaction: one(transactions),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  user: one(user, { fields: [categories.userId], references: [user.id] }),
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "parent",
  }),
  children: many(categories, { relationName: "parent" }),
  transactions: many(transactions),
  rules: many(categoryRules),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(user, { fields: [transactions.userId], references: [user.id] }),
  rawEmail: one(rawEmails, { fields: [transactions.rawEmailId], references: [rawEmails.id] }),
  category: one(categories, { fields: [transactions.categoryId], references: [categories.id] }),
}));

export const categoryRulesRelations = relations(categoryRules, ({ one }) => ({
  user: one(user, { fields: [categoryRules.userId], references: [user.id] }),
  category: one(categories, { fields: [categoryRules.categoryId], references: [categories.id] }),
}));
