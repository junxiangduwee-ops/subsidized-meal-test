import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { formatSen } from '@/lib/money';
import { formatWeekRange } from '@/lib/cycle';
import { getLocale } from 'next-intl/server';
import { PageHeader, Section, EmptyState, StatusBadge } from '@/components/ui';
import { Pagination, parsePage } from '@/components/pagination';
import { InvoiceUploadDialog, InvoiceReviewDialog } from './invoice-dialogs';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  PAID: 'Paid',
  DISPUTED: 'Disputed',
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  PENDING:  'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  PAID:     'bg-blue-100 text-blue-800',
  DISPUTED: 'bg-red-100 text-red-800',
};

type SearchParams = {
  page?: string;
  cycle?: string;
  restaurant?: string;
  status?: string;
};

export default async function AdminInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireCapability('catalogue:manage');

  const params = await searchParams;
  const locale = await getLocale();
  const page = parsePage(params.page);

  const selectedCycleId = params.cycle ?? '';
  const selectedRestaurantId = params.restaurant ?? '';
  const selectedStatus = params.status ?? '';

  // Cycles for filter dropdown — recent closed/fulfilled only
  const cycles = await prisma.menuCycle.findMany({
    where: { status: { in: ['PUBLISHED', 'CLOSED', 'FULFILLED'] } },
    orderBy: { serviceWeekStart: 'desc' },
    take: 26,
    select: { id: true, serviceWeekStart: true, status: true },
  });

  // Restaurants for filter dropdown
  const restaurants = await prisma.restaurant.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  const where = {
    ...(selectedCycleId ? { cycleId: selectedCycleId } : {}),
    ...(selectedRestaurantId ? { restaurantId: selectedRestaurantId } : {}),
    ...(selectedStatus ? { status: selectedStatus as 'PENDING' | 'APPROVED' | 'PAID' | 'DISPUTED' } : {}),
  };

  const [total, invoices, summary] = await Promise.all([
    prisma.vendorInvoice.count({ where }),
    prisma.vendorInvoice.findMany({
      where,
      orderBy: [{ cycle: { serviceWeekStart: 'desc' } }, { restaurant: { name: 'asc' } }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        restaurant: { select: { id: true, name: true } },
        cycle: { select: { id: true, serviceWeekStart: true } },
        uploadedBy: { select: { name: true } },
        reviewedBy: { select: { name: true } },
      },
    }),
    // Summary counts by status for the current filter
    prisma.vendorInvoice.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      _sum: { amountSen: true },
    }),
  ]);

  const totalAmount = summary.reduce((s, g) => s + (g._sum.amountSen ?? 0), 0);
  const pendingCount = summary.find((g) => g.status === 'PENDING')?._count._all ?? 0;
  const pendingAmount = summary.find((g) => g.status === 'PENDING')?._sum.amountSen ?? 0;

  const filterParams = {
    ...(selectedCycleId ? { cycle: selectedCycleId } : {}),
    ...(selectedRestaurantId ? { restaurant: selectedRestaurantId } : {}),
    ...(selectedStatus ? { status: selectedStatus } : {}),
  };

  return (
    <>
      <PageHeader
        title="Vendor Invoices"
        subtitle="Upload and track invoices from restaurants by service week"
        action={
          <InvoiceUploadDialog cycles={cycles} restaurants={restaurants} locale={locale} />
        }
      />

      {/* ── Summary cards ─────────────────────────────────────────────── */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
          <p className="text-xs text-slate-500">Total Invoiced</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{formatSen(totalAmount)}</p>
          <p className="text-xs text-slate-400">{total} invoice{total !== 1 ? 's' : ''}</p>
        </div>
        <div className={`rounded-xl border px-5 py-4 ${pendingCount > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
          <p className="text-xs text-slate-500">Awaiting Review</p>
          <p className={`mt-1 text-2xl font-semibold ${pendingCount > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
            {formatSen(pendingAmount)}
          </p>
          <p className="text-xs text-slate-400">{pendingCount} pending</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
          <p className="text-xs text-slate-500">Status Breakdown</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {summary.map((g) => (
              <span
                key={g.status}
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[g.status] ?? 'bg-slate-100 text-slate-600'}`}
              >
                {STATUS_LABEL[g.status] ?? g.status}: {g._count._all}
              </span>
            ))}
            {summary.length === 0 && <span className="text-xs text-slate-400">No invoices</span>}
          </div>
        </div>
      </div>

      <Section
        title={`${total} Invoice${total !== 1 ? 's' : ''}`}
        description="Filter by week, restaurant or status. Click a row to review or update."
        action={
          <form method="get" className="flex flex-wrap items-center gap-2">
            <select name="cycle" defaultValue={selectedCycleId} className="input !w-44 !py-1 text-xs">
              <option value="">All weeks</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {formatWeekRange(c.serviceWeekStart, locale)}
                </option>
              ))}
            </select>
            <select name="restaurant" defaultValue={selectedRestaurantId} className="input !w-40 !py-1 text-xs">
              <option value="">All restaurants</option>
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <select name="status" defaultValue={selectedStatus} className="input !w-32 !py-1 text-xs">
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <button type="submit" className="btn-secondary btn-sm">Filter</button>
            {Object.keys(filterParams).length > 0 && (
              <a href="/admin/invoices" className="text-xs text-slate-400 hover:text-slate-600">Clear</a>
            )}
          </form>
        }
      >
        {invoices.length === 0 ? (
          <EmptyState
            title="No invoices found"
            hint="Upload an invoice using the button above, or try clearing your filters."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Restaurant</th>
                    <th>Service Week</th>
                    <th>Invoice No.</th>
                    <th>Invoice Date</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                    <th>File</th>
                    <th>Uploaded By</th>
                    <th>Notes</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="font-medium text-slate-900">{inv.restaurant.name}</td>
                      <td className="whitespace-nowrap text-sm text-slate-600">
                        {formatWeekRange(inv.cycle.serviceWeekStart, locale)}
                      </td>
                      <td className="font-mono text-xs text-slate-700">
                        {inv.invoiceNumber ?? '—'}
                      </td>
                      <td className="text-xs text-slate-600 whitespace-nowrap">
                        {inv.invoiceDate
                          ? new Date(inv.invoiceDate).toLocaleDateString(locale)
                          : '—'}
                      </td>
                      <td className="num font-semibold text-slate-900">{formatSen(inv.amountSen)}</td>
                      <td>
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[inv.status] ?? ''}`}>
                          {STATUS_LABEL[inv.status] ?? inv.status}
                        </span>
                        {inv.reviewNote && (
                          <div className="mt-0.5 text-xs text-slate-400 max-w-[160px] truncate" title={inv.reviewNote}>
                            {inv.reviewNote}
                          </div>
                        )}
                      </td>
                      <td>
                        {inv.fileUrl ? (
                          <a
                            href={inv.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-brand-700 hover:underline"
                          >
                            {inv.fileName ?? 'View'}
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">No file</span>
                        )}
                      </td>
                      <td className="text-xs text-slate-600">
                        {inv.uploadedBy?.name ?? '—'}
                      </td>
                      <td className="max-w-[160px] text-xs text-slate-500 truncate" title={inv.notes ?? ''}>
                        {inv.notes ?? '—'}
                      </td>
                      <td>
                        <InvoiceReviewDialog invoice={inv} locale={locale} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              basePath="/admin/invoices"
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              searchParams={filterParams}
            />
          </>
        )}
      </Section>
    </>
  );
}
