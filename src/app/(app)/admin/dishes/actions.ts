'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { put, del } from '@vercel/blob';

import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { encodeTags } from '@/lib/db-compat';
import { audit } from '@/lib/orders';
import { ringgitToSen, assertValidSen, formatSen } from '@/lib/money';
import { CACHE_TAGS } from '@/lib/cache';
import { CODE_MAX_LENGTH, CODE_PATTERN, generateUniqueCode, nextSequentialCode, normalizeCode } from '@/lib/codes';
import type { ActionState } from '@/components/action-form';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

function isBlobUrl(url: string | null | undefined): url is string {
  return !!url && url.startsWith('https://');
}

async function parseImageFile(
  formData: FormData,
): Promise<{ imageUrl: string | null } | { error: string }> {
  const file = formData.get('imageFile');
  if (!(file instanceof File) || file.size === 0) return { imageUrl: null };
  if (file.size > MAX_IMAGE_BYTES)
    return { error: 'Image is too large — please keep it under 2 MB.' };
  const ext = ALLOWED_IMAGE_TYPES[file.type];
  if (!ext) return { error: 'Unsupported image type. Use PNG, JPEG, or WEBP.' };

  try {
    const result = await Promise.race([
      put(`dish-images/${Date.now()}.${ext}`, file, {
        access: 'public',
        token: process.env.PUBLIC_READ_WRITE_TOKEN,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Blob upload timeout after 10s')), 10000),
      ),
    ]);
    return { imageUrl: result.url };
  } catch (err) {
    console.error('[Dish image blob upload failed]', err);
    const buffer = Buffer.from(await file.arrayBuffer());
    return { imageUrl: `data:${file.type};base64,${buffer.toString('base64')}` };
  }
}


const dishSchema = z.object({
  restaurantId: z.string().min(1, 'Choose a restaurant.'),
  code: z
    .string()
    .trim()
    .max(CODE_MAX_LENGTH)
    .regex(CODE_PATTERN, 'Code can only contain letters, numbers, - and _.')
    .optional()
    .or(z.literal('')),
  name: z.string().trim().min(2, 'Dish name must be at least 2 characters.').max(120),
  price: z.string().min(1, 'Enter a price.'),
  category: z.string().trim().max(60).optional().or(z.literal('')),
  description: z.string().trim().max(500).optional().or(z.literal('')),
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

/**
 * Auto-generates the next "D-001"-style code, used when the admin leaves
 * the code field blank. Unique across every dish in the catalogue, not
 * just within its restaurant.
 */
async function autoCode(): Promise<string> {
  const existing = await prisma.dish.findMany({
    where: { code: { not: null } },
    select: { code: true },
  });
  const base = nextSequentialCode('D', existing.map((d) => d.code));
  const isTaken = (code: string) => prisma.dish.findUnique({ where: { code } }).then(Boolean);
  return generateUniqueCode(base, isTaken);
}

export async function createDish(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('catalogue:manage');

  const parsed = dishSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const image = await parseImageFile(formData);
  if ('error' in image) return { error: image.error };

  const price = parsePrice(d.price);
  if ('error' in price) return { error: price.error };

  const clash = await prisma.dish.findFirst({ where: { restaurantId: d.restaurantId, name: d.name } });
  if (clash) return { error: `That restaurant already has a dish called "${d.name}".` };

  const code = normalizeCode(d.code);
  if (code) {
    const codeClash = await prisma.dish.findUnique({ where: { code } });
    if (codeClash) return { error: `A dish with code "${code}" already exists.` };
  }

  const created = await prisma.dish.create({
    data: {
      restaurantId: d.restaurantId,
      code: code ?? (await autoCode()),
      name: d.name,
      priceSen: price.sen,
      category: d.category?.trim() || null,
      description: d.description?.trim() || null,
      imageUrl: image.imageUrl,
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

  const image = await parseImageFile(formData);
  if ('error' in image) return { error: image.error };

  const price = parsePrice(d.price);
  if ('error' in price) return { error: price.error };

  const before = await prisma.dish.findUnique({ where: { id }, select: { priceSen: true, imageUrl: true } });

  const clash = await prisma.dish.findFirst({
    where: { restaurantId: d.restaurantId, name: d.name, NOT: { id } },
  });
  if (clash) return { error: `That restaurant already has a dish called "${d.name}".` };

  const code = normalizeCode(d.code);
  if (code) {
    const codeClash = await prisma.dish.findFirst({ where: { code, NOT: { id } } });
    if (codeClash) return { error: `Another dish already uses code "${code}".` };
  }

  if (image.imageUrl !== null && isBlobUrl(before?.imageUrl))
    await del(before.imageUrl, { token: process.env.PUBLIC_READ_WRITE_TOKEN });

  await prisma.dish.update({
    where: { id },
    data: {
      restaurantId: d.restaurantId,
      code: code ?? (await autoCode()),
      name: d.name,
      priceSen: price.sen,
      category: d.category?.trim() || null,
      description: d.description?.trim() || null,
      imageUrl: image.imageUrl !== null ? image.imageUrl : (before?.imageUrl ?? null),
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
  const dish = await prisma.dish.findUnique({ where: { id }, select: { imageUrl: true } });
  const onMenus = await prisma.menuItem.count({ where: { dishId: id } });
  if (onMenus > 0) {
    await prisma.dish.update({ where: { id }, data: { active: false } });
    await audit(actor.id, 'dish.deactivate_instead_of_delete', 'Dish', id, { menuItems: onMenus });
  } else {
    await prisma.dish.delete({ where: { id } });
    if (isBlobUrl(dish?.imageUrl)) await del(dish.imageUrl, { token: process.env.PUBLIC_READ_WRITE_TOKEN });
    await audit(actor.id, 'dish.delete', 'Dish', id);
  }

  revalidatePath('/admin/dishes');
  revalidateTag(CACHE_TAGS.restaurants);
}
