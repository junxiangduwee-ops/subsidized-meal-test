'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { audit } from '@/lib/orders';
import { CACHE_TAGS } from '@/lib/cache';
import type { ActionState } from '@/components/action-form';

const siteSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(120),
});

export async function createDeliverySite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('catalogue:manage');

  const parsed = siteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name } = parsed.data;

  const clash = await prisma.deliverySite.findUnique({ where: { name } });
  if (clash) return { error: `A delivery site named "${name}" already exists.` };

  const created = await prisma.deliverySite.create({ data: { name } });

  await audit(actor.id, 'delivery_site.create', 'DeliverySite', created.id, { name: created.name });
  revalidatePath('/admin/delivery-sites');
  revalidateTag(CACHE_TAGS.deliverySites);
  return { success: `Added ${created.name}.` };
}

export async function updateDeliverySite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('catalogue:manage');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing delivery site id.' };

  const parsed = siteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name } = parsed.data;

  const clash = await prisma.deliverySite.findFirst({ where: { name, NOT: { id } } });
  if (clash) return { error: `Another delivery site is already named "${name}".` };

  await prisma.deliverySite.update({ where: { id }, data: { name } });

  await audit(actor.id, 'delivery_site.update', 'DeliverySite', id);
  revalidatePath('/admin/delivery-sites');
  revalidateTag(CACHE_TAGS.deliverySites);
  return { success: 'Saved.' };
}

export async function toggleDeliverySiteActive(formData: FormData): Promise<void> {
  const actor = await assertCapability('catalogue:manage');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const current = await prisma.deliverySite.findUnique({ where: { id }, select: { active: true } });
  if (!current) return;

  await prisma.deliverySite.update({ where: { id }, data: { active: !current.active } });

  // Turning a site OFF: nobody's default (admin-pinned or self-learned)
  // should keep quietly pointing at a site that's no longer selectable -
  // clear it back to null/unlocked, same as when a site is deleted outright
  // (see deleteDeliverySite). It's just a convenience preference, not an
  // audit/financial record like an Order, so there's nothing to preserve -
  // whoever it was gets prompted to pick a site next time they order.
  let clearedDefaults = 0;
  if (current.active) {
    const cleared = await prisma.user.updateMany({
      where: { defaultDeliverySiteId: id },
      data: { defaultDeliverySiteId: null, defaultDeliverySiteLocked: false },
    });
    clearedDefaults = cleared.count;
  }

  await audit(
    actor.id,
    current.active ? 'delivery_site.deactivate' : 'delivery_site.activate',
    'DeliverySite',
    id,
    current.active ? { usersDefaultCleared: clearedDefaults } : undefined,
  );
  revalidatePath('/admin/delivery-sites');
  revalidatePath('/menu');
  revalidatePath('/admin/users');
  revalidateTag(CACHE_TAGS.deliverySites);
}

/**
 * Deleting is only allowed while nothing has ever been ordered to this site -
 * otherwise we deactivate so historical orders keep an intact reference.
 * Someone's default pointing here is NOT a reason to block the delete: it's
 * just a convenience preference (see User.defaultDeliverySiteId), not a
 * record anything depends on, so it simply reverts to null/unlocked as part
 * of the same delete - they pick a site next time they order, exactly like
 * a first-time employee would.
 */
export async function deleteDeliverySite(formData: FormData): Promise<void> {
  const actor = await assertCapability('catalogue:manage');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const orderUsage = await prisma.order.count({ where: { deliverySiteId: id } });
  if (orderUsage > 0) {
    await prisma.deliverySite.update({ where: { id }, data: { active: false } });
    await audit(actor.id, 'delivery_site.deactivate_instead_of_delete', 'DeliverySite', id, {
      orders: orderUsage,
    });
  } else {
    const [{ count: usersDefaultCleared }] = await prisma.$transaction([
      prisma.user.updateMany({
        where: { defaultDeliverySiteId: id },
        data: { defaultDeliverySiteId: null, defaultDeliverySiteLocked: false },
      }),
      prisma.deliverySite.delete({ where: { id } }),
    ]);
    await audit(actor.id, 'delivery_site.delete', 'DeliverySite', id, { usersDefaultCleared });
  }

  revalidatePath('/admin/delivery-sites');
  revalidatePath('/menu');
  revalidatePath('/admin/users');
  revalidateTag(CACHE_TAGS.deliverySites);
}
