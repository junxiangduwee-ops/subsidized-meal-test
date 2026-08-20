'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';

export type DayTab = {
  /** Value written to the query string - a YYYY-MM-DD date key. */
  key: string;
  label: string;
  sublabel: string;
  /** Small count shown on the right of the tab. Hidden when 0 or null. */
  badge?: number | null;
  /** Shows a tick instead of a count - for "this day is chosen". */
  check?: boolean;
  /** Renders the tab muted - e.g. a day with nothing on the menu. */
  muted?: boolean;
  /** Full accessible name; the visible label is abbreviated. */
  ariaLabel?: string;
};

/**
 * Weekday tab bar.
 *
 * Each tab is a query-string navigation, so the server renders only the
 * selected day's dishes. Prefetch is off deliberately: hovering five tabs
 * should not run five days' worth of queries.
 *
 * The clicked tab highlights immediately while the new day streams in, so
 * the bar never feels unresponsive during the round trip.
 */
export function DayTabs({
  tabs,
  active,
  param = 'day',
}: {
  tabs: DayTab[];
  active: string;
  param?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations('common');
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(active);

  // Re-sync when the server settles on a different day than we guessed.
  useEffect(() => setOptimistic(active), [active]);

  function select(key: string) {
    if (key === optimistic) return;
    setOptimistic(key);
    const next = new URLSearchParams(searchParams.toString());
    next.set(param, key);
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  return (
    <div
      role="tablist"
      aria-label={t('serviceDaysAriaLabel')}
      className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const selected = tab.key === optimistic;
        const loading = selected && isPending;
        return (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-label={tab.ariaLabel ?? `${tab.label} ${tab.sublabel}`}
            onClick={() => select(tab.key)}
            className={`group relative flex min-w-[7.5rem] flex-1 flex-col items-start rounded-xl border px-3.5 py-2.5 text-left transition-all ${
              selected
                ? 'border-brand-500 bg-white shadow-sm ring-1 ring-brand-500/20'
                : 'border-slate-200 bg-white/60 hover:border-slate-300 hover:bg-white'
            }`}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span
                className={`text-sm font-semibold ${
                  selected ? 'text-brand-800' : tab.muted ? 'text-slate-400' : 'text-slate-700'
                }`}
              >
                {tab.label}
              </span>
              {loading ? (
                <Spinner />
              ) : tab.check ? (
                <span
                  aria-hidden
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                    selected ? 'bg-brand-600 text-white' : 'bg-brand-100 text-brand-700'
                  }`}
                >
                  <svg
                    viewBox="0 0 12 12"
                    className="h-2.5 w-2.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M2.5 6.5 5 9l4.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              ) : tab.badge ? (
                <span
                  className={`badge shrink-0 ${
                    selected ? 'bg-brand-600 text-white' : 'bg-brand-100 text-brand-800'
                  }`}
                >
                  {tab.badge}
                </span>
              ) : null}
            </span>
            <span className={`text-xs ${selected ? 'text-brand-600' : 'text-slate-400'}`}>
              {tab.sublabel}
            </span>
            {selected ? (
              <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand-500" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function Spinner() {
  const t = useTranslations('common');
  return (
    <span
      aria-label={t('loadingAriaLabel')}
      className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600"
    />
  );
}
