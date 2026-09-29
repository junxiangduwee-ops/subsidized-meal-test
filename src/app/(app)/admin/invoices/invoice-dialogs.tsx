'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Dialog } from '@/components/dialog';
import { ActionForm } from '@/components/action-form';
import { uploadInvoice, reviewInvoice, deleteInvoice } from './actions';

// ── Types ────────────────────────────────────────────────────────────────────

type Cycle      = { id: string; serviceWeekStart: Date };
type Restaurant = { id: string; name: string };

type Invoice = {
  id: string;
  invoiceNumber: string | null;
  invoiceDate:   Date | null;
  amountSen:     number;
  notes:         string | null;
  reviewNote:    string | null;
  status:        string;
  fileUrl:       string | null;
  fileName:      string | null;
  restaurant:    { id: string; name: string };
  cycle:         { id: string; serviceWeekStart: Date };
  uploadedBy:    { name: string } | null;
  reviewedBy:    { name: string } | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatWeek(date: Date, locale: string): string {
  return new Date(date).toLocaleDateString(locale, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function senToRm(sen: number): string {
  return (sen / 100).toFixed(2);
}

const STATUS_OPTIONS = [
  { value: 'PENDING',  label: 'Pending'  },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'PAID',     label: 'Paid'     },
  { value: 'DISPUTED', label: 'Disputed' },
];

const STATUS_BADGE: Record<string, string> = {
  PENDING:  'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  PAID:     'bg-blue-100 text-blue-800',
  DISPUTED: 'bg-red-100 text-red-800',
};

// ── File input helper ─────────────────────────────────────────────────────────

function FileField({ label = 'Invoice File', hint }: { label?: string; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="file"
        name="invoiceFile"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        className="block w-full text-sm text-slate-600
          file:mr-3 file:rounded-md file:border-0
          file:bg-slate-100 file:px-3 file:py-1.5
          file:text-sm file:font-medium file:text-slate-700
          hover:file:bg-slate-200 cursor-pointer"
      />
      <p className="mt-1 text-xs text-slate-400">
        {hint ?? 'PDF, PNG, JPEG or WEBP — max 10 MB. Stored on the server.'}
      </p>
    </div>
  );
}

// ── Upload dialog ─────────────────────────────────────────────────────────────

export function InvoiceUploadDialog({
  cycles,
  restaurants,
  locale,
}: {
  cycles:      Cycle[];
  restaurants: Restaurant[];
  locale:      string;
}) {
  return (
    <Dialog
      trigger={(open) => (
        <button type="button" onClick={open} className="btn-primary btn-sm">
          + Upload Invoice
        </button>
      )}
      title="Upload Vendor Invoice"
      width="max-w-xl"
    >
      {(close) => (
        <ActionForm
          action={uploadInvoice}
          submitLabel="Upload Invoice"
          onSuccess={close}
          className="space-y-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Restaurant *</label>
              <select name="restaurantId" required className="input">
                <option value="">Select restaurant…</option>
                {restaurants.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Service Week *</label>
              <select name="cycleId" required className="input">
                <option value="">Select week…</option>
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatWeek(c.serviceWeekStart, locale)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Invoice Number</label>
              <input
                name="invoiceNumber"
                className="input"
                placeholder="e.g. INV-2024-001"
              />
            </div>
            <div>
              <label className="label">Invoice Date</label>
              <input type="date" name="invoiceDate" className="input" />
            </div>
          </div>

          <div>
            <label className="label">Amount (RM) *</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
                RM
              </span>
              <input
                name="amountSen"
                type="number"
                step="0.01"
                min="0.01"
                required
                className="input pl-9"
                placeholder="0.00"
              />
            </div>
          </div>

          <FileField />

          <div>
            <label className="label">Internal Notes</label>
            <textarea
              name="notes"
              rows={2}
              className="input"
              placeholder="Any notes for finance review…"
            />
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}

// ── Review / edit dialog ──────────────────────────────────────────────────────

export function InvoiceReviewDialog({
  invoice,
  locale,
}: {
  invoice: Invoice;
  locale:  string;
}) {
  const [, deleteAction] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      await deleteInvoice(formData);
    },
    null,
  );

  return (
    <Dialog
      trigger={(open) => (
        <button type="button" onClick={open} className="btn-secondary btn-sm">
          Review
        </button>
      )}
      title={`Invoice — ${invoice.restaurant.name}`}
      width="max-w-xl"
    >
      {(close) => (
        <div className="space-y-5">
          {/* Read-only header strip */}
          <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-slate-900">{invoice.restaurant.name}</span>
                <span className="ml-2 text-slate-500">
                  {formatWeek(invoice.cycle.serviceWeekStart, locale)}
                </span>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[invoice.status] ?? ''}`}
              >
                {STATUS_OPTIONS.find((s) => s.value === invoice.status)?.label ?? invoice.status}
              </span>
            </div>
            {invoice.uploadedBy && (
              <p className="mt-1 text-xs text-slate-400">
                Uploaded by {invoice.uploadedBy.name}
                {invoice.reviewedBy ? ` · Reviewed by ${invoice.reviewedBy.name}` : ''}
              </p>
            )}
          </div>

          {/* Edit + review form */}
          <ActionForm
            action={reviewInvoice}
            submitLabel="Save Changes"
            onSuccess={close}
            className="space-y-4"
          >
            <input type="hidden" name="id" value={invoice.id} />

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Invoice Number</label>
                <input
                  name="invoiceNumber"
                  defaultValue={invoice.invoiceNumber ?? ''}
                  className="input"
                  placeholder="INV-2024-001"
                />
              </div>
              <div>
                <label className="label">Invoice Date</label>
                <input
                  type="date"
                  name="invoiceDate"
                  defaultValue={
                    invoice.invoiceDate
                      ? new Date(invoice.invoiceDate).toISOString().slice(0, 10)
                      : ''
                  }
                  className="input"
                />
              </div>
            </div>

            <div>
              <label className="label">Amount (RM) *</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
                  RM
                </span>
                <input
                  name="amountSen"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  defaultValue={senToRm(invoice.amountSen)}
                  className="input pl-9"
                />
              </div>
            </div>

            <div>
              <label className="label">Status</label>
              <select name="status" defaultValue={invoice.status} className="input">
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Review Note</label>
              <textarea
                name="reviewNote"
                rows={2}
                defaultValue={invoice.reviewNote ?? ''}
                className="input"
                placeholder="Reason for approval, dispute details, payment reference…"
              />
            </div>

            <div>
              <label className="label">Internal Notes</label>
              <textarea
                name="notes"
                rows={2}
                defaultValue={invoice.notes ?? ''}
                className="input"
              />
            </div>

            {/* Replace file — optional */}
            <FileField
              label={invoice.fileUrl ? 'Replace File (optional)' : 'Attach File (optional)'}
              hint={
                invoice.fileUrl
                  ? `Current: ${invoice.fileName ?? 'uploaded file'}. Upload a new file to replace it.`
                  : 'PDF, PNG, JPEG or WEBP — max 10 MB.'
              }
            />

            {invoice.fileUrl && (
              <p className="text-xs text-slate-500">
                Current file:{' '}
                <a
                  href={invoice.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-700 hover:underline"
                >
                  {invoice.fileName ?? 'View invoice'}
                </a>
              </p>
            )}
          </ActionForm>

          {/* Delete — separate form at the bottom */}
          <div className="border-t border-slate-100 pt-4">
            <form action={deleteAction}>
              <input type="hidden" name="id" value={invoice.id} />
              <DeleteButton />
            </form>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn-danger btn-sm"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm('Delete this invoice? This cannot be undone.')) e.preventDefault();
      }}
    >
      {pending ? 'Deleting…' : 'Delete Invoice'}
    </button>
  );
}
