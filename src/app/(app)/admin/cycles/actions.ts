'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { skipDuplicates } from '@/lib/db-compat';
import { audit } from '@/lib/orders';
import { ringgitToSen, assertValidSen, formatSen } from '@/lib/money';
import {
  addWeeks,
  dateOnly,
  defaultWindowFor,
  formatWeekRange,
  mondayOf,
  serviceDatesFor,
  todayInAppTz,
  zonedToUtc,
} from '@/lib/cycle';
import {
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_ROWS,
  parseMenuImportFile,
  resolveMenuImportRows,
} from '@/lib/menu-import';
import type { ActionState } from '@/components/action-form';

// ---------------------------------------------------------------------------
// Cycle lifecycle
// ---------------------------------------------------------------------------

export async function createCycle(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('menu:plan');

  const parsed = z
    .object({
      weekOf: z.string().min(10, 'Pick a date in the service week.'),
      title: z.string().trim().max(120).optional().or(z.literal('')),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const serviceWeekStart = mondayOf(dateOnly(parsed.data.weekOf));

  // Food is always served in a future week - never this week or earlier.
  const thisMonday = mondayOf(todayInAppTz());
  if (serviceWeekStart <= thisMonday) {
    return { error: 'Service week must start after the current week.' };
  }

  // A cancelled week doesn't block re-planning - only a still-live cycle does.
  const existing = await prisma.menuCycle.findFirst({
    where: { serviceWeekStart, status: { not: 'CANCELLED' } },
  });
  if (existing) {
    return { error: `A menu for ${formatWeekRange(serviceWeekStart)} already exists.` };
  }

  const { orderOpenAt, orderCutoffAt } = defaultWindowFor(serviceWeekStart);

  const cycle = await prisma.menuCycle.create({
    data: {
      serviceWeekStart,
      title: parsed.data.title?.trim() || null,
      orderOpenAt,
      orderCutoffAt,
      createdById: actor.id,
      days: {
        create: serviceDatesFor(serviceWeekStart).map((serviceDate) => ({
          serviceDate,
          slot: 'LUNCH' as const,
        })),
      },
    },
  });

  await audit(actor.id, 'cycle.create', 'MenuCycle', cycle.id, {
    serviceWeekStart: serviceWeekStart.toISOString(),
  });

  revalidatePath('/admin/cycles');
  redirect(`/admin/cycles/${cycle.id}`);
}

export async function publishCycle(formData: FormData): Promise<void> {
  const actor = await assertCapability('menu:plan');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const cycle = await prisma.menuCycle.findUnique({
    where: { id },
    include: { days: { include: { items: true } } },
  });
  if (!cycle || cycle.status !== 'DRAFT') return;

  const totalItems = cycle.days.reduce((n, d) => n + d.items.length, 0);
  if (totalItems === 0) return; // guarded in the UI too

  // Publishing late must not leave ordering "not yet open".
  const now = new Date();
  const orderOpenAt = cycle.orderOpenAt > now ? cycle.orderOpenAt : now;

  await prisma.menuCycle.update({
    where: { id },
    data: { status: 'PUBLISHED', publishedAt: now, orderOpenAt },
  });

  await audit(actor.id, 'cycle.publish', 'MenuCycle', id, { items: totalItems });
  revalidatePath('/admin/cycles');
  revalidatePath(`/admin/cycles/${id}`);
  revalidatePath('/menu');
}

export async function unpublishCycle(formData: FormData): Promise<void> {
  const actor = await assertCapability('menu:plan');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  // Pulling a menu back is only safe while nobody has committed to it.
  const committed = await prisma.order.count({
    where: { cycleId: id, status: { in: ['AWAITING_PAYMENT', 'PAID'] } },
  });
  if (committed > 0) return;

  await prisma.menuCycle.update({
    where: { id },
    data: { status: 'DRAFT', publishedAt: null },
  });

  await audit(actor.id, 'cycle.unpublish', 'MenuCycle', id);
  revalidatePath('/admin/cycles');
  revalidatePath(`/admin/cycles/${id}`);
  revalidatePath('/menu');
}

export async function closeCycle(formData: FormData): Promise<void> {
  const actor = await assertCapability('menu:plan');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await prisma.menuCycle.update({
    where: { id },
    data: { status: 'CLOSED', closedAt: new Date() },
  });

  // Abandoned carts are cleaned up so they don't linger as phantom demand.
  await prisma.order.deleteMany({ where: { cycleId: id, status: 'CART' } });

  await audit(actor.id, 'cycle.close', 'MenuCycle', id);
  revalidatePath('/admin/cycles');
  revalidatePath(`/admin/cycles/${id}`);
  revalidatePath('/kitchen');
}

export async function cancelCycle(formData: FormData): Promise<void> {
  const actor = await assertCapability('menu:plan');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const paid = await prisma.order.count({ where: { cycleId: id, status: 'PAID' } });

  await prisma.$transaction([
    prisma.menuCycle.update({ where: { id }, data: { status: 'CANCELLED' } }),
    prisma.order.updateMany({
      where: { cycleId: id, status: { in: ['CART', 'AWAITING_PAYMENT'] } },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Week cancelled by admin' },
    }),
  ]);

  await audit(actor.id, 'cycle.cancel', 'MenuCycle', id, { paidOrdersNeedingRefund: paid });
  revalidatePath('/admin/cycles');
  revalidatePath(`/admin/cycles/${id}`);
}

export async function updateCycleWindow(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('menu:plan');

  const parsed = z
    .object({
      id: z.string().min(1),
      title: z.string().trim().max(120).optional().or(z.literal('')),
      orderOpenAt: z.string().min(16, 'Pick an opening date and time.'),
      orderCutoffAt: z.string().min(16, 'Pick a cutoff date and time.'),
      notes: z.string().trim().max(1000).optional().or(z.literal('')),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const open = parseLocalDateTime(parsed.data.orderOpenAt);
  const cutoff = parseLocalDateTime(parsed.data.orderCutoffAt);
  if (!open || !cutoff) return { error: 'Could not read those dates.' };
  if (cutoff <= open) return { error: 'The cutoff must be after ordering opens.' };

  const cycle = await prisma.menuCycle.findUnique({
    where: { id: parsed.data.id },
    select: { serviceWeekStart: true },
  });
  if (!cycle) return { error: 'Cycle not found.' };

  const weekStart = dateOnly(cycle.serviceWeekStart);
  if (cutoff >= weekStart) {
    return { error: 'The cutoff must fall before the service week begins.' };
  }

  await prisma.menuCycle.update({
    where: { id: parsed.data.id },
    data: {
      title: parsed.data.title?.trim() || null,
      orderOpenAt: open,
      orderCutoffAt: cutoff,
      notes: parsed.data.notes?.trim() || null,
    },
  });

  await audit(actor.id, 'cycle.update_window', 'MenuCycle', parsed.data.id, {
    orderOpenAt: open.toISOString(),
    orderCutoffAt: cutoff.toISOString(),
  });

  revalidatePath(`/admin/cycles/${parsed.data.id}`);
  return { success: 'Schedule updated.' };
}

/** `<input type="datetime-local">` gives wall-clock text with no zone. */
function parseLocalDateTime(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  return zonedToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}

// ---------------------------------------------------------------------------
// Menu items within a cycle
// ---------------------------------------------------------------------------

async function assertDraftDay(menuDayId: string) {
  const day = await prisma.menuDay.findUnique({
    where: { id: menuDayId },
    include: { cycle: { select: { id: true, status: true } } },
  });
  if (!day) throw new Error('That day is not part of any menu.');
  if (day.cycle.status !== 'DRAFT') {
    throw new Error('This menu is published. Unpublish it before changing the dishes.');
  }
  return day;
}

export async function addMenuItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('menu:plan');

  const parsed = z
    .object({
      menuDayId: z.string().min(1),
      dishId: z.string().min(1, 'Choose a dish.'),
      price: z.string().optional().or(z.literal('')),
      capacity: z.string().optional().or(z.literal('')),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let day;
  try {
    day = await assertDraftDay(parsed.data.menuDayId);
  } catch (e) {
    return { error: (e as Error).message };
  }

  const dish = await prisma.dish.findUnique({ where: { id: parsed.data.dishId } });
  if (!dish) return { error: 'That dish no longer exists.' };

  // Snapshot the catalogue price unless the admin overrode it for this week.
  let priceSen = dish.priceSen;
  if (parsed.data.price?.trim()) {
    priceSen = ringgitToSen(parsed.data.price);
    if (!Number.isFinite(priceSen)) return { error: 'Price must be a number, e.g. 12.50' };
    try {
      assertValidSen(priceSen, 'price');
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  let capacity: number | null = null;
  if (parsed.data.capacity?.trim()) {
    capacity = Number.parseInt(parsed.data.capacity, 10);
    if (!Number.isInteger(capacity) || capacity < 1) {
      return { error: 'Capacity must be a whole number of at least 1, or blank for unlimited.' };
    }
  }

  const already = await prisma.menuItem.findUnique({
    where: { menuDayId_dishId: { menuDayId: day.id, dishId: dish.id } },
  });
  if (already) return { error: `${dish.name} is already on that day.` };

  const count = await prisma.menuItem.count({ where: { menuDayId: day.id } });

  await prisma.menuItem.create({
    data: { menuDayId: day.id, dishId: dish.id, priceSen, capacity, sortOrder: count },
  });

  await audit(actor.id, 'menuitem.add', 'MenuCycle', day.cycle.id, { dish: dish.name, priceSen, capacity });
  revalidatePath(`/admin/cycles/${day.cycle.id}`);
  return { success: `Added ${dish.name} at ${formatSen(priceSen)}.` };
}

export async function updateMenuItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('menu:plan');

  const id = String(formData.get('id') ?? '');
  const item = await prisma.menuItem.findUnique({
    where: { id },
    include: { menuDay: { include: { cycle: { select: { id: true, status: true } } } } },
  });
  if (!item) return { error: 'Menu item not found.' };
  if (item.menuDay.cycle.status !== 'DRAFT') {
    return { error: 'This menu is published. Unpublish it before changing prices.' };
  }

  const priceRaw = String(formData.get('price') ?? '').trim();
  const capacityRaw = String(formData.get('capacity') ?? '').trim();

  const priceSen = ringgitToSen(priceRaw);
  if (!Number.isFinite(priceSen)) return { error: 'Price must be a number, e.g. 12.50' };
  try {
    assertValidSen(priceSen, 'price');
  } catch (e) {
    return { error: (e as Error).message };
  }

  let capacity: number | null = null;
  if (capacityRaw) {
    capacity = Number.parseInt(capacityRaw, 10);
    if (!Number.isInteger(capacity) || capacity < 1) {
      return { error: 'Capacity must be at least 1, or blank for unlimited.' };
    }
  }

  await prisma.menuItem.update({ where: { id }, data: { priceSen, capacity } });
  await audit(actor.id, 'menuitem.update', 'MenuCycle', item.menuDay.cycle.id, { menuItemId: id, priceSen, capacity });

  revalidatePath(`/admin/cycles/${item.menuDay.cycle.id}`);
  return { success: 'Saved.' };
}

export async function removeMenuItem(formData: FormData): Promise<void> {
  const actor = await assertCapability('menu:plan');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const item = await prisma.menuItem.findUnique({
    where: { id },
    include: { menuDay: { include: { cycle: { select: { id: true, status: true } } } } },
  });
  if (!item || item.menuDay.cycle.status !== 'DRAFT') return;

  await prisma.menuItem.delete({ where: { id } });
  await audit(actor.id, 'menuitem.remove', 'MenuCycle', item.menuDay.cycle.id, { menuItemId: id });
  revalidatePath(`/admin/cycles/${item.menuDay.cycle.id}`);
}

/**
 * Copy the previous week's line-up into this draft. Days are matched by
 * weekday position, and dishes already present are skipped.
 */
export async function copyPreviousWeek(formData: FormData): Promise<void> {
  const actor = await assertCapability('menu:plan');
  const cycleId = String(formData.get('id') ?? '');
  if (!cycleId) return;

  const target = await prisma.menuCycle.findUnique({
    where: { id: cycleId },
    include: { days: { orderBy: { serviceDate: 'asc' }, include: { items: true } } },
  });
  if (!target || target.status !== 'DRAFT') return;

  const source = await prisma.menuCycle.findFirst({
    where: {
      serviceWeekStart: addWeeks(dateOnly(target.serviceWeekStart), -1),
      status: { not: 'CANCELLED' },
    },
    include: { days: { orderBy: { serviceDate: 'asc' }, include: { items: true } } },
  });
  if (!source) return;

  const rows: Array<{ menuDayId: string; dishId: string; priceSen: number; capacity: number | null; sortOrder: number }> = [];

  target.days.forEach((targetDay, index) => {
    const sourceDay = source.days[index];
    if (!sourceDay) return;
    const present = new Set(targetDay.items.map((i) => i.dishId));
    let sortOrder = targetDay.items.length;
    for (const item of sourceDay.items) {
      if (present.has(item.dishId)) continue;
      rows.push({
        menuDayId: targetDay.id,
        dishId: item.dishId,
        priceSen: item.priceSen,
        capacity: item.capacity,
        sortOrder: sortOrder++,
      });
    }
  });

  if (rows.length > 0) {
    await prisma.menuItem.createMany({ data: rows, ...skipDuplicates() });
  }

  await audit(actor.id, 'cycle.copy_previous', 'MenuCycle', cycleId, { copied: rows.length });
  revalidatePath(`/admin/cycles/${cycleId}`);
}

// ---------------------------------------------------------------------------
// Weekly-menu CSV/Excel import
// ---------------------------------------------------------------------------

export type MenuImportRejectedRow = {
  row: number;
  restaurantCode: string;
  restaurantName: string;
  dishCode: string;
  dishName: string;
  day: string;
  reason: string;
};

export type MenuImportState = {
  error?: string;
  result?: {
    fileName: string;
    importedCount: number;
    skippedCount: number;
    createdRestaurants: string[];
    createdDishes: string[];
    rejected: MenuImportRejectedRow[];
  };
};

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/**
 * Bulk-adds dishes to a draft menu from an uploaded CSV/Excel file. Rows
 * whose restaurant/dish code+name match the catalogue (or are entirely new)
 * are applied; rows where a code matches an existing record under a
 * different name are rejected and reported back, untouched, so the admin
 * can fix and re-upload just those.
 */
export async function importWeeklyMenu(
  _prev: MenuImportState,
  formData: FormData,
): Promise<MenuImportState> {
  const actor = await assertCapability('menu:plan');

  const cycleId = String(formData.get('cycleId') ?? '');
  if (!cycleId) return { error: 'Missing menu.' };

  const cycle = await prisma.menuCycle.findUnique({
    where: { id: cycleId },
    include: { days: { orderBy: { serviceDate: 'asc' } } },
  });
  if (!cycle) return { error: 'Menu not found.' };
  if (cycle.status !== 'DRAFT') {
    return { error: 'This menu is published. Unpublish it before importing dishes.' };
  }
  if (cycle.days.length === 0) return { error: 'This menu has no service days.' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a CSV or Excel file to upload.' };
  }
  if (file.size > IMPORT_MAX_FILE_BYTES) {
    return { error: `File is too large (max ${Math.round(IMPORT_MAX_FILE_BYTES / 1024 / 1024)} MB).` };
  }

  const bytes = await file.arrayBuffer();
  const parsed = parseMenuImportFile(bytes);
  if ('error' in parsed) return { error: parsed.error };
  if (parsed.rows.length === 0) return { error: 'That file has no data rows.' };
  if (parsed.rows.length > IMPORT_MAX_ROWS) {
    return { error: `That file has more than ${IMPORT_MAX_ROWS} rows - split it into smaller uploads.` };
  }

  const [restaurants, dishes] = await Promise.all([
    prisma.restaurant.findMany({ select: { id: true, code: true, name: true } }),
    prisma.dish.findMany({
      select: { id: true, code: true, name: true, restaurantId: true, priceSen: true },
    }),
  ]);

  const resolved = resolveMenuImportRows(parsed.rows, { restaurants, dishes });

  // Per-day sort order, seeded from what's already on the menu.
  const dayIds = cycle.days.map((d) => d.id);
  const counts = await prisma.menuItem.groupBy({
    by: ['menuDayId'],
    where: { menuDayId: { in: dayIds } },
    _count: { _all: true },
  });
  const sortOrderByDay = new Map<string, number>(dayIds.map((id) => [id, 0]));
  for (const c of counts) sortOrderByDay.set(c.menuDayId, c._count._all);

  const existingDishPriceById = new Map(dishes.map((d) => [d.id, d.priceSen]));
  const restaurantIdByCode = new Map<string, string>();
  const dishIdByCode = new Map<string, { id: string; priceSen: number }>();
  const createdRestaurants: string[] = [];
  const createdDishes: string[] = [];
  const rejected: MenuImportRejectedRow[] = [];
  let importedCount = 0;
  let skippedCount = 0;

  for (const row of resolved) {
    if (!row.ok) {
      rejected.push({
        row: row.rowNumber,
        restaurantCode: row.raw.restaurantCode,
        restaurantName: row.raw.restaurantName,
        dishCode: row.raw.dishCode,
        dishName: row.raw.dishName,
        day: row.raw.day,
        reason: row.reason,
      });
      continue;
    }

    const dayId = cycle.days[row.weekdayIndex]?.id;
    if (!dayId) {
      rejected.push({
        row: row.rowNumber,
        restaurantCode: row.restaurant.code,
        restaurantName: row.restaurant.name,
        dishCode: row.dish.code,
        dishName: row.dish.name,
        day: WEEKDAY_LABELS[row.weekdayIndex] ?? '',
        reason: "That day isn't part of this menu.",
      });
      continue;
    }

    try {
      let restaurantId = row.restaurant.existingId ?? restaurantIdByCode.get(row.restaurant.code);
      if (!restaurantId) {
        const created = await prisma.restaurant.create({
          data: { code: row.restaurant.code, name: row.restaurant.name },
        });
        restaurantId = created.id;
        restaurantIdByCode.set(row.restaurant.code, restaurantId);
        createdRestaurants.push(`${row.restaurant.name} (${row.restaurant.code})`);
      }

      let dish = dishIdByCode.get(row.dish.code);
      if (!dish && row.dish.existingId) {
        dish = { id: row.dish.existingId, priceSen: existingDishPriceById.get(row.dish.existingId)! };
      }
      if (!dish) {
        // New dish: priceSen is guaranteed by resolveMenuImportRows when existingId is null.
        const created = await prisma.dish.create({
          data: {
            restaurantId,
            code: row.dish.code,
            name: row.dish.name,
            priceSen: row.priceSen!,
          },
        });
        dish = { id: created.id, priceSen: created.priceSen };
        dishIdByCode.set(row.dish.code, dish);
        createdDishes.push(`${row.dish.name} (${row.dish.code})`);
      }

      const already = await prisma.menuItem.findUnique({
        where: { menuDayId_dishId: { menuDayId: dayId, dishId: dish.id } },
      });
      if (already) {
        skippedCount++;
        continue;
      }

      const sortOrder = sortOrderByDay.get(dayId) ?? 0;
      await prisma.menuItem.create({
        data: {
          menuDayId: dayId,
          dishId: dish.id,
          priceSen: row.priceSen ?? dish.priceSen,
          capacity: row.capacity,
          sortOrder,
        },
      });
      sortOrderByDay.set(dayId, sortOrder + 1);
      importedCount++;
    } catch (e) {
      rejected.push({
        row: row.rowNumber,
        restaurantCode: row.restaurant.code,
        restaurantName: row.restaurant.name,
        dishCode: row.dish.code,
        dishName: row.dish.name,
        day: WEEKDAY_LABELS[row.weekdayIndex] ?? '',
        reason: (e as Error).message || 'Could not save this row.',
      });
    }
  }

  await audit(actor.id, 'cycle.import_menu', 'MenuCycle', cycleId, {
    fileName: file.name,
    imported: importedCount,
    skipped: skippedCount,
    rejected: rejected.length,
  });

  revalidatePath(`/admin/cycles/${cycleId}`);
  revalidatePath('/admin/restaurants');
  revalidatePath('/admin/dishes');

  return {
    result: {
      fileName: file.name,
      importedCount,
      skippedCount,
      createdRestaurants,
      createdDishes,
      rejected,
    },
  };
}
