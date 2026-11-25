import { env } from "../config/env";

const DATE = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})/;
const ISO_DATE = /(\d{4})-(\d{1,2})-(\d{1,2})/;
const TIME = /(\d{1,2}):(\d{2})(?::(\d{2}))?/;

/** Offset of `timeZone` from UTC in milliseconds at the given instant. */
function zoneOffset(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

type WallTime = [
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
];

/** The UTC instant at which the clock in `timeZone` shows the given wall time. */
export function wallTimeToInstant(
  [year, month, day, hour, minute, second]: WallTime,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = naive - zoneOffset(naive, timeZone);
  return new Date(naive - zoneOffset(first, timeZone));
}

/** "2026-11-12T14:03:21+07:00": an instant rendered in `timeZone` with its numeric offset. */
export function toIsoInZone(instant: Date, timeZone: string): string {
  const offset = zoneOffset(instant.getTime(), timeZone);
  const local = new Date(instant.getTime() + offset).toISOString().slice(0, 19);
  const sign = offset < 0 ? "-" : "+";
  const minutes = Math.abs(offset) / 60000;
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${local}${sign}${hh}:${mm}`;
}

/**
 * Finds the first date (and optional time) in a string, read in the display timezone.
 * Accepts "12/11/2026 14:03:21", "12-11-2026 14:03", "14:03 12/11/2026" and "2026-11-12 14:03:21".
 */
export function parse(value: string, timeZone: string = env.APP_TIMEZONE): Date | null {
  let year: number;
  let month: number;
  let day: number;
  let matched: string;

  const iso = value.match(ISO_DATE);
  const dmy = iso ? null : value.match(DATE);
  if (iso) {
    [year, month, day, matched] = [Number(iso[1]), Number(iso[2]), Number(iso[3]), iso[0]];
  } else if (dmy) {
    [day, month, year, matched] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3]), dmy[0]];
  } else {
    return null;
  }
  if (year < 100) year += 2000;

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  const time = value.replace(matched, " ").match(TIME);
  const [hour, minute, second] = time
    ? [Number(time[1]), Number(time[2]), Number(time[3] ?? 0)]
    : [0, 0, 0];
  if (hour > 23 || minute > 59 || second > 59) return null;

  return wallTimeToInstant([year, month, day, hour, minute, second], timeZone);
}
