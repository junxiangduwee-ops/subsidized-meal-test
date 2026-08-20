'use client';

import { useTranslations } from 'next-intl';

import { ActionForm } from '@/components/action-form';

import { updateCycleWindow } from '../actions';

export function ScheduleForm({
  cycleId,
  title,
  notes,
  orderOpenAt,
  orderCutoffAt,
  disabled,
}: {
  cycleId: string;
  title: string | null;
  notes: string | null;
  orderOpenAt: string;
  orderCutoffAt: string;
  disabled: boolean;
}) {
  const t = useTranslations('cyclesAdmin');
  return (
    <ActionForm
      action={updateCycleWindow}
      submitLabel={t('saveSchedule')}
      resetOnSuccess={false}
      className="space-y-3"
    >
      <input type="hidden" name="id" value={cycleId} />

      <div>
        <label className="label">{t('scheduleTitle')}</label>
        <input name="title" defaultValue={title ?? ''} className="input" disabled={disabled} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">{t('orderingOpens')}</label>
          <input
            name="orderOpenAt"
            type="datetime-local"
            required
            defaultValue={orderOpenAt}
            className="input"
            disabled={disabled}
          />
        </div>
        <div>
          <label className="label">{t('orderingCloses')}</label>
          <input
            name="orderCutoffAt"
            type="datetime-local"
            required
            defaultValue={orderCutoffAt}
            className="input"
            disabled={disabled}
          />
        </div>
      </div>

      <div>
        <label className="label">{t('notesForStaff')}</label>
        <textarea
          name="notes"
          rows={2}
          defaultValue={notes ?? ''}
          className="input"
          disabled={disabled}
          placeholder={t('notesPlaceholder')}
        />
      </div>
    </ActionForm>
  );
}
