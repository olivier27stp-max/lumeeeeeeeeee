/* ═══════════════════════════════════════════════════════════════
   Provider — QuickBooks Online
   Auth type: api_key (user provides their own Client ID, Secret, Realm ID)
   Validates by requesting an OAuth2 client_credentials token from Intuit.
   ═══════════════════════════════════════════════════════════════ */

import { registerProvider } from '../registry';
import type { ProviderDefinition, DecryptedCredentials, TestResult } from '../types';

const quickbooks: ProviderDefinition = {
  slug: 'quickbooks',
  display_name: 'QuickBooks Online',
  auth_type: 'api_key',

  credential_fields: [
    {
      key: 'client_id',
      label: 'Client ID',
      type: 'text',
      required: true,
      placeholder: 'Your Intuit app Client ID',
      help_text: 'Found in Intuit Developer Portal → Dashboard → Keys & credentials',
    },
    {
      key: 'client_secret',
      label: 'Client Secret',
      type: 'password',
      required: true,
      placeholder: 'Your Intuit app Client Secret',
    },
    {
      key: 'realm_id',
      label: 'Company ID (Realm ID)',
      type: 'text',
      required: true,
      placeholder: '123456789',
      help_text: 'Found in QuickBooks → Settings → Account and Settings',
    },
  ],

  testConnection: async (creds: DecryptedCredentials): Promise<TestResult> => {
    const clientId = creds.extra?.client_id;
    const clientSecret = creds.extra?.client_secret || creds.api_secret;
    const realmId = creds.extra?.realm_id;

    if (!clientId || !clientSecret) {
      return { success: false, error: 'Client ID and Client Secret are required' };
    }
    if (!realmId) {
      return { success: false, error: 'Company ID (Realm ID) is required' };
    }

    try {
      // Validate credentials by requesting a token from Intuit's OAuth endpoint
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
        }),
      });

      if (res.status === 401 || res.status === 403) {
        return { success: false, error: 'Invalid Client ID or Client Secret' };
      }

      if (!res.ok) {
        const body = await res.text();
        // Intuit may return various errors — try to extract a useful message
        try {
          const json = JSON.parse(body);
          const msg = json.error_description || json.error || `HTTP ${res.status}`;
          return { success: false, error: `Intuit API: ${msg}` };
        } catch {
          return { success: false, error: `Intuit API error (${res.status}): ${body.slice(0, 200)}` };
        }
      }

      return {
        success: true,
        account_name: `QuickBooks (${realmId})`,
        account_id: realmId,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to connect to QuickBooks',
      };
    }
  },
};

export function registerQuickBooks(): void {
  registerProvider(quickbooks);
}
