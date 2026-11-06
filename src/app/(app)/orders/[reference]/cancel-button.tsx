'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { userCancelOrder } from './cancel-order-action';

type Props = {
  orderId: string;
  minutesLeft: number;
  amountLabel: string;
};

export function CancelOrderButton({ orderId, minutesLeft, amountLabel }: Props) {
  const router = useRouter();
  const t = useTranslations('cancelOrder');
  const [step, setStep] = useState<'idle' | 'confirm' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  function formatTimeLeft(minutes: number): string {
    const d = Math.floor(minutes / 1440);
    const h = Math.floor((minutes % 1440) / 60);
    const m = minutes % 60;

    const parts: string[] = [];
    if (d > 0) parts.push(t('days', { count: d }));
    if (h > 0) parts.push(t('hours', { count: h }));
    if (m > 0 || parts.length === 0) parts.push(t('minutes', { count: m }));
    return parts.join(' ');
  }

  async function handleConfirm() {
    setStep('loading');
    const result = await userCancelOrder(orderId);
    if (result.ok) {
      setMessage(t('success'));
      setStep('done');
      setTimeout(() => router.refresh(), 2000);
    } else {
      setMessage(result.error);
      setStep('error');
    }
  }

  if (step === 'done') {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        {message}
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="flex flex-col gap-2">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {message}
        </div>
        <button
          type="button"
          onClick={() => setStep('idle')}
          className="btn-secondary btn-sm self-start"
        >
          {t('tryAgain')}
        </button>
      </div>
    );
  }

  if (step === 'loading') {
    return (
      <p className="text-sm text-slate-500">{t('processing')}</p>
    );
  }

  if (step === 'confirm') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 space-y-3">
        <p className="text-sm font-medium text-red-800">
          {t('confirmTitle', { amount: amountLabel })}
        </p>
        <p className="text-xs text-red-700">
          {t('confirmHint')}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            {t('confirmYes')}
          </button>
          <button
            type="button"
            onClick={() => setStep('idle')}
            className="btn-secondary btn-sm"
          >
            {t('confirmNo')}
          </button>
        </div>
      </div>
    );
  }

  // idle
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setStep('confirm')}
        className="btn-secondary btn-sm self-start border-red-200 text-red-700 hover:bg-red-50"
      >
        {t('button')}
      </button>
      <p className="text-xs text-slate-500">
        {t('timeLeft', { time: formatTimeLeft(minutesLeft) })}
      </p>
    </div>
  );
}
