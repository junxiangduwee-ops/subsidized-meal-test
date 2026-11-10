'use server';

import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { landingPathFor } from '@/lib/rbac';

export async function selectCompany(companyId: string): Promise<{ error?: string }> {
  const user = await assertCapability('order:place');

  const company = await prisma.companyInfo.findUnique({
    where: { id: companyId },
  });

  if (!company) {
    return { error: 'Invalid company selection. Please try again.' };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { companyId: company.id },
  });

  redirect(landingPathFor(user.role));
}
