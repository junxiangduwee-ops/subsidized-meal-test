'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { completeProfileAction, type CompleteProfileState } from './actions';

function SubmitButton() {
  const t = useTranslations('completeProfile');
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? t('saving') : t('save')}
    </button>
  );
}

export function CompleteProfileForm({
  currentEmail,
  currentPhone,
  isEmbed,
}: {
  currentEmail: string | null;
  currentPhone: string | null;
  isEmbed: boolean;
}) {
  const t = useTranslations('completeProfile');
  const [state, formAction] = useActionState<CompleteProfileState, FormData>(completeProfileAction, {});

  // Track which fields the user has filled so we can show the "at least one" hint.
  const [phone, setPhone] = useState(currentPhone ?? '');
  const [email, setEmail] = useState(currentEmail ?? '');

  return (
    <form action={formAction} className="space-y-4">
      {/* Pass embed flag so the action redirects correctly inside the iframe */}
      {isEmbed ? <input type="hidden" name="embed" value="1" /> : null}

      {state.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </div>
      ) : null}

      <p className="text-sm text-slate-600">{t('atLeastOneHint')}</p>

      {/* ── Phone number ──────────────────────────────────────── */}
      <div>
        <label htmlFor="phone" className="label">
          {t('phone')}
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          className="input"
          placeholder={t('phonePlaceholder')}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-500">{t('phoneHint')}</p>
      </div>

      {/* ── Email ─────────────────────────────────────────────── */}
      <div>
        <label htmlFor="email" className="label">
          {t('email')}
        </label>
        {currentEmail ? (
          <>
            {/* Already on file — show read-only but still send it */}
            <input
              id="email"
              type="email"
              value={currentEmail}
              disabled
              className="input bg-slate-50 text-slate-500"
            />
            <input type="hidden" name="email" value={currentEmail} />
            <p className="mt-1 text-xs text-slate-500">{t('emailReadOnly')}</p>
          </>
        ) : (
          <>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              className="input"
              placeholder="name@mrdiy.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">{t('emailHint')}</p>
          </>
        )}
      </div>

      <SubmitButton />
    </form>
  );
}
