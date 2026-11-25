import i18n from "../i18n";

/** The server's display time zone (APP_TIMEZONE), set once the public config has loaded. */
let displayTimeZone = "Asia/Ho_Chi_Minh";

export function setDisplayTimeZone(timeZone: string) {
  displayTimeZone = timeZone;
}

const MINUS = "−";

/** 1250000 → "1.250.000", the Vietnamese grouping. */
export const groupDigits = (value: number) =>
  Math.round(Math.abs(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** 1250000 → "1.250.000 ₫"; with `signed`, prefixes "+" or "−". */
export function money(amount: number, signed = false): string {
  const formatted = `${groupDigits(amount)} ₫`;
  if (!signed) return amount < 0 ? `${MINUS}${formatted}` : formatted;
  return `${amount < 0 ? MINUS : "+"}${formatted}`;
}

/** 1250, "USD" → "12,50 USD" (amount in minor units). */
export function foreign(minorAmount: number, currency: string): string {
  const units = Math.abs(minorAmount) / 100;
  const [whole = "0", cents = "00"] = units.toFixed(2).split(".");
  const sign = minorAmount < 0 ? MINUS : "";
  return `${sign}${groupDigits(Number(whole))},${cents} ${currency}`;
}

/** Money in is positive, money out negative. */
export const signedAmount = (transaction: { direction: "in" | "out"; amount: number }) =>
  transaction.direction === "in" ? transaction.amount : -transaction.amount;

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

function partsOf(instant: Date | string | number): Parts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: displayTimeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/** `YYYY-MM-DD` on the display wall clock. */
export function localDate(instant: Date | string | number): string {
  const { year, month, day } = partsOf(instant);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** `YYYY-MM-DDTHH:mm`, the value of a `datetime-local` input, on the display wall clock. */
export function localMinute(instant: Date | string | number = Date.now()): string {
  const { year, month, day, hour, minute } = partsOf(instant);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

/** `HH:mm` on the display wall clock. */
export const timeOf = (instant: Date | string | number) => localMinute(instant).slice(11);

/** `dd/mm/yyyy HH:mm` on the display wall clock. */
export function shortDateTime(instant: Date | string | number): string {
  const { year, month, day, hour, minute } = partsOf(instant);
  return `${pad(day)}/${pad(month)}/${year} ${pad(hour)}:${pad(minute)}`;
}

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const isMonth = (value: unknown): value is string =>
  typeof value === "string" && MONTH_PATTERN.test(value);

/** The current `YYYY-MM` on the display wall clock. */
export const currentMonth = () => localDate(Date.now()).slice(0, 7);

/** `YYYY-MM` shifted by whole months. */
export function addMonths(month: string, delta: number): string {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (number - 1) + delta;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`;
}

const ucfirst = (value: string) => value.charAt(0).toLocaleUpperCase() + value.slice(1);

/** Weekday name of a calendar date (`YYYY-MM-DD`) in the current language. */
function weekdayOf(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(i18n.language, { weekday: "long", timeZone: "UTC" }).format(
    Date.UTC(year, month - 1, day),
  );
}

/** "Tháng 11/2026" or "November 2026". */
export function monthLabel(month: string): string {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const monthName = new Intl.DateTimeFormat(i18n.language, {
    month: "long",
    timeZone: "UTC",
  }).format(Date.UTC(year, number - 1, 1));
  return i18n.t("{{monthName}} {{year}}", { monthName, number: pad(number), year });
}

/** "MM/YYYY". */
export const monthNumeric = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;

/** Day heading of the transaction list: Today, Yesterday, else "Monday, 24/11". */
export function dayLabel(date: string): string {
  const today = localDate(Date.now());
  if (date === today) return i18n.t("Today");
  if (date === localDate(Date.now() - 24 * 60 * 60 * 1000)) return i18n.t("Yesterday");
  return ucfirst(`${weekdayOf(date)}, ${date.slice(8, 10)}/${date.slice(5, 7)}`);
}

/** "Monday, 24/11/2026 · 09:31" on the display wall clock. */
export function longDateTime(instant: Date | string | number): string {
  const date = localDate(instant);
  const [year, month, day] = date.split("-");
  return ucfirst(`${weekdayOf(date)}, ${day}/${month}/${year} · ${timeOf(instant)}`);
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 hours ago" in the current language. */
export function relativeTime(instant: Date | string | number, now = Date.now()): string {
  const seconds = Math.round((new Date(instant).getTime() - now) / 1000);
  const format = new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(seconds, "second");
}

/** Shortens text to `limit` characters with "...", like Laravel's Str::limit. */
export const limit = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, max).trimEnd()}...`;
