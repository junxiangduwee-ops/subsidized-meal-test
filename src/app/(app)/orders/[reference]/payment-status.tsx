'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { retryPayment } from './retry-payment-action';

const POLL_MS = 3000;

/**
 * Embed (Joget iframe) payment status.
 * Shows "Continue to Payment" button immediately.
 * Polls silently in background — auto-closes popup and refreshes when PAID.
 * Retry always creates a fresh payment request.
 */
export function PaymentStatus({
  reference,
}: {
  reference: string;
  checkoutUrl: string;
}) {
  const t = useTranslations('orderDetail');
  const router = useRouter();
  const popupRef = useRef<Window | null>(null);
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
          // Close popup by ref or by name
          if (popupRef.current && !popupRef.current.closed) {
            popupRef.current.close();
          } else {
            try {
              const p = window.open('', 'hitpay_checkout');
              if (p && !p.closed) p.close();
            } catch { /* cross-origin */ }
          }
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

  function handleRetry() {
    setError(null);
    setRetrying(true);

    // Open blank popup synchronously — must be in click handler
    const popup = window.open('', 'hitpay_checkout', 'width=480,height=760');
    popupRef.current = popup ?? null;
    if (popup) {
      popup.document.write(
        '<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p style="color:#666">Preparing payment\u2026</p></body></html>'
      );
    }

    retryPayment(reference).then((result) => {
      setRetrying(false);

      if (result.error) {
        setError(result.error);
        popup?.close();
        return;
      }

      // HitPay — navigate popup to fresh URL
      if (result.checkoutUrl) {
        if (popup && !popup.closed) {
          popup.location.href = result.checkoutUrl;
        } else {
          window.open(result.checkoutUrl, '_blank');
        }
      }
    }).catch(() => {
      setRetrying(false);
      setError('Could not create payment. Please try again.');
      popup?.close();
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="btn-primary btn-sm"
        >
          {retrying ? 'Preparing\u2026' : t('continueToPayment')}
        </button>
      </div>
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
