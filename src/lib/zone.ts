import { TZDate } from '@date-fns/tz';

/*
 * The planner thinks in wall-clock time ("gym at 18:00", "all day on Monday"). In the browser that
 * is the device's time zone. Servers (the Cloudflare Worker) run in UTC, so they set the user's zone
 * here and every local-time calculation goes through these helpers instead of plain `Date`.
 */
let zone: string | undefined;

/** Use `tz` (IANA name, e.g. "Europe/Amsterdam") for local time; undefined = the runtime's zone. */
export function setTimeZone(tz: string | undefined): void {
  zone = tz;
}

export const timeZone = (): string => zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The instant `d` as a Date whose local fields (getHours, setDate, date-fns) are in the planner's zone.
 * Use it for calculations; convert results with `isoOf` or `getTime()`.
 */
export function local(d: Date | string | number = Date.now()): Date {
  const ms = typeof d === 'string' ? Date.parse(d) : +d;
  return zone ? new TZDate(ms, zone) : new Date(ms);
}

/**
 * The instant of a local date-time in the planner's zone (month is 0-based, like `new Date`).
 * Returns a plain Date: zoned dates print `toISOString()` with an offset, but stored times end in Z.
 */
export function localDate(y: number, mo: number, d = 1, h = 0, mi = 0, s = 0, ms = 0): Date {
  return zone ? new Date(+new TZDate(y, mo, d, h, mi, s, ms, zone)) : new Date(y, mo, d, h, mi, s, ms);
}

/** ISO string in UTC ("…Z"), also for zoned dates. */
export const isoOf = (d: Date): string => new Date(+d).toISOString();
