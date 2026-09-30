'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { audit } from '@/lib/orders';
import type { ActionState } from '@/components/action-form';

// ── File validation ──────────────────────────────────────────────────────────

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png':       '.png',
  'image/jpeg':      '.jpg',
  'image/webp':      '.webp',
};

// ── Upload invoice ───────────────────────────────────────────────────────────

const uploadSchema = z.object({
  restaurantId:  z.string().min(1, 'Restaurant is required.'),
  cycleId:       z.string().min(1, 'Service week is required.'),
  invoiceNumber: z.string().trim().max(80).optional().or(z.literal('')),
  invoiceDate:   z.string().optional().or(z.literal('')),
  amountSen: z
    .string()
    .min(1, 'Amount is required.')
    .transform((v) => Math.round(parseFloat(v) * 100))
    .refine((v) => Number.isFinite(v) && v > 0, 'Amount must be a positive number.'),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});

export async function uploadInvoice(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await assertCapability('catalogue:manage');

  const parsed = uploadSchema.safeParse({
    restaurantId:  formData.get('restaurantId'),
    cycleId:       formData.get('cycleId'),
    invoiceNumber: formData.get('invoiceNumber'),
    invoiceDate:   formData.get('invoiceDate'),
    amountSen:     formData.get('amountSen'),
    notes:         formData.get('notes'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const [restaurant, cycle] = await Promise.all([
    prisma.restaurant.findUnique({ where: { id: d.restaurantId }, select: { name: true } }),
    prisma.menuCycle.findUnique({ where: { id: d.cycleId }, select: { serviceWeekStart: true } }),
  ]);
  if (!restaurant) return { error: 'Restaurant not found.' };
  if (!cycle)      return { error: 'Service week not found.' };

  if (d.invoiceNumber) {
    const clash = await prisma.vendorInvoice.findFirst({
      where: { restaurantId: d.restaurantId, cycleId: d.cycleId, invoiceNumber: d.invoiceNumber },
    });
    if (clash)
      return { error: `Invoice "${d.invoiceNumber}" already exists for ${restaurant.name} this week.` };
  }

  // ── Convert file to base64 data URL (same as reception photo) ───────────
  let fileUrl:  string | null = null;
  let fileName: string | null = null;

  const file = formData.get('invoiceFile');
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES)
      return { error: 'File is too large — please keep it under 10 MB.' };
    if (!ALLOWED_TYPES[file.type])
      return { error: 'Unsupported file type. Use PDF, PNG, JPEG, or WEBP.' };

    const buffer = Buffer.from(await file.arrayBuffer());
    fileUrl  = `data:${file.type};base64,${buffer.toString('base64')}`;
    fileName = file.name;
  }

  const invoice = await prisma.vendorInvoice.create({
    data: {
      restaurantId:  d.restaurantId,
      cycleId:       d.cycleId,
      invoiceNumber: d.invoiceNumber || null,
      invoiceDate:   d.invoiceDate ? new Date(d.invoiceDate) : null,
      amountSen:     d.amountSen,
      notes:         d.notes || null,
      fileUrl,
      fileName,
      uploadedById:  actor.id,
      status:        'PENDING',
    },
  });

  await audit(actor.id, 'invoice.upload', 'VendorInvoice', invoice.id, {
    restaurantName: restaurant.name,
    invoiceNumber:  d.invoiceNumber,
    amountSen:      d.amountSen,
    hasFile:        !!fileUrl,
  });

  revalidatePath('/admin/invoices');
  revalidatePath('/finance');
  return { success: `Invoice uploaded for ${restaurant.name}.` };
}

// ── Review / update status ───────────────────────────────────────────────────

const reviewSchema = z.object({
  id:            z.string().min(1),
  status:        z.enum(['PENDING', 'APPROVED', 'PAID', 'DISPUTED']),
  reviewNote:    z.string().trim().max(500).optional().or(z.literal('')),
  invoiceNumber: z.string().trim().max(80).optional().or(z.literal('')),
  invoiceDate:   z.string().optional().or(z.literal('')),
  amountSen: z
    .string()
    .min(1, 'Amount is required.')
    .transform((v) => Math.round(parseFloat(v) * 100))
    .refine((v) => Number.isFinite(v) && v > 0, 'Amount must be a positive number.'),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});

export async function reviewInvoice(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await assertCapability('catalogue:manage');

  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const existing = await prisma.vendorInvoice.findUnique({
    where: { id: d.id },
    select: { status: true, fileUrl: true, restaurant: { select: { name: true } } },
  });
  if (!existing) return { error: 'Invoice not found.' };

  // Optional file replacement — also base64
  let fileUrl  = existing.fileUrl;
  let fileName: string | undefined;

  const file = formData.get('invoiceFile');
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES)
      return { error: 'File is too large — please keep it under 10 MB.' };
    if (!ALLOWED_TYPES[file.type])
      return { error: 'Unsupported file type. Use PDF, PNG, JPEG, or WEBP.' };

    const buffer = Buffer.from(await file.arrayBuffer());
    fileUrl  = `data:${file.type};base64,${buffer.toString('base64')}`;
    fileName = file.name;
  }

  await prisma.vendorInvoice.update({
    where: { id: d.id },
    data: {
      status:        d.status,
      reviewNote:    d.reviewNote || null,
      reviewedById:  actor.id,
      reviewedAt:    new Date(),
      invoiceNumber: d.invoiceNumber || null,
      invoiceDate:   d.invoiceDate ? new Date(d.invoiceDate) : null,
      amountSen:     d.amountSen,
      notes:         d.notes || null,
      ...(fileUrl !== existing.fileUrl ? { fileUrl, fileName: fileName ?? null } : {}),
    },
  });

  await audit(actor.id, 'invoice.review', 'VendorInvoice', d.id, {
    restaurantName: existing.restaurant.name,
    fromStatus:     existing.status,
    toStatus:       d.status,
  });

  revalidatePath('/admin/invoices');
  revalidatePath('/finance');
  return { success: `Invoice updated to ${d.status}.` };
}

// ── Delete invoice ───────────────────────────────────────────────────────────

export async function deleteInvoice(formData: FormData): Promise<void> {
  const actor = await assertCapability('catalogue:manage');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const inv = await prisma.vendorInvoice.findUnique({
    where: { id },
    select: { restaurant: { select: { name: true } }, invoiceNumber: true },
  });
  if (!inv) return;

  // No disk file to clean up — base64 is stored in the DB row
  await prisma.vendorInvoice.delete({ where: { id } });
  await audit(actor.id, 'invoice.delete', 'VendorInvoice', id, {
    restaurantName: inv.restaurant.name,
    invoiceNumber:  inv.invoiceNumber,
  });

  revalidatePath('/admin/invoices');
  revalidatePath('/finance');
}
