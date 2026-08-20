'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Fragment, useState, useTransition } from 'react';

import { formatSen } from '@/lib/money';
import { DayTabs, type DayTab } from '@/components/day-tabs';

import { checkout, chooseDeliverySite, chooseMeal, clearCart, removeMeal } from './actions';

export type MenuDish = {
  menuItemId: string;
  dishName: string;
  restaurantName: string;
  description: string | null;
  tags: string[];
  /**
   * What this employee pays, after the company contribution. The gross price
   * and the subsidy amount are deliberately never sent to the browser -
   * staff see their own price and nothing else.
   */
  priceSen: number;
  remaining: number | null;
  chosen: boolean;
};

/** One chosen day, for the summary panel. Spans the whole week. */
export type CartLine = {
  id: string;
  dayKey: string;
  dayLabel: string;
  dishName: string;
  netSen: number;
  /** True once this line belongs to an already-submitted order (paid, done). */
  locked: boolean;
};

/**
 * Dishes for a day, grouped by restaurant so a day with several vendors
 * reads as sections instead of one long undifferentiated list. Restaurants
 * appear in the order their first dish appears - i.e. whatever order the
 * admin's menu planner already set (`sortOrder`) - rather than alphabetical,
 * so this doesn't fight the ordering an admin deliberately chose.
 */
function groupByRestaurant(dishes: MenuDish[]): Array<[string, MenuDish[]]> {
  const groups = new Map<string, MenuDish[]>();
  for (const dish of dishes) {
    const bucket = groups.get(dish.restaurantName) ?? [];
    bucket.push(dish);
    groups.set(dish.restaurantName, bucket);
  }
  return [...groups.entries()];
}

