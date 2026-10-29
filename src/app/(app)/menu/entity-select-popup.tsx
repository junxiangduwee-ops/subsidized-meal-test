'use client';

import { ENTITIES, type EntityId } from '@/lib/entity-config';

type Props = {
  onConfirm: (entityId: EntityId) => void;
  onCancel: () => void;
};

export function EntitySelectPopup({ onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-base font-semibold text-slate-900">Select your entity</h2>
        <p className="mt-1 text-sm text-slate-500">
          Please select which MR DIY entity you belong to. Your payment will go to the correct account.
        </p>

        <div className="mt-4 grid gap-2">
          {ENTITIES.map((entity) => (
            <button
              key={entity.id}
              type="button"
              onClick={() => onConfirm(entity.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left text-sm font-medium text-slate-800 transition hover:border-emerald-400 hover:bg-emerald-50"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                {entity.label.split(' ').pop()?.slice(0, 1)}
              </span>
              {entity.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="mt-4 w-full text-center text-xs text-slate-400 hover:text-slate-600"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
