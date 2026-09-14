import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { can } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/**
 * Polled by the order page's payment-waiting UI to detect when HitPay's
 * webhook has flipped the order out of AWAITING_PAYMENT, so it can close the
 * checkout popup and refresh without the person needing to do anything.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { reference } = await params;
  const order = await prisma.order.findUnique({
    where: { reference: decodeURIComponent(reference) },
    select: { userId: true, status: true },
  });

  if (!order || (order.userId !== user.id && !can(user.role, 'finance:view'))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ status: order.status }, { headers: { 'Cache-Control': 'no-store' } });
}
