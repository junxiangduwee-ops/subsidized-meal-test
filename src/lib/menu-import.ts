/**
 * Weekly-menu CSV/Excel import.
 *
 * An admin uploads a spreadsheet after pressing "Create draft" instead of
 * (or in addition to) picking dishes one by one in the planner. Every row
 * names a restaurant and a dish by their stable `code` (see lib/codes.ts) -
 * matching `Admin > Restaurants` / `Admin > Dishes` export column order -
 * plus which weekday it goes on.
 *
 * Matching rules (as specified by the business):
 *   - code + name both match an existing catalogue row -> use it as-is.
 *   - code matches but the name differs -> CONFLICT. The row is rejected;
 *     nothing is created or added for it. The admin is told which row and
 *     why, so they can fix just that row and re-upload.
 *   - code is new and the name is also new -> create a brand new
 *     restaurant/dish from this row.
 *   - code is new but the name already belongs to a different existing
 *     code (or vice versa within the same file) -> also a CONFLICT,
 *     because names are unique in the catalogue and creating it would
 *     silently collide.
 *
 * Everything here is pure (no I/O, no Prisma) so it can be unit tested and
 * so the server action that actually writes to the database stays a thin
 * wrapper around it.
 */

import * as XLSX from 'xlsx';

import { CODE_PATTERN, normalizeCode } from './codes';
import { ringgitToSen, assertValidSen } from './money';

// ---------------------------------------------------------------------------
// File parsing
// ---------------------------------------------------------------------------

export const IMPORT_MAX_ROWS = 500;
export const IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

/** One data row from the uploaded file, columns as raw (untrimmed) strings. */
export type ImportRow = {
  day: string;
  restaurantCode: string;
  restaurantName: string;
  dishCode: string;
  dishName: string;
  price: string;
  capacity: string;
};

const REQUIRED_COLUMNS = [
  'day',
  'restaurantCode',
  'restaurantName',
  'dishCode',
  'dishName',
] as const satisfies readonly (keyof ImportRow)[];

/** "Restaurant Code" / "restaurant_code" / "R Code" all become "restaurantcode". */
function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const HEADER_ALIASES: Record<string, keyof ImportRow> = {
  day: 'day',
  weekday: 'day',
  serviceday: 'day',
  restaurantcode: 'restaurantCode',
  rcode: 'restaurantCode',
  restcode: 'restaurantCode',
  code: 'restaurantCode', // only used as a fallback if "dish code" isn't also just "code"
  restaurantname: 'restaurantName',
  rname: 'restaurantName',
  restname: 'restaurantName',
  restaurant: 'restaurantName',
  dishcode: 'dishCode',
  dcode: 'dishCode',
  dishname: 'dishName',
  dname: 'dishName',
  dish: 'dishName',
  price: 'price',
  priceper: 'price',
  pricerm: 'price',
  priceweek: 'price',
  capacity: 'capacity',
  qty: 'capacity',
  qtylimit: 'capacity',
  maxqty: 'capacity',
  maxportions: 'capacity',
};

export type ParsedFile = { rows: ImportRow[] } | { error: string };

/**
 * Reads an uploaded .csv/.xls/.xlsx file (as bytes) into `ImportRow`s.
 * SheetJS reads both CSV and Excel through the same API, so one code path
 * covers both formats the admin might upload.
 */
export function parseMenuImportFile(bytes: ArrayBuffer | Uint8Array): ParsedFile {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: 'buffer' });
  } catch {
    return { error: "Couldn't read that file. Please upload a .csv or .xlsx file." };
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) return { error: 'That file has no sheet to read.' };

  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });
  if (grid.length === 0) return { error: 'That file is empty.' };

  const [headerRow, ...dataRows] = grid;
  const columnForIndex = new Map<number, keyof ImportRow>();
  headerRow.forEach((cell, index) => {
    const key = HEADER_ALIASES[normalizeHeader(String(cell ?? ''))];
    if (key) columnForIndex.set(index, key);
  });

  const missing = REQUIRED_COLUMNS.filter((col) => ![...columnForIndex.values()].includes(col));
  if (missing.length > 0) {
    return {
      error: `Missing column(s): ${missing.join(', ')}. Expected Day, Restaurant code, Restaurant name, Dish code, Dish name (Price and Capacity are optional).`,
    };
  }

  const rows: ImportRow[] = [];
  for (const raw of dataRows) {
    if (raw.every((cell) => String(cell ?? '').trim() === '')) continue; // fully blank row
    const row: ImportRow = { day: '', restaurantCode: '', restaurantName: '', dishCode: '', dishName: '', price: '', capacity: '' };
    columnForIndex.forEach((key, index) => {
      row[key] = String(raw[index] ?? '').trim();
    });
    rows.push(row);
  }

  return { rows };
}

