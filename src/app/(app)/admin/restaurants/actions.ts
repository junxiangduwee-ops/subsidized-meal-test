'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { audit } from '@/lib/orders';
import type { ActionState } from '@/components/action-form';

const restaurantSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(120),
  cuisine: z.string().trim().max(60).optional().or(z.literal('')),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  contactName: z.string().trim().max(120).optional().or(z.literal('')),
  contactPhone: z.string().trim().max(40).optional().or(z.literal('')),
  address: z.string().trim().max(300).optional().or(z.literal('')),
});

function blankToNull(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export async function createRestaurant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('catalogue:manage');

  const parsed = restaurantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const clash = await prisma.restaurant.findUnique({ where: { name: d.name } });
  if (clash) return { error: `A restaurant named "${d.name}" already exists.` };

  const created = await prisma.restaurant.create({
    data: {
      name: d.name,
      cuisine: blankToNull(d.cuisine),
      description: blankToNull(d.description),
      contactName: blankToNull(d.contactName),
      contactPhone: blankToNull(d.contactPhone),
      address: blankToNull(d.address),
    },
  });

  await audit(actor.id, 'restaurant.create', 'Restaurant', created.id, { name: created.name });
  revalidatePath('/admin/restaurants');
  return { success: `Added ${created.name}.` };
}

export async function updateRestaurant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('catalogue:manage');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing restaurant id.' };

  const parsed = restaurantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const clash = await prisma.restaurant.findFirst({ where: { name: d.name, NOT: { id } } });
  if (clash) return { error: `Another restaurant is already named "${d.name}".` };

  await prisma.restaurant.update({
    where: { id },
    data: {
      name: d.name,
      cuisine: blankToNull(d.cuisine),
      description: blankToNull(d.description),
      contactName: blankToNull(d.contactName),
      contactPhone: blankToNull(d.contactPhone),
      address: blankToNull(d.address),
    },
  });

  await audit(actor.id, 'restaurant.update', 'Restaurant', id);
  revalidatePath('/admin/restaurants');
  return { success: 'Saved.' };
}

export async function toggleRestaurantActive(formData: FormData): Promise<void> {
  const actor = await assertCapability('catalogue:manage');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const current = await prisma.restaurant.findUnique({ where: { id }, select: { active: true } });
  if (!current) return;

  await prisma.restaurant.update({ where: { id }, data: { active: !current.active } });
  await audit(actor.id, current.active ? 'restaurant.deactivate' : 'restaurant.activate', 'Restaurant', id);
  revalidatePath('/admin/restaurants');
  revalidatePath('/admin/dishes');
}

/**
 * Deleting is only allowed while nothing has ever been ordered from the
 * restaurant - otherwise we deactivate so historical orders stay intact.
 */
export async function deleteRestaurant(formData: FormData): Promise<void> {
  const actor = await assertCapability('catalogue:manage');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const usage = await prisma.orderItem.count({ where: { menuItem: { dish: { restaurantId: id } } } });
  if (usage > 0) {
    await prisma.restaurant.update({ where: { id }, data: { active: false } });
    await audit(actor.id, 'restaurant.deactivate_instead_of_delete', 'Restaurant', id, { orderItems: usage });
  } else {
    await prisma.restaurant.delete({ where: { id } });
    await audit(actor.id, 'restaurant.delete', 'Restaurant', id);
  }

  revalidatePath('/admin/restaurants');
  revalidatePath('/admin/dishes');
}
