/**
 * Weekly cycle arithmetic.
 *
 * A cycle is identified by the Monday of the week the food is *served*.
 * For a service week starting Monday W:
 *
 *   W-2  any day    admin drafts the menu (DRAFT, invisible to users)
 *   W-1  Monday     publish -> ordering opens          (orderOpenAt)
 *   W-1  Wednesday  17:00 cutoff -> ordering closes    (orderCutoffAt)
 *   W    Mon..Fri   food served
 *
 * All wall-clock reasoning happens in APP_TIMEZONE (default Asia/Kuala_Lumpur).
 * Date-only columns are stored as UTC midnight, matching Prisma's `@db.Date`.
 */

import type { MenuCycle } from '@prisma/client';

export const APP_TIMEZONE = process.env.APP_TIMEZONE ?? 'Asia/Kuala_Lumpur';

/** Number of service days rendered per week, starting Monday. 5 = Mon-Fri. */
export const SERVICE_DAYS_PER_WEEK = 5;

/** How many weeks before the service week the admin is expected to draft. */
export const DRAFT_LEAD_WEEKS = 2;

const DAY_MS = 86_400_000;

export const WEEKDAY_LABELS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

// ---------------------------------------------------------------------------
// Timezone-aware construction
// ---------------------------------------------------------------------------

/** Offset in ms between `tz` wall-clock and UTC at the given instant. */
function tzOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const f: Record<string, number> = {};
  for (const p of parts) if (p.type !== 'literal') f[p.type] = Number(p.value);

  const asUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour % 24, f.minute, f.second);
  return asUtc - instant.getTime();
}

/** Build the UTC instant for a wall-clock time in APP_TIMEZONE. */
export function zonedToUtc(
  year: number,
  month1: number,
  day: number,
  hour = 0,
  minute = 0,
  tz: string = APP_TIMEZONE,
): Date {
  const guess = Date.UTC(year, month1 - 1, day, hour, minute, 0);
  // Two passes settle the fixed point even across a DST boundary.
  let ts = guess - tzOffsetMs(new Date(guess), tz);
  ts = guess - tzOffsetMs(new Date(ts), tz);
  return new Date(ts);
}

