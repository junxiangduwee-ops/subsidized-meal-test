'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

const POLL_MS = 3000;
const TIMEOUT_MS = 60_000;

export function WebPaymentStatus({
  reference,
  checkoutUrl,
}: {
  reference: string;
  checkoutUrl: string;
}) {
  const t = useTranslations('orderDetail');
  const router = useRouter();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(reference)}/status`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (data.status && data.status !== 'AWAITING_PAYMENT') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          router.refresh();
        }
      } catch {
        // Transient network hiccup — next tick will retry.
      }
    }, POLL_MS);

    timeoutRef.current = setTimeout(() => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      setTimedOut(true);
    }, TIMEOUT_MS);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (timedOut) {
    return (
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-xs text-amber-700">
          Payment confirmation is taking longer than expected. If you have completed payment, please wait a moment and refresh. Otherwise you can retry below.
        </p>
        <p className="mt-2">
          <a href={checkoutUrl} className="btn-primary btn-sm">
            {t('continueToPayment')}
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
      <span className="text-xs text-slate-500">{t('checkingPayment')}</span>
    </div>
  );
}
