'use client';

import { Dialog } from '@/components/dialog';
import { formatSen } from '@/lib/money';

type OrderItem = {
  dishName: string;
  quantity: number;
  serviceDate: Date;
};

type Order = {
  reference: string;
  grossSen: number;
  subsidySen: number;
  netSen: number;
  user: {
    name: string;
    staffId: string | null;
    email: string | null;
    department: string | null;
  };
  deliverySite: { name: string } | null;
  items: OrderItem[];
};

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 py-1.5 border-b border-slate-100 last:border-0">
      <span className="w-28 shrink-0 text-xs text-slate-400">{label}</span>
      <span className="text-sm text-slate-900">{value}</span>
    </div>
  );
}

export function OrderDetailDialog({ order, locale }: { order: Order; locale: string }) {
  // Group items by service date
  const byDay = order.items.reduce<Record<string, OrderItem[]>>((acc, item) => {
    const key = new Date(item.serviceDate).toISOString().slice(0, 10);
    (acc[key] ??= []).push(item);
    return acc;
  }, {});
  const sortedDays = Object.keys(byDay).sort();

  return (
    <Dialog
      trigger={(open) => (
        <button
          type="button"
          onClick={open}
          className="whitespace-nowrap rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
        >
          View Details
        </button>
      )}
      title={`Order ${order.reference}`}
      width="max-w-lg"
    >
      {() => (
        <div className="space-y-5">

          {/* Employee */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Employee
            </p>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-1">
              <Row label="Name"       value={order.user.name} />
              <Row label="Staff ID"   value={order.user.staffId} />
              <Row label="Email"      value={order.user.email} />
              <Row label="Department" value={order.user.department} />
              <Row label="Delivery Site" value={order.deliverySite?.name} />
            </div>
          </div>

          {/* Meal breakdown by day */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Meals by Day
            </p>
            {sortedDays.length === 0 ? (
              <p className="text-sm text-slate-400">No items on this order.</p>
            ) : (
              <div className="space-y-3">
                {sortedDays.map((day) => (
                  <div key={day} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="mb-1.5 text-xs font-medium text-slate-500">
                      {new Date(day).toLocaleDateString(locale, {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </p>
                    <ul className="space-y-1">
                      {byDay[day].map((item, i) => (
                        <li key={i} className="flex items-center justify-between text-sm text-slate-700">
                          <span>{item.dishName}</span>
                          {item.quantity > 1 && (
                            <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-500">
                              ×{item.quantity}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Order summary */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Order Summary
            </p>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-1">
              <Row label="Food Total" value={formatSen(order.grossSen)} />
              <Row label="Subsidy"    value={`−${formatSen(order.subsidySen)}`} />
              <Row label="Staff Pays" value={formatSen(order.netSen)} />
            </div>
          </div>

        </div>
      )}
    </Dialog>
  );
}
