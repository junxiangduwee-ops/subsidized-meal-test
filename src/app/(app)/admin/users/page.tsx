import { getLocale, getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { containsInsensitive } from '@/lib/db-compat';
import { ROLE_LABEL } from '@/lib/rbac';
import { formatDateTime } from '@/lib/cycle';
import { PageHeader, Section, EmptyState, Alert } from '@/components/ui';
import { InlineSubmit } from '@/components/action-form';

import { toggleUserActive } from './actions';
import { AddUserButton, EditUserDialog, ResetPasswordDialog } from './user-forms';

export const dynamic = 'force-dynamic';

const ROLE_STYLE: Record<string, string> = {
  ADMIN: 'bg-brand-100 text-brand-800',
  FINANCE: 'bg-emerald-100 text-emerald-800',
  ANALYTICS: 'bg-sky-100 text-sky-800',
  USER: 'bg-slate-100 text-slate-700',
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string }>;
}) {
  const me = await requireCapability('users:manage');
  const params = await searchParams;
  const t = await getTranslations('usersAdmin');
  const locale = await getLocale();

  const users = await prisma.user.findMany({
    where: {
      role: params.role && params.role !== 'all' ? (params.role as never) : undefined,
      OR: params.q
        ? [
            { name: containsInsensitive(params.q) },
            { email: containsInsensitive(params.q) },
            { staffId: containsInsensitive(params.q) },
          ]
        : undefined,
    },
    orderBy: [{ active: 'desc' }, { role: 'asc' }, { name: 'asc' }],
    take: 300,
  });

  const departmentRows = await prisma.user.findMany({
    where: { department: { not: null } },
    distinct: ['department'],
    select: { department: true },
    orderBy: { department: 'asc' },
  });
  const departments = departmentRows.map((r) => r.department!).filter(Boolean);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} action={<AddUserButton departments={departments} />} />

      <div className="mb-6">
        <Alert tone="info">{t('rolesInfo')}</Alert>
      </div>

      <Section
        title={t('accounts')}
          description={t('shownCount', { count: users.length })}
          action={
            <form method="get" className="flex gap-2">
              <select name="role" defaultValue={params.role ?? 'all'} className="input !w-32 !py-1 text-xs">
                <option value="all">{t('allRoles')}</option>
                <option value="ADMIN">{t('roleAdmin')}</option>
                <option value="ANALYTICS">{t('roleAnalytics')}</option>
                <option value="FINANCE">{t('roleFinance')}</option>
                <option value="USER">{t('roleEmployee')}</option>
              </select>
              <input
                name="q"
                defaultValue={params.q ?? ''}
                placeholder={t('searchPlaceholder')}
                className="input !w-44 !py-1 text-xs"
              />
              <button type="submit" className="btn-secondary btn-sm">
                {t('filter')}
              </button>
            </form>
          }
        >
          {users.length === 0 ? (
            <EmptyState title={t('noAccountsMatch')} hint={t('noAccountsMatchHint')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('name')}</th>
                    <th>{t('staffId')}</th>
                    <th>{t('department')}</th>
                    <th>{t('role')}</th>
                    <th>{t('signIn')}</th>
                    <th>{t('lastSeen')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className={u.active ? undefined : 'opacity-60'}>
                      <td>
                        <div className="font-medium text-slate-900">
                          {u.name}
                          {u.id === me.id ? <span className="ml-1 text-xs text-slate-400">{t('you')}</span> : null}
                        </div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </td>
                      <td className="text-slate-600">{u.staffId ?? '—'}</td>
                      <td className="text-slate-600">{u.department ?? '—'}</td>
                      <td>
                        <span className={`badge ${ROLE_STYLE[u.role]}`}>{ROLE_LABEL[u.role]}</span>
                      </td>
                      <td className="text-xs text-slate-500">{u.authProvider}</td>
                      <td className="text-xs text-slate-500">
                        {u.lastLoginAt ? formatDateTime(u.lastLoginAt, locale) : t('never')}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          <EditUserDialog
                            user={{
                              id: u.id,
                              name: u.name,
                              email: u.email,
                              staffId: u.staffId,
                              department: u.department,
                              role: u.role,
                              authProvider: u.authProvider,
                            }}
                            departments={departments}
                          />
                          <ResetPasswordDialog user={{ id: u.id, name: u.name }} />
                          {u.id === me.id ? null : (
                            <form action={toggleUserActive}>
                              <input type="hidden" name="id" value={u.id} />
                              <InlineSubmit
                                label={u.active ? t('deactivate') : t('activate')}
                                variant={u.active ? 'danger' : 'secondary'}
                              />
                            </form>
                          )}
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
