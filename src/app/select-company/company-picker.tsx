'use client';

import { useState, useTransition } from 'react';
import { selectCompany } from './actions';

type Company = {
  id: string;
  code: string;
  name: string;
  entityLabel: string;
  enabled: boolean;
};

export function CompanyPicker({ companies }: { companies: Company[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function pick(id: string) {
    setError(null);
    setSelectedId(id);
    startTransition(async () => {
      const result = await selectCompany(id);
      if (result?.error) setError(result.error);
    });
  }

  if (companies.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
        No companies have been configured yet. Please contact the admin team.
      </div>
    );
  }

  return (
    <div className="card overflow-hidden p-0">
      {error ? (
        <p className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>
      ) : null}
      <ul className="divide-y divide-slate-100">
        {companies.map((company) => (
          <li key={company.id}>
            <button
              type="button"
              disabled={pending}
              onClick={() => pick(company.id)}
              className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-emerald-50 disabled:opacity-60 ${
                selectedId === company.id ? 'bg-emerald-50' : ''
              }`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                {company.entityLabel.split(' ').pop()?.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-900">{company.name}</span>
                <span className="block text-xs text-slate-500">{company.entityLabel} · {company.code}</span>
              </span>
              {!company.enabled ? (
                <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                  Disabled
                </span>
              ) : selectedId === company.id && pending ? (
                <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-emerald-300 border-t-emerald-600" />
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
