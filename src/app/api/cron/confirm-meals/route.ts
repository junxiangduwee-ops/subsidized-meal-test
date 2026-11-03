/**
 * Cron job: Auto-confirm past meals.
 * Schedule: daily at 18:00 MYT (10:00 UTC) — matches the admin-configured
 * meal receipt cutoff hour (default 18:00).
 *
 * Marks all PAID OrderItems as received once the cutoff hour has passed.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { todayInAppTz, toDateKey, zonedToUtc, APP_TIMEZONE } from '@/lib/cycle';
import { getSiteSettings } from '@/lib/settings';

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === 'development';
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const { mealReceiptCutoffHour } = await getSiteSettings();

  const today = todayInAppTz(now);
  const todayKey = toDateKey(today);
  const [y, m, d] = todayKey.split('-').map(Number);
  const cutoffUtc = zonedToUtc(y, m, d, mealReceiptCutoffHour, 0, APP_TIMEZONE);
  const serviceDateFilter = now >= cutoffUtc ? { lte: today } : { lt: today };

  const result = await prisma.orderItem.updateMany({
    where: {
      receivedAt: null,
      serviceDate: serviceDateFilter,
      order: { status: 'PAID' },
    },
    data: { receivedAt: now, receivedBySystem: true },
  });

  return NextResponse.json({ ok: true, confirmed: result.count, ranAt: now.toISOString() });
}
