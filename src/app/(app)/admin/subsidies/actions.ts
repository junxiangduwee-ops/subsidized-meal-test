'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { audit } from '@/lib/orders';
import { ringgitToSen } from '@/lib/money';
import { dateOnly } from '@/lib/cycle';
import type { ActionState } from '@/components/action-form';

const schema = z.object({
  name: z.string().trim().min(2, 'Give the rule a name.').max(120),
  type: z.enum(['PERCENTAGE', 'FIXED_PER_ITEM', 'FIXED_PER_DAY']),
  value: z.string().min(1, 'Enter a value.'),
  cap: z.string().optional().or(z.literal('')),
  scope: z.enum(['ALL', 'DEPARTMENT']),
  department: z.string().trim().max(120).optional().or(z.literal('')),
  priority: z.string().optional().or(z.literal('')),
  effectiveFrom: z.string().optional().or(z.literal('')),
  effectiveTo: z.string().optional().or(z.literal('')),
});

type Parsed = z.infer<typeof schema>;

function normalise(d: Parsed):
  | { error: string }
  | {
      data: {
        name: string;
        type: Parsed['type'];
        value: number;
        capSen: number | null;
        scope: Parsed['scope'];
        department: string | null;
        priority: number;
        effectiveFrom: Date | null;
        effectiveTo: Date | null;
      };
    } {
  let value: number;
  if (d.type === 'PERCENTAGE') {
    value = Number.parseInt(d.value, 10);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      return { error: 'Percentage must be a whole number between 1 and 100.' };
    }
  } else {
    value = ringgitToSen(d.value);
    if (!Number.isFinite(value) || value < 1) return { error: 'Amount must be greater than zero.' };
    if (value > 500_00) return { error: 'Amount looks too large (max RM 500).' };
  }

  let capSen: number | null = null;
  if (d.cap?.trim() && d.type !== 'FIXED_PER_DAY') {
    capSen = ringgitToSen(d.cap);
    if (!Number.isFinite(capSen) || capSen < 1) return { error: 'Cap must be greater than zero, or blank.' };
  }

  if (d.scope === 'DEPARTMENT' && !d.department?.trim()) {
    return { error: 'Choose a department for a department-scoped rule.' };
  }

  const priority = d.priority?.trim() ? Number.parseInt(d.priority, 10) : 0;
  if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
    return { error: 'Priority must be a whole number between 0 and 100.' };
  }

  const from = d.effectiveFrom?.trim() ? dateOnly(d.effectiveFrom) : null;
  const to = d.effectiveTo?.trim() ? dateOnly(d.effectiveTo) : null;
  if (from && to && to < from) return { error: 'The end date must be after the start date.' };

  return {
    data: {
      name: d.name,
      type: d.type,
      value,
      capSen,
      scope: d.scope,
      department: d.scope === 'DEPARTMENT' ? d.department!.trim() : null,
      priority,
      effectiveFrom: from,
      effectiveTo: to,
    },
  };
}

export async function createSubsidyRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('subsidy:manage');

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const result = normalise(parsed.data);
  if ('error' in result) return { error: result.error };

  const rule = await prisma.subsidyRule.create({ data: result.data });
  await audit(actor.id, 'subsidy.create', 'SubsidyRule', rule.id, { name: rule.name });

  revalidatePath('/admin/subsidies');
  return { success: `Created "${rule.name}". It applies to carts priced from now on.` };
}

export async function updateSubsidyRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('subsidy:manage');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing rule id.' };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const result = normalise(parsed.data);
  if ('error' in result) return { error: result.error };

  await prisma.subsidyRule.update({ where: { id }, data: result.data });
  await audit(actor.id, 'subsidy.update', 'SubsidyRule', id);

  revalidatePath('/admin/subsidies');
  return { success: 'Saved. Orders already paid keep the subsidy they were charged.' };
}

export async function toggleSubsidyRule(formData: FormData): Promise<void> {
  const actor = await assertCapability('subsidy:manage');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const current = await prisma.subsidyRule.findUnique({ where: { id }, select: { active: true } });
  if (!current) return;

  await prisma.subsidyRule.update({ where: { id }, data: { active: !current.active } });
  await audit(actor.id, current.active ? 'subsidy.deactivate' : 'subsidy.activate', 'SubsidyRule', id);
  revalidatePath('/admin/subsidies');
}

export async function deleteSubsidyRule(formData: FormData): Promise<void> {
  const actor = await assertCapability('subsidy:manage');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await prisma.subsidyRule.delete({ where: { id } });
  await audit(actor.id, 'subsidy.delete', 'SubsidyRule', id);
  revalidatePath('/admin/subsidies');
}
