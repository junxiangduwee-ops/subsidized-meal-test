'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { retryPayment } from './retry-payment-action';

const POLL_MS = 3000;

export function PaymentStatus({
  reference,
}: {
  reference: string;
  checkoutUrl: string; // kept for API compatibility but not used for retry
}) {
  const t = useTranslations('orderDetail');
  const router = useRouter();
  const popupRef = useRef<Window | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [polling, setPolling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startPolling() {
    if (pollingRef.current) return;
    setPolling(true);

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
          pollingRef.current = null;
          setPolling(false);
          router.refresh();
        }
      } catch { /* network hiccup */ }
    }, POLL_MS);
  }

  // Auto-start polling on mount — popup already opened in menu-ordering.tsx
  useEffect(() => {
    startPolling();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRetry() {
    setError(null);
    setRetrying(true);

    // Open blank popup SYNCHRONOUSLY here (direct click handler — browser allows it)
    // We then navigate it once the server action returns the new URL
    const popup = window.open('', 'hitpay_checkout', 'width=480,height=760');
    popupRef.current = popup ?? null;

    // Show a loading message in the popup while we create the payment
    if (popup) {
      popup.document.write('<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p style="color:#666">Preparing payment...</p></body></html>');
    }

    retryPayment(reference).then((result) => {
      setRetrying(false);

      if (result.error) {
        setError(result.error);
        popup?.close();
        return;
      }

      // ADAPTIS — inject form into the already-open popup
      if (result.adaptisFormData && result.adaptisPaymentUrl) {
        if (popup && !popup.closed) {
          const doc = popup.document;
          doc.open();
          doc.write('<html><body>');
          doc.write(`<form id="f" method="POST" action="${result.adaptisPaymentUrl}">`);
          for (const [key, val] of Object.entries(result.adaptisFormData)) {
            const safe = String(val).replace(/"/g, '&quot;');
            doc.write(`<input type="hidden" name="${key}" value="${safe}">`);
          }
          doc.write('</form>');
          doc.write('<script>document.getElementById("f").submit();<\/script>');
          doc.write('</body></html>');
          doc.close();
          startPolling();
        }
        return;
      }

      // HitPay / Betterpay — navigate popup to new URL
      if (result.checkoutUrl) {
        if (popup && !popup.closed) {
          popup.location.href = result.checkoutUrl;
          startPolling();
        } else {
          // Popup was blocked — open directly
          window.open(result.checkoutUrl, '_blank');
        }
      }
    }).catch((err) => {
      setRetrying(false);
      setError('Could not create payment. Please try again.');
      popup?.close();
      console.error('[retry]', err);
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying || polling}
          className="btn-primary btn-sm"
        >
          {retrying
            ? 'Preparing…'
            : polling
            ? t('waitingForPayment')
            : t('continueToPayment')}
        </button>
        {(polling || retrying) && (
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
            {retrying ? 'Creating payment…' : t('checkingPayment')}
          </span>
        )}
      </div>
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
