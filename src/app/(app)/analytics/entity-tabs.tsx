'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type EntityTab = { code: string; name: string };

export function EntityTabs({
  entities,
  activeEntity,
  weeks,
}: {
  entities: EntityTab[];
  activeEntity: string | null;
  weeks: number;
}) {
  const pathname = usePathname();

  function tabHref(code: string | null) {
    const params = new URLSearchParams({ weeks: String(weeks) });
    if (code) params.set('entity', code);
    return `${pathname}?${params.toString()}`;
  }

  const tabs: Array<{ code: string | null; name: string }> = [
    { code: null, name: 'All' },
    ...entities,
  ];

  return (
    <div className="mb-6 flex w-fit gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
      {tabs.map((tab) => {
        const isActive = tab.code === activeEntity;
        return (
          <Link
            key={tab.code ?? 'all'}
            href={tabHref(tab.code)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              isActive
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.name}
          </Link>
        );
      })}
    </div>
  );
}
