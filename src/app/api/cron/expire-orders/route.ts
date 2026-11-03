/**
 * Cron job: Expire stale AWAITING_PAYMENT orders.
 * Schedule: every hour — catches abandoned payment sessions promptly
 * without waiting for the daily window.
 *
 * Cancels any Order stuck in AWAITING_PAYMENT for more than 24 hours.
 * This handles users who opened the payment gateway and never returned
 * (closed tab, gateway timeout, network drop, etc.).
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/orders';

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === 'development';
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

const TTL_HOURS = 24;

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - TTL_HOURS * 3_600_000);

  const stale = await prisma.order.findMany({
    where: {
      status: 'AWAITING_PAYMENT',
      createdAt: { lte: cutoff },
    },
    select: { id: true, userId: true, reference: true },
  });

  if (stale.length === 0) {
    return NextResponse.json({ ok: true, expired: 0, ranAt: new Date().toISOString() });
  }

  await prisma.order.updateMany({
    where: { id: { in: stale.map((o) => o.id) } },
    data: { status: 'CANCELLED' },
  });

  await Promise.allSettled(
    stale.map((o) =>
      audit('SYSTEM', 'order.expired', 'Order', o.id, {
        reference: o.reference,
        reason: `AWAITING_PAYMENT for more than ${TTL_HOURS}h`,
      }),
    ),
  );

  return NextResponse.json({ ok: true, expired: stale.length, ranAt: new Date().toISOString() });
}
