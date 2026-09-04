import 'server-only';

import { type CredentialProvider, type ExternalIdentity, isJogetEnabled } from './providers';

/**
 * Joget directory provider.
 *
 * Joget itself holds the accounts (its own local user directory), so this
 * app never sees a password hash - it delegates the credential check to a
 * small custom API you expose from Joget's API Builder plugin, then trusts
 * the JSON it returns.
 *
 * Expected endpoint (path is configurable via JOGET_API_URL, which should
 * point at the base of your API Builder app, e.g.
 * "https://joget.example.com/jw/api/build/foodAuth"):
 *
 *   POST {JOGET_API_URL}/verify
 *   Headers: api_id: <JOGET_API_KEY>, api_key: <JOGET_API_SECRET>
 *   Body:    { "username": "<email>", "password": "<plain text>" }
 *
 *   200 OK
 *   {
 *     "valid": true,
 *     "userId": "joget-user-id",
 *     "email": "jane@mrdiy.com",
 *     "name": "Jane Doe",
 *     "staffId": "EMP1234",
 *     "department": "Finance",
 *     "groups": ["Finance", "Employee"]
 *   }
 *
 * Return { "valid": false } (or any non-2xx) for a bad credential - never
 * distinguish "wrong password" from "unknown user" in the response.
 */
export const jogetProvider: CredentialProvider = {
  id: 'JOGET',
  get enabled() {
    return isJogetEnabled();
  },

  async verify(email, password): Promise<ExternalIdentity | null> {
    if (!isJogetEnabled()) return null;
    // Never forward an empty password - some backends treat it as "skip check".
    if (!password) return null;

    const base = process.env.JOGET_API_URL!.replace(/\/$/, '');

    let res: Response;
    try {
      res = await fetch(`${base}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          api_id: process.env.JOGET_API_KEY!,
          api_key: process.env.JOGET_API_SECRET ?? '',
        },
        body: JSON.stringify({ username: email, password }),
        cache: 'no-store',
      });
    } catch (err) {
      console.error('[auth] Joget verify request failed:', err);
      return null;
    }

    if (!res.ok) return null;

    let data: {
      valid?: boolean;
      userId?: string;
      email?: string;
      name?: string;
      staffId?: string | null;
      department?: string | null;
      groups?: string[];
    };
    try {
      data = await res.json();
    } catch {
      return null;
    }

    if (!data.valid) return null;

    return {
      provider: 'JOGET',
      externalId: data.userId ?? email,
      email: (data.email ?? email).toLowerCase(),
      name: data.name ?? email.split('@')[0],
      staffId: data.staffId ?? null,
      department: data.department ?? null,
      groups: data.groups ?? [],
    };
  },
};
