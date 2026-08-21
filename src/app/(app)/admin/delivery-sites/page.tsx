import { getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { PageHeader, Section, EmptyState } from '@/components/ui';
import { InlineSubmit } from '@/components/action-form';
import { Pagination, parsePage } from '@/components/pagination';

import { deleteDeliverySite, toggleDeliverySiteActive } from './actions';
import { AddDeliverySiteButton, EditDeliverySiteDialog } from './site-form';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

export default async function DeliverySitesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireCapability('catalogue:manage');
  const params = await searchParams;
  const t = await getTranslations('deliverySitesAdmin');
  const c = await getTranslations('adminCommon');
  const page = parsePage(params.page);

  const [total, sites] = await Promise.all([
    prisma.deliverySite.count(),
    prisma.deliverySite.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { orders: true } } },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} action={<AddDeliverySiteButton />} />

      <Section title={t('allSites')} description={t('totalCount', { count: total })}>
        {sites.length === 0 ? (
          <EmptyState
            title={t('noSitesYet')}
            hint={t('noSitesHint')}
            action={<AddDeliverySiteButton />}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{c('name')}</th>
                  <th className="num">{t('orders')}</th>
                  <th>{c('status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium text-slate-900">{s.name}</td>
                    <td className="num text-slate-600 text-left">{s._count.orders}</td>
                    <td>
                      <span
                        className={`badge ${
                          s.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {s.active ? c('active') : c('inactive')}
                      </span>
                    </td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        <EditDeliverySiteDialog site={s} />
                        <form action={toggleDeliverySiteActive}>
                          <input type="hidden" name="id" value={s.id} />
                          <InlineSubmit label={s.active ? c('disable') : c('enable')} />
                        </form>
                        <form action={deleteDeliverySite}>
                          <input type="hidden" name="id" value={s.id} />
                          <InlineSubmit
                            label={c('delete')}
                            variant="danger"
                            confirm={t('deleteConfirm', { name: s.name })}
                          />
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <Pagination basePath="/admin/delivery-sites" page={page} pageSize={PAGE_SIZE} total={total} />
          </div>
        )}
      </Section>
    </>
  );
}
