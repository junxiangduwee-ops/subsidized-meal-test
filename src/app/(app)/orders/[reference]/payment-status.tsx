'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

const POLL_MS = 3000;

/**
 * HitPay's checkout page refuses to render inside any iframe, so it's
 * opened in its own popup window instead - this page (already inside the
 * Joget iframe when embedded) just waits, polling for the webhook to mark
 * the order paid, then closes the popup and refreshes automatically.
 *
 * The popup is NOT opened automatically on mount because browsers block
 * window.open() calls that are not triggered by a direct user gesture,
 * especially when running inside an iframe (Joget embedded mode).
 * The user must click the button to open the popup.
 */
export function PaymentStatus({
  reference,
  checkoutUrl,
  autoStart = false,
}: {
  reference: string;
  checkoutUrl: string;
  /** Auto-start polling immediately — used when returning from HitPay redirect (web mode). */
  autoStart?: boolean;
}) {
  const t = useTranslations('orderDetail');
  const router = useRouter();
  const popupRef = useRef<Window | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [polling, setPolling] = useState(autoStart);

  function startPolling() {
    if (pollingRef.current) return; // already polling
    setPolling(true);

    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(reference)}/status`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (data.status && data.status !== 'AWAITING_PAYMENT') {
          popupRef.current?.close();
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          setPolling(false);
          router.refresh();
        }
      } catch {
        // Transient network hiccup — next tick will retry.
      }
    }, POLL_MS);
  }

  function openCheckout() {
    // Must be called directly from a user click — browsers block window.open()
    // when called from useEffect or any async context inside an iframe.
    const popup = window.open(checkoutUrl, 'hitpay_checkout', 'width=480,height=760');
    popupRef.current = popup;

    if (!popup) {
      setPopupBlocked(true);
      return;
    }

    setPopupBlocked(false);
    startPolling();
  }

  // Auto-start polling when returning from HitPay redirect (web mode)
  useEffect(() => {
    if (autoStart) startPolling();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Web (non-embed) mode — auto polling, no button needed
  if (autoStart) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        <span className="text-xs text-slate-500">{t('checkingPayment')}</span>
      </div>
    );
  }

  // Embed (Joget iframe) mode — user must click to open popup
  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={openCheckout}
          className="btn-primary btn-sm"
        >
          {polling ? t('waitingForPayment') : t('continueToPayment')}
        </button>
        {polling && (
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
            {t('checkingPayment')}
          </span>
        )}
      </div>
      {popupBlocked && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('popupBlocked')}
          {' '}
          <a
            href={checkoutUrl}
            target="_blank"
            rel="noreferrer"
            className="underline font-medium"
          >
            {t('openManually')}
          </a>
        </p>
      )}
    </div>
  );
}
