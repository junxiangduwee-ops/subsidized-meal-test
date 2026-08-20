import { getLocale, getTranslations } from 'next-intl/server';

import { requireCapability } from '@/lib/session';
import { formatSen } from '@/lib/money';
import {
  demandByWeekday,
  departmentBreakdown,
  participation,
  restaurantShare,
  topDishes,
  trailingWeeks,
  weeklyTotals,
} from '@/lib/reporting';
import { PageHeader, Section, Stat, EmptyState } from '@/components/ui';

import { RestaurantShareChart, SpendChart, WeekdayChart, WeeklyDemandChart } from './charts';

export const dynamic = 'force-dynamic';

const RANGES = [4, 8, 12, 26] as const;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ weeks?: string }>;
}) {
  await requireCapability('analytics:view');
  const params = await searchParams;
  const t = await getTranslations('analyticsAdmin');
  const locale = await getLocale();

  const requested = Number.parseInt(params.weeks ?? '', 10);
  const weeks = (RANGES as readonly number[]).includes(requested) ? requested : 12;
  const window = trailingWeeks(weeks);

  const [weekly, dishes, restaurants, weekday, departments, take] = await Promise.all([
    weeklyTotals(window, locale),
    topDishes(window, 10),
    restaurantShare(window),
    demandByWeekday(window, locale),
    departmentBreakdown(window),
    participation(window),
  ]);

  const totalMeals = weekly.reduce((s, w) => s + w.meals, 0);
  const totalOrders = weekly.reduce((s, w) => s + w.orders, 0);
  const totalGross = weekly.reduce((s, w) => s + w.grossSen, 0);
  const weeksWithData = weekly.filter((w) => w.orders > 0).length;

  const rangeSwitcher = (
    <form method="get" className="flex items-center gap-2">
      <label htmlFor="weeks" className="text-xs text-slate-500">
        {t('range')}
      </label>
      <select id="weeks" name="weeks" defaultValue={String(weeks)} className="input !w-32 !py-1 text-xs">
        {RANGES.map((r) => (
          <option key={r} value={r}>
            {t('lastNWeeks', { count: r })}
          </option>
        ))}
      </select>
      <button type="submit" className="btn-secondary btn-sm">
        {t('apply')}
      </button>
    </form>
  );

  if (totalOrders === 0) {
    return (
      <>
        <PageHeader title={t('title')} subtitle={t('subtitle')} action={rangeSwitcher} />
        <EmptyState title={t('noOrdersInRange')} hint={t('noOrdersInRangeHint')} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitlePaid', { weeks })} action={rangeSwitcher} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('mealsServed')} value={totalMeals.toLocaleString()} hint={t('ordersHint', { count: totalOrders })} />
        <Stat
          label={t('participation')}
          value={`${Math.round(take.rate * 100)}%`}
          hint={t('participationHint', { ordered: take.ordered, eligible: take.eligible })}
        />
        <Stat
          label={t('avgMealsPerWeek')}
          value={weeksWithData ? Math.round(totalMeals / weeksWithData).toLocaleString() : '0'}
          hint={t('weeksWithOrders', { count: weeksWithData })}
        />
        <Stat
          label={t('avgMealValue')}
          value={totalMeals ? formatSen(Math.round(totalGross / totalMeals)) : formatSen(0)}
          hint={t('grossBeforeSubsidy')}
        />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Section title={t('demandByWeek')} description={t('demandByWeekDesc')}>
          <div className="p-4">
            <WeeklyDemandChart
              data={weekly.map((w) => ({ label: w.label.split(' - ')[0], meals: w.meals, orders: w.orders }))}
            />
          </div>
        </Section>

        <Section title={t('whoPaysWhat')} description={t('whoPaysWhatDesc')}>
          <div className="p-4">
            <SpendChart
              data={weekly.map((w) => ({
                label: w.label.split(' - ')[0],
                staff: w.netSen,
                company: w.subsidySen,
              }))}
            />
          </div>
        </Section>

        <Section title={t('demandByWeekday')} description={t('demandByWeekdayDesc')}>
          <div className="p-4">
            <WeekdayChart data={weekday} />
          </div>
        </Section>

        <Section title={t('restaurantShare')} description={t('restaurantShareDesc')}>
          <div className="p-4">
            <RestaurantShareChart data={restaurants.slice(0, 7)} />
          </div>
        </Section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title={t('mostOrderedDishes')} description={t('mostOrderedDishesDesc')}>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('dish')}</th>
                  <th>{t('restaurant')}</th>
                  <th className="num">{t('portions')}</th>
                  <th className="num">{t('foodValue')}</th>
                </tr>
              </thead>
              <tbody>
                {dishes.map((d) => (
                  <tr key={`${d.restaurantName}-${d.dishName}`}>
                    <td className="font-medium text-slate-900">{d.dishName}</td>
                    <td className="text-slate-600">{d.restaurantName}</td>
                    <td className="num text-slate-900 text-left">{d.quantity}</td>
                    <td className="num text-slate-600 text-left">{formatSen(d.grossSen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title={t('byDepartment')} description={t('byDepartmentDesc')}>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('department')}</th>
                  <th className="num">{t('people')}</th>
                  <th className="num">{t('orders')}</th>
                  <th className="num">{t('foodValue')}</th>
                  <th className="num">{t('subsidy')}</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d.department}>
                    <td className="font-medium text-slate-900">{d.department}</td>
                    <td className="num text-slate-600 text-left">{d.people}</td>
                    <td className="num text-slate-600 text-left">{d.orders}</td>
                    <td className="num text-slate-900 text-left">{formatSen(d.grossSen)}</td>
                    <td className="num text-emerald-700 text-left">{formatSen(d.subsidySen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  );
}
