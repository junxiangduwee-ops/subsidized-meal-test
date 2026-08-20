'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { audit } from '@/lib/orders';
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
  return { success: 'Saved.' };
}

export async function toggleDeliverySiteActive(formData: FormData): Promise<void> {
  const actor = await assertCapability('catalogue:manage');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const current = await prisma.deliverySite.findUnique({ where: { id }, select: { active: true } });
  if (!current) return;

  await prisma.deliverySite.update({ where: { id }, data: { active: !current.active } });
  await audit(
    actor.id,
    current.active ? 'delivery_site.deactivate' : 'delivery_site.activate',
    'DeliverySite',
    id,
  );
  revalidatePath('/admin/delivery-sites');
  revalidatePath('/menu');
}

/**
 * Deleting is only allowed while nothing has ever been ordered to this site -
 * otherwise we deactivate so historical orders keep an intact reference.
 */
export async function deleteDeliverySite(formData: FormData): Promise<void> {
  const actor = await assertCapability('catalogue:manage');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const usage = await prisma.order.count({ where: { deliverySiteId: id } });
  if (usage > 0) {
    await prisma.deliverySite.update({ where: { id }, data: { active: false } });
    await audit(actor.id, 'delivery_site.deactivate_instead_of_delete', 'DeliverySite', id, {
      orders: usage,
    });
  } else {
    await prisma.deliverySite.delete({ where: { id } });
    await audit(actor.id, 'delivery_site.delete', 'DeliverySite', id);
  }

  revalidatePath('/admin/delivery-sites');
  revalidatePath('/menu');
}
