import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { requireUser } from '@/lib/session';
import { can, ROLE_LABEL } from '@/lib/rbac';
import { getSiteSettings } from '@/lib/settings';
import { LOSLogo } from '@/components/los-logo';
import { MobileNav, SideNav, type NavGroup } from '@/components/nav';
import { SidebarScroll } from '@/components/sidebar-scroll';
import { MainScroll } from '@/components/main-scroll';
import { UserMenu } from '@/components/user-menu';
import { Alert } from '@/components/ui';
import { logoutAction } from '@/app/login/actions';
import { SidebarLanguageSwitcher } from '@/components/language-switcher';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // ── First-login profile gate ─────────────────────────────────────────────
  // Always read from the DB (not the session JWT) so it takes effect the
  // moment the server action marks profileCompleted = true, even inside the
  // Joget iframe where the embedded session cookie is reused across requests.
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { profileCompleted: true, companyId: true, superAdmin: true },
  });
  if (!dbUser?.profileCompleted) {
    redirect('/complete-profile');
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── Company assignment gate ───────────────────────────────────────────────
  // Super-admins are exempt — they manage the whole system and don't belong
  // to any single entity.
  if (!dbUser?.superAdmin && !dbUser?.companyId) {
    redirect('/select-company');
  }
  // ─────────────────────────────────────────────────────────────────────────

  const t = await getTranslations('nav');
  const settings = await getSiteSettings();

  const groups: NavGroup[] = [];

  if (can(user.role, 'order:place')) {
    groups.push({
      heading: t('order'),
      items: [
        { href: '/menu', label: t('nextWeeksMenu') },
        { href: '/my-meals', label: 'My Meals' },
        { href: '/orders', label: t('myOrders') },
      ],
    });
  }

  const isSuperAdmin = user.superAdmin;

  if (isSuperAdmin || can(user.role, 'menu:plan')) {
    groups.push({
      heading: t('administration'),
      items: [
        { href: '/admin/cycles', label: t('weeklyMenus') },
        { href: '/admin/restaurants', label: t('restaurants') },
        { href: '/admin/delivery-sites', label: t('deliverySites') },
        { href: '/admin/dishes', label: t('dishesPrices') },
        { href: '/admin/subsidies', label: t('subsidies') },
        { href: '/admin/users', label: t('usersRoles') },
        { href: '/admin/invoices', label: 'Vendor Invoices' },
        ...(isSuperAdmin || can(user.role, 'settings:manage')
          ? [
              { href: '/admin/bulk-refund', label: t('bulkRefund') },
              { href: '/admin/companies', label: 'Companies' },
              { href: '/admin/settings', label: t('settings') },
              { href: '/admin/audit', label: 'Audit Log' },
            ]
          : []),
      ],
    });
  }
  const insights: NavGroup = { heading: t('insights'), items: [] };
  if (isSuperAdmin || can(user.role, 'analytics:view')) insights.items.push({ href: '/analytics', label: t('analytics') });
  if (isSuperAdmin || can(user.role, 'finance:view')) insights.items.push({ href: '/finance', label: t('finance') });
  if (isSuperAdmin || can(user.role, 'kitchen:view'))
    insights.items.push({ href: '/kitchen', label: t('kitchenCounts') });
  if (isSuperAdmin || can(user.role, 'analytics:view'))
    insights.items.push({ href: '/receipt', label: 'Receipt Confirmation' });
  if (insights.items.length) groups.push(insights);

  if (can(user.role, 'delivery:confirm')) {
    groups.push({
      heading: t('reception'),
      items: [{ href: '/reception', label: t('receptionDeliveries') }],
    });
  }

  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {!user.embed ? (
        <header className="shrink-0 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3">
            <Link href="/">
              <LOSLogo size="sm" />
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
      ) : (
        <div className="shrink-0 border-b border-slate-200 bg-white/90 backdrop-blur">
          <MobileNav groups={groups} />
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        {settings.maintenanceMessage ? (
          <div className="shrink-0 mx-auto w-full max-w-[1400px] px-4 pt-4">
            <Alert tone="warning">{settings.maintenanceMessage}</Alert>
          </div>
        ) : null}

        <div className="flex flex-1 overflow-hidden">
          <div className="mx-auto flex w-full max-w-[1400px] gap-6 px-4">
            <aside className="hidden w-56 shrink-0 lg:flex lg:flex-col overflow-hidden">
              <SidebarScroll>
                {user.embed ? <SidebarLanguageSwitcher /> : null}
                <SideNav groups={groups} />
              </SidebarScroll>
            </aside>
            <MainScroll>{children}</MainScroll>
          </div>
        </div>
      </div>
    </div>
  );
}
