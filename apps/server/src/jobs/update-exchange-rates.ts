import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { rawEmails } from "../db/schema";
import { saveRates } from "../parsing/exchange-rates";
import { dispatch } from "../queue/queue";

export const EXCHANGE_RATES_URL = "https://open.er-api.com/v6/latest/USD";

type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

async function download(fetcher: Fetcher, retries = 2): Promise<Record<string, number>> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await Bun.sleep(1000);
    try {
      const response = await fetcher(EXCHANGE_RATES_URL, { signal: AbortSignal.timeout(15_000) });
      const body = (await response.json()) as { result?: string; rates?: Record<string, unknown> };
      const vndPerUsd = Number(body.rates?.VND);
      if (!response.ok || body.result !== "success" || !(vndPerUsd > 0)) {
        throw new Error(`Unexpected exchange rate response (HTTP ${response.status})`);
      }
      const rates: Record<string, number> = {};
      for (const [code, perUsd] of Object.entries(body.rates ?? {})) {
        if (typeof perUsd === "number" && perUsd > 0) rates[code] = vndPerUsd / perUsd;
      }
      return rates;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Downloads today's rates (VND per unit of each currency) and requeues emails that failed for a
 * missing rate. On failure the previous rates stay and the error is thrown.
 */
export async function updateExchangeRates(
  db: Db,
  fetcher: Fetcher = fetch,
): Promise<{ currencies: number; requeued: number }> {
  const rates = await download(fetcher);
  saveRates(rates);

  const failed = db
    .select({ id: rawEmails.id })
    .from(rawEmails)
    .where(eq(rawEmails.parseError, "currency_unsupported"))
    .all();
  for (const { id } of failed) {
    dispatch(db, "parse-raw-email", { rawEmailId: id }, { uniqueKey: `parse-raw-email:${id}` });
  }
  return { currencies: Object.keys(rates).length, requeued: failed.length };
}
