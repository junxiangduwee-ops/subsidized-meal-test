'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Dialog } from '@/components/dialog';
import { ActionForm } from '@/components/action-form';

import { createDish, updateDish } from './actions';

export type RestaurantOption = { id: string; name: string; active: boolean };

type DishFields = {
  id: string;
  restaurantId: string;
  code: string | null;
  name: string;
  priceSen: number;
  category: string | null;
  description: string | null;
  imageUrl: string | null;
  tags: string[];
};

// ── Image picker with live preview ────────────────────────────────────────────

function ImageField({ existing }: { existing?: string | null }) {
  const [preview, setPreview] = useState<string | null>(existing ?? null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  return (
    <div>
      <label className="label">Dish Image</label>
      <div className="flex items-start gap-3">
        {/* Preview box */}
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
          {preview ? (
            <img src={preview} alt="Preview" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-2xl text-slate-300">
              🍽
            </div>
          )}
        </div>

        {/* File input */}
        <div className="flex-1">
          <input
            type="file"
            name="imageFile"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleFile}
            className="block w-full text-sm text-slate-600
              file:mr-3 file:rounded-md file:border-0
              file:bg-slate-100 file:px-3 file:py-1.5
              file:text-sm file:font-medium file:text-slate-700
              hover:file:bg-slate-200 cursor-pointer"
          />
          <p className="mt-1 text-xs text-slate-400">
            PNG, JPEG or WEBP — max 2 MB.
            {existing ? ' Leave empty to keep the current image.' : ''}
          </p>
          {preview && (
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="mt-1 text-xs text-red-500 hover:underline"
            >
              Remove image
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Shared form fields ────────────────────────────────────────────────────────

function Fields({
  restaurants,
  dish,
}: {
  restaurants: RestaurantOption[];
  dish?: DishFields;
}) {
  const t = useTranslations('dishesAdmin');
  return (
    <>
      <div>
        <label className="label">{t('restaurant')}</label>
        <select name="restaurantId" required defaultValue={dish?.restaurantId ?? ''} className="input">
          <option value="" disabled>
            {t('chooseRestaurant')}
          </option>
          {restaurants.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.active ? '' : t('inactiveSuffix')}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-[1fr_120px] gap-3">
        <div>
          <label className="label">{t('dishName')}</label>
          <input name="name" required defaultValue={dish?.name} className="input" placeholder="Nasi Lemak Ayam" />
        </div>
        <div>
          <label className="label">{t('priceRm')}</label>
          <input
            name="price"
            required
            inputMode="decimal"
            defaultValue={dish ? (dish.priceSen / 100).toFixed(2) : ''}
            className="input"
            placeholder="12.50"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">{t('code')}</label>
          <input
            name="code"
            defaultValue={dish?.code ?? ''}
            className="input uppercase"
            placeholder={t('codePlaceholder')}
            maxLength={40}
          />
        </div>
        <div>
          <label className="label">{t('category')}</label>
          <input name="category" defaultValue={dish?.category ?? ''} className="input" placeholder="Main" />
        </div>
      </div>
      <p className="-mt-2 text-xs text-slate-400">{t('codeHint')}</p>

      <div>
        <label className="label">{t('tagsLabel')}</label>
        <input
          name="tags"
          defaultValue={dish?.tags.join(', ') ?? ''}
          className="input"
          placeholder={t('tagsPlaceholder')}
        />
      </div>

      <div>
        <label className="label">{t('description')}</label>
        <textarea name="description" rows={2} defaultValue={dish?.description ?? ''} className="input" />
      </div>

      {/* Image upload with preview */}
      <ImageField existing={dish?.imageUrl} />
    </>
  );
}

// ── Add dish dialog ───────────────────────────────────────────────────────────

export function AddDishButton({ restaurants }: { restaurants: RestaurantOption[] }) {
  const t = useTranslations('dishesAdmin');
  return (
    <Dialog
      title={t('addADish')}
      trigger={(open) => (
        <button
          type="button"
          className="btn-primary"
          onClick={open}
          disabled={restaurants.length === 0}
        >
          {t('addDish')}
        </button>
      )}
    >
      {(close) => (
        <ActionForm
          action={createDish}
          submitLabel={t('addDish')}
          className="space-y-3"
          onSuccess={close}
        >
          <Fields restaurants={restaurants} />
        </ActionForm>
      )}
    </Dialog>
  );
}

// ── Edit dish dialog ──────────────────────────────────────────────────────────

export function EditDishDialog({
  dish,
  restaurants,
}: {
  dish: DishFields;
  restaurants: RestaurantOption[];
}) {
  const t = useTranslations('dishesAdmin');
  const c = useTranslations('adminCommon');
  return (
    <Dialog
      title={t('editDish', { name: dish.name })}
      trigger={(open) => (
        <button type="button" className="btn-secondary btn-sm" onClick={open}>
          {c('edit')}
        </button>
      )}
    >
      {(close) => (
        <ActionForm
          action={updateDish}
          submitLabel={c('saveChanges')}
          resetOnSuccess={false}
          className="space-y-3"
          onSuccess={close}
        >
          <input type="hidden" name="id" value={dish.id} />
          <Fields restaurants={restaurants} dish={dish} />
        </ActionForm>
      )}
    </Dialog>
  );
}
