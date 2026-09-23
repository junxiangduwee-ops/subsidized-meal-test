'use client';

import { useTranslations } from 'next-intl';

import { ActionForm, InlineSubmit } from '@/components/action-form';
import { Dialog } from '@/components/dialog';

import { confirmDelivery, unmarkDelivery } from './actions';

/**
 * Not-yet-confirmed row: lets reception attach a photo, or just mark the
 * delivery received with no photo at all. The photo input is intentionally
 * optional - see confirmDelivery in actions.ts.
 */
export function ConfirmDeliveryForm({
  cycleId,
  deliverySiteId,
  serviceDate,
}: {
  cycleId: string;
  deliverySiteId: string;
  serviceDate: string;
}) {
  const t = useTranslations('reception');

  return (
    <ActionForm
      action={confirmDelivery}
      submitLabel={t('markReceived')}
      size="sm"
      inline
      className="flex flex-col gap-2 sm:flex-row sm:flex-nowrap sm:items-center"
    >
      <input type="hidden" name="cycleId" value={cycleId} />
      <input type="hidden" name="deliverySiteId" value={deliverySiteId} />
      <input type="hidden" name="serviceDate" value={serviceDate} />
      <input
        type="file"
        name="photo"
        accept="image/*"
        capture="environment"
        // Fixed h-8 plus restyling the native "Choose file" button via the
        // file: variant - browsers size that inner button off their own
        // defaults, not the outer input's padding/font, so without this it
        // renders a different height than the text input and button next
        // to it no matter what py-*/text-* is set on the outer element.
        className="input h-8 !w-full !py-1 text-xs file:mr-2 file:h-6 file:cursor-pointer file:rounded file:border-0 file:bg-slate-100 file:px-2 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200 sm:!w-36 sm:shrink-0"
        aria-label={t('photoInputLabel')}
      />
      <input
        type="text"
        name="note"
        placeholder={t('notePlaceholder')}
        maxLength={500}
        className="input h-8 !w-full !py-1 text-xs sm:!w-32 sm:shrink-0"
      />
    </ActionForm>
  );
}

/** Already-confirmed row: status badge plus a dialog with the details/photo and an undo. */
export function DeliveryConfirmedCell({
  id,
  receivedAtLabel,
  receivedByName,
  note,
  photoDataUrl,
}: {
  id: string;
  receivedAtLabel: string;
  receivedByName: string | null;
  note: string | null;
  photoDataUrl: string | null;
}) {
  const t = useTranslations('reception');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="badge bg-emerald-100 text-emerald-800">{t('received')}</span>
      <Dialog
        title={t('deliveryDetails')}
        trigger={(open) => (
          <button
            type="button"
            onClick={open}
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            {photoDataUrl ? t('viewPhoto') : t('details')}
          </button>
        )}
      >
        {() => (
          <div className="space-y-3">
            {photoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoDataUrl}
                alt=""
                className="max-h-96 w-full rounded-md border border-slate-200 object-contain"
              />
            ) : (
              <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
                {t('noPhotoAttached')}
              </p>
            )}
            <p className="text-xs text-slate-500">
              {t('receivedByAt', { name: receivedByName ?? t('unknownStaff'), when: receivedAtLabel })}
            </p>
            {note ? <p className="text-sm text-slate-700">{note}</p> : null}
            <form action={unmarkDelivery}>
              <input type="hidden" name="id" value={id} />
              <InlineSubmit label={t('unmark')} variant="danger" confirm={t('unmarkConfirm')} />
            </form>
          </div>
        )}
      </Dialog>
    </div>
  );
}
