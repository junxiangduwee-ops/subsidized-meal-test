import { getLocale, getTranslations } from 'next-intl/server';

import { requireCapability } from '@/lib/session';
import { formatSen } from '@/lib/money';
import { getAnalyticsDashboard } from '@/lib/cache';
import { PageHeader, Section, Stat, EmptyState } from '@/components/ui';

import { RestaurantShareChart, SpendChart, WeekdayChart, WeeklyDemandChart } from './charts';

export const dynamic = 'force-dynamic';

const RANGES = [4, 8, 12, 26] as const;

// ── HitPay balance fetch ──────────────────────────────────────────────────────
type HitPayWallet = {
  available: number;
  pending: number;
  reserve: number;
};

async function fetchHitPayBalance(): Promise<HitPayWallet | null> {
  const apiKey = process.env.HITPAY_API_KEY;
  if (!apiKey) return null;

  const base =
    process.env.HITPAY_MODE === 'live'
      ? 'https://api.hit-pay.com/v1'
      : 'https://api.sandbox.hit-pay.com/v1';

  try {
    const res = await fetch(`${base}/balances`, {
      headers: {
        'X-BUSINESS-API-KEY': apiKey,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!res.ok) return null;

    const data = (await res.json()) as Array<{
      currency: string;
      wallets: HitPayWallet;
    }>;

    // Find MYR balance — fall back to first entry
    const currency = (process.env.HITPAY_CURRENCY ?? 'MYR').toUpperCase();
    const entry = data.find((d) => d.currency.toUpperCase() === currency) ?? data[0];
    return entry?.wallets ?? null;
  } catch {
    return null;
  }
}

// ── Page ─────────────────────────────────────────────────────────────────────
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

  const [{ weekly, dishes, restaurants, weekday, departments, take }, hitpay] =
    await Promise.all([getAnalyticsDashboard(weeks, locale), fetchHitPayBalance()]);

  const totalMeals = weekly.reduce((s, w) => s + w.meals, 0);
  const totalOrders = weekly.reduce((s, w) => s + w.orders, 0);
  const totalGross = weekly.reduce((s, w) => s + w.grossSen, 0);
  const weeksWithData = weekly.filter((w) => w.orders > 0).length;

  const isSandbox = process.env.HITPAY_MODE !== 'live';

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

      {/* ── HitPay Wallet Balance ─────────────────────────────────────── */}
      {hitpay !== null && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-700">HitPay Wallet</h2>
            {isSandbox && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                Sandbox
              </span>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-slate-500">Available (ready to settle)</p>
              <p className="mt-0.5 text-xl font-semibold text-emerald-700">
                RM {hitpay.available.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Pending (unsettled)</p>
              <p className="mt-0.5 text-xl font-semibold text-amber-600">
                RM {hitpay.pending.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Reserve</p>
              <p className="mt-0.5 text-xl font-semibold text-slate-700">
                RM {hitpay.reserve.toFixed(2)}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Live from HitPay · Refreshes on every page load
          </p>
        </div>
      )}

      {/* ── 4 stat boxes ─────────────────────────────────────────────── */}
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
                  <th className="text-center">{t('portions')}</th>
                  <th className="num">{t('foodValue')}</th>
                </tr>
              </thead>
              <tbody>
                {dishes.map((d) => (
                  <tr key={`${d.restaurantName}-${d.dishName}`}>
                    <td className="font-medium text-slate-900">{d.dishName}</td>
                    <td className="text-slate-600">{d.restaurantName}</td>
                    <td className="text-center text-slate-900">{d.quantity}</td>
                    <td className="num text-slate-600">{formatSen(d.grossSen)}</td>
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
                  <th className="text-center">{t('people')}</th>
                  <th className="text-center">{t('orders')}</th>
                  <th className="num">{t('foodValue')}</th>
                  <th className="num">{t('subsidy')}</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d.department}>
                    <td className="font-medium text-slate-900">{d.department}</td>
                    <td className="text-center text-slate-600">{d.people}</td>
                    <td className="text-center text-slate-600">{d.orders}</td>
                    <td className="num text-slate-900">{formatSen(d.grossSen)}</td>
                    <td className="num text-emerald-700">{formatSen(d.subsidySen)}</td>
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
