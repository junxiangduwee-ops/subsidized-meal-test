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
 */
export function PaymentStatus({ reference, checkoutUrl }: { reference: string; checkoutUrl: string }) {
  const t = useTranslations('orderDetail');
  const router = useRouter();
  const popupRef = useRef<Window | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);

  function openCheckout() {
    const popup = window.open(checkoutUrl, 'hitpay_checkout', 'width=480,height=760');
    popupRef.current = popup;
    setPopupBlocked(!popup);
  }

  useEffect(() => {
    openCheckout();

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(reference)}/status`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (data.status && data.status !== 'AWAITING_PAYMENT') {
          popupRef.current?.close();
          clearInterval(interval);
          router.refresh();
        }
      } catch {
        // Transient network hiccup - the next tick will just try again.
      }
    }, POLL_MS);

    return () => clearInterval(interval);
    // Only ever needs to run once per mount - reference/checkoutUrl are fixed
    // for the lifetime of this AWAITING_PAYMENT view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <p className="mt-2 flex items-center gap-2">
      <button type="button" onClick={openCheckout} className="btn-primary btn-sm">
        {t('continueToPayment')}
      </button>
      {popupBlocked ? <span className="text-xs text-slate-500">{t('popupBlocked')}</span> : null}
    </p>
  );
}
