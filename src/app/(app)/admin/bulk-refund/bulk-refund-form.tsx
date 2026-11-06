'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { bulkRefundOrders, type BulkRefundResult } from './bulk-refund-action';

export type OrderRow = {
  id: string;
  reference: string;
  userName: string;
  staffId: string | null;
  items: { dishName: string; restaurantName: string; quantity: number }[];
  amountLabel: string;
};

type Props = {
  orders: OrderRow[];
};

export function BulkRefundForm({ orders }: Props) {
  const t = useTranslations('bulkRefund');
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [result, setResult] = useState<BulkRefundResult | null>(null);

  if (orders.length === 0) {
    return <p className="text-sm text-slate-500 p-5">{t('noOrders')}</p>;
  }

  const allChecked = checked.size === orders.length;

  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(orders.map((o) => o.id)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (checked.size === 0) return;
    setStatus('loading');
    const res = await bulkRefundOrders([...checked]);
    setResult(res);
    setStatus('done');
  }

  if (status === 'done' && result) {
    return (
      <div className="p-5 space-y-4">
        {!result.ok ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {result.error}
          </div>
        ) : (
          <>
            <div
              className={`rounded-lg border px-4 py-3 text-sm ${
                result.failed === 0
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              {t('resultSummary', { total: result.total, succeeded: result.succeeded, failed: result.failed })}
            </div>
            {result.results.length > 0 && (
              <table className="table text-sm">
                <thead>
                  <tr>
                    <th>{t('reference')}</th>
                    <th>{t('statusCol')}</th>
                    <th>{t('detail')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((r) => (
                    <tr key={r.orderId}>
                      <td className="font-mono text-xs">{r.reference}</td>
                      <td>
                        <span
                          className={`badge ${
                            r.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {r.ok ? t('refunded') : t('failed')}
                        </span>
                      </td>
                      <td className="text-xs text-slate-500">{r.ok ? (r.refundId ?? '') : r.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
        <button
          type="button"
          onClick={() => {
            setStatus('idle');
            setResult(null);
            setChecked(new Set());
          }}
          className="btn-secondary btn-sm"
        >
          {t('back')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-10">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-slate-300"
                />
              </th>
              <th>{t('employee')}</th>
              <th>{t('meals')}</th>
              <th className="num">{t('amount')}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={checked.has(order.id)}
                    onChange={(e) => {
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(order.id);
                        else next.delete(order.id);
                        return next;
                      });
                    }}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </td>
                <td>
                  <div className="font-medium text-slate-900">{order.userName}</div>
                  {order.staffId ? (
                    <div className="text-xs text-slate-500 font-mono">{order.staffId}</div>
                  ) : null}
                </td>
                <td>
                  <ul className="space-y-0.5">
                    {order.items.map((item, i) => (
                      <li key={i} className="text-xs text-slate-700">
                        {item.dishName} ×{item.quantity}
                        <span className="text-slate-400"> · {item.restaurantName}</span>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="tabular-nums text-right">{order.amountLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 border-t border-slate-100 p-5">
        <button
          type="submit"
          disabled={checked.size === 0 || status === 'loading'}
          className="btn-primary disabled:opacity-50"
        >
          {status === 'loading'
            ? t('processing')
            : t('refundSelected', { count: checked.size })}
        </button>
        {checked.size > 0 ? (
          <span className="text-xs text-slate-500">
            {t('selectedCount', { count: checked.size })}
          </span>
        ) : (
          <span className="text-xs text-slate-400">{t('noneSelected')}</span>
        )}
      </div>
    </form>
  );
}
