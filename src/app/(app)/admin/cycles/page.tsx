import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { formatSen } from '@/lib/money';
import {
  cyclePhase,
  formatDateTime,
  formatWeekRange,
  nextPlannableWeekStart,
  toDateKey,
} from '@/lib/cycle';
import { PageHeader, Section, EmptyState, PhaseBadge, Alert } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { Pagination, parsePage, parsePageSize } from '@/components/pagination';

import { createCycle } from './actions';

export const dynamic = 'force-dynamic';

const DEFAULT_PAGE_SIZE = 15;

export default async function CyclesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string; }>;
}) {
  await requireCapability('menu:plan');
  const params = await searchParams;
  const t = await getTranslations('cyclesAdmin');
  const locale = await getLocale();
  const page = parsePage(params.page);
  const pageSize = parsePageSize(params.pageSize, DEFAULT_PAGE_SIZE);

  const [total, cycles] = await Promise.all([
    prisma.menuCycle.count(),
    prisma.menuCycle.findMany({
      orderBy: { serviceWeekStart: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        days: { include: { _count: { select: { items: true } } } },
        _count: { select: { orders: true } },
      },
    }),
  ]);

  const suggested = nextPlannableWeekStart();
  const suggestedKey = toDateKey(suggested);
  const alreadyPlanned = cycles.some(
    (c) => toDateKey(c.serviceWeekStart) === suggestedKey && c.status !== 'CANCELLED',
  );

  const paidTotals = await prisma.order.groupBy({
    by: ['cycleId'],
    where: { status: 'PAID' },
    _sum: { netSen: true, subsidySen: true },
    _count: { _all: true },
  });
  const paidByCycle = new Map(paidTotals.map((t) => [t.cycleId, t]));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {!alreadyPlanned ? (
        <div className="mb-6">
          <Alert tone="warning">{t('noMenuYetWarning', { week: formatWeekRange(suggested, locale) })}</Alert>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Section title={t('cycles')} description={t('cyclesDescription')}>
          {cycles.length === 0 ? (
            <EmptyState title={t('noCyclesYet')} hint={t('noCyclesHint')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('serviceWeek')}</th>
                    <th className="!text-center">{t('status')}</th>
                    <th className="num">{t('dishes')}</th>
                    <th className="num">{t('paidOrders')}</th>
                    <th className="num">{t('staffPays')}</th>
                    <th className="num">{t('companyPays')}</th>
                    <th>{t('cutoff')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {cycles.map((c) => {
                    const phase = cyclePhase(c);
                    const items = c.days.reduce((n, d) => n + d._count.items, 0);
                    const totals = paidByCycle.get(c.id);
                    return (
                      <tr key={c.id}>
                        <td>
                          <Link
                            href={`/admin/cycles/${c.id}`}
                            className="font-medium text-slate-900 hover:text-brand-700"
                          >
                            {formatWeekRange(c.serviceWeekStart, locale)}
                          </Link>
                          {c.title ? <div className="text-xs text-slate-500">{c.title}</div> : null}
                        </td>
                        <td className="text-center">
                          <PhaseBadge phase={phase} />
                        </td>
                        <td className="num text-slate-600 text-left">{items}</td>
                        <td className="num text-slate-600 text-left">{totals?._count._all ?? 0}</td>
                        <td className="num text-slate-900 text-left">{formatSen(totals?._sum.netSen ?? 0)}</td>
                        <td className="num text-emerald-700 text-left">{formatSen(totals?._sum.subsidySen ?? 0)}</td>
                        <td className="text-xs text-slate-500">{formatDateTime(c.orderCutoffAt, locale)}</td>
                        <td>
                          <div className="flex justify-end">
                            <Link href={`/admin/cycles/${c.id}`} className="btn-secondary btn-sm whitespace-nowrap">
                              {t('open')}
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <Pagination basePath="/admin/cycles" page={page} pageSize={pageSize} total={total} />
            </div>
          )}
        </Section>

        <Section title={t('planNewWeek')}>
          <div className="p-5">
            <ActionForm action={createCycle} submitLabel={t('createDraft')} className="space-y-3">
              <div>
                <label className="label" htmlFor="weekOf">
                  {t('serviceWeekLabel')}
                </label>
                <input
                  id="weekOf"
                  name="weekOf"
                  type="date"
                  required
                  defaultValue={suggestedKey}
                  className="input"
                />
                <p className="mt-1 text-xs text-slate-500">{t('serviceWeekHint')}</p>
              </div>
              <div>
                <label className="label" htmlFor="title">
                  {t('titleOptional')}
                </label>
                <input id="title" name="title" className="input" placeholder={t('titlePlaceholder')} />
              </div>
            </ActionForm>

            <div className="mt-5 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
              <p className="mb-1 font-semibold text-slate-700">{t('howScheduleWorks')}</p>
              <p>{t('scheduleExplainer', { cutoff: t('wednesdayCutoff') })}</p>
            </div>
          </div>
        </Section>
      </div>
    </>
  );
}
