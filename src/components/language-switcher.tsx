'use client';

import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useTransition } from 'react';

import { LOCALES, LOCALE_LABEL } from '@/i18n/config';
import { setLocale } from '@/i18n/actions';

/**
 * A pill-shaped button that sits inline with the MobileNav items in the
 * embedded sticky bar. Tapping it cycles through the available locales,
 * matching the exact pill style used by MobileNav so it looks native.
 */
export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function cycleLocale() {
    const idx = LOCALES.indexOf(locale as typeof LOCALES[number]);
    const next = LOCALES[(idx + 1) % LOCALES.length];
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={cycleLocale}
      disabled={pending}
      className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
    >
      {LOCALE_LABEL[locale as typeof LOCALES[number]]}
    </button>
  );
}
