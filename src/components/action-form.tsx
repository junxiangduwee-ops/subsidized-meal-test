'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

export type ActionState = { error?: string; success?: string };

export const EMPTY_STATE: ActionState = {};

function Submit({
  label,
  variant = 'primary',
}: {
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const t = useTranslations('common');
  const { pending } = useFormStatus();
  const cls =
    variant === 'danger' ? 'btn-danger' : variant === 'secondary' ? 'btn-secondary' : 'btn-primary';
  return (
    <button type="submit" className={cls} disabled={pending}>
      {pending ? t('working') : label}
    </button>
  );
}

/**
 * Wraps a server action with inline error/success feedback so every admin
 * form behaves the same way. Clears its fields after a successful submit.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  variant = 'primary',
  className,
  resetOnSuccess = true,
  footer,
  onSuccess,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  submitLabel: string;
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
  resetOnSuccess?: boolean;
  footer?: ReactNode;
  /** Fired once after a successful submit - dialogs use it to close. */
  onSuccess?: () => void;
}) {
  const [state, formAction] = useActionState(action, EMPTY_STATE);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.success) return;
    if (resetOnSuccess) ref.current?.reset();
    onSuccess?.();
    // `onSuccess` is a fresh closure each render; keying off the message
    // keeps this to one call per successful submit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success, resetOnSuccess]);

  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state.error ? (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>
      ) : null}
      {state.success ? (
        <p className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.success}
        </p>
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        <Submit label={submitLabel} variant={variant} />
        {footer}
      </div>
    </form>
  );
}

/** A bare submit button for inline row actions (delete, toggle, publish). */
export function InlineSubmit({
  label,
  variant = 'secondary',
  confirm,
}: {
  label: string;
  variant?: 'secondary' | 'danger' | 'primary';
  confirm?: string;
}) {
  const t = useTranslations('common');
  const { pending } = useFormStatus();
  const cls =
    variant === 'danger' ? 'btn-danger' : variant === 'primary' ? 'btn-primary' : 'btn-secondary';
  return (
    <button
      type="submit"
      className={`${cls} btn-sm`}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? t('ellipsis') : label}
    </button>
  );
}