export function MenuOrdering({
  cycleId,
  tabs,
  activeDay,
  dayHeading,
  dishes,
  cartLines,
  totalSen,
  notes,
  readOnly = false,
  hasSettledOrders = false,
  deliverySites,
  selectedDeliverySiteId,
}: {
  cycleId: string;
  tabs: DayTab[];
  activeDay: string;
  dayHeading: string;
  dishes: MenuDish[];
  cartLines: CartLine[];
  totalSen: number;
  notes: string | null;
  /** Whether the currently viewed day is locked (already paid). */
  readOnly?: boolean;
  /** Whether any day this week has already been paid for, in any order. */
  hasSettledOrders?: boolean;
  /** Active sites the employee can choose to have this order delivered to. */
  deliverySites: Array<{ id: string; name: string }>;
  /** The open cart's current choice, if one has been made yet. */
  selectedDeliverySiteId: string | null;
}) {
  const t = useTranslations('menu');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(menuItemId: string, alreadyChosen: boolean) {
    setError(null);
    setBusyId(menuItemId);
    startTransition(async () => {
      const result = alreadyChosen ? await removeMeal(menuItemId) : await chooseMeal(menuItemId);
      if (!result.ok) setError(result.error ?? t('genericError'));
      setBusyId(null);
      router.refresh();
    });
  }

  function clear() {
    const data = new FormData();
    data.set('cycleId', cycleId);
    startTransition(async () => {
      await clearCart(data);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-4">
        {notes ? (
          <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            {notes}
          </p>
        ) : null}

        <DayTabs tabs={tabs} active={activeDay} />

        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        <section className="card overflow-hidden">
          <header className="flex items-baseline justify-between border-b border-slate-200 bg-slate-50/60 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">{dayHeading}</h2>
            <span className="text-xs text-slate-500">
              {readOnly
                ? t('alreadyPaidForDay', { count: dishes.length })
                : t('chooseOne', { count: dishes.length })}
            </span>
          </header>

          {dishes.length === 0 ? (
            <p className="px-5 py-16 text-center text-sm text-slate-400">{t('noDishes')}</p>
          ) : (
            <ul
              role={readOnly ? undefined : 'radiogroup'}
              aria-label={readOnly ? undefined : t('mealForDay', { day: dayHeading })}
              className="divide-y divide-slate-100"
            >
              {groupByRestaurant(dishes).map(([restaurantName, group]) => (
                <Fragment key={restaurantName}>
                  <li
                    role="presentation"
                    className="bg-slate-50/80 px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    {restaurantName}
                  </li>
                  {group.map((dish) => (
                    <DishRow
                      key={dish.menuItemId}
                      dish={dish}
                      busy={busyId === dish.menuItemId}
                      readOnly={readOnly}
                      onToggle={toggle}
                    />
                  ))}
                </Fragment>
              ))}
            </ul>
          )}
        </section>
      </div>

      <OrderSummary
        cartLines={cartLines}
        totalSen={totalSen}
        cycleId={cycleId}
        onClear={clear}
        hasSettledOrders={hasSettledOrders}
        deliverySites={deliverySites}
        selectedDeliverySiteId={selectedDeliverySiteId}
      />
    </div>
  );
}

/**
 * A day's dish, as a single-choice row.
 *
 * Staff get one meal per service day, so the whole row is the control:
 * picking a dish swaps out whatever was chosen for that day, and picking the
 * chosen dish again clears the day. Rendered as a radio so screen readers
 * and keyboard users get the same "choose one" semantics the visuals imply.
 *
 * Once the order is submitted the same rows render read-only, so people see
 * their week in the layout they ordered it in.
 */
function DishRow({
  dish,
  busy,
  readOnly,
  onToggle,
}: {
  dish: MenuDish;
  busy: boolean;
  readOnly: boolean;
  onToggle: (id: string, alreadyChosen: boolean) => void;
}) {
  const t = useTranslations('menu');
  const { chosen } = dish;
  const soldOut = dish.remaining !== null && dish.remaining <= 0 && !chosen;
  const disabled = busy || soldOut;

  const body = (
    <>
      <span
        aria-hidden
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${chosen ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'
          }`}
      >
        {busy ? (
          <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
        ) : chosen ? (
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M2.5 6.5 5 9l4.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`font-medium ${chosen ? 'text-brand-900' : 'text-slate-900'}`}>
            {dish.dishName}
          </span>
          {dish.tags.map((tag) => (
            <span key={tag} className="badge bg-slate-100 text-slate-600">
              {tag}
            </span>
          ))}
          {soldOut ? <span className="badge bg-red-100 text-red-700">{t('soldOut')}</span> : null}
        </span>
        {dish.description ? (
          <span className="mt-0.5 line-clamp-1 block text-xs text-slate-400">{dish.description}</span>
        ) : null}
        {!readOnly && dish.remaining !== null && dish.remaining > 0 && dish.remaining <= 5 ? (
          <span className="mt-1 block text-xs font-medium text-amber-600">
            {t('onlyLeft', { count: dish.remaining })}
          </span>
        ) : null}
      </span>

      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold tabular-nums text-slate-900">
          {formatSen(dish.priceSen)}
        </span>
        {chosen ? (
          <span className="block text-[11px] font-medium text-brand-700">
            {readOnly ? t('yourChoice') : t('chosenTapRemove')}
          </span>
        ) : null}
      </span>
    </>
  );

  const rowClass = `flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors ${chosen ? 'bg-brand-50/60' : soldOut ? 'opacity-55' : ''
    }`;

  if (readOnly) {
    return <li className={`${rowClass} ${chosen ? '' : 'opacity-70'}`}>{body}</li>;
  }

  return (
    <li>
      <button
        type="button"
        role="radio"
        aria-checked={chosen}
        aria-label={t('dishAriaLabel', {
          dish: dish.dishName,
          restaurant: dish.restaurantName,
          price: formatSen(dish.priceSen),
        })}
        disabled={disabled}
        onClick={() => onToggle(dish.menuItemId, chosen)}
        className={`${rowClass} ${chosen ? 'hover:bg-brand-50' : soldOut ? 'cursor-not-allowed' : 'hover:bg-slate-50'
          }`}
      >
        {body}
      </button>
    </li>
  );
}

function OrderSummary({
  cartLines,
  totalSen,
  cycleId,
  onClear,
  hasSettledOrders,
  deliverySites,
  selectedDeliverySiteId,
}: {
  cartLines: CartLine[];
  /** Amount due now - the open cart's total, not the whole week's. */
  totalSen: number;
  cycleId: string;
  onClear: () => void;
  /** Whether any day this week has already been paid for, in any order. */
  hasSettledOrders: boolean;
  deliverySites: Array<{ id: string; name: string }>;
  selectedDeliverySiteId: string | null;
}) {
  const t = useTranslations('menu');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [siteSaving, setSiteSaving] = useState(false);

  // Group by day so people see their whole week at a glance, paid and
  // pending days together.
  const byDay = new Map<string, { label: string; lines: CartLine[] }>();
  for (const line of cartLines) {
    const bucket = byDay.get(line.dayKey) ?? { label: line.dayLabel, lines: [] };
    bucket.lines.push(line);
    byDay.set(line.dayKey, bucket);
  }

  // Only the pending (unpaid) lines belong to the cart being paid for here -
  // locked lines are already-settled days and stay visible, but out of reach
  // of Clear/Pay.
  const pendingLines = cartLines.filter((l) => !l.locked);
  const empty = pendingLines.length === 0;
  const nothingToPay = totalSen === 0 && !empty;

  function changeSite(deliverySiteId: string) {
    setError(null);
    setSiteSaving(true);
    startTransition(async () => {
      const result = await chooseDeliverySite(cycleId, deliverySiteId);
      setSiteSaving(false);
      if (!result.ok) setError(result.error ?? t('siteError'));
    });
  }

  function submit() {
    setError(null);
    if (!selectedDeliverySiteId) {
      setError(t('chooseSiteToContinue'));
      return;
    }
    const data = new FormData();
    data.set('cycleId', cycleId);
    startTransition(async () => {
      const result = await checkout({}, data);
      // A successful checkout redirects, so anything returned is an error.
      if (result?.error) setError(result.error);
    });
  }

  return (
    <aside className="xl:sticky xl:top-20 xl:self-start">
      <div className="card overflow-hidden">
        <header className="flex items-baseline justify-between gap-2 border-b border-slate-200 bg-slate-50/60 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">{t('yourWeek')}</h2>
          {!empty ? (
            <button
              type="button"
              onClick={onClear}
              disabled={pending}
              className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800"
            >
              {t('clear')}
            </button>
          ) : null}
        </header>

        {cartLines.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">{t('pickMealPrompt')}</p>
        ) : (
          <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
            {[...byDay.values()].map((day) => (
              <div key={day.label} className="px-5 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {day.label}
                </p>
                {day.lines.map((line) => (
                  <div key={line.id} className="mt-1 flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-slate-700">
                      {line.dishName}
                      {line.locked ? (
                        <span className="ml-1.5 badge bg-emerald-100 text-emerald-800 align-middle">
                          {t('paid')}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-900">{formatSen(line.netSen)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-slate-200 px-5 py-4 text-sm">
          <div className="flex items-baseline justify-between text-slate-600">
            <span>{t('daysSelected', { count: byDay.size })}</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between border-t border-slate-200 pt-3">
            <span className="font-medium text-slate-900">{t('youPay')}</span>
            <span className="text-xl font-semibold tabular-nums text-slate-900">
              {formatSen(totalSen)}
            </span>
          </div>
        </div>

        <div className="border-t border-slate-200 px-5 py-4">
          {empty ? (
            hasSettledOrders ? (
              <>
                <Link href="/orders" className="btn-secondary w-full">
                  {t('viewReceipts')}
                </Link>
                <p className="mt-2 text-center text-xs text-slate-500">{t('everythingPaid')}</p>
              </>
            ) : (
              <p className="text-center text-xs text-slate-500">{t('chooseDayPrompt')}</p>
            )
          ) : (
            <>
              <label className="mb-3 block text-xs font-medium text-slate-600">
                {t('deliverTo')}
                <select
                  className="input mt-1"
                  value={selectedDeliverySiteId ?? ''}
                  disabled={siteSaving}
                  onChange={(e) => changeSite(e.target.value)}
                >
                  <option value="" disabled>
                    {t('chooseSite')}
                  </option>
                  {deliverySites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </label>

              {error ? (
                <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
              ) : null}

              <button
                type="button"
                onClick={submit}
                disabled={pending || !selectedDeliverySiteId}
                className="btn-primary w-full"
              >
                {pending
                  ? t('pleaseWait')
                  : nothingToPay
                    ? t('confirmOrder')
                    : t('pay', { amount: formatSen(totalSen) })}
              </button>

              <p className="mt-2 text-center text-xs text-slate-500">
                {!selectedDeliverySiteId
                  ? t('chooseSiteToContinue')
                  : nothingToPay
                    ? t('nothingToPay')
                    : t('savedAsYouGo')}
              </p>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
