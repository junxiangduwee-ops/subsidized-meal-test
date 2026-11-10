import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { PageHeader } from '@/components/ui';
import { isEntityConfigured } from '@/lib/entity-config';
import { CompaniesTable } from './companies-table';

export const dynamic = 'force-dynamic';

export default async function CompaniesPage() {
  await requireCapability('settings:manage');

  const [companies, entities] = await Promise.all([
    prisma.companyInfo.findMany({
      include: { entitlement: true, entity: true },
      orderBy: { name: 'asc' },
    }),
    prisma.entity.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { companies: true } } },
    }),
  ]);

  const companyRows = companies.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    entityId: c.entityId,
    entityName: c.entity.name,
    enabled: c.entitlement?.enabled ?? true,
    bankName: c.bankName,
    bankAccountName: c.bankAccountName,
    bankAccountNumber: c.bankAccountNumber,
  }));

  const entityRows = entities.map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name,
    configured: isEntityConfigured(e.code, !!(e.hitpayKeyEncrypted && e.hitpaySaltEncrypted)),
    companyCount: e._count.companies,
  }));

  return (
    <>
      <PageHeader
        title="Companies & Entities"
        subtitle={`${companies.length} ${companies.length === 1 ? 'company' : 'companies'}, ${entities.length} ${entities.length === 1 ? 'entity' : 'entities'}`}
      />
      <CompaniesTable companyRows={companyRows} entityRows={entityRows} />
    </>
  );
}
