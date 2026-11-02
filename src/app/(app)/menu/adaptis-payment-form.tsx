'use client';

import { useEffect, useRef } from 'react';

type Props = {
  formData: Record<string, string>;
  paymentUrl: string;
};

/**
 * Auto-submitting form for ADAPTIS (eGHL) payment.
 * eGHL uses HTML form POST — no REST API URL to redirect to.
 * This component renders a hidden form and submits it automatically.
 */
export function AdaptisPaymentForm({ formData, paymentUrl }: Props) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    // Auto-submit the form when component mounts
    formRef.current?.submit();
  }, []);

  return (
    <form
      ref={formRef}
      method="POST"
      action={paymentUrl}
      style={{ display: 'none' }}
    >
      {Object.entries(formData).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
    </form>
  );
}
