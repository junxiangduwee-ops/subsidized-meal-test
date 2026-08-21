import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/** Parses a `?page=` searchParam into a safe, 1-based page number. */
export function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * Prev/Next + "showing X-Y of Z" pager for a server-rendered table.
 *
 * Deliberately plain <Link>s, not a client component — changing page is a
 * normal navigation (new searchParams), so no client-side state or JS is
 * needed. Any other filters already in the URL (search text, dropdowns) are
 * passed in via `searchParams` and carried through to the prev/next links.
 */
export async function Pagination({
  basePath,
  page,
  pageSize,
  total,
  searchParams = {},
}: {
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
  searchParams?: Record<string, string | undefined>;
}) {
  const t = await getTranslations('adminCommon');
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Nothing to page through — don't show the control at all.
  if (totalPages <= 1) return null;

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const hrefFor = (p: number) => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value) qs.set(key, value);
    }
    qs.set('page', String(p));
    return `${basePath}?${qs.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
      <span>{t('pagerShowing', { from, to, total })}</span>
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
