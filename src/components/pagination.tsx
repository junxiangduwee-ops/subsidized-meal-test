import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { PageSizeSelect } from '@/components/page-size-select';

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/** Parses a `?page=` searchParam into a safe, 1-based page number. */
export function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * Parses a `?pageSize=` searchParam, restricted to `PAGE_SIZE_OPTIONS` so
 * people can't force an arbitrarily large `take` through the URL. Falls
 * back to `fallback` (the page's own default) for anything else.
 */
export function parsePageSize(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return PAGE_SIZE_OPTIONS.includes(n) ? n : fallback;
}

/**
 * Prev/Next + "showing X-Y of Z" + rows-per-page pager for a server-rendered
 * table.
 *
 * The prev/next links and the "showing" text are plain server-rendered
 * <Link>s - changing page is a normal navigation (new searchParams), so no
 * client JS is needed for that part. Only the page-size dropdown itself is a
 * small client component, since selecting an option needs to trigger a
 * navigation on change. Any other filters already in the URL (search text,
 * dropdowns) are passed in via `searchParams` and carried through both
 * controls.
 */
export async function Pagination({
  basePath,
  page,
  pageSize,
  total,
  searchParams = {},
  pageSizeOptions = PAGE_SIZE_OPTIONS,
}: {
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
  searchParams?: Record<string, string | undefined>;
  pageSizeOptions?: number[];
}) {
  const t = await getTranslations('adminCommon');

  // Nothing to show at all.
  if (total === 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const hrefFor = (p: number) => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value) qs.set(key, value);
    }
    qs.set('pageSize', String(pageSize));
    qs.set('page', String(p));
    return `${basePath}?${qs.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
      <div className="flex items-center gap-4">
        <span>{t('pagerShowing', { from, to, total })}</span>
        <PageSizeSelect pageSize={pageSize} options={pageSizeOptions} label={t('pagerPerPage')} />
      </div>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className="btn-secondary btn-sm">
            {t('pagerPrevious')}
          </Link>
        ) : (
          <span className="btn-secondary btn-sm cursor-not-allowed opacity-40">{t('pagerPrevious')}</span>
        )}
        <span className="px-1 tabular-nums">{t('pagerPageOf', { page, totalPages })}</span>
        {page < totalPages ? (
          <Link href={hrefFor(page + 1)} className="btn-secondary btn-sm">
            {t('pagerNext')}
          </Link>
        ) : (
          <span className="btn-secondary btn-sm cursor-not-allowed opacity-40">{t('pagerNext')}</span>
        )}
      </div>
    </div>
  );
}
