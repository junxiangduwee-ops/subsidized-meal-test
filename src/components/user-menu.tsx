'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';

import { LOCALES, LOCALE_LABEL } from '@/i18n/config';
import { setLocale } from '@/i18n/actions';

/**
 * Avatar/name button that opens a small anchored dropdown - profile summary
 * up top, quick links in the middle, sign out at the bottom (visually
 * separated and in red, since it's the one destructive-feeling action here).
 */
export function UserMenu({
  name,
  roleLabel,
  department,
  initials,
  canViewOrders,
  onLogout,
}: {
  name: string;
  roleLabel: string;
  department: string | null;
  initials: string;
  canViewOrders: boolean;
  onLogout: (formData: FormData) => void | Promise<void>;
}) {
  const t = useTranslations('userMenu');
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  function changeLocale(next: string) {
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full py-1 pl-2 pr-1 hover:bg-slate-100"
      >
        <span className="hidden text-sm font-medium leading-tight text-slate-900 sm:block">{name}</span>
        <span
          aria-hidden
          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600"
        >
          {initials}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
        >
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="truncate text-sm font-medium text-slate-900">{name}</p>
            <p className="truncate text-xs text-slate-500">
              {roleLabel}
              {department ? ` · ${department}` : ''}
            </p>
          </div>

          <div className="py-1">
            {canViewOrders ? (
              <Link
                href="/orders"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                {t('myOrders')}
              </Link>
            ) : null}
            <a
              href="mailto:ai.automation@mrdiy.com"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              {t('helpSupport')}
            </a>
          </div>

          <div className="border-t border-slate-100 px-4 py-3">
            <label className="mb-1 block text-xs font-medium text-slate-500">{t('language')}</label>
            <select
              className="input"
              value={locale}
              onChange={(e) => changeLocale(e.target.value)}
            >
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_LABEL[l]}
                </option>
              ))}
            </select>
          </div>

          <form action={onLogout} className="border-t border-slate-100 py-1">
            <button
              type="submit"
              role="menuitem"
              className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
            >
              {t('signOut')}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
