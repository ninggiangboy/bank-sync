import { DIRECTIONS } from "@bank-sync/shared";
import { Elysia } from "elysia";
import { z } from "zod";
import type { AuthPlugin } from "../auth/plugin";
import type { Db } from "../db/client";
import { resolveOwner, writeContext } from "../domain/demo";
import { parseMonth } from "../domain/time";
import {
  backfillRule,
  confirmUnverified,
  createManual,
  deleteManual,
  FILTERS,
  fittingCategories,
  listTransactions,
  notFound,
  rawEmailText,
  setCategory,
  setNote,
  setRule,
  toggleHidden,
  transactionDetail,
  updateManual,
} from "../domain/transactions";
import { validate } from "../http/validate";

const idOf = (value: string) => {
  const id = /^\d{1,15}$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(id)) throw notFound();
  return id;
};

const categoryBody = z.object({
  categoryId: z.number({ error: "required" }).int("invalid"),
});
const ruleBody = z.object({ enabled: z.boolean({ error: "required" }) });
const noteBody = z.object({
  note: z
    .string({ error: "invalid" })
    .nullable()
    .optional()
    .transform((value) => value?.trim() ?? "")
    .pipe(z.string().max(1000, "max"))
    .transform((value) => (value === "" ? null : value)),
});

const manualBody = z.object({
  direction: z.enum(DIRECTIONS, { error: "invalid" }).default("out"),
  amount: z
    .string({ error: "required" })
    .max(20, "max")
    .regex(/^[1-9]\d{0,2}(\.?\d{3})*$/, "amount"),
  occurredAt: z.string({ error: "required" }).min(1, "required"),
  counterparty: z.string({ error: "required" }).trim().min(1, "required").max(255, "max"),
  categoryId: z.number().int("invalid").nullable().optional().default(null),
  note: noteBody.shape.note.optional().default(null),
});

const parseInput = (body: unknown) => {
  const input = validate(manualBody, body);
  return { ...input, categoryId: input.categoryId ?? null, note: input.note ?? null };
};

export const transactionRoutes = ({ db, authed }: { db: Db; authed: AuthPlugin }) =>
  new Elysia()
    .use(authed)
    .get(
      "/transactions",
      ({ user, query }) => {
        const filter = FILTERS.find((value) => value === query.filter) ?? "all";
        const category = /^\d{1,15}$/.test(query.category ?? "") ? Number(query.category) : null;
        return listTransactions(
          db,
          resolveOwner(db, user),
          {
            month: parseMonth(query.month),
            filter,
            categoryId: category,
            payee: (query.payee ?? "").trim(),
          },
          user.id,
        );
      },
      { auth: true },
    )
    .post(
      "/transactions",
      ({ user, body }) => {
        const ctx = writeContext(db, user);
        return createManual(db, ctx, parseInput(body));
      },
      { auth: true },
    )
    .get(
      "/transactions/:id",
      ({ user, params }) => transactionDetail(db, resolveOwner(db, user), idOf(params.id)),
      { auth: true },
    )
    .put(
      "/transactions/:id",
      ({ user, params, body }) => {
        const ctx = writeContext(db, user);
        return updateManual(db, ctx, idOf(params.id), parseInput(body));
      },
      { auth: true },
    )
    .delete(
      "/transactions/:id",
      ({ user, params }) => deleteManual(db, writeContext(db, user), idOf(params.id)),
      { auth: true },
    )
    .post(
      "/transactions/:id/confirm",
      ({ user, params }) => confirmUnverified(db, writeContext(db, user), idOf(params.id)),
      { auth: true },
    )
    .get(
      "/transactions/:id/raw",
      ({ user, params }) => ({ text: rawEmailText(db, resolveOwner(db, user), idOf(params.id)) }),
      { auth: true },
    )
    .put(
      "/transactions/:id/category",
      ({ user, params, body }) => {
        const ctx = writeContext(db, user);
        return setCategory(db, ctx, idOf(params.id), validate(categoryBody, body).categoryId);
      },
      { auth: true },
    )
    .put(
      "/transactions/:id/rule",
      ({ user, params, body }) => {
        const ctx = writeContext(db, user);
        return setRule(db, ctx, idOf(params.id), validate(ruleBody, body).enabled);
      },
      { auth: true },
    )
    .post(
      "/transactions/:id/backfill",
      ({ user, params }) => backfillRule(db, writeContext(db, user), idOf(params.id)),
      { auth: true },
    )
    .put(
      "/transactions/:id/note",
      ({ user, params, body }) => {
        const ctx = writeContext(db, user);
        return setNote(db, ctx, idOf(params.id), validate(noteBody, body).note);
      },
      { auth: true },
    )
    .post(
      "/transactions/:id/toggle-hidden",
      ({ user, params }) => toggleHidden(db, writeContext(db, user), idOf(params.id)),
      { auth: true },
    )
    .get(
      "/categories",
      ({ user, query }) =>
        fittingCategories(db, resolveOwner(db, user), query.direction === "in" ? "in" : "out"),
      { auth: true },
    );
