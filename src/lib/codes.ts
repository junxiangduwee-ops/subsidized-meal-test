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
