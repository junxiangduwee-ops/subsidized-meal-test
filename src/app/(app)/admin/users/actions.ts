'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { audit } from '@/lib/orders';
import { hashPassword, validatePasswordStrength } from '@/lib/auth';
import { CACHE_TAGS } from '@/lib/cache';
import type { ActionState } from '@/components/action-form';

const ROLES = ['ADMIN', 'ANALYTICS', 'FINANCE', 'USER'] as const;

const createSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  name: z.string().trim().min(2, 'Enter the person’s name.').max(120),
  staffId: z.string().trim().max(40).optional().or(z.literal('')),
  department: z.string().trim().max(120).optional().or(z.literal('')),
  role: z.enum(ROLES),
  password: z.string().min(1, 'Set a temporary password.'),
});

export async function createUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('users:manage');

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const weak = validatePasswordStrength(d.password);
  if (weak) return { error: weak };

  const email = d.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) {
    return { error: 'An account with that email already exists.' };
  }

  const staffId = d.staffId?.trim() || null;
  if (staffId && (await prisma.user.findUnique({ where: { staffId } }))) {
    return { error: `Staff ID ${staffId} is already assigned to someone else.` };
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: d.name,
      staffId,
      department: d.department?.trim() || null,
      role: d.role,
      passwordHash: await hashPassword(d.password),
      authProvider: 'LOCAL',
    },
  });

  await audit(actor.id, 'user.create', 'User', user.id, { email: user.email, role: user.role });
  revalidatePath('/admin/users');
  revalidateTag(CACHE_TAGS.departments);
  return { success: `Created ${user.name}. Share the temporary password securely — never by email.` };
}

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(2, 'Enter a name.').max(120),
  staffId: z.string().trim().max(40).optional().or(z.literal('')),
  department: z.string().trim().max(120).optional().or(z.literal('')),
  role: z.enum(ROLES),
});

export async function updateUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('users:manage');

  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const target = await prisma.user.findUnique({ where: { id: d.id } });
  if (!target) return { error: 'User not found.' };

  // Don't let the last administrator demote themselves out of the system.
  if (target.role === 'ADMIN' && d.role !== 'ADMIN') {
    const admins = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
    if (admins <= 1) return { error: 'This is the only active administrator. Promote someone else first.' };
  }

  const staffId = d.staffId?.trim() || null;
  if (staffId) {
    const clash = await prisma.user.findFirst({ where: { staffId, NOT: { id: d.id } } });
    if (clash) return { error: `Staff ID ${staffId} is already assigned to someone else.` };
  }

  await prisma.user.update({
    where: { id: d.id },
    data: { name: d.name, staffId, department: d.department?.trim() || null, role: d.role },
  });

  await audit(actor.id, 'user.update', 'User', d.id, { roleFrom: target.role, roleTo: d.role });
  revalidatePath('/admin/users');
  revalidateTag(CACHE_TAGS.departments);
  return { success: 'Saved.' };
}

export async function resetPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('users:manage');

  const id = String(formData.get('id') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!id) return { error: 'Missing user id.' };

  const weak = validatePasswordStrength(password);
  if (weak) return { error: weak };

  await prisma.user.update({
    where: { id },
    data: { passwordHash: await hashPassword(password), authProvider: 'LOCAL' },
  });

  await audit(actor.id, 'user.reset_password', 'User', id);
  revalidatePath('/admin/users');
  return { success: 'Password reset. Share it in person or via your password manager, not over email.' };
}

export async function toggleUserActive(formData: FormData): Promise<void> {
  const actor = await assertCapability('users:manage');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const target = await prisma.user.findUnique({ where: { id }, select: { active: true, role: true } });
  if (!target) return;

  if (target.active && target.role === 'ADMIN') {
    const admins = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
    if (admins <= 1) return; // never lock everyone out
  }

  await prisma.user.update({ where: { id }, data: { active: !target.active } });
  await audit(actor.id, target.active ? 'user.deactivate' : 'user.activate', 'User', id);
  revalidatePath('/admin/users');
}
