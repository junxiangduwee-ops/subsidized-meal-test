'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export type CycleOption = { id: string; label: string };
export type DayOption = { key: string; label: string };

type Props = {
  cycles: CycleOption[];
  selectedCycleId: string;
  days: DayOption[];
  selectedDayKey: string;
  restaurants: string[];
  selectedRestaurant: string;
  dishes: string[];
  selectedDish: string;
};

export function BulkRefundFilters({
  cycles,
  selectedCycleId,
  days,
  selectedDayKey,
  restaurants,
  selectedRestaurant,
  dishes,
  selectedDish,
}: Props) {
  const router = useRouter();
  const t = useTranslations('bulkRefund');

  function navigate(params: Record<string, string>) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v) qs.set(k, v);
    }
    router.push(`/admin/bulk-refund?${qs.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3 p-5">
      {/* Cycle */}
      <div>
        <label className="label text-xs">{t('cycle')}</label>
        <select
          value={selectedCycleId}
          onChange={(e) => navigate({ cycle: e.target.value })}
          className="input !py-1 text-sm"
        >
          {cycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {/* Day */}
      <div>
        <label className="label text-xs">{t('day')}</label>
        <select
          value={selectedDayKey}
          onChange={(e) =>
            navigate({ cycle: selectedCycleId, day: e.target.value })
          }
          className="input !py-1 text-sm"
        >
          <option value="">{t('allDays')}</option>
          {days.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      {/* Restaurant */}
      <div>
        <label className="label text-xs">{t('restaurant')}</label>
        <select
          value={selectedRestaurant}
          onChange={(e) =>
            navigate({ cycle: selectedCycleId, day: selectedDayKey, restaurant: e.target.value })
          }
          className="input !py-1 text-sm"
        >
          <option value="">{t('allRestaurants')}</option>
          {restaurants.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {/* Dish */}
      <div>
        <label className="label text-xs">{t('dish')}</label>
        <select
          value={selectedDish}
          onChange={(e) =>
            navigate({
              cycle: selectedCycleId,
              day: selectedDayKey,
              restaurant: selectedRestaurant,
              dish: e.target.value,
            })
          }
          className="input !py-1 text-sm"
        >
          <option value="">{t('allDishes')}</option>
          {dishes.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={() => navigate({ cycle: selectedCycleId })}
        className="self-end text-xs text-slate-400 underline underline-offset-2 hover:text-slate-600"
      >
        {t('clearFilters')}
      </button>
    </div>
  );
}
