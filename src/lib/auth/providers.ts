import 'server-only';

import type { AuthProvider } from '@prisma/client';

/**
 * An authentication provider verifies a credential and returns a normalised
 * identity. It never touches the database - `authenticate()` in ../auth.ts
 * owns provisioning so every provider gets identical account handling.
 */
export type ExternalIdentity = {
  provider: AuthProvider;
  /** Stable subject id from the directory: LDAP dn, or OIDC `sub`. */
  externalId: string;
  email: string;
  name: string;
  staffId?: string | null;
  department?: string | null;
};

export type CredentialProvider = {
  readonly id: AuthProvider;
  readonly enabled: boolean;
  /** Returns null when the credential is simply wrong (not an error). */
  verify(email: string, password: string): Promise<ExternalIdentity | null>;
};

export function isLdapEnabled(): boolean {
  return process.env.AUTH_LDAP_ENABLED === 'true' && Boolean(process.env.LDAP_URL);
}

export function isOidcEnabled(): boolean {
  return (
    process.env.AUTH_OIDC_ENABLED === 'true' &&
    Boolean(process.env.OIDC_ISSUER) &&
    Boolean(process.env.OIDC_CLIENT_ID)
  );
}
