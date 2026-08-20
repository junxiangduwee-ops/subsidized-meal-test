import { getLocale, getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { describeRule } from '@/lib/subsidy';
import { formatDate, toDateKey } from '@/lib/cycle';
import { PageHeader, Section, EmptyState, Alert } from '@/components/ui';
import { InlineSubmit } from '@/components/action-form';

import { deleteSubsidyRule, toggleSubsidyRule } from './actions';
import { AddRuleButton, EditRuleDialog } from './rule-form';

export const dynamic = 'force-dynamic';

export default async function SubsidiesPage() {
  await requireCapability('subsidy:manage');
  const t = await getTranslations('subsidiesAdmin');
  const c = await getTranslations('adminCommon');
  const locale = await getLocale();

  const TYPE_LABEL = {
    PERCENTAGE: t('typePercentage'),
    FIXED_PER_ITEM: t('typePerItem'),
    FIXED_PER_DAY: t('typeDailyCap'),
  } as const;

  const rules = await prisma.subsidyRule.findMany({
    orderBy: [{ active: 'desc' }, { priority: 'desc' }, { name: 'asc' }],
  });

  const departmentRows = await prisma.user.findMany({
    where: { department: { not: null } },
    distinct: ['department'],
    select: { department: true },
    orderBy: { department: 'asc' },
  });
  const departments = departmentRows.map((r) => r.department!).filter(Boolean);

  const activeCount = rules.filter((r) => r.active).length;

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} action={<AddRuleButton departments={departments} />} />

      {activeCount === 0 ? (
        <div className="mb-6">
          <Alert tone="warning">{t('noActiveRules')}</Alert>
        </div>
      ) : null}

      <Section title={t('rules')} description={t('activeOfTotal', { active: activeCount, total: rules.length })}>
          {rules.length === 0 ? (
          <EmptyState
            title={t('noRules')}
            hint={t('noRulesHint')}
            action={<AddRuleButton departments={departments} />}
          />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('rule')}</th>
                    <th>{t('type')}</th>
                    <th>{t('benefit')}</th>
                    <th>{t('appliesTo')}</th>
                    <th className="num">{t('priority')}</th>
                    <th>{t('window')}</th>
                    <th>{c('status')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium text-slate-900">{r.name}</td>
                      <td className="text-slate-600">{TYPE_LABEL[r.type]}</td>
                      <td className="text-slate-900">{describeRule(r)}</td>
                      <td className="text-slate-600">
                        {r.scope === 'ALL' ? t('everyone') : (r.department ?? '—')}
                      </td>
                      <td className="num text-slate-600 text-left">{r.priority}</td>
                      <td className="text-xs text-slate-500">
                        {r.effectiveFrom || r.effectiveTo
                          ? `${r.effectiveFrom ? formatDate(r.effectiveFrom, 'long', locale) : t('windowAny')} → ${
                              r.effectiveTo ? formatDate(r.effectiveTo, 'long', locale) : t('windowOpen')
                            }`
                          : t('windowAlways')}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            r.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {r.active ? c('active') : c('inactive')}
                        </span>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          <EditRuleDialog
                            rule={{
                              id: r.id,
                              name: r.name,
                              type: r.type,
                              value: r.value,
                              capSen: r.capSen,
                              scope: r.scope,
                              department: r.department,
                              priority: r.priority,
                              effectiveFrom: r.effectiveFrom ? toDateKey(r.effectiveFrom) : null,
                              effectiveTo: r.effectiveTo ? toDateKey(r.effectiveTo) : null,
                            }}
                            departments={departments}
                          />
                          <form action={toggleSubsidyRule}>
                            <input type="hidden" name="id" value={r.id} />
                            <InlineSubmit label={r.active ? c('disable') : c('enable')} />
                          </form>
                          <form action={deleteSubsidyRule}>
                            <input type="hidden" name="id" value={r.id} />
                            <InlineSubmit
                              label={c('delete')}
                              variant="danger"
                              confirm={t('deleteConfirm', { name: r.name })}
                            />
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

    </>
  );
}
