import { getLocale } from 'next-intl/server';

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { formatDateTime } from '@/lib/cycle';
import { PageHeader, Section, EmptyState } from '@/components/ui';
import { Pagination, parsePage } from '@/components/pagination';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

// ── Action categories ────────────────────────────────────────────────────────
// Groups the 45+ raw action strings into human-readable categories for the
// filter dropdown. Each entry maps a display label to a list of action prefixes.

const CATEGORIES: { label: string; prefixes: string[] }[] = [
  { label: 'Orders',   prefixes: ['order.', 'meal.'] },
  { label: 'Payments', prefixes: ['payment.'] },
  { label: 'Exports',  prefixes: ['export.'] },
  { label: 'Cycles',   prefixes: ['cycle.', 'menuitem.'] },
  { label: 'Delivery', prefixes: ['delivery.'] },
  { label: 'Users',    prefixes: ['user.', 'auth.'] },
  { label: 'Settings', prefixes: ['settings.', 'subsidy.', 'dish.', 'restaurant.', 'delivery_site.'] },
];

function categoryToActions(category: string): string[] {
  const found = CATEGORIES.find((c) => c.label === category);
  if (!found) return [];
  return found.prefixes;
}

// ── Human-readable summary per action ───────────────────────────────────────

function summarise(action: string, meta: Record<string, unknown> | null): string {
  const m = meta ?? {};
  switch (action) {
    // Orders
    case 'order.checkout':        return `Checked out order ${m.reference ?? ''} — RM ${((Number(m.netSen) || 0) / 100).toFixed(2)}`;
    case 'order.paid_fully_subsidised': return `Order ${m.reference ?? ''} fully subsidised — no payment needed`;
    // Meals
    case 'meal.received':         return `Confirmed meal received for ${m.serviceDate ?? ''}`;
    case 'meal.received.undo':    return `Undid meal receipt for ${m.serviceDate ?? ''}`;
    // Payments
    case 'payment.webhook_unmatched': return `Unmatched HitPay webhook — payment ID: ${m.paymentId ?? '—'}`;
    case 'payment.amount_mismatch':   return `Amount mismatch on order ${m.reference ?? ''} — expected RM ${((Number(m.expectedSen) || 0) / 100).toFixed(2)}, got RM ${((Number(m.paidSen) || 0) / 100).toFixed(2)}`;
    // Exports
    case 'export.reconciliation': return `Exported reconciliation report${m.cycleId ? ` for week ${m.serviceWeek}` : ` (last ${m.weeks} weeks)`} — ${m.rows} rows`;
    case 'export.kitchen':        return `Exported kitchen counts`;
    case 'export.kitchen_employees': return `Exported kitchen per-employee breakdown`;
    case 'export.orders':         return `Exported orders CSV`;
    case 'export.payments':       return `Exported payments CSV`;
    case 'export.subsidy':        return `Exported subsidy summary`;
    case 'export.my-orders':      return `Exported personal order history`;
    case 'export.dishes':         return `Exported dish catalogue`;
    case 'export.restaurants':    return `Exported restaurant list`;
    case 'export.weekly_menu_template': return `Exported weekly menu template`;
    // Cycles
    case 'cycle.create':          return `Created cycle for week ${m.serviceWeekStart ?? ''}`;
    case 'cycle.publish':         return `Published cycle`;
    case 'cycle.unpublish':       return `Unpublished cycle`;
    case 'cycle.close':           return `Closed cycle`;
    case 'cycle.cancel':          return `Cancelled cycle`;
    case 'cycle.update_window':   return `Updated ordering window`;
    case 'cycle.copy_previous':   return `Copied menu from previous cycle`;
    case 'cycle.import_menu':     return `Imported menu — ${m.imported ?? 0} items`;
    case 'cycle.import_menu_failed': return `Menu import failed`;
    case 'cycle.import_menu_rejected': return `Menu import rejected — ${m.reason ?? ''}`;
    case 'menuitem.add':          return `Added dish to menu`;
    case 'menuitem.remove':       return `Removed dish from menu`;
    case 'menuitem.update':       return `Updated menu item`;
    // Delivery
    case 'delivery.confirm':      return `Confirmed delivery for ${m.deliverySiteName ?? ''} on ${m.serviceDate ?? ''}`;
    case 'delivery.unconfirm':    return `Unconfirmed delivery for ${m.deliverySiteName ?? ''}`;
    // Users
    case 'auth.login':            return `Logged in via ${m.provider ?? 'local'}`;
    case 'user.create':           return `Created user ${m.name ?? ''} (${m.staffId ?? ''})`;
    case 'user.update':           return `Updated user ${m.name ?? ''}`;
    case 'user.reset_password':   return `Reset password for user`;
    // Settings
    case 'settings.update':       return `Updated site settings`;
    case 'settings.upload_branding_image': return `Uploaded ${m.kind ?? ''} image`;
    case 'settings.reset_branding_image':  return `Reset ${m.kind ?? ''} image to default`;
    case 'subsidy.create':        return `Created subsidy rule "${m.name ?? ''}"`;
    case 'subsidy.update':        return `Updated subsidy rule "${m.name ?? ''}"`;
    case 'subsidy.delete':        return `Deleted subsidy rule`;
    case 'dish.create':           return `Created dish "${m.name ?? ''}"`;
    case 'dish.update':           return `Updated dish "${m.name ?? ''}"`;
    case 'dish.delete':           return `Deleted dish`;
    case 'dish.deactivate_instead_of_delete': return `Deactivated dish (has order history)`;
    case 'restaurant.create':     return `Created restaurant "${m.name ?? ''}"`;
    case 'restaurant.update':     return `Updated restaurant "${m.name ?? ''}"`;
    case 'restaurant.delete':     return `Deleted restaurant`;
    case 'restaurant.deactivate_instead_of_delete': return `Deactivated restaurant (has order history)`;
    case 'delivery_site.create':  return `Created delivery site "${m.name ?? ''}"`;
    case 'delivery_site.update':  return `Updated delivery site "${m.name ?? ''}"`;
    case 'delivery_site.delete':  return `Deleted delivery site`;
    case 'delivery_site.deactivate_instead_of_delete': return `Deactivated delivery site (in use)`;
    default:                      return action;
  }
}