// ---------------------------------------------------------------------------
// Weekday matching - the app only ever plans Mon-Fri (SERVICE_DAYS_PER_WEEK
// in lib/cycle.ts), one LUNCH slot per day, so a short weekday name is all a
// row needs to say which day it belongs to.
// ---------------------------------------------------------------------------

const WEEKDAY_INDEX: Record<string, number> = {
  mon: 0, monday: 0,
  tue: 1, tues: 1, tuesday: 1,
  wed: 2, weds: 2, wednesday: 2,
  thu: 3, thur: 3, thurs: 3, thursday: 3,
  fri: 4, friday: 4,
};

/** Returns 0-4 (Mon-Fri) for a recognised weekday cell, else null. */
export function resolveWeekdayIndex(raw: string): number | null {
  const key = raw.trim().toLowerCase();
  return key in WEEKDAY_INDEX ? WEEKDAY_INDEX[key] : null;
}

// ---------------------------------------------------------------------------
// Catalogue matching
// ---------------------------------------------------------------------------

export type CatalogueRestaurant = { id: string; code: string | null; name: string };
export type CatalogueDish = {
  id: string;
  code: string | null;
  name: string;
  restaurantId: string;
  priceSen: number;
};

function normName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export type ResolvedRow =
  | {
      ok: true;
      rowNumber: number;
      weekdayIndex: number;
      restaurant: { code: string; name: string; existingId: string | null };
      dish: { code: string; name: string; existingId: string | null };
      /** Override price for this cycle only, in sen. Null = use the dish's catalogue price. */
      priceSen: number | null;
      capacity: number | null;
    }
  | {
      ok: false;
      rowNumber: number;
      raw: ImportRow;
      reason: string;
    };

/**
 * Resolves every row against a snapshot of the current catalogue. Rows are
 * walked in order and a restaurant/dish that's new in row 3 is remembered
 * so row 8 referencing the same code reuses it - and a same-file
 * inconsistency (same code claiming two different names, or vice versa)
 * is caught exactly like a conflict against the database would be.
 */
