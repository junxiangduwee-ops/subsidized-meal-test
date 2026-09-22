'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { audit } from '@/lib/orders';
import { dateOnly, toDateKey } from '@/lib/cycle';
import { deliverySiteSheet, receptionSiteRestriction, DELIVERY_PHOTO_MAX_BYTES } from '@/lib/delivery';
import type { ActionState } from '@/components/action-form';

const confirmSchema = z.object({
  cycleId: z.string().min(1),
  deliverySiteId: z.string().min(1),
  serviceDate: z.string().min(1),
  note: z
    .string()
    .trim()
    .max(500, 'Keep the note under 500 characters.')
    .optional()
    .or(z.literal('')),
});

/**
 * Records that a delivery site's food for one service day has arrived.
 *
 * A photo is optional and never blocks this: reception may not have a
 * camera handy, the file may be too large, or the connection may be poor.
 * Whether or not a photo is attached, clicking through here is what marks
 * the day "fulfilled" - the photo is supporting evidence layered on top,
 * not a requirement (see DeliveryConfirmation in schema.prisma).
 */
export async function confirmDelivery(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('delivery:confirm');

  const parsed = confirmSchema.safeParse({
    cycleId: formData.get('cycleId'),
    deliverySiteId: formData.get('deliverySiteId'),
    serviceDate: formData.get('serviceDate'),
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { cycleId, deliverySiteId, serviceDate, note } = parsed.data;

  // A reception account confined to one site cannot confirm - or even
  // probe the existence of - another site's delivery, regardless of what
  // the submitted form claims. This must be checked here, not just hidden
  // in the UI, since a form field is trivially editable client-side.
  const restriction = await receptionSiteRestriction(actor.id);
  if (restriction && restriction.id !== deliverySiteId) {
    return { error: `You can only confirm deliveries for ${restriction.name}.` };
  }

  let photoDataUrl: string | undefined;
  const photo = formData.get('photo');
  if (photo instanceof File && photo.size > 0) {
    if (!photo.type.startsWith('image/')) {
      return {
        error:
          'That file is not an image, so it was not attached. You can still mark this delivery as received without a photo - just submit again.',
      };
    }
    if (photo.size > DELIVERY_PHOTO_MAX_BYTES) {
      const maxMb = (DELIVERY_PHOTO_MAX_BYTES / (1024 * 1024)).toFixed(0);
      return {
        error: `That photo is larger than ${maxMb}MB, so it was not attached. You can still mark this delivery as received without a photo - just submit again.`,
      };
    }
    const buffer = Buffer.from(await photo.arrayBuffer());
    photoDataUrl = `data:${photo.type};base64,${buffer.toString('base64')}`;
  }

  // Snapshot what was expected at the moment of confirmation, so a later
  // cancelled/refunded order can't quietly rewrite what reception attested
  // to on the day.
  const sheet = await deliverySiteSheet(cycleId);
  const match = sheet.find(
    (r) => r.deliverySiteId === deliverySiteId && toDateKey(r.serviceDate) === serviceDate,
  );

  const confirmation = await prisma.deliveryConfirmation.upsert({
    where: {
      cycleId_deliverySiteId_serviceDate: {
        cycleId,
        deliverySiteId,
        serviceDate: dateOnly(serviceDate),
      },
    },
    update: {
      receivedAt: new Date(),
      receivedById: actor.id,
      ...(photoDataUrl ? { photoDataUrl } : {}),
      note: note || null,
      expectedMeals: match?.mealCount ?? 0,
      expectedOrders: match?.orderCount ?? 0,
    },
    create: {
      cycleId,
      deliverySiteId,
      serviceDate: dateOnly(serviceDate),
      receivedAt: new Date(),
      receivedById: actor.id,
      photoDataUrl,
      note: note || null,
      expectedMeals: match?.mealCount ?? 0,
      expectedOrders: match?.orderCount ?? 0,
    },
  });

  await audit(actor.id, 'delivery.confirm', 'DeliveryConfirmation', confirmation.id, {
    deliverySiteId,
    serviceDate,
    hasPhoto: Boolean(photoDataUrl),
  });

  revalidatePath('/reception');
  return { success: photoDataUrl ? 'Marked as received, with photo attached.' : 'Marked as received.' };
}

/** Reverses a confirmation made in error - the site goes back to "pending". */
export async function unmarkDelivery(formData: FormData): Promise<void> {
  const actor = await assertCapability('delivery:confirm');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const existing = await prisma.deliveryConfirmation.findUnique({ where: { id } });
  if (!existing) return;

  const restriction = await receptionSiteRestriction(actor.id);
  if (restriction && restriction.id !== existing.deliverySiteId) return;

  await prisma.deliveryConfirmation.delete({ where: { id } });

  await audit(actor.id, 'delivery.unconfirm', 'DeliveryConfirmation', id, {
    deliverySiteId: existing.deliverySiteId,
    serviceDate: toDateKey(existing.serviceDate),
  });

  revalidatePath('/reception');
}
