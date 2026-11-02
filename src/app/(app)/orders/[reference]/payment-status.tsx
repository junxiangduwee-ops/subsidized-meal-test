'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { retryPayment } from './retry-payment-action';

const POLL_MS = 3000;

/**
 * Embed (Joget iframe) payment status component.
 *
 * Polls for payment completion and auto-starts on mount since the popup
 * was already opened in menu-ordering.tsx before navigating here.
 *
 * When the user clicks "Continue to Payment" after a timeout, a FRESH
 * payment request is created via retryPayment() so the expired URL is
 * never reused.
 */
export function PaymentStatus({
  reference,
  checkoutUrl: initialCheckoutUrl,
}: {
  reference: string;
  checkoutUrl: string;
}) {
  const t = useTranslations('orderDetail');
  const router = useRouter();
  const popupRef = useRef<Window | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
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
            } catch { /* cross-origin — ignore */ }
          }
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          setPolling(false);
          router.refresh();
        }
      } catch {
        // Transient network hiccup — retry next tick
      }
    }, POLL_MS);
  }

  // Auto-start polling on mount — popup already open from menu-ordering.tsx
  useEffect(() => {
    startPolling();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openCheckout() {
    setError(null);
    setRetrying(true);

    // Always create a FRESH payment request — never reuse an expired URL
    const result = await retryPayment(reference);

    setRetrying(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    // ADAPTIS — inject form into popup
    if (result.adaptisFormData && result.adaptisPaymentUrl) {
      const popup = window.open('', 'hitpay_checkout', 'width=480,height=760');
      popupRef.current = popup ?? null;
      if (popup) {
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
        setPopupBlocked(false);
        startPolling();
      } else {
        setPopupBlocked(true);
      }
      return;
    }

    // HitPay / Betterpay — open new URL in popup
    if (result.checkoutUrl) {
      const popup = window.open(result.checkoutUrl, 'hitpay_checkout', 'width=480,height=760');
      popupRef.current = popup ?? null;
      if (!popup) {
        setPopupBlocked(true);
        return;
      }
      setPopupBlocked(false);
      startPolling();
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={openCheckout}
          disabled={retrying || polling}
          className="btn-primary btn-sm"
        >
          {retrying
            ? 'Preparing payment…'
            : polling
            ? t('waitingForPayment')
            : t('continueToPayment')}
        </button>
        {(polling || retrying) && (
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
            {retrying ? 'Creating new payment…' : t('checkingPayment')}
          </span>
        )}
      </div>
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      {popupBlocked && !error && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('popupBlocked')}
        </p>
      )}
    </div>
  );
}
