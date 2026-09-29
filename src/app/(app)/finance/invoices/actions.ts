'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { audit } from '@/lib/orders';
import { kitchenSheet } from '@/lib/reporting';
import type { ActionState } from '@/components/action-form';

const MAX_PDF_BYTES = 5 * 1024 * 1024; // 5 MB

const invoiceSchema = z.object({
  restaurantId:      z.string().min(1, 'Select a restaurant.'),
  cycleId:           z.string().min(1, 'Select a service week.'),
  invoiceNumber:     z.string().trim().min(1, 'Invoice number is required.').max(80),
  invoiceDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date.'),
  invoicedAmountRm:  z.coerce.number().min(0.01, 'Amount must be greater than 0.'),
  note:              z.string().trim().max(500).optional(),
});

/**
 * Calculate the expected total for a restaurant in a cycle from the
 * kitchen order sheet (quantity × unit price, PAID orders only).
 */
async function expectedAmountSen(restaurantId: string, cycleId: string): Promise<number> {
  const items = await prisma.orderItem.findMany({
    where: {
      order: { cycleId, status: 'PAID' },
      menuItem: { dish: { restaurantId } },
    },
    select: { grossSen: true },
  });
  return items.reduce((sum, i) => sum + i.grossSen, 0);
}

export async function uploadInvoice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('menu:plan');

  const parsed = invoiceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  // Duplicate check
  const existing = await prisma.vendorInvoice.findUnique({
    where: {
      restaurantId_cycleId_invoiceNumber: {
        restaurantId: d.restaurantId,
        cycleId: d.cycleId,
        invoiceNumber: d.invoiceNumber,
      },
    },
  });
  if (existing) return { error: `Invoice "${d.invoiceNumber}" for this vendor and week already exists.` };

  // PDF upload (optional)
  let pdfDataUrl: string | null = null;
  const file = formData.get('pdf');
  if (file instanceof File && file.size > 0) {
    if (!file.type.includes('pdf')) return { error: 'Only PDF files are accepted.' };
    if (file.size > MAX_PDF_BYTES) return { error: 'PDF is too large — keep it under 5 MB.' };
    const bytes = Buffer.from(await file.arrayBuffer());
    pdfDataUrl = `data:application/pdf;base64,${bytes.toString('base64')}`;
  }

  // Auto-calculate expected amount and status
  const expected = await expectedAmountSen(d.restaurantId, d.cycleId);
  const invoicedAmountSen = Math.round(d.invoicedAmountRm * 100);
  const discrepancy = invoicedAmountSen - expected;
  const TOLERANCE_SEN = 100; // ±RM 1.00 rounding tolerance
  const status = Math.abs(discrepancy) <= TOLERANCE_SEN ? 'MATCHED' : 'DISCREPANCY';

  const invoice = await prisma.vendorInvoice.create({
    data: {
      restaurantId:      d.restaurantId,
      cycleId:           d.cycleId,
      invoiceNumber:     d.invoiceNumber,
      invoiceDate:       new Date(d.invoiceDate),
      invoicedAmountSen,
      expectedAmountSen: expected,
      discrepancySen:    discrepancy,
      status,
      pdfDataUrl,
      note:              d.note || null,
      uploadedById:      actor.id,
    },
    include: { restaurant: { select: { name: true } } },
  });

  await audit(actor.id, 'invoice.upload', 'VendorInvoice', invoice.id, {
    restaurantName: invoice.restaurant.name,
    invoiceNumber: d.invoiceNumber,
    invoicedAmountSen,
    expectedAmountSen: expected,
    discrepancySen: discrepancy,
    status,
  } as Record<string, unknown>);

  revalidatePath('/finance');
  return { success: `Invoice "${d.invoiceNumber}" uploaded — status: ${status}.` };
}

export async function approveInvoice(formData: FormData): Promise<void> {
  const actor = await assertCapability('menu:plan');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await prisma.vendorInvoice.update({
    where: { id },
    data: { status: 'APPROVED', approvedById: actor.id, approvedAt: new Date() },
  });

  await audit(actor.id, 'invoice.approve', 'VendorInvoice', id);
  revalidatePath('/finance');
}

export async function deleteInvoice(formData: FormData): Promise<void> {
  const actor = await assertCapability('menu:plan');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const inv = await prisma.vendorInvoice.findUnique({
    where: { id },
    select: { invoiceNumber: true, restaurant: { select: { name: true } } },
  });
  if (!inv) return;

  await prisma.vendorInvoice.delete({ where: { id } });
  await audit(actor.id, 'invoice.delete', 'VendorInvoice', id, {
    invoiceNumber: inv.invoiceNumber,
    restaurantName: inv.restaurant.name,
  } as Record<string, unknown>);
  revalidatePath('/finance');
}
