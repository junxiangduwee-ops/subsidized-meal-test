'use client';

import { useState } from 'react';

type Props = {
  reference: string;
};

export function VerifyPaymentButton({ reference }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  async function handleVerify() {
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/admin/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference }),
      });

      const data = await res.json();

      setResult({
        success: data.success,
        message: data.message ?? data.error ?? 'Unknown error',
      });

      // If payment confirmed — refresh the page so the status updates
      if (data.success) {
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch {
      setResult({ success: false, message: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleVerify}
        disabled={loading}
        className="btn-secondary btn-sm whitespace-nowrap disabled:opacity-50"
      >
        {loading ? 'Checking…' : 'Verify Payment'}
      </button>
      {result && (
        <p
          className={`text-xs ${
            result.success ? 'text-emerald-700' : 'text-amber-700'
          }`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
