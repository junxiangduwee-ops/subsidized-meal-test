'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ScrollFadeRow } from '@/components/scroll-fade-row';

export type NavItem = { href: string; label: string };
export type NavGroup = { heading: string; items: NavItem[] };

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

export function SideNav({ groups }: { groups: NavGroup[] }) {
  const isActive = useIsActive();

  return (
    <nav className="space-y-6">
      {groups.map((group) => (
        <div key={group.heading}>
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {group.heading}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`relative block rounded-lg px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-brand-50 font-medium text-brand-800'
                        : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900'
                    }`}
                  >
                    {active ? (
                      <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand-600" />
                    ) : null}
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * Horizontally scrolling nav for narrow screens. Employees order lunch on
 * their phones, so the sidebar cannot simply disappear below `lg`.
 */
export function MobileNav({ groups }: { groups: NavGroup[] }) {
  const isActive = useIsActive();
  const items = groups.flatMap((g) => g.items);

  if (items.length <= 1) return null;

  return (
    <nav aria-label="Sections" className="border-t border-slate-200 bg-white px-4 py-2 lg:hidden">
      <ScrollFadeRow innerClassName="gap-1" fadeColorClassName="from-white">
        {items.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors ${
                active
                  ? 'bg-brand-600 font-medium text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </ScrollFadeRow>
    </nav>
  );
}
