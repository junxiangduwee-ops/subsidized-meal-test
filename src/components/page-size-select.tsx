'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * "Rows per page" dropdown for a paginated table.
 *
 * Needs to be a client component since selecting an option triggers a
 * navigation on change - everything else in the pager is a plain server
 * link. Changing the page size always resets back to page 1, since the
 * current page number may no longer make sense at the new size.
 */
export function PageSizeSelect({
  pageSize,
  options,
  label,
}: {
  pageSize: number;
  options: number[];
  label: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('pageSize', e.target.value);
    params.set('page', '1');
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-500">
      {label}
      <select
        value={pageSize}
        onChange={handleChange}
        className="input !w-auto !py-1 pr-6 text-xs"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
