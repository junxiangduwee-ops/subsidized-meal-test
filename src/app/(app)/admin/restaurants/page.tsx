import { getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { PageHeader, Section, EmptyState } from '@/components/ui';
import { InlineSubmit } from '@/components/action-form';

import { deleteRestaurant, toggleRestaurantActive } from './actions';
import { AddRestaurantButton, EditRestaurantDialog } from './forms';

export const dynamic = 'force-dynamic';

export default async function RestaurantsPage() {
  await requireCapability('catalogue:manage');
  const t = await getTranslations('restaurantsAdmin');
  const c = await getTranslations('adminCommon');

  const restaurants = await prisma.restaurant.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { dishes: true } } },
  });

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} action={<AddRestaurantButton />} />

      <Section title={t('allRestaurants')} description={t('totalCount', { count: restaurants.length })}>
        {restaurants.length === 0 ? (
          <EmptyState
            title={t('noRestaurantsYet')}
            hint={t('noRestaurantsHint')}
            action={<AddRestaurantButton />}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{c('name')}</th>
                  <th>{t('cuisine')}</th>
                  <th>{t('contact')}</th>
                  <th className="num">{t('dishes')}</th>
                  <th>{c('status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {restaurants.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="font-medium text-slate-900">{r.name}</div>
                      {r.description ? (
                        <div className="text-xs text-slate-500">{r.description}</div>
                      ) : null}
                    </td>
                    <td className="text-slate-600">{r.cuisine ?? '—'}</td>
                    <td className="text-slate-600">
                      {r.contactName ?? '—'}
                      {r.contactPhone ? (
                        <div className="text-xs text-slate-400">{r.contactPhone}</div>
                      ) : null}
                    </td>
                    <td className="num text-slate-600 text-left">{r._count.dishes}</td>
                    <td>
                      <span
                        className={`badge ${
                          r.active
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {r.active ? c('active') : c('inactive')}
                      </span>
                    </td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        <EditRestaurantDialog restaurant={r} />
                        <form action={toggleRestaurantActive}>
                          <input type="hidden" name="id" value={r.id} />
                          <InlineSubmit label={r.active ? c('disable') : c('enable')} />
                        </form>
                        <form action={deleteRestaurant}>
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
