import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/session';
import { landingPathFor } from '@/lib/rbac';
import { CompanyPicker } from './company-picker';

export const dynamic = 'force-dynamic';

export default async function SelectCompanyPage() {
  const user = await requireUser();

  // Super-admins and users who already have a company skip this page
  if (user.superAdmin) {
    redirect(landingPathFor(user.role));
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { companyId: true },
  });

  if (dbUser?.companyId) {
    redirect(landingPathFor(user.role));
  }

  const companies = await prisma.companyInfo.findMany({
    include: { entity: true, entitlement: true },
    orderBy: { name: 'asc' },
  });

  const items = companies.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    entityLabel: c.entity.name,
    enabled: c.entitlement?.enabled ?? true,
  }));

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900">Select Your Company</h1>
          <p className="mt-1 text-sm text-slate-500">
            Choose the MR DIY entity you belong to. This determines which account your meal payment goes to.
          </p>
        </div>
        <CompanyPicker companies={items} />
      </div>
    </div>
  );
}
