/**
 * Restaurant and dish "codes".
 *
 * Names are free text and can be renamed at any time, which makes them a
 * poor key for a weekly-menu CSV/Excel import - a typo or a rename would
 * silently point a row at the wrong dish. A code is a short, admin-chosen,
 * stable identifier used instead: it round-trips through the catalogue
 * exports below and is what a future import validator will match rows
 * against.
 */

/** Letters, numbers, hyphen and underscore only - safe to put in a filename
 * or a spreadsheet cell with no quoting/escaping concerns. */
export const CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

export const CODE_MAX_LENGTH = 40;

/** Trims and upper-cases a raw form value, or null if it was left blank. */
export function normalizeCode(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

/**
 * Turns a free-text name into a `CODE_PATTERN`-safe base code: upper-cased,
 * non-alphanumeric runs collapsed to a single hyphen, and trimmed to
 * `maxLength`. Falls back to a short random code if the name has no
 * alphanumeric characters at all (e.g. an emoji-only name).
 *
 * Currently unused by the auto-generation flow (which prefers a
 * sequential `PREFIX-001` code instead - see `nextSequentialCode` below),
 * but kept as an option for anyone who wants name-based codes.
 */
export function slugifyCode(text: string, maxLength: number = CODE_MAX_LENGTH): string {
  const slug = text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
  return slug || randomCode();
}

function randomCode(length = 6): string {
  return Math.random().toString(36).slice(2, 2 + length).toUpperCase();
}

/**
 * Picks the next `PREFIX-001`-style code given the codes already in use.
 * Looks at the highest existing number after `prefix-` (case-insensitive)
 * and increments it, rather than counting rows, so a deleted row never
 * causes a code to be reused. The zero-padded width grows automatically
 * past 999 (`R-1000`, not `R-1000` truncated to three digits).
 */
export function nextSequentialCode(
  prefix: string,
  existingCodes: Iterable<string | null | undefined>,
  minDigits = 3,
): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  let max = 0;
  for (const code of existingCodes) {
    const match = code ? pattern.exec(code) : null;
    if (!match) continue;
    const n = Number.parseInt(match[1], 10);
    if (n > max) max = n;
  }
  const next = max + 1;
  const digits = Math.max(minDigits, String(next).length);
  return `${prefix}-${String(next).padStart(digits, '0')}`;
}

/**
 * Appends `-2`, `-3`, ... to `base` until `isTaken` reports the candidate is
 * free. Used as a last-resort tie-breaker if two auto-generated codes ever
 * collide (e.g. a race between two concurrent form submissions).
 */
export async function generateUniqueCode(
  base: string,
  isTaken: (code: string) => Promise<boolean>,
  maxLength: number = CODE_MAX_LENGTH,
): Promise<string> {
  let candidate = base;
  let suffix = 2;
  // A few hundred collisions on the same base is not a realistic scenario,
  // but bail out rather than loop forever if it somehow happens.
  while ((await isTaken(candidate)) && suffix < 1000) {
    const suffixStr = `-${suffix}`;
    candidate = `${base.slice(0, Math.max(1, maxLength - suffixStr.length))}${suffixStr}`;
    suffix++;
  }
  return candidate;
}
