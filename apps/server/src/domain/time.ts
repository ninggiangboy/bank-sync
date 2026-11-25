import { env } from "../config/env";

export type YearMonth = { year: number; month: number };

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const LOCAL_MINUTE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

function partsOf(instant: number, timeZone: string): Parts {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(instant);
  const get = (type: string) => Number(formatted.find((part) => part.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** The instant at which the wall clock in `timeZone` reads the given local time. */
export function zonedInstant(
  local: { year: number; month: number; day: number; hour?: number; minute?: number },
  timeZone = env.APP_TIMEZONE,
): Date {
  const wall = Date.UTC(local.year, local.month - 1, local.day, local.hour ?? 0, local.minute ?? 0);
  let instant = wall;
  // Two passes settle the offset even when it changes between the guess and the answer.
  for (let pass = 0; pass < 2; pass++) {
    const shown = partsOf(instant, timeZone);
    const offset =
      Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute) -
      Math.floor(instant / 60_000) * 60_000;
    instant = wall - offset;
  }
  return new Date(instant);
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/** `YYYY-MM-DD` of an instant on the wall clock of the display time zone. */
export function localDate(instant: Date, timeZone = env.APP_TIMEZONE): string {
  const { year, month, day } = partsOf(instant.getTime(), timeZone);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** `YYYY-MM-DDTHH:mm`, the value of a `datetime-local` input. */
export function localMinute(instant: Date, timeZone = env.APP_TIMEZONE): string {
  const { year, month, day, hour, minute } = partsOf(instant.getTime(), timeZone);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

export function monthOf(instant: Date, timeZone = env.APP_TIMEZONE): YearMonth {
  const { year, month } = partsOf(instant.getTime(), timeZone);
  return { year, month };
}

export const formatMonth = ({ year, month }: YearMonth) => `${pad(year, 4)}-${pad(month)}`;

export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** `YYYY-MM` in the display time zone; anything else, or nothing, means the current month. */
export function parseMonth(value: unknown, now = Date.now()): YearMonth {
  const match = typeof value === "string" ? MONTH_PATTERN.exec(value) : null;
  if (match) return { year: Number(match[1]), month: Number(match[2]) };
  return monthOf(new Date(now));
}

/** UTC bounds `[start, end)` of a local month. */
export function monthRange(month: YearMonth): { start: Date; end: Date } {
  const next = addMonths(month, 1);
  return {
    start: zonedInstant({ ...month, day: 1 }),
    end: zonedInstant({ ...next, day: 1 }),
  };
}

/** Parses a `datetime-local` value as local time; null when it is not a real date. */
export function parseLocalMinute(value: string, timeZone = env.APP_TIMEZONE): Date | null {
  const match = LOCAL_MINUTE_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const real =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day &&
    hour < 24 &&
    minute < 60;
  return real ? zonedInstant({ year, month, day, hour, minute }, timeZone) : null;
}
