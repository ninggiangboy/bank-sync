import { Elysia } from "elysia";
import { z } from "zod";
import type { AuthPlugin } from "../auth/plugin";
import type { Db } from "../db/client";
import { writeContext } from "../domain/demo";
import {
  addCategory,
  deleteCategory,
  deleteRule,
  isCategoryType,
  listCategories,
  listRules,
  settingsSummary,
  updateCategory,
} from "../domain/settings";
import { notFound } from "../domain/transactions";
import { validate } from "../http/validate";

const idOf = (value: string) => {
  if (!/^\d{1,15}$/.test(value)) throw notFound();
  return Number(value);
};

const name = z.string({ error: "required" }).trim().min(1, "required").max(50, "max");
const icon = z
  .string({ error: "invalid" })
  .trim()
  .max(16, "max")
  .nullable()
  .optional()
  .transform((value) => (value ? value : null));

const newCategory = z.object({
  name,
  icon,
  type: z.enum(["expense", "income"], { error: "invalid" }),
  parentId: z
    .number()
    .int("invalid")
    .nullable()
    .optional()
    .transform((value) => value ?? null),
});
const editCategory = z.object({ name, icon });

/** Settings that belong to the signed-in user (never the demo account being viewed). */
export const settingsDomainRoutes = ({ db, authed }: { db: Db; authed: AuthPlugin }) =>
  new Elysia({ prefix: "/settings" })
    .use(authed)
    .get("/summary", ({ user }) => settingsSummary(db, user.id), { auth: true })
    .get(
      "/categories",
      ({ user, query }) =>
        listCategories(db, user.id, isCategoryType(query.type) ? query.type : "expense"),
      { auth: true },
    )
    .post(
      "/categories",
      ({ user, body }) => {
        writeContext(db, user);
        return addCategory(db, user.id, validate(newCategory, body));
      },
      { auth: true },
    )
    .patch(
      "/categories/:id",
      ({ user, params, body }) => {
        writeContext(db, user);
        return updateCategory(db, user.id, idOf(params.id), validate(editCategory, body));
      },
      { auth: true },
    )
    .delete(
      "/categories/:id",
      ({ user, params }) => {
        writeContext(db, user);
        deleteCategory(db, user.id, idOf(params.id));
        return new Response(null, { status: 204 });
      },
      { auth: true },
    )
    .get("/rules", ({ user }) => listRules(db, user.id), { auth: true })
    .delete(
      "/rules/:id",
      ({ user, params }) => {
        writeContext(db, user);
        deleteRule(db, user.id, idOf(params.id));
        return new Response(null, { status: 204 });
      },
      { auth: true },
    );
