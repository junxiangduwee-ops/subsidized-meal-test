import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

async function handleReturn(invoice: string, status: string, req: NextRequest) {
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

  return NextResponse.redirect(new URL('/orders', req.url));
}

/** GET — Betterpay redirects with query params */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return handleReturn(
    searchParams.get('invoice') ?? '',
    searchParams.get('status') ?? '',
    req
  );
}

/** POST — Betterpay posts form data to return URL */
export async function POST(req: NextRequest) {
  let invoice = '';
  let status = '';
  try {
    const text = await req.text();
    const fields = Object.fromEntries(new URLSearchParams(text));
    // Betterpay posts: invoice_no, txn_status among others
    invoice = fields.invoice ?? fields.invoice_no ?? '';
    status  = fields.txn_status === '00' ? 'success' : 'failed';
  } catch { /* ignore parse errors */ }

  return handleReturn(invoice, status, req);
}
