'use server';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';

import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/orders';
import { landingPathFor } from '@/lib/rbac';

export type CompleteProfileState = { error?: string };

// Malaysian mobile: 01x-xxxxxxxx (10–11 digits) or international E.164.
const phoneSchema = z
  .string()
  .trim()
  .regex(
    /^(\+\d{7,15}|01\d{8,9})$/,
    'Enter a valid phone number (e.g. 0123456789 or +60123456789).',
  );

export async function completeProfileAction(
  _prev: CompleteProfileState,
  formData: FormData,
): Promise<CompleteProfileState> {
  const t = await getTranslations('completeProfile');

  const user = await getCurrentUser();
  if (!user) return { error: t('notSignedIn') };

  // ── Phone ────────────────────────────────────────────────────────────────
  const rawPhone = String(formData.get('phone') ?? '').replace(/[\s\-().]/g, '');
  const hasPhone = rawPhone.length > 0;
  let phone: string | null = null;

  if (hasPhone) {
    const result = phoneSchema.safeParse(rawPhone);
    if (!result.success) {
      return { error: result.error.issues[0]?.message ?? t('invalidPhone') };
    }
    phone = result.data;
  }

  // ── Email ────────────────────────────────────────────────────────────────
  const rawEmail = String(formData.get('email') ?? '').trim().toLowerCase();
  const hasEmail = rawEmail.length > 0;
  let email: string | null = user.email; // keep existing if already on file

  if (!user.email && hasEmail) {
    // They typed a new email (they had none before).
    const result = z.string().email(t('invalidEmail')).safeParse(rawEmail);
    if (!result.success) {
      return { error: t('invalidEmail') };
    }
    const clash = await prisma.user.findUnique({ where: { email: rawEmail } });
    if (clash && clash.id !== user.id) {
      return { error: t('emailTaken') };
    }
    email = rawEmail;
  }

  // ── At least one required ────────────────────────────────────────────────
  // "Phone or email" — they only need to provide whichever they have.
  // An account that already has an email on file satisfies the email side
  // automatically, so only truly blank accounts with no phone fail here.
  const satisfiedByExistingEmail = !!user.email;
  if (!hasPhone && !hasEmail && !satisfiedByExistingEmail) {
    return { error: t('atLeastOneRequired') };
  }

  // ── Persist ──────────────────────────────────────────────────────────────
  await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(phone !== null ? { phone } : {}),
      ...(email !== user.email ? { email } : {}),
      profileCompleted: true,
    },
  });

  await audit(user.id, 'user.profile_completed', 'User', user.id, {
    // Store a masked phone in the audit log.
    phone: phone ? phone.replace(/\d(?=\d{4})/g, '*') : null,
    hadEmail: !!user.email,
    addedEmail: email !== user.email,
  });

  // ── Redirect ─────────────────────────────────────────────────────────────
  // Preserve the embedded context so the session cookie's embed flag is
  // honoured and the user lands on the right page without the full shell.
  const isEmbed = formData.get('embed') === '1';
  redirect(isEmbed ? '/menu' : landingPathFor(user.role));
}
