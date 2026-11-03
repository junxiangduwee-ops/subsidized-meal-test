/**
 * Cron job: Close ordering for past-deadline cycles.
 * Schedule: daily at 17:00 MYT (09:00 UTC) — runs right after the default
 * Wednesday 17:00 MYT ordering deadline so cycles are closed promptly.
 *
 * Sets MenuCycle.status = CLOSED for any PUBLISHED cycle whose
 * orderCutoffAt has passed, making DB state authoritative for reports
 * and exports instead of relying on runtime filtering.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

  const result = await prisma.menuCycle.updateMany({
    where: {
      status: 'PUBLISHED',
      orderCutoffAt: { lte: now },
    },
    data: { status: 'CLOSED' },
  });

  return NextResponse.json({ ok: true, closed: result.count, ranAt: now.toISOString() });
}
