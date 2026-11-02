'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { retryPayment } from './retry-payment-action';

const POLL_MS = 3000;
const TIMEOUT_MS = 60_000;

/**
 * Web (non-embed) payment status component.
 *
 * Auto-starts polling when user returns from payment gateway (?from=xxx).
 * Shows a spinner while waiting, retry button if timed out or interrupted.
 * Always creates a FRESH payment request on retry — never reuses expired URL.
 */
export function WebPaymentStatus({
  reference,
}: {
  reference: string;
  checkoutUrl: string; // kept for API compat but not used
}) {
  const t = useTranslations('orderDetail');
  const router = useRouter();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startPolling() {
    if (pollingRef.current) return;

    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/orders/${encodeURIComponent(reference)}/status`,
          { cache: 'no-store' }
        );
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (data.status && data.status !== 'AWAITING_PAYMENT') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          router.refresh();
        }
      } catch { /* network hiccup */ }
    }, POLL_MS);

    // Show retry button after 60 seconds
    timeoutRef.current = setTimeout(() => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      setTimedOut(true);
    }, TIMEOUT_MS);
  }

  useEffect(() => {
    startPolling();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRetry() {
    setError(null);
    setRetrying(true);
    setTimedOut(false);

    const result = await retryPayment(reference);
    setRetrying(false);

    if (result.error) {
      setError(result.error);
      setTimedOut(true);
      return;
    }

    // ADAPTIS — submit form in page (full page redirect, no popup in web mode)
    if (result.adaptisFormData && result.adaptisPaymentUrl) {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = result.adaptisPaymentUrl;
      for (const [key, val] of Object.entries(result.adaptisFormData)) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = String(val);
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
      return;
    }

    // HitPay / Betterpay — redirect to fresh URL
    if (result.checkoutUrl) {
      window.location.href = result.checkoutUrl;
    }
  }

  if (timedOut) {
    return (
      <div className="mt-2 flex flex-col gap-2">
        {error ? (
          <p className="text-xs text-red-700">{error}</p>
        ) : (
          <p className="text-xs text-amber-700">
            Payment confirmation is taking longer than expected. If you have completed payment, please wait a moment and refresh. Otherwise retry below.
          </p>
        )}
        <p className="mt-1">
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="btn-primary btn-sm"
          >
            {retrying ? 'Preparing…' : t('continueToPayment')}
          </button>
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
