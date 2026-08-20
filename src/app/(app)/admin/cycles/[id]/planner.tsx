'use client';

import { useTranslations } from 'next-intl';
import { Fragment, useMemo, useState } from 'react';

import { ActionForm, InlineSubmit } from '@/components/action-form';
import { Dialog } from '@/components/dialog';
import { DayTabs, type DayTab } from '@/components/day-tabs';
import { formatSen } from '@/lib/money';

import { addMenuItem, removeMenuItem, updateMenuItem } from '../actions';

export type DishOption = {
  id: string;
  name: string;
  priceSen: number;
  restaurantName: string;
};

export type PlannerItem = {
  id: string;
  dishId: string;
  dishName: string;
  restaurantName: string;
  priceSen: number;
  catalogPriceSen: number;
  capacity: number | null;
  ordered: number;
};

/** Groups anything with a restaurantName, preserving first-appearance order. */
function groupByRestaurant<T extends { restaurantName: string }>(rows: T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = groups.get(row.restaurantName) ?? [];
    bucket.push(row);
    groups.set(row.restaurantName, bucket);
  }
  return [...groups.entries()];
}

/**
 * One day of the weekly planner. Only this day's items are fetched by the
 * server - switching tabs is a fresh query for that day alone.
 */
export function DayPlanner({
  tabs,
  activeDay,
  dayHeading,
  menuDayId,
  items,
  dishes,
  editable,
}: {
  tabs: DayTab[];
  activeDay: string;
  dayHeading: string;
  menuDayId: string;
  items: PlannerItem[];
  dishes: DishOption[];
  editable: boolean;
}) {
  const dayValue = items.reduce((sum, i) => sum + i.priceSen, 0);
  const t = useTranslations('cyclesAdmin');

  return (
    <div className="space-y-4">
      <DayTabs tabs={tabs} active={activeDay} />

      <section className="card overflow-hidden">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 bg-slate-50/60 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">{dayHeading}</h2>
          <span className="text-xs text-slate-500">
            {t('dishValueSummary', { count: items.length, value: formatSen(dayValue) })}
          </span>
        </header>

        {items.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-400">{t('noDishesPlanned')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('dishColumn')}</th>
                  <th className="num">{t('price')}</th>
                  <th>{t('capacity')}</th>
                  {editable ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {groupByRestaurant(items).map(([restaurantName, group]) => (
                  <Fragment key={restaurantName}>
                    <tr>
                      <td
                        colSpan={editable ? 4 : 3}
                        className="bg-slate-50/80 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
                      >
                        {restaurantName}
                      </td>
                    </tr>
                    {group.map((item) => {
                      const full = item.capacity != null && item.ordered >= item.capacity;
                      return (
                        <tr key={item.id}>
                          <td className="font-medium text-slate-900">{item.dishName}</td>
                          <td className="num">
                            <span className="font-medium text-slate-900">{formatSen(item.priceSen)}</span>
                            {item.priceSen !== item.catalogPriceSen ? (
                              <div className="text-[11px] text-amber-600">
                                {t('catalogue')} {formatSen(item.catalogPriceSen)}
                              </div>
                            ) : null}
                          </td>
                          <td>
                            {item.capacity == null ? (
                              <span className="text-slate-400">{t('unlimited')}</span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                                  <div
                                    className={`h-full rounded-full ${full ? 'bg-red-500' : 'bg-brand-500'}`}
                                    style={{
                                      width: `${Math.min(100, (item.ordered / item.capacity) * 100)}%`,
                                    }}
                                  />
                                </div>
                                <span
                                  className={`text-xs tabular-nums ${full ? 'text-red-600' : 'text-slate-500'}`}
                                >
                                  {item.ordered}/{item.capacity}
                                </span>
                              </div>
                            )}
                          </td>
                          {editable ? (
                            <td>
                              <div className="flex justify-end gap-1.5">
                                <EditItemDialog item={item} />
                                <form action={removeMenuItem}>
                                  <input type="hidden" name="id" value={item.id} />
                                  <InlineSubmit label={t('remove')} variant="danger" />
                                </form>
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {editable ? (
          <div className="border-t border-slate-200 bg-slate-50/60 p-4">
            <AddDishForm
              menuDayId={menuDayId}
              dishes={dishes}
              existing={items.map((i) => i.dishId)}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function AddDishForm({
  menuDayId,
  dishes,
  existing,
}: {
  menuDayId: string;
  dishes: DishOption[];
  existing: string[];
}) {
  const t = useTranslations('cyclesAdmin');
  const [dishId, setDishId] = useState('');
  const taken = useMemo(() => new Set(existing), [existing]);
  const selected = dishes.find((d) => d.id === dishId);

  return (
    <ActionForm action={addMenuItem} submitLabel={t('addToThisDay')} className="space-y-0">
      <input type="hidden" name="menuDayId" value={menuDayId} />

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem]">
        <div>
          <label className="label text-xs" htmlFor={`dish-${menuDayId}`}>
            {t('dishColumn')}
          </label>
          <select
            id={`dish-${menuDayId}`}
            name="dishId"
            required
            value={dishId}
            onChange={(e) => setDishId(e.target.value)}
            className="input"
          >
            <option value="" disabled>
              {t('chooseADish')}
            </option>
            {groupByRestaurant(dishes).map(([restaurantName, group]) => (
              <optgroup key={restaurantName} label={restaurantName}>
                {group.map((d) => (
                  <option key={d.id} value={d.id} disabled={taken.has(d.id)}>
                    {d.name} ({formatSen(d.priceSen)})
                    {taken.has(d.id) ? t('alreadyAdded') : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="label text-xs" htmlFor={`price-${menuDayId}`}>
            {t('priceRm')}
          </label>
          <input
            id={`price-${menuDayId}`}
            name="price"
            inputMode="decimal"
            className="input"
            placeholder={selected ? (selected.priceSen / 100).toFixed(2) : t('catalogue')}
          />
        </div>
        <div>
          <label className="label text-xs" htmlFor={`cap-${menuDayId}`}>
            {t('qtyLimit')}
          </label>
          <input
            id={`cap-${menuDayId}`}
            name="capacity"
            inputMode="numeric"
            className="input"
            placeholder={t('none')}
          />
        </div>
      </div>
    </ActionForm>
  );
}

function EditItemDialog({ item }: { item: PlannerItem }) {
  const t = useTranslations('cyclesAdmin');
  const c = useTranslations('adminCommon');
  return (
    <Dialog
      title={t('editItem', { name: item.dishName })}
      width="max-w-sm"
      trigger={(open) => (
        <button type="button" className="btn-secondary btn-sm" onClick={open}>
          {c('edit')}
        </button>
      )}
    >
      {() => (
        <ActionForm action={updateMenuItem} submitLabel={t('save')} resetOnSuccess={false} className="space-y-3">
          <input type="hidden" name="id" value={item.id} />
          <div>
            <label className="label">{t('priceForThisWeek')}</label>
            <input
              name="price"
              required
              inputMode="decimal"
              defaultValue={(item.priceSen / 100).toFixed(2)}
              className="input"
            />
            <p className="mt-1 text-xs text-slate-500">
              {t('cataloguePriceIs', { price: formatSen(item.catalogPriceSen) })}
            </p>
          </div>
          <div>
            <label className="label">{t('dailyCapacity')}</label>
            <input
              name="capacity"
              inputMode="numeric"
              defaultValue={item.capacity ?? ''}
              className="input"
              placeholder={t('blankUnlimited')}
            />
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}
