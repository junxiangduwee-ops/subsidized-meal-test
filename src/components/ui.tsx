import type { ReactNode } from 'react';

import type { CyclePhase } from '@/lib/cycle';

import { getTranslations } from 'next-intl/server';

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle ? <div className="mt-1.5 text-sm text-slate-500">{subtitle}</div> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'positive' | 'warning';
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-700'
      : tone === 'warning'
        ? 'text-amber-700'
        : 'text-slate-900';
  return (
    <div className="card p-4 transition-shadow hover:shadow">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums leading-none ${toneClass}`}>
        {value}
      </div>
      {hint ? <div className="mt-1.5 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

const PHASE_STYLES: Record<CyclePhase, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  SCHEDULED: 'bg-sky-100 text-sky-800',
  OPEN: 'bg-emerald-100 text-emerald-800',
  CLOSED: 'bg-amber-100 text-amber-800',
  SERVING: 'bg-brand-100 text-brand-800',
  COMPLETED: 'bg-slate-100 text-slate-600',
  CANCELLED: 'bg-red-100 text-red-800',
};

export async function PhaseBadge({ phase }: { phase: CyclePhase }) {
  const t = await getTranslations('cyclePhase');
  return <span className={`badge ${PHASE_STYLES[phase]}`}>{t(phase)}</span>;
}

const STATUS_STYLES: Record<string, string> = {
  PAID: 'bg-emerald-100 text-emerald-800',
  SUCCEEDED: 'bg-emerald-100 text-emerald-800',
  AWAITING_PAYMENT: 'bg-amber-100 text-amber-800',
  PENDING: 'bg-amber-100 text-amber-800',
  CART: 'bg-slate-100 text-slate-700',
  CANCELLED: 'bg-red-100 text-red-800',
  FAILED: 'bg-red-100 text-red-800',
  REFUNDED: 'bg-purple-100 text-purple-800',
};

export async function StatusBadge({ status }: { status: string }) {
  const t = await getTranslations('orderStatus');
  const label = t.has(status) ? t(status) : status.replace(/_/g, ' ').toLowerCase();
  return (
    <span className={`badge ${STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700'}`}>
      {label}
    </span>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-base font-medium text-slate-700">{title}</p>
      {hint ? <p className="max-w-md text-sm text-slate-500">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error' | 'success' | 'warning';
  children: ReactNode;
}) {
  const styles = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    error: 'border-red-200 bg-red-50 text-red-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
  }[tone];
  return <div className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

export function Section({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description ? <p className="text-xs text-slate-500">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
