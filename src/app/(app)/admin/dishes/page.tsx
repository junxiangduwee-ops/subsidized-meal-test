import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { containsInsensitive, decodeTags } from '@/lib/db-compat';
import { formatSen } from '@/lib/money';
import { PageHeader, Section, EmptyState } from '@/components/ui';
import { InlineSubmit } from '@/components/action-form';
import { Pagination, parsePage, parsePageSize } from '@/components/pagination';

import { deleteDish, toggleDishActive } from './actions';
import { AddDishButton, EditDishDialog } from './dish-form';

export const dynamic = 'force-dynamic';

const DEFAULT_PAGE_SIZE = 25;

export default async function DishesPage({
  searchParams,
}: {
  searchParams: Promise<{ restaurant?: string; q?: string; page?: string; pageSize?: string; }>;
}) {
  await requireCapability('catalogue:manage');
  const params = await searchParams;
  const t = await getTranslations('dishesAdmin');
  const c = await getTranslations('adminCommon');
  const page = parsePage(params.page);
  const pageSize = parsePageSize(params.pageSize, DEFAULT_PAGE_SIZE);

  const restaurants = await prisma.restaurant.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, active: true },
  });

  const where = {
    restaurantId: params.restaurant || undefined,
    name: params.q ? containsInsensitive(params.q) : undefined,
  };

  const [total, dishes] = await Promise.all([
    prisma.dish.count({ where }),
    prisma.dish.findMany({
      where,
      orderBy: [{ active: 'desc' }, { restaurant: { name: 'asc' } }, { name: 'asc' }],
      include: { restaurant: { select: { name: true, active: true } } },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  // tags are a scalar list on Postgres and a delimited string on SQLite
  const rows = dishes.map((d) => ({ ...d, tags: decodeTags(d.tags) }));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} action={<AddDishButton restaurants={restaurants} />} />

      {restaurants.length === 0 ? (
        <EmptyState
          title={t('addRestaurantFirst')}
          hint={t('addRestaurantFirstHint')}
          action={
            <Link href="/admin/restaurants" className="btn-primary">
              {t('goToRestaurants')}
            </Link>
          }
        />
      ) : (
        <Section
            title={t('catalogue')}
            description={t('dishCount', { count: total })}
            action={
              <form method="get" className="flex gap-2">
                <select name="restaurant" defaultValue={params.restaurant ?? ''} className="input !w-44 !py-1 text-xs">
                  <option value="">{t('allRestaurantsOption')}</option>
                  {restaurants.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <input
                  name="q"
                  defaultValue={params.q ?? ''}
                  placeholder={t('searchPlaceholder')}
                  className="input !w-36 !py-1 text-xs"
                />
                <button type="submit" className="btn-secondary btn-sm">
                  {t('filter')}
                </button>
              </form>
            }
          >
            {rows.length === 0 ? (
              <EmptyState title={t('noDishesMatch')} hint={t('noDishesMatchHint')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('dish')}</th>
                      <th>{t('restaurant')}</th>
                      <th>{t('category')}</th>
                      <th className="num">{t('price')}</th>
                      <th>{c('status')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <div className="font-medium text-slate-900">{d.name}</div>
                          {d.tags.length > 0 ? (
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              {d.tags.map((tag) => (
                                <span key={tag} className="badge bg-slate-100 text-slate-600">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </td>
                        <td className="text-slate-600">{d.restaurant.name}</td>
                        <td className="text-slate-600">{d.category ?? '—'}</td>
                        <td className="num font-medium text-slate-900 text-left">{formatSen(d.priceSen)}</td>
                        <td>
                          <span
                            className={`badge ${
                              d.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {d.active ? c('active') : c('inactive')}
                          </span>
                        </td>
                        <td>
                          <div className="flex justify-end gap-1.5">
                            <EditDishDialog dish={d} restaurants={restaurants} />
                            <form action={toggleDishActive}>
                              <input type="hidden" name="id" value={d.id} />
                              <InlineSubmit label={d.active ? c('disable') : c('enable')} />
                            </form>
                            <form action={deleteDish}>
                              <input type="hidden" name="id" value={d.id} />
                              <InlineSubmit
                                label={c('delete')}
                                variant="danger"
                                confirm={t('deleteConfirm', { name: d.name })}
                              />
                            </form>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <Pagination
                  basePath="/admin/dishes"
                  page={page}
                  pageSize={pageSize}
                  total={total}
                  searchParams={{ restaurant: params.restaurant, q: params.q }}
                />
              </div>
            )}
          </Section>

      )}
    </>
  );
}
