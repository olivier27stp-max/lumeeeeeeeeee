import { createClient } from '@supabase/supabase-js';
import { decryptSecret } from './crypto';

interface PayPalClientOptions {
  orgId: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  env: 'sandbox' | 'live';
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

function getAdminClient(options: PayPalClientOptions) {
  if (!options.supabaseUrl || !options.serviceRoleKey) {
    throw new Error('Missing Supabase admin credentials for PayPal client.');
  }
  return createClient(options.supabaseUrl, options.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getPayPalBaseUrl(env: 'sandbox' | 'live') {
  return env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

async function getPayPalCredentials(options: PayPalClientOptions): Promise<{ clientId: string; secret: string }> {
  const admin = getAdminClient(options);
  const { data, error } = await admin
    .from('payment_provider_secrets')
    .select('paypal_client_id,paypal_secret_enc')
    .eq('org_id', options.orgId)
    .maybeSingle();

  if (error) throw error;
  const clientId = String(data?.paypal_client_id || '').trim();
  const encrypted = String(data?.paypal_secret_enc || '').trim();
  if (!clientId || !encrypted) {
    throw new Error('PayPal credentials are not configured for this organization.');
  }

  return {
    clientId,
    secret: decryptSecret(encrypted),
  };
}

export async function getPayPalAccessToken(options: PayPalClientOptions): Promise<string> {
  const cacheKey = `${options.orgId}:${options.env}`;
  const now = Date.now();
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > now + 10_000) {
    return cached.accessToken;
  }

  const credentials = await getPayPalCredentials(options);
  const auth = Buffer.from(`${credentials.clientId}:${credentials.secret}`).toString('base64');
  const response = await fetch(`${getPayPalBaseUrl(options.env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PayPal OAuth failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as { access_token: string; expires_in?: number };
  const accessToken = String(payload.access_token || '').trim();
  if (!accessToken) {
    throw new Error('PayPal OAuth response missing access_token.');
  }

  const ttlMs = Math.max(30, Number(payload.expires_in || 300)) * 1000;
  tokenCache.set(cacheKey, {
    accessToken,
    expiresAt: now + ttlMs,
  });

  return accessToken;
}

export async function paypalFetch(
  options: PayPalClientOptions,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const token = await getPayPalAccessToken(options);
  const url = `${getPayPalBaseUrl(options.env)}${path}`;
  const headers = new Headers(init?.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && init?.method && init.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }

  let response = await fetch(url, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    tokenCache.delete(`${options.orgId}:${options.env}`);
    const refreshed = await getPayPalAccessToken(options);
    headers.set('Authorization', `Bearer ${refreshed}`);
    response = await fetch(url, {
      ...init,
      headers,
    });
  }

  return response;
}

