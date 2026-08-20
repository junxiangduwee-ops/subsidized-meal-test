'use client';

import { useTranslations } from 'next-intl';

import { Dialog } from '@/components/dialog';
import { ActionForm } from '@/components/action-form';

import { createRestaurant, updateRestaurant } from './actions';

type RestaurantFields = {
  id: string;
  name: string;
  cuisine: string | null;
  description: string | null;
  contactName: string | null;
  contactPhone: string | null;
  address: string | null;
};

function Fields({ restaurant }: { restaurant?: RestaurantFields }) {
  const t = useTranslations('restaurantsAdmin');
  const c = useTranslations('adminCommon');
  return (
    <>
      <div>
        <label className="label">{c('name')}</label>
        <input
          name="name"
          required
          defaultValue={restaurant?.name}
          className="input"
          placeholder={t('namePlaceholder')}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">{t('cuisine')}</label>
          <input
            name="cuisine"
            defaultValue={restaurant?.cuisine ?? ''}
            className="input"
            placeholder={t('cuisinePlaceholder')}
          />
        </div>
        <div>
          <label className="label">{t('contact')}</label>
          <input
            name="contactName"
            defaultValue={restaurant?.contactName ?? ''}
            className="input"
          />
        </div>
      </div>
      <div>
        <label className="label">{t('phone')}</label>
        <input
          name="contactPhone"
          defaultValue={restaurant?.contactPhone ?? ''}
          className="input"
          placeholder={t('phonePlaceholder')}
        />
      </div>
      <div>
        <label className="label">{t('description')}</label>
        <textarea
          name="description"
          rows={2}
          defaultValue={restaurant?.description ?? ''}
          className="input"
        />
      </div>
      <div>
        <label className="label">{t('address')}</label>
        <textarea
          name="address"
          rows={2}
          defaultValue={restaurant?.address ?? ''}
          className="input"
        />
      </div>
    </>
  );
}

export function AddRestaurantButton() {
  const t = useTranslations('restaurantsAdmin');
  return (
    <Dialog
      title={t('addARestaurant')}
      trigger={(open) => (
        <button type="button" className="btn-primary" onClick={open}>
          {t('addRestaurant')}
        </button>
      )}
    >
      {(close) => (
        <ActionForm
          action={createRestaurant}
          submitLabel={t('addRestaurant')}
          className="space-y-3"
          onSuccess={close}
        >
          <Fields />
        </ActionForm>
      )}
    </Dialog>
  );
}

export function EditRestaurantDialog({ restaurant }: { restaurant: RestaurantFields }) {
  const t = useTranslations('restaurantsAdmin');
  const c = useTranslations('adminCommon');
  return (
    <Dialog
      title={t('editRestaurant', { name: restaurant.name })}
      trigger={(open) => (
        <button type="button" className="btn-secondary btn-sm" onClick={open}>
          {c('edit')}
        </button>
      )}
    >
      {(close) => (
        <ActionForm
          action={updateRestaurant}
          submitLabel={c('saveChanges')}
          resetOnSuccess={false}
          className="space-y-3"
          onSuccess={close}
        >
          <input type="hidden" name="id" value={restaurant.id} />
          <Fields restaurant={restaurant} />
        </ActionForm>
      )}
    </Dialog>
  );
}
