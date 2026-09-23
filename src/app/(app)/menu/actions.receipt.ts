'use server';

/**
 * Employee meal-receipt confirmation.
 *
 * On each service day the employee sees an "I received my meal" button next
 * to every PAID order item for today. If they don't tap it before 18:00,
 * the cron at /api/cron/auto-confirm-meals auto-confirms it for them.
 */

import { revalidatePath } from 'next/cache';

import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { todayInAppTz, toDateKey, zonedToUtc, APP_TIMEZONE } from '@/lib/cycle';
import { audit } from '@/lib/orders';

export type ReceiptResult = { ok: boolean; error?: string };

// ---------------------------------------------------------------------------
// Internal guard
// ---------------------------------------------------------------------------

async function loadAndGuardItem(userId: string, orderItemId: string) {
  const item = await prisma.orderItem.findUnique({
    where: { id: orderItemId },
    select: {
      id: true,
      serviceDate: true,
      receivedAt: true,
      receivedBySystem: true,
      order: { select: { userId: true, status: true } },
    },
  });

  if (!item) return { ok: false as const, error: 'Meal not found.' };
  if (item.order.userId !== userId) return { ok: false as const, error: 'That meal does not belong to your order.' };
  if (item.order.status !== 'PAID') return { ok: false as const, error: 'Only paid orders can be confirmed as received.' };

  // Must be on or after the service date
  const todayKey = toDateKey(todayInAppTz());
  if (toDateKey(item.serviceDate) > todayKey) {
    return { ok: false as const, error: 'You can only confirm receipt on or after the service date.' };
  }

  return { ok: true as const, item };
}

// ---------------------------------------------------------------------------
// Public actions
// ---------------------------------------------------------------------------

/**
 * Employee taps "I received my meal".
 * Idempotent — calling it on an already-confirmed item is a silent no-op.
 */
export async function confirmMealReceived(orderItemId: string): Promise<ReceiptResult> {
  const user = await assertCapability('order:place');

  const guard = await loadAndGuardItem(user.id, orderItemId);
  if (!guard.ok) return guard;

  const { item } = guard;
  if (item.receivedAt) return { ok: true }; // already confirmed

  await prisma.orderItem.update({
    where: { id: orderItemId },
    data: { receivedAt: new Date(), receivedBySystem: false },
  });

  await audit(user.id, 'meal.received', 'OrderItem', orderItemId, {
    serviceDate: toDateKey(item.serviceDate),
    confirmedBy: 'employee',
  });

  revalidatePath('/menu');
  return { ok: true };
}

/**
 * Employee undoes an accidental confirmation — only allowed before 18:00 on
 * the service date, and only if *they* confirmed it (not the cron).
 */
export async function undoMealReceived(orderItemId: string): Promise<ReceiptResult> {
  const user = await assertCapability('order:place');

  const guard = await loadAndGuardItem(user.id, orderItemId);
  if (!guard.ok) return guard;

  const { item } = guard;
  if (!item.receivedAt) return { ok: true }; // nothing to undo

  if (item.receivedBySystem) {
    return {
      ok: false,
      error: 'This was automatically confirmed at 6 PM. Contact your administrator to correct it.',
    };
  }

  // Block undo once 18:00 has passed on the service date
  const [y, m, d] = toDateKey(item.serviceDate).split('-').map(Number);
  const cutoff = zonedToUtc(y, m, d, 18, 0, APP_TIMEZONE);
  if (new Date() >= cutoff) {
    return { ok: false, error: 'The 6 PM window has closed; this receipt can no longer be undone.' };
  }

  await prisma.orderItem.update({
    where: { id: orderItemId },
    data: { receivedAt: null, receivedBySystem: false },
  });

  await audit(user.id, 'meal.received.undo', 'OrderItem', orderItemId, {
    serviceDate: toDateKey(item.serviceDate),
  });

  revalidatePath('/menu');
  return { ok: true };
}
