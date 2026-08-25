import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { requireUser } from '@/lib/session';
import { can, ROLE_LABEL } from '@/lib/rbac';
import { getSiteSettings } from '@/lib/settings';
import { MobileNav, SideNav, type NavGroup } from '@/components/nav';
import { UserMenu } from '@/components/user-menu';
import { Alert } from '@/components/ui';
import { logoutAction } from '@/app/login/actions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const t = await getTranslations('nav');
  const settings = await getSiteSettings();

  const groups: NavGroup[] = [];

  if (can(user.role, 'order:place')) {
    groups.push({
      heading: t('order'),
      items: [
        { href: '/menu', label: t('nextWeeksMenu') },
        { href: '/orders', label: t('myOrders') },
      ],
    });
  }

  if (can(user.role, 'menu:plan')) {
    groups.push({
      heading: t('administration'),
      items: [
        { href: '/admin/cycles', label: t('weeklyMenus') },
        { href: '/admin/restaurants', label: t('restaurants') },
        { href: '/admin/delivery-sites', label: t('deliverySites') },
        { href: '/admin/dishes', label: t('dishesPrices') },
        { href: '/admin/subsidies', label: t('subsidies') },
        { href: '/admin/users', label: t('usersRoles') },
        ...(can(user.role, 'settings:manage') ? [{ href: '/admin/settings', label: t('settings') }] : []),
      ],
    });
  }

  const insights: NavGroup = { heading: t('insights'), items: [] };
  if (can(user.role, 'analytics:view')) insights.items.push({ href: '/analytics', label: t('analytics') });
  if (can(user.role, 'finance:view')) insights.items.push({ href: '/finance', label: t('finance') });
  if (can(user.role, 'kitchen:view'))
    insights.items.push({ href: '/kitchen', label: t('kitchenCounts') });
  if (insights.items.length) groups.push(insights);

  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={settings.logoUrl} alt="" className="h-8 w-8 object-contain" />
            <span className="text-sm font-semibold text-slate-900">{settings.siteName}</span>
          </Link>

          <div className="flex items-center gap-3">
            <UserMenu
              name={user.name}
              roleLabel={ROLE_LABEL[user.role]}
              department={user.department}
              initials={initials}
              canViewOrders={can(user.role, 'order:place')}
              onLogout={logoutAction}
            />
          </div>
        </div>

        <MobileNav groups={groups} />
      </header>

      {settings.maintenanceMessage ? (
        <div className="mx-auto max-w-[1400px] px-4 pt-4">
          <Alert tone="warning">{settings.maintenanceMessage}</Alert>
        </div>
      ) : null}

      <div className="mx-auto flex max-w-[1400px] gap-6 px-4 py-6">
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-24">
            <SideNav groups={groups} />
          </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
