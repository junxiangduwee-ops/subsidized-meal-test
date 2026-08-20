'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * Minimal modal. Renders inline (no portal) which is fine here - the
 * overlay is fixed-position and sits above the sticky header's z-index.
 */
export function Dialog({
  trigger,
  title,
  children,
  width = 'max-w-lg',
}: {
  trigger: (open: () => void) => ReactNode;
  title: string;
  children: (close: () => void) => ReactNode;
  width?: string;
}) {
  const t = useTranslations('common');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  return (
    <>
      {trigger(() => setIsOpen(true))}
      {isOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsOpen(false);
          }}
        >
          <div
            className={`w-full ${width} rounded-xl bg-white shadow-xl`}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label={t('close')}
              >
                ✕
              </button>
            </div>
            <div className="p-5">{children(() => setIsOpen(false))}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
