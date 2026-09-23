'use client';

/**
 * "I received my meal" button shown next to each PAID order item on service day.
 * Optimistic UI — disables immediately on click, flips to a green badge on success.
 */

import { useState, useTransition } from 'react';
import { confirmMealReceived, undoMealReceived } from '@/app/(app)/menu/actions.receipt';

type Props = {
  orderItemId: string;
  receivedAt: Date | string | null;
  receivedBySystem: boolean;
  /** Only true before 18:00 on the service date AND when employee confirmed (not cron). */
  canUndo: boolean;
  receivedAtLabel?: string;
};

export function MealReceiptButton({ orderItemId, receivedAt, receivedBySystem, canUndo, receivedAtLabel }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [localConfirmed, setLocalConfirmed] = useState(Boolean(receivedAt));
  const [localBySystem, setLocalBySystem] = useState(receivedBySystem);

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmMealReceived(orderItemId);
      if (!result.ok) setError(result.error ?? 'Something went wrong.');
      else { setLocalConfirmed(true); setLocalBySystem(false); }
    });
  }

  function handleUndo() {
    setError(null);
    startTransition(async () => {
      const result = await undoMealReceived(orderItemId);
      if (!result.ok) setError(result.error ?? 'Could not undo.');
      else setLocalConfirmed(false);
    });
  }

  if (localConfirmed) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            {localBySystem ? 'Auto-confirmed at 6 PM' : 'Received'}
          </span>
          {receivedAtLabel && <span className="text-xs text-slate-400">{receivedAtLabel}</span>}
          {canUndo && !localBySystem && (
            <button type="button" onClick={handleUndo} disabled={isPending}
              className="text-xs text-slate-400 underline decoration-dotted hover:text-slate-600 disabled:opacity-50">
              Undo
            </button>
          )}
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={handleConfirm} disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60">
        {isPending ? (
          <>
            <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Confirming…
          </>
        ) : (
          <>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            I received my meal
          </>
        )}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