// ── Action → severity badge ──────────────────────────────────────────────────

function severity(action: string): 'normal' | 'warning' | 'critical' {
  if (action.includes('mismatch') || action.includes('unmatched') || action.includes('failed') || action.includes('rejected'))
    return 'critical';
  if (action.includes('cancel') || action.includes('delete') || action.includes('deactivate') || action.includes('undo'))
    return 'warning';
  return 'normal';
}

const SEVERITY_BADGE: Record<string, string> = {
  normal:   'bg-slate-100 text-slate-600',
  warning:  'bg-amber-100 text-amber-800',
  critical: 'bg-red-100 text-red-700',
};

// ── Page ─────────────────────────────────────────────────────────────────────

type SearchParams = {
  page?: string;
  category?: string;
  from?: string;
  to?: string;
  q?: string;
};

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireCapability('settings:manage');

  const params = await searchParams;
  const locale = await getLocale();
  const page = parsePage(params.page);

  // Date range — default to last 90 days
  const toDate   = params.to   ? new Date(params.to + 'T23:59:59Z')   : new Date();
  const fromDate = params.from ? new Date(params.from + 'T00:00:00Z') : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const category = params.category ?? '';
  const q = params.q?.trim() ?? '';

  // Build where clause
  const actionPrefixes = category ? categoryToActions(category) : [];

  const where: Prisma.AuditLogWhereInput = {
    createdAt: { gte: fromDate, lte: toDate },
    ...(actionPrefixes.length > 0
      ? { OR: actionPrefixes.map((p) => ({ action: { startsWith: p } })) }
      : {}),
  };

  // Free-text search — match against actor name/staffId or entityId
  if (q) {
    const matchingUsers = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { staffId: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    const userIds = matchingUsers.map((u) => u.id);

    where.OR = [
      ...(userIds.length > 0 ? [{ actorId: { in: userIds } }] : []),
      { entityId: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        actor: { select: { name: true, staffId: true, role: true } },
      },
    }),
  ]);

  // Current filter params for pagination + export links
  const filterParams = {
    ...(category ? { category } : {}),
    ...(params.from ? { from: params.from } : {}),
    ...(params.to ? { to: params.to } : {}),
    ...(q ? { q } : {}),
  };

  const exportHref = `/api/exports/audit?${new URLSearchParams({
    ...filterParams,
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
  }).toString()}`;

  return (
    <>
      <PageHeader
        title="Audit Log"
        subtitle={`${total.toLocaleString()} event${total === 1 ? '' : 's'} — last 90 days by default`}
        action={
          <a href={exportHref} className="btn-secondary btn-sm">
            Export CSV
          </a>
        }
      />

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <form method="get" className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <label className="label">Category</label>
          <select name="category" defaultValue={category} className="input !w-44 !py-1.5 text-sm">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.label} value={c.label}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">From</label>
          <input
            type="date"
            name="from"
            defaultValue={params.from ?? fromDate.toISOString().slice(0, 10)}
            className="input !py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="label">To</label>
          <input
            type="date"
            name="to"
            defaultValue={params.to ?? toDate.toISOString().slice(0, 10)}
            className="input !py-1.5 text-sm"
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="label">Search</label>
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Name, staff ID or entity ID…"
            className="input !py-1.5 text-sm w-full"
          />
        </div>
        <button type="submit" className="btn-primary btn-sm">Filter</button>
        {Object.keys(filterParams).length > 0 && (
          <a href="/admin/audit" className="text-xs text-slate-400 hover:text-slate-600 self-center">
            Clear
          </a>
        )}
      </form>

      {/* ── Log table ───────────────────────────────────────────────────── */}
      <Section
        title={`${total.toLocaleString()} event${total === 1 ? '' : 's'}`}
        description={
          category
            ? `Filtered to ${category} events between ${fromDate.toLocaleDateString()} – ${toDate.toLocaleDateString()}`
            : `All events between ${fromDate.toLocaleDateString()} – ${toDate.toLocaleDateString()}`
        }
      >
        {logs.length === 0 ? (
          <EmptyState title="No events match your filters" hint="Try widening the date range or clearing the category filter." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Actor</th>
                    <th>Category</th>
                    <th>Event</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const meta = (log.metadata ?? null) as Record<string, unknown> | null;
                    const sev = severity(log.action);
                    const cat = CATEGORIES.find((c) =>
                      c.prefixes.some((p) => log.action.startsWith(p)),
                    )?.label ?? 'Other';

                    return (
                      <tr key={log.id}>
                        <td className="whitespace-nowrap text-xs text-slate-500">
                          {formatDateTime(log.createdAt, locale)}
                        </td>
                        <td>
                          {log.actor ? (
                            <>
                              <div className="text-sm font-medium text-slate-900">{log.actor.name}</div>
                              {log.actor.staffId && (
                                <div className="font-mono text-xs text-slate-400">{log.actor.staffId}</div>
                              )}
                              <div className="text-xs text-slate-400 capitalize">{log.actor.role.toLowerCase()}</div>
                            </>
                          ) : (
                            <span className="text-xs text-slate-400">System</span>
                          )}
                        </td>
                        <td>
                          <span className="text-xs text-slate-500">{cat}</span>
                        </td>
                        <td>
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium mb-1 ${SEVERITY_BADGE[sev]}`}>
                            {log.action}
                          </span>
                          <div className="text-xs text-slate-600">{summarise(log.action, meta)}</div>
                        </td>
                        <td className="font-mono text-xs text-slate-500">
                          {log.entityId ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              basePath="/admin/audit"
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              searchParams={{ ...filterParams }}
            />
          </>
        )}
      </Section>
    </>
  );
}
