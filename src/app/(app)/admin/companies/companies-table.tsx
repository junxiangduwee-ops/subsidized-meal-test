'use client';

import { useState, useTransition } from 'react';
import { toggleEntitlement, upsertCompany, addEntity } from './actions';

type CompanyRow = {
  id: string;
  code: string;
  name: string;
  entityId: string;
  entityName: string;
  enabled: boolean;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
};

type EntityRow = {
  id: string;
  code: string;
  name: string;
  configured: boolean;
  companyCount: number;
};

export function CompaniesTable({
  companyRows,
  entityRows,
}: {
  companyRows: CompanyRow[];
  entityRows: EntityRow[];
}) {
  const [, startTransition] = useTransition();
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [showEntityForm, setShowEntityForm] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [entityError, setEntityError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggle(companyId: string, current: boolean) {
    startTransition(async () => {
      await toggleEntitlement(companyId, !current);
    });
  }

  async function handleAddCompany(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCompanyError(null);
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    const result = await upsertCompany({
      code: String(fd.get('code') ?? ''),
      name: String(fd.get('name') ?? ''),
      entityId: String(fd.get('entityId') ?? ''),
      bankName: String(fd.get('bankName') ?? '') || null,
      bankAccountName: String(fd.get('bankAccountName') ?? '') || null,
      bankAccountNumber: String(fd.get('bankAccountNumber') ?? '') || null,
    });
    setSaving(false);
    if (result.error) {
      setCompanyError(result.error);
    } else {
      setShowCompanyForm(false);
    }
  }

  async function handleAddEntity(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEntityError(null);
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    const result = await addEntity({
      code: String(fd.get('code') ?? ''),
      name: String(fd.get('name') ?? ''),
      hitpayApiKey: String(fd.get('hitpayApiKey') ?? '') || undefined,
      hitpaySalt:   String(fd.get('hitpaySalt')   ?? '') || undefined,
    });
    setSaving(false);
    if (result.error) {
      setEntityError(result.error);
    } else {
      setShowEntityForm(false);
    }
  }

  return (
    <div className="space-y-8">

      {/* ── Entities ──────────────────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Entities</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Each entity maps to a HitPay account. Set env vars per entity; admin manages name and code.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setShowEntityForm((v) => !v); setEntityError(null); }}
            className="btn-secondary btn-sm"
          >
            {showEntityForm ? 'Cancel' : '+ Add Entity'}
          </button>
        </div>

        {showEntityForm ? (
          <form onSubmit={handleAddEntity} className="card p-4 space-y-3 mb-4">
            <h3 className="text-sm font-semibold text-slate-900">New Entity</h3>
            {entityError ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{entityError}</p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-600">
                Code <span className="text-red-500">*</span>
                <input name="code" className="input mt-1" placeholder="newentity" required
                  pattern="[a-z0-9]+" title="Lowercase letters and numbers only" />
                <span className="mt-0.5 block text-xs text-slate-400">Lowercase letters and numbers only.</span>
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Display Name <span className="text-red-500">*</span>
                <input name="name" className="input mt-1" placeholder="MR DIY New Entity" required />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-600">
                HitPay API Key
                <input name="hitpayApiKey" type="password" className="input mt-1" placeholder="Leave blank to configure later" autoComplete="off" />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                HitPay Webhook Salt
                <input name="hitpaySalt" type="password" className="input mt-1" placeholder="Leave blank to configure later" autoComplete="off" />
              </label>
            </div>
            <p className="text-xs text-slate-500">
              Credentials are encrypted before saving. You can leave them blank now and add them later by editing the entity.
            </p>
            <div className="flex justify-end">
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Saving…' : 'Save Entity'}
              </button>
            </div>
          </form>
        ) : null}

        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">HitPay Credentials</th>
                <th className="px-4 py-3">Companies</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entityRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                    No entities yet. Add one above.
                  </td>
                </tr>
              ) : entityRows.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{e.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{e.name}</td>
                  <td className="px-4 py-3">
                    {e.configured ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Configured
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-red-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                        Missing — set{' '}
                        <code className="rounded bg-red-50 px-1 font-mono">
                          HITPAY_API_KEY_{e.code.toUpperCase()}
                        </code>
                        {' '}and{' '}
                        <code className="rounded bg-red-50 px-1 font-mono">
                          HITPAY_SALT_{e.code.toUpperCase()}
                        </code>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{e.companyCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Companies ─────────────────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Companies</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Each company maps to one entity. Entitlement controls whether employees can order.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setShowCompanyForm((v) => !v); setCompanyError(null); }}
            className="btn-primary"
          >
            {showCompanyForm ? 'Cancel' : '+ Add Company'}
          </button>
        </div>

        {showCompanyForm ? (
          <form onSubmit={handleAddCompany} className="card p-4 space-y-3 mb-4">
            <h3 className="text-sm font-semibold text-slate-900">New Company</h3>
            {companyError ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{companyError}</p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-xs font-medium text-slate-600">
                Code <span className="text-red-500">*</span>
                <input name="code" className="input mt-1" placeholder="MRD-RET" required />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Company Name <span className="text-red-500">*</span>
                <input name="name" className="input mt-1" placeholder="MR DIY Retail Sdn Bhd" required />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Entity <span className="text-red-500">*</span>
                <select name="entityId" className="input mt-1" required>
                  <option value="">Select entity…</option>
                  {entityRows.map((e) => (
                    <option key={e.id} value={e.code}>
                      {e.name}{!e.configured ? ' ⚠ no HitPay key' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-xs font-medium text-slate-600">
                Bank Name
                <input name="bankName" className="input mt-1" placeholder="Maybank" />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Account Name
                <input name="bankAccountName" className="input mt-1" placeholder="MR DIY Retail Sdn Bhd" />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Account Number
                <input name="bankAccountNumber" className="input mt-1" placeholder="1234567890" />
              </label>
            </div>
            <div className="flex justify-end">
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Saving…' : 'Save Company'}
              </button>
            </div>
          </form>
        ) : null}

        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Company Name</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Bank Account</th>
                <th className="px-4 py-3">Entitlement</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companyRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No companies yet. Add one above.
                  </td>
                </tr>
              ) : companyRows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{row.name}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{row.entityName}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {row.bankAccountNumber ? (
                      <div>
                        <div className="font-medium text-slate-800">{row.bankAccountName ?? '—'}</div>
                        <div className="text-slate-500">{row.bankName} · {row.bankAccountNumber}</div>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${row.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                      {row.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => toggle(row.id, row.enabled)}
                      className={`text-xs font-medium underline underline-offset-2 ${row.enabled ? 'text-red-600 hover:text-red-800' : 'text-emerald-600 hover:text-emerald-800'}`}
                    >
                      {row.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
