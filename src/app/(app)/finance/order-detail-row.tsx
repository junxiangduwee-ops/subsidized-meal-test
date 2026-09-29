'use client';

import { useState } from 'react';

type OrderItem = {
  dishName: string;
  quantity: number;
  serviceDate: Date;
};

type OrderDetail = {
  id: string;
  user: {
    name: string;
    staffId: string | null;
    email: string | null;
    department: string | null;
  };
  deliverySite: { name: string } | null;
  items: OrderItem[];
};

/**
 * Renders two things:
 *  1. A "View Details" / "Hide" button cell — sits in the main <tr> as the
 *     last <td>, so the parent row must leave a cell slot open for it.
 *  2. A collapsible <tr> directly below that row containing the PII detail
 *     panel (employee info + per-day meal breakdown).
 *
 * Both are rendered as a fragment so they slot cleanly into a <tbody>.
 */
export function OrderDetailRow({
  order,
  colSpan,
  locale,
}: {
  order: OrderDetail;
  /** Total column count of the table — used to span the detail panel. */
  colSpan: number;
  locale: string;
}) {
  const [open, setOpen] = useState(false);

  // Group items by service date for the per-day breakdown
  const byDay = order.items.reduce<Record<string, OrderItem[]>>((acc, item) => {
    const key = new Date(item.serviceDate).toISOString().slice(0, 10);
    (acc[key] ??= []).push(item);
    return acc;
  }, {});

  const sortedDays = Object.keys(byDay).sort();

  return (
    <>
      {/* Button cell — rendered inside the parent <tr> by the server page */}
      <td>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`btn-sm rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            open
              ? 'bg-brand-100 text-brand-800 hover:bg-brand-200'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          {open ? 'Hide' : 'View Details'}
        </button>
      </td>

      {/* Expandable detail panel — second <tr> below the main row */}
      {open && (
        <tr className="bg-slate-50">
          <td colSpan={colSpan} className="px-4 pb-4 pt-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Employee &amp; Order Details
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Left — employee info */}
                <div className="space-y-1.5">
                  <div className="flex items-baseline gap-2">
                    <span className="w-20 shrink-0 text-xs text-slate-400">Name</span>
                    <span className="text-sm font-medium text-slate-900">{order.user.name}</span>
                  </div>
                  {order.user.staffId && (
                    <div className="flex items-baseline gap-2">
                      <span className="w-20 shrink-0 text-xs text-slate-400">Staff ID</span>
                      <span className="font-mono text-sm text-slate-700">{order.user.staffId}</span>
                    </div>
                  )}
                  {order.user.email && (
                    <div className="flex items-baseline gap-2">
                      <span className="w-20 shrink-0 text-xs text-slate-400">Email</span>
                      <span className="text-sm text-slate-700">{order.user.email}</span>
                    </div>
                  )}
                  {order.user.department && (
                    <div className="flex items-baseline gap-2">
                      <span className="w-20 shrink-0 text-xs text-slate-400">Department</span>
                      <span className="text-sm text-slate-700">{order.user.department}</span>
                    </div>
                  )}
                  {order.deliverySite && (
                    <div className="flex items-baseline gap-2">
                      <span className="w-20 shrink-0 text-xs text-slate-400">Delivery Site</span>
                      <span className="text-sm text-slate-700">{order.deliverySite.name}</span>
                    </div>
                  )}
                </div>

                {/* Right — per-day meal breakdown */}
                <div>
                  <p className="mb-2 text-xs text-slate-400">Items by Day</p>
                  {sortedDays.length === 0 ? (
                    <p className="text-xs text-slate-400">No items</p>
                  ) : (
                    <div className="space-y-2">
                      {sortedDays.map((day) => (
                        <div key={day}>
                          <p className="text-xs font-medium text-slate-500">
                            {new Date(day).toLocaleDateString(locale, {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short',
                            })}
                          </p>
                          <ul className="mt-0.5 space-y-0.5">
                            {byDay[day].map((item, i) => (
                              <li key={i} className="flex items-center gap-1.5 text-xs text-slate-700">
                                <span className="inline-block h-1 w-1 rounded-full bg-slate-300" />
                                {item.dishName}
                                {item.quantity > 1 && (
                                  <span className="text-slate-400">×{item.quantity}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
