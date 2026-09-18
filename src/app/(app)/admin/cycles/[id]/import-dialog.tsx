'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

import { Dialog } from '@/components/dialog';
import { toCsv } from '@/lib/csv';

import { EMPTY_IMPORT_STATE, importWeeklyMenu, type MenuImportRejectedRow } from '../actions';

function UploadSubmit({ label }: { label: string }) {
  const t = useTranslations('common');
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? t('working') : label}
    </button>
  );
}

function downloadRejectedReport(fileName: string, rejected: MenuImportRejectedRow[]) {
  const csv = toCsv(
    ['Row', 'Day', 'Restaurant code', 'Restaurant name', 'Dish code', 'Dish name', 'Reason'],
    rejected.map((r) => [r.row, r.day, r.restaurantCode, r.restaurantName, r.dishCode, r.dishName, r.reason]),
  );
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.replace(/\.[^.]+$/, '') + '-rejected-rows.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportMenuDialog({ cycleId }: { cycleId: string }) {
  const t = useTranslations('cyclesAdmin');
  const [state, formAction] = useActionState(importWeeklyMenu, EMPTY_IMPORT_STATE);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.result && fileRef.current) fileRef.current.value = '';
  }, [state.result]);

  return (
    <Dialog
      title={t('importMenuTitle')}
      width="max-w-2xl"
      trigger={(open) => (
        <button type="button" className="btn-secondary btn-sm" onClick={open}>
          {t('importMenu')}
        </button>
      )}
    >
      {() => (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t('importMenuHelp')}</p>

          <a href="/api/exports/weekly-menu-template" className="text-sm font-medium text-brand-600 hover:underline">
            {t('downloadTemplate')}
          </a>

          <form action={formAction} className="space-y-3">
            <input type="hidden" name="cycleId" value={cycleId} />
            <div>
              <label className="label text-xs" htmlFor={`import-file-${cycleId}`}>
                {t('importFile')}
              </label>
              <input
                ref={fileRef}
                id={`import-file-${cycleId}`}
                type="file"
                name="file"
                required
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="input"
              />
            </div>

            {state.error ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>
            ) : null}

            <UploadSubmit label={t('importSubmit')} />
          </form>

          {state.result ? (
            <div className="space-y-3 border-t border-slate-200 pt-4">
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {t('importResultSummary', {
                  added: state.result.importedCount,
                  skipped: state.result.skippedCount,
                  rejected: state.result.rejected.length,
                })}
              </p>

              {state.result.createdRestaurants.length > 0 ? (
                <p className="text-xs text-slate-500">
                  {t('importNewRestaurants', { list: state.result.createdRestaurants.join(', ') })}
                </p>
              ) : null}
              {state.result.createdDishes.length > 0 ? (
                <p className="text-xs text-slate-500">
                  {t('importNewDishes', { list: state.result.createdDishes.join(', ') })}
                </p>
              ) : null}

              {state.result.rejected.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">{t('importRejectedHeading')}</h3>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => downloadRejectedReport(state.result!.fileName, state.result!.rejected)}
                    >
                      {t('importDownloadErrors')}
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>{t('importRowColumn')}</th>
                          <th>{t('dishColumn')}</th>
                          <th>{t('importReasonColumn')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.result.rejected.map((r) => (
                          <tr key={r.row}>
                            <td className="whitespace-nowrap text-xs text-slate-500">
                              {r.day} · #{r.row}
                            </td>
                            <td className="text-xs text-slate-700">
                              {r.dishName} <span className="text-slate-400">({r.dishCode})</span>
                              <div className="text-slate-400">
                                {r.restaurantName} ({r.restaurantCode})
                              </div>
                            </td>
                            <td className="text-xs text-red-700">{r.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-slate-500">{t('importReuploadHint')}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