/** Today's calendar date in APP_TIMEZONE, as a UTC-midnight Date. */
export function todayInAppTz(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // "YYYY-MM-DD"
  const [y, m, d] = parts.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// ---------------------------------------------------------------------------
// Date-only helpers (all operate on UTC-midnight Dates)
// ---------------------------------------------------------------------------

export function dateOnly(input: Date | string): Date {
  const d = typeof input === 'string' ? new Date(`${input.slice(0, 10)}T00:00:00.000Z`) : input;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}

/** Monday of the ISO week containing `date`. */
export function mondayOf(date: Date): Date {
  const d = dateOnly(date);
  const dow = d.getUTCDay(); // 0=Sun .. 6=Sat
  const backToMonday = dow === 0 ? 6 : dow - 1;
  return addDays(d, -backToMonday);
}

/** "2026-08-03" */
export function toDateKey(date: Date): string {
  return dateOnly(date).toISOString().slice(0, 10);
}

export function sameDate(a: Date, b: Date): boolean {
  return toDateKey(a) === toDateKey(b);
}

// ---------------------------------------------------------------------------
// Cycle windows
// ---------------------------------------------------------------------------

function cutoffConfig() {
  const weekday = clampInt(process.env.ORDER_CUTOFF_WEEKDAY, 3, 1, 7); // 1=Mon .. 7=Sun
  const hour = clampInt(process.env.ORDER_CUTOFF_HOUR, 17, 0, 23);
  const minute = clampInt(process.env.ORDER_CUTOFF_MINUTE, 0, 0, 59);
  return { weekday, hour, minute };
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Default ordering window for a service week: opens Monday 00:00 of the
 * preceding week, closes on the configured cutoff weekday/time of that
 * same preceding week (Wednesday 17:00 by default).
 */
export function defaultWindowFor(serviceWeekStart: Date): {
  orderOpenAt: Date;
  orderCutoffAt: Date;
} {
  const monday = mondayOf(serviceWeekStart);
  const openDate = addWeeks(monday, -1);
  const { weekday, hour, minute } = cutoffConfig();
  const cutoffDate = addDays(openDate, weekday - 1);

  return {
    orderOpenAt: zonedToUtc(
      openDate.getUTCFullYear(),
      openDate.getUTCMonth() + 1,
      openDate.getUTCDate(),
      0,
      0,
    ),
    orderCutoffAt: zonedToUtc(
      cutoffDate.getUTCFullYear(),
      cutoffDate.getUTCMonth() + 1,
      cutoffDate.getUTCDate(),
      hour,
      minute,
    ),
  };
}

/** The service dates rendered in the planner, Monday first. */
export function serviceDatesFor(serviceWeekStart: Date, count = SERVICE_DAYS_PER_WEEK): Date[] {
  const monday = mondayOf(serviceWeekStart);
  return Array.from({ length: count }, (_, i) => addDays(monday, i));
}

/**
 * Earliest service week an admin should be drafting right now: two weeks
 * out, so there is a full week of lead time before ordering opens.
 */
export function nextPlannableWeekStart(now: Date = new Date()): Date {
  return addWeeks(mondayOf(todayInAppTz(now)), DRAFT_LEAD_WEEKS);
}

/** The service week currently being ordered for (ordering week + 1). */
export function currentOrderingWeekStart(now: Date = new Date()): Date {
  return addWeeks(mondayOf(todayInAppTz(now)), 1);
}

export type CyclePhase =
  | 'DRAFT'
  | 'SCHEDULED' // published, but ordering has not opened yet
  | 'OPEN'
  | 'CLOSED' // cutoff passed, service week not started
  | 'SERVING'
  | 'COMPLETED'
  | 'CANCELLED';

type CycleWindow = Pick<MenuCycle, 'status' | 'serviceWeekStart' | 'orderOpenAt' | 'orderCutoffAt'>;

export function cyclePhase(cycle: CycleWindow, now: Date = new Date()): CyclePhase {
  if (cycle.status === 'CANCELLED') return 'CANCELLED';
  if (cycle.status === 'DRAFT') return 'DRAFT';

  const weekStart = dateOnly(cycle.serviceWeekStart);
  const weekEndExclusive = addDays(weekStart, 7);

  if (now >= weekEndExclusive) return 'COMPLETED';
  if (now >= weekStart) return 'SERVING';
  if (now >= new Date(cycle.orderCutoffAt)) return 'CLOSED';
  if (now >= new Date(cycle.orderOpenAt)) return 'OPEN';
  return 'SCHEDULED';
}

/** Can a user still add to / check out an order for this cycle? */
export function isOrderingOpen(cycle: CycleWindow, now: Date = new Date()): boolean {
  return cycle.status === 'PUBLISHED' && cyclePhase(cycle, now) === 'OPEN';
}

/** Human-readable countdown, e.g. "2 days 4 hrs left". */
export function timeUntil(target: Date, now: Date = new Date()): string {
  const ms = new Date(target).getTime() - now.getTime();
  if (ms <= 0) return 'closed';
  const mins = Math.floor(ms / 60_000);
  const days = Math.floor(mins / 1440);
  const hrs = Math.floor((mins % 1440) / 60);
  const rem = mins % 60;
  if (days > 0) return `${days}d ${hrs}h left`;
  if (hrs > 0) return `${hrs}h ${rem}m left`;
  return `${rem}m left`;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Maps our app locales to the Intl locale tag that renders them correctly. */
const INTL_LOCALE: Record<string, string> = { en: 'en-GB', ms: 'ms-MY', zh: 'zh-CN' };
function intlLocale(locale?: string): string {
  return (locale && INTL_LOCALE[locale]) || 'en-GB';
}

export function formatDate(
  date: Date | string,
  style: 'short' | 'long' | 'weekday' | 'full' = 'short',
  locale?: string,
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const loc = intlLocale(locale);
  const base: Intl.DateTimeFormatOptions = { timeZone: 'UTC' };
  if (style === 'weekday') return new Intl.DateTimeFormat(loc, { ...base, weekday: 'long' }).format(d);
  if (style === 'full')
    return new Intl.DateTimeFormat(loc, {
      ...base,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(d);
  if (style === 'long')
    return new Intl.DateTimeFormat(loc, {
      ...base,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(d);
  return new Intl.DateTimeFormat(loc, { ...base, day: 'numeric', month: 'short' }).format(d);
}

export function formatDateTime(date: Date | string, locale?: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: APP_TIMEZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/** Format an instant as "YYYY-MM-DDTHH:mm" in APP_TIMEZONE for datetime-local inputs. */
export function toLocalInputValue(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const f: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') f[p.type] = p.value;
  const hour = f.hour === '24' ? '00' : f.hour;
  return `${f.year}-${f.month}-${f.day}T${hour}:${f.minute}`;
}

/** "4 Aug - 8 Aug 2026" */
export function formatWeekRange(serviceWeekStart: Date | string, locale?: string): string {
  const start = dateOnly(
    typeof serviceWeekStart === 'string' ? new Date(serviceWeekStart) : serviceWeekStart,
  );
  const end = addDays(start, SERVICE_DAYS_PER_WEEK - 1);
  const y = new Intl.DateTimeFormat(intlLocale(locale), { timeZone: 'UTC', year: 'numeric' }).format(end);
  return `${formatDate(start, 'short', locale)} - ${formatDate(end, 'short', locale)} ${y}`;
}