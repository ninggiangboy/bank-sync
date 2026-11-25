import { z } from "zod";

/**
 * Search params kept in the URL, as Livewire's #[Url] did, so back/forward and shared links keep
 * the state. A malformed value is dropped instead of failing the page.
 */
export const monthParam = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .optional()
  .catch(undefined);

export const FILTERS = ["in", "out", "uncategorized"] as const;

/** `all` is the default and stays out of the URL. */
export const filterParam = z.enum(FILTERS).optional().catch(undefined);

export const categoryParam = z.coerce.number().int().positive().optional().catch(undefined);

export const payeeParam = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .optional()
  .catch(undefined);

/** Which slice of the list a transaction was opened from, so "back" returns to it. */
export const scopeSearch = z.object({
  filter: filterParam,
  category: categoryParam,
  payee: payeeParam,
});

export const listSearch = scopeSearch.extend({ month: monthParam });
export const monthSearch = z.object({ month: monthParam });

export type ListSearch = z.output<typeof listSearch>;
