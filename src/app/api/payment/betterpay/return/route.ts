import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Betterpay frontend return handler.
 *
 * Betterpay redirects the browser here after payment.
 * This endpoint does NOT require authentication — it just looks up
 * the order by invoice number and redirects to the order detail page.
 *
 * The session cookie is preserved because this is a same-domain redirect
 * (Next.js → Next.js), not a cross-domain redirect (Betterpay → Next.js).
 *
 * Success: GET /api/payment/betterpay/return?invoice=MRD26103025188&status=success
 * Fail:    GET /api/payment/betterpay/return?invoice=MRD26103025188&status=failed
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const invoice = searchParams.get('invoice') ?? '';
  const status = searchParams.get('status') ?? '';

  // Look up the order reference from the payment record
  let orderReference: string | null = null;
  if (invoice) {
    const payment = await prisma.payment.findFirst({
      where: { requestId: invoice },
      select: { order: { select: { reference: true } } },
    });
    orderReference = payment?.order.reference ?? null;
  }

  if (orderReference) {
    const from = status === 'failed' ? 'betterpay&status=failed' : 'betterpay';
    return NextResponse.redirect(
      new URL(`/orders/${encodeURIComponent(orderReference)}?from=${from}`, req.url)
    );
  }

  // Fallback — go to orders list
  return NextResponse.redirect(new URL('/orders', req.url));
}
