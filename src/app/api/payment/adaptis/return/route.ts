import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * ADAPTIS (eGHL) frontend return handler.
 *
 * eGHL redirects here after payment via MerchantApprovalURL / MerchantUnApprovalURL.
 * Looks up the order by PaymentID and redirects to the order detail page.
 * No auth required — session preserved via same-domain redirect.
 */
export async function POST(req: NextRequest) {
  let fields: Record<string, string>;
  try {
    const text = await req.text();
    fields = Object.fromEntries(new URLSearchParams(text));
  } catch {
    return NextResponse.redirect(new URL('/orders', req.url));
  }

  const { PaymentID, TxnStatus } = fields;
  const from = TxnStatus === '0' ? 'adaptis' : 'adaptis&status=failed';

  if (PaymentID) {
    const payment = await prisma.payment.findFirst({
      where: { requestId: PaymentID },
      select: { order: { select: { reference: true } } },
    });
    const reference = payment?.order.reference;
    if (reference) {
      return NextResponse.redirect(
        new URL(`/orders/${encodeURIComponent(reference)}?from=${from}`, req.url)
      );
    }
  }

  return NextResponse.redirect(new URL('/orders', req.url));
}

// Also handle GET (some gateways redirect with GET)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const PaymentID = searchParams.get('PaymentID') ?? '';
  const TxnStatus = searchParams.get('TxnStatus') ?? '';
  const from = TxnStatus === '0' ? 'adaptis' : 'adaptis&status=failed';

  if (PaymentID) {
    const payment = await prisma.payment.findFirst({
      where: { requestId: PaymentID },
      select: { order: { select: { reference: true } } },
    });
    const reference = payment?.order.reference;
    if (reference) {
      return NextResponse.redirect(
        new URL(`/orders/${encodeURIComponent(reference)}?from=${from}`, req.url)
      );
    }
  }

  return NextResponse.redirect(new URL('/orders', req.url));
}
