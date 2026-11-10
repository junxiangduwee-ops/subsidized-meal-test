'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { encrypt } from '@/lib/encrypt';

export async function toggleEntitlement(companyId: string, enabled: boolean): Promise<void> {
  await assertCapability('settings:manage');

  await prisma.companyEntitlement.upsert({
    where: { companyId },
    update: { enabled },
    create: { companyId, enabled },
  });

  revalidatePath('/admin/companies');
}

export async function upsertCompany(data: {
  id?: string;
  code: string;
  name: string;
  entityId: string;
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
}): Promise<{ error?: string }> {
  await assertCapability('settings:manage');

  const { id, code, name, entityId, bankName, bankAccountName, bankAccountNumber } = data;

  if (!code.trim() || !name.trim() || !entityId.trim()) {
    return { error: 'Code, name, and entity are required.' };
  }

  const entity = await prisma.entity.findUnique({ where: { code: entityId } });
  if (!entity) {
    return { error: 'Invalid entity — select one from the Entities list above.' };
  }

  if (id) {
    await prisma.companyInfo.update({
      where: { id },
      data: {
        code: code.trim(),
        name: name.trim(),
        entityId,
        bankName: bankName?.trim() || null,
        bankAccountName: bankAccountName?.trim() || null,
        bankAccountNumber: bankAccountNumber?.trim() || null,
      },
    });
  } else {
    const created = await prisma.companyInfo.create({
      data: {
        code: code.trim(),
        name: name.trim(),
        entityId,
        bankName: bankName?.trim() || null,
        bankAccountName: bankAccountName?.trim() || null,
        bankAccountNumber: bankAccountNumber?.trim() || null,
      },
    });
    await prisma.companyEntitlement.create({
      data: { companyId: created.id, enabled: true },
    });
  }

  revalidatePath('/admin/companies');
  return {};
}

export async function updateEntity(data: {
  id: string;
  name: string;
  hitpayApiKey?: string;
  hitpaySalt?: string;
}): Promise<{ error?: string }> {
  await assertCapability('settings:manage');

  const name = data.name.trim();
  const apiKey = data.hitpayApiKey?.trim() || null;
  const salt   = data.hitpaySalt?.trim()  || null;

  if (!name) return { error: 'Name is required.' };

  if ((apiKey && !salt) || (!apiKey && salt)) {
    return { error: 'Enter both the API key and the salt, or leave both blank to keep the current credentials.' };
  }

  const updateData: {
    name: string;
    hitpayKeyEncrypted?: string;
    hitpaySaltEncrypted?: string;
  } = { name };

  if (apiKey && salt) {
    try {
      updateData.hitpayKeyEncrypted  = encrypt(apiKey);
      updateData.hitpaySaltEncrypted = encrypt(salt);
    } catch {
      return { error: 'Encryption failed — ensure HITPAY_ENCRYPTION_KEY is set correctly.' };
    }
  }

  await prisma.entity.update({ where: { id: data.id }, data: updateData });
  revalidatePath('/admin/companies');
  return {};
}

export async function addEntity(data: {
  code: string;
  name: string;
  hitpayApiKey?: string;
  hitpaySalt?: string;
}): Promise<{ error?: string }> {
  await assertCapability('settings:manage');

  const code = data.code.trim().toLowerCase();
  const name = data.name.trim();
  const apiKey = data.hitpayApiKey?.trim() || null;
  const salt   = data.hitpaySalt?.trim()  || null;

  if (!code || !name) return { error: 'Code and name are required.' };
  if (!/^[a-z0-9]+$/.test(code)) {
    return { error: 'Code must be lowercase letters and numbers only (no spaces or symbols).' };
  }

  const existing = await prisma.entity.findUnique({ where: { code } });
  if (existing) return { error: `Entity code "${code}" is already in use.` };

  if ((apiKey && !salt) || (!apiKey && salt)) {
    return { error: 'Enter both the API key and the salt, or leave both blank.' };
  }

  let hitpayKeyEncrypted: string | null = null;
  let hitpaySaltEncrypted: string | null = null;
  if (apiKey && salt) {
    try {
      hitpayKeyEncrypted  = encrypt(apiKey);
      hitpaySaltEncrypted = encrypt(salt);
    } catch {
      return { error: 'Encryption failed — ensure HITPAY_ENCRYPTION_KEY is set correctly.' };
    }
  }

  await prisma.entity.create({
    data: { code, name, hitpayKeyEncrypted, hitpaySaltEncrypted },
  });

  revalidatePath('/admin/companies');
  return {};
}