export function resolveMenuImportRows(
  rows: ImportRow[],
  catalogue: { restaurants: CatalogueRestaurant[]; dishes: CatalogueDish[] },
): ResolvedRow[] {
  const restaurantByCode = new Map<string, { id: string | null; name: string }>();
  for (const r of catalogue.restaurants) {
    if (r.code) restaurantByCode.set(normalizeCode(r.code)!, { id: r.id, name: r.name });
  }
  const restaurantByName = new Map<string, { id: string | null; code: string | null }>();
  for (const r of catalogue.restaurants) {
    restaurantByName.set(normName(r.name), { id: r.id, code: r.code });
  }

  const dishByCode = new Map<string, { id: string | null; name: string; restaurantKey: string }>();
  const dishByRestaurantAndName = new Map<string, { id: string | null; code: string | null }>();
  for (const d of catalogue.dishes) {
    const restaurantKey = d.restaurantId;
    if (d.code) dishByCode.set(normalizeCode(d.code)!, { id: d.id, name: d.name, restaurantKey });
    dishByRestaurantAndName.set(`${restaurantKey}::${normName(d.name)}`, { id: d.id, code: d.code });
  }

  const results: ResolvedRow[] = [];

  rows.forEach((raw, index) => {
    const rowNumber = index + 2; // header is row 1
    const reject = (reason: string): void => {
      results.push({ ok: false, rowNumber, raw, reason });
    };

    if (!raw.day.trim() || !raw.restaurantCode.trim() || !raw.restaurantName.trim() || !raw.dishCode.trim() || !raw.dishName.trim()) {
      reject('Missing Day, Restaurant code, Restaurant name, Dish code, or Dish name.');
      return;
    }

    const weekdayIndex = resolveWeekdayIndex(raw.day);
    if (weekdayIndex === null) {
      reject(`Unknown day "${raw.day}" - expected Mon, Tue, Wed, Thu or Fri.`);
      return;
    }

    const restaurantCode = normalizeCode(raw.restaurantCode);
    if (!restaurantCode || !CODE_PATTERN.test(restaurantCode)) {
      reject(`Restaurant code "${raw.restaurantCode}" can only contain letters, numbers, - and _.`);
      return;
    }
    const restaurantName = raw.restaurantName.trim();

    const dishCode = normalizeCode(raw.dishCode);
    if (!dishCode || !CODE_PATTERN.test(dishCode)) {
      reject(`Dish code "${raw.dishCode}" can only contain letters, numbers, - and _.`);
      return;
    }
    const dishName = raw.dishName.trim();

    // --- Restaurant resolution ---
    let restaurantId: string | null;
    const byCode = restaurantByCode.get(restaurantCode);
    if (byCode) {
      if (normName(byCode.name) !== normName(restaurantName)) {
        reject(
          `Restaurant code "${restaurantCode}" is already "${byCode.name}" in the system - this row says "${restaurantName}". Fix the name (or the code) and re-upload just this row.`,
        );
        return;
      }
      restaurantId = byCode.id;
    } else {
      const byName = restaurantByName.get(normName(restaurantName));
      if (byName) {
        reject(
          `Restaurant "${restaurantName}" already exists with code "${byName.code ?? '(no code)'}" - this row uses code "${restaurantCode}". Use the existing code, or give this row a different name.`,
        );
        return;
      }
      // Brand new restaurant. Remember it (id null = "to be created") so a
      // later row with the same code reuses it instead of re-declaring it.
      restaurantId = null;
      restaurantByCode.set(restaurantCode, { id: null, name: restaurantName });
      restaurantByName.set(normName(restaurantName), { id: null, code: restaurantCode });
    }

    const restaurantKey = restaurantId ?? `NEW:${restaurantCode}`;

    // --- Dish resolution (scoped to the resolved restaurant) ---
    let dishId: string | null;
    const dishHitByCode = dishByCode.get(dishCode);
    if (dishHitByCode) {
      if (dishHitByCode.restaurantKey !== restaurantKey) {
        reject(`Dish code "${dishCode}" belongs to a different restaurant in the system, not "${restaurantName}".`);
        return;
      }
      if (normName(dishHitByCode.name) !== normName(dishName)) {
        reject(
          `Dish code "${dishCode}" is already "${dishHitByCode.name}" in the system - this row says "${dishName}". Fix the name (or the code) and re-upload just this row.`,
        );
        return;
      }
      dishId = dishHitByCode.id;
    } else {
      const dishHitByName = dishByRestaurantAndName.get(`${restaurantKey}::${normName(dishName)}`);
      if (dishHitByName) {
        reject(
          `"${dishName}" at ${restaurantName} already exists with code "${dishHitByName.code ?? '(no code)'}" - this row uses code "${dishCode}".`,
        );
        return;
      }
      dishId = null;
      dishByCode.set(dishCode, { id: null, name: dishName, restaurantKey });
      dishByRestaurantAndName.set(`${restaurantKey}::${normName(dishName)}`, { id: null, code: dishCode });
    }

    // --- Price / capacity ---
    let priceSen: number | null = null;
    if (raw.price.trim()) {
      const sen = ringgitToSen(raw.price);
      if (!Number.isFinite(sen)) {
        reject(`Price "${raw.price}" is not a number.`);
        return;
      }
      try {
        assertValidSen(sen, 'price');
      } catch (e) {
        reject((e as Error).message);
        return;
      }
      priceSen = sen;
    } else if (dishId === null) {
      reject(`"${dishName}" is a new dish, so a Price (RM) is required to add it.`);
      return;
    }

    let capacity: number | null = null;
    if (raw.capacity.trim()) {
      const n = Number.parseInt(raw.capacity, 10);
      if (!Number.isInteger(n) || n < 1) {
        reject(`Capacity "${raw.capacity}" must be a whole number of at least 1, or left blank for unlimited.`);
        return;
      }
      capacity = n;
    }

    results.push({
      ok: true,
      rowNumber,
      weekdayIndex,
      restaurant: { code: restaurantCode, name: restaurantName, existingId: restaurantId },
      dish: { code: dishCode, name: dishName, existingId: dishId },
      priceSen,
      capacity,
    });
  });

  return results;
}
