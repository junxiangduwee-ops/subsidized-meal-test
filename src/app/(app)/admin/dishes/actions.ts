'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { encodeTags } from '@/lib/db-compat';
import { audit } from '@/lib/orders';
import { ringgitToSen, assertValidSen, formatSen } from '@/lib/money';
import { CACHE_TAGS } from '@/lib/cache';
import type { ActionState } from '@/components/action-form';

const dishSchema = z.object({
  restaurantId: z.string().min(1, 'Choose a restaurant.'),
  name: z.string().trim().min(2, 'Dish name must be at least 2 characters.').max(120),
  price: z.string().min(1, 'Enter a price.'),
  category: z.string().trim().max(60).optional().or(z.literal('')),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  imageUrl: z.string().trim().url('Image URL must be a valid URL.').optional().or(z.literal('')),
  tags: z.string().trim().max(200).optional().or(z.literal('')),
});

function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
}

function parsePrice(raw: string): { sen: number } | { error: string } {
  const sen = ringgitToSen(raw);
  if (!Number.isFinite(sen)) return { error: 'Price must be a number, e.g. 12.50' };
  try {
    assertValidSen(sen, 'price');
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (sen === 0) return { error: 'Price must be greater than zero.' };
  return { sen };
}

export async function createDish(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('catalogue:manage');

  const parsed = dishSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const price = parsePrice(d.price);
  if ('error' in price) return { error: price.error };

  const clash = await prisma.dish.findFirst({ where: { restaurantId: d.restaurantId, name: d.name } });
  if (clash) return { error: `That restaurant already has a dish called "${d.name}".` };

  const created = await prisma.dish.create({
    data: {
      restaurantId: d.restaurantId,
      name: d.name,
      priceSen: price.sen,
      category: d.category?.trim() || null,
      description: d.description?.trim() || null,
      imageUrl: d.imageUrl?.trim() || null,
      tags: encodeTags(parseTags(d.tags)),
    },
  });

  await audit(actor.id, 'dish.create', 'Dish', created.id, { name: created.name, priceSen: created.priceSen });
  revalidatePath('/admin/dishes');
  revalidateTag(CACHE_TAGS.restaurants);
  return { success: `Added ${created.name} at ${formatSen(created.priceSen)}.` };
}

export async function updateDish(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('catalogue:manage');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing dish id.' };

  const parsed = dishSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const price = parsePrice(d.price);
  if ('error' in price) return { error: price.error };

  const before = await prisma.dish.findUnique({ where: { id }, select: { priceSen: true } });

  const clash = await prisma.dish.findFirst({
    where: { restaurantId: d.restaurantId, name: d.name, NOT: { id } },
  });
  if (clash) return { error: `That restaurant already has a dish called "${d.name}".` };

  await prisma.dish.update({
    where: { id },
    data: {
      restaurantId: d.restaurantId,
      name: d.name,
      priceSen: price.sen,
      category: d.category?.trim() || null,
      description: d.description?.trim() || null,
      imageUrl: d.imageUrl?.trim() || null,
      tags: encodeTags(parseTags(d.tags)),
    },
  });

  await audit(actor.id, 'dish.update', 'Dish', id, {
    priceFrom: before?.priceSen ?? null,
    priceTo: price.sen,
  });

  revalidatePath('/admin/dishes');
  return {
    success:
      before && before.priceSen !== price.sen
        ? `Saved. New price ${formatSen(price.sen)} applies to menus created from now on; published menus keep their original price.`
        : 'Saved.',
  };
}

export async function toggleDishActive(formData: FormData): Promise<void> {
  const actor = await assertCapability('catalogue:manage');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const current = await prisma.dish.findUnique({ where: { id }, select: { active: true } });
  if (!current) return;

  await prisma.dish.update({ where: { id }, data: { active: !current.active } });
  await audit(actor.id, current.active ? 'dish.deactivate' : 'dish.activate', 'Dish', id);
  revalidatePath('/admin/dishes');
}

export async function deleteDish(formData: FormData): Promise<void> {
  const actor = await assertCapability('catalogue:manage');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  // A dish that has ever appeared on a menu is deactivated, not deleted -
  // MenuItem.dish uses onDelete: Restrict to protect order history.
  const onMenus = await prisma.menuItem.count({ where: { dishId: id } });
  if (onMenus > 0) {
    await prisma.dish.update({ where: { id }, data: { active: false } });
    await audit(actor.id, 'dish.deactivate_instead_of_delete', 'Dish', id, { menuItems: onMenus });
  } else {
    await prisma.dish.delete({ where: { id } });
    await audit(actor.id, 'dish.delete', 'Dish', id);
  }

  revalidatePath('/admin/dishes');
  revalidateTag(CACHE_TAGS.restaurants);
}
