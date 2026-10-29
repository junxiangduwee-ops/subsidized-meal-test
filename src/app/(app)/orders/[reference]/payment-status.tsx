'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

const POLL_MS = 3000;

/**
 * Embed (Joget iframe) payment status component.
 *
 * Flow:
 * 1. Popup was already opened in menu-ordering.tsx before navigating here
 * 2. This component auto-starts polling immediately on mount
 * 3. When webhook fires and order is PAID → popup closes + page refreshes
 * 4. If popup was blocked → show "Continue to Payment" button as fallback
 */
export function PaymentStatus({
  reference,
  checkoutUrl,
}: {
  reference: string;
  checkoutUrl: string;
}) {
  const t = useTranslations('orderDetail');
  const router = useRouter();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    // Auto-start polling immediately — popup is already open from menu-ordering.tsx
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(reference)}/status`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (data.status && data.status !== 'AWAITING_PAYMENT') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          // Close the HitPay popup if still open
          const popup = window.open('', 'hitpay_checkout');
          popup?.close();
          router.refresh();
        }
      } catch {
        // Transient network hiccup — next tick will retry.
      }
    }, POLL_MS);

    // Show the button after 5 seconds as fallback in case popup was blocked
    const fallbackTimer = setTimeout(() => setShowButton(true), 5000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      clearTimeout(fallbackTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        <span className="text-xs text-slate-500">{t('checkingPayment')}</span>
      </div>
      {showButton && (
        <p className="mt-1">
          <a
            href={checkoutUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-primary btn-sm"
          >
            {t('continueToPayment')}
          </a>
        </p>
      )}
    </div>
  );
}
