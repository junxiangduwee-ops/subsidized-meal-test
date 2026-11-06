/**
 * Cron job: Process queued refunds.
 * Schedule: daily at 20:00 MYT (12:00 UTC).
 *
 * Picks up every order in REFUND_PENDING status and attempts a HitPay refund.
 * Orders that succeed move to REFUNDED. Orders that fail stay in REFUND_PENDING
 * so the next nightly run retries — this continues indefinitely until success.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { processRefund } from '@/lib/refund';

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === 'development';
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pending = await prisma.order.findMany({
    where: { status: 'REFUND_PENDING' },
    select: { id: true, reference: true },
  });

  if (pending.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, succeeded: 0, failed: 0, ranAt: new Date().toISOString() });
  }

  const results = await Promise.allSettled(
    pending.map((order) => processRefund(order.id, null, 'Nightly refund batch')),
  );

  let succeeded = 0;
  let failed = 0;
  const failures: { reference: string; error: string }[] = [];

  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value.ok) {
      succeeded++;
    } else {
      failed++;
      const error =
        result.status === 'rejected'
          ? String(result.reason)
          : !result.value.ok
            ? result.value.error
            : 'Unknown error';
      failures.push({ reference: pending[i].reference, error });
    }
  });

  console.log(`[cron/process-refunds] processed=${pending.length} succeeded=${succeeded} failed=${failed}`, failures.length ? failures : '');

  return NextResponse.json({
    ok: true,
    processed: pending.length,
    succeeded,
    failed,
    failures,
    ranAt: new Date().toISOString(),
  });
}
