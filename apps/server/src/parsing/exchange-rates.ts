import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../config/env";

const fileName = () => join(env.STORAGE_PATH, "fx-rates.json");

function readRates(): Record<string, number> {
  try {
    if (!existsSync(fileName())) return {};
    return JSON.parse(readFileSync(fileName(), "utf8")) as Record<string, number>;
  } catch {
    return {};
  }
}

/** VND per one unit of a foreign currency: the daily downloaded table first, then FX_USD_VND for USD. */
export function vndPer(currency: string): number | null {
  const code = currency.toUpperCase();
  const rate = readRates()[code] ?? (code === "USD" ? env.FX_USD_VND : undefined);
  return rate ? rate : null;
}

/** Saves VND per unit keyed by currency code; the swap is atomic so readers never see half a file. */
export function saveRates(rates: Record<string, number>): void {
  mkdirSync(env.STORAGE_PATH, { recursive: true });
  const temp = `${fileName()}.tmp`;
  writeFileSync(temp, JSON.stringify(rates));
  renameSync(temp, fileName());
}
