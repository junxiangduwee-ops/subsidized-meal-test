'use client';

import { useTranslations } from 'next-intl';

import { Dialog } from '@/components/dialog';
import { ActionForm } from '@/components/action-form';

import { createDeliverySite, updateDeliverySite } from './actions';

type DeliverySiteFields = {
  id: string;
  name: string;
};

function Fields({ site }: { site?: DeliverySiteFields }) {
  const t = useTranslations('deliverySitesAdmin');
  const c = useTranslations('adminCommon');
  return (
    <div>
      <label className="label">{c('name')}</label>
      <input
        name="name"
        required
        defaultValue={site?.name}
        className="input"
        placeholder={t('namePlaceholder')}
      />
    </div>
  );
}

export function AddDeliverySiteButton() {
  const t = useTranslations('deliverySitesAdmin');
  return (
    <Dialog
      title={t('addASite')}
      trigger={(open) => (
        <button type="button" className="btn-primary" onClick={open}>
          {t('addSite')}
        </button>
      )}
    >
      {(close) => (
        <ActionForm
          action={createDeliverySite}
          submitLabel={t('addSite')}
          className="space-y-3"
          onSuccess={close}
        >
          <Fields />
        </ActionForm>
      )}
    </Dialog>
  );
}

export function EditDeliverySiteDialog({ site }: { site: DeliverySiteFields }) {
  const t = useTranslations('deliverySitesAdmin');
  const c = useTranslations('adminCommon');
  return (
    <Dialog
      title={t('editSite', { name: site.name })}
      trigger={(open) => (
        <button type="button" className="btn-secondary btn-sm" onClick={open}>
          {c('edit')}
        </button>
      )}
    >
      {(close) => (
        <ActionForm
          action={updateDeliverySite}
          submitLabel={c('saveChanges')}
          resetOnSuccess={false}
          className="space-y-3"
          onSuccess={close}
        >
          <input type="hidden" name="id" value={site.id} />
          <Fields site={site} />
        </ActionForm>
      )}
    </Dialog>
  );
}
