'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { retryPayment } from './retry-payment-action';

const POLL_MS = 3000;

/**
 * Web (non-embed) payment status.
 * Shows "Continue to Payment" button immediately.
 * Polls silently in background — auto-refreshes when PAID.
 * Retry always creates a fresh payment request.
 */
export function WebPaymentStatus({
  reference,
}: {
  reference: string;
  checkoutUrl: string;
  autoStart?: boolean;
}) {
  const t = useTranslations('orderDetail');
  const router = useRouter();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Always poll silently in background
  useEffect(() => {
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
          router.refresh();
        }
      } catch { /* network hiccup */ }
    }, POLL_MS);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRetry() {
    setError(null);
    setRetrying(true);

    const result = await retryPayment(reference);
    setRetrying(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    // HitPay — redirect to fresh URL
    if (result.checkoutUrl) {
      window.location.href = result.checkoutUrl;
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <p>
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="btn-primary btn-sm"
        >
          {retrying ? 'Preparing…' : t('continueToPayment')}
        </button>
      </p>
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
