/* ═══════════════════════════════════════════════════════════════
   Generic API-key Providers
   All integrations that use simple API key / credential auth
   with a test endpoint to validate the connection.
   ═══════════════════════════════════════════════════════════════ */

import { registerProvider } from '../registry';
import type { ProviderDefinition, DecryptedCredentials, TestResult } from '../types';

// ── Helper: create a simple API-key provider ──────────────────
function apiKeyProvider(opts: {
  slug: string;
  display_name: string;
  credential_fields: ProviderDefinition['credential_fields'];
  testConnection: (creds: DecryptedCredentials) => Promise<TestResult>;
}): ProviderDefinition {
  return {
    slug: opts.slug,
    display_name: opts.display_name,
    auth_type: 'api_key',
    credential_fields: opts.credential_fields,
    testConnection: opts.testConnection,
  };
}

// ── Helper: create a webhook-based provider ───────────────────
function webhookProvider(opts: {
  slug: string;
  display_name: string;
  extraFields?: ProviderDefinition['credential_fields'];
}): ProviderDefinition {
  return {
    slug: opts.slug,
    display_name: opts.display_name,
    auth_type: 'api_key',
    credential_fields: [
      { key: 'webhook_url', label: 'Webhook URL', type: 'url', required: true, placeholder: 'https://...' },
      ...(opts.extraFields || []),
    ],
    testConnection: async (creds: DecryptedCredentials): Promise<TestResult> => {
      const url = creds.extra?.webhook_url;
      if (!url) return { success: false, error: 'No webhook URL provided' };
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ test: true, source: 'lume-crm' }),
        });
        // Webhooks may return various success codes
        if (res.status < 500) {
          return { success: true, account_name: opts.display_name };
        }
        return { success: false, error: `Webhook returned ${res.status}` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Webhook unreachable' };
      }
    },
  };
}

// ══════════════════════════════════════════════════════════════
// PROVIDER DEFINITIONS
// ══════════════════════════════════════════════════════════════

// ── Mailchimp ─────────────────────────────────────────────────
const mailchimp = apiKeyProvider({
  slug: 'mailchimp',
  display_name: 'Mailchimp',
  credential_fields: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true, placeholder: 'xxxxxxxx-us21' },
    { key: 'server_prefix', label: 'Server Prefix', type: 'text', required: true, placeholder: 'us21' },
  ],
  testConnection: async (creds) => {
    const key = creds.api_key || creds.extra?.api_key;
    const dc = creds.extra?.server_prefix || key?.split('-').pop();
    if (!key || !dc) return { success: false, error: 'API key and server prefix required' };
    try {
      const res = await fetch(`https://${dc}.api.mailchimp.com/3.0/ping`, {
        headers: { Authorization: `apikey ${key}` },
      });
      if (!res.ok) return { success: false, error: `Mailchimp API error: ${res.status}` };
      return { success: true, account_name: 'Mailchimp Account' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to connect' };
    }
  },
});

// ── OpenAI ────────────────────────────────────────────────────
const openai = apiKeyProvider({
  slug: 'openai',
  display_name: 'OpenAI',
  credential_fields: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true, placeholder: 'sk-...' },
  ],
  testConnection: async (creds) => {
    const key = creds.api_key || creds.extra?.api_key;
    if (!key) return { success: false, error: 'No API key provided' };
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.status === 401) return { success: false, error: 'Invalid API key' };
      if (!res.ok) return { success: false, error: `OpenAI API error: ${res.status}` };
      return { success: true, account_name: 'OpenAI Account' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to connect' };
    }
  },
});

// ── Google Maps ───────────────────────────────────────────────
const googleMaps = apiKeyProvider({
  slug: 'google-maps',
  display_name: 'Google Maps',
  credential_fields: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true, placeholder: 'AIza...' },
  ],
  testConnection: async (creds) => {
    const key = creds.api_key || creds.extra?.api_key;
    if (!key) return { success: false, error: 'No API key provided' };
    try {
      const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=test&key=${key}`);
      const data = await res.json() as Record<string, unknown>;
      if ((data as any).status === 'REQUEST_DENIED') {
        return { success: false, error: (data as any).error_message || 'Invalid API key' };
      }
      return { success: true, account_name: 'Google Maps' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to connect' };
    }
  },
});

// ── Traccar ───────────────────────────────────────────────────
const traccar = apiKeyProvider({
  slug: 'traccar',
  display_name: 'Traccar',
  credential_fields: [
    { key: 'server_url', label: 'Server URL', type: 'url', required: true, placeholder: 'https://your-traccar.com' },
    { key: 'username', label: 'Username', type: 'text', required: true },
    { key: 'password', label: 'Password', type: 'password', required: true },
  ],
  testConnection: async (creds) => {
    const url = creds.extra?.server_url;
    const user = creds.extra?.username;
    const pass = creds.extra?.password;
    if (!url || !user || !pass) return { success: false, error: 'Server URL, username and password required' };
    try {
      const basicAuth = Buffer.from(`${user}:${pass}`).toString('base64');
      const res = await fetch(`${url.replace(/\/$/, '')}/api/session`, {
        method: 'GET',
        headers: { Authorization: `Basic ${basicAuth}` },
      });
      if (res.status === 401) return { success: false, error: 'Invalid username or password' };
      if (!res.ok) return { success: false, error: `Traccar API error: ${res.status}` };
      const data = await res.json() as Record<string, unknown>;
      return { success: true, account_name: (data as any).name || 'Traccar', account_id: String((data as any).id || '') };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to connect to Traccar' };
    }
  },
});

// ── Gemini ────────────────────────────────────────────────────
const gemini = apiKeyProvider({
  slug: 'gemini',
  display_name: 'Gemini',
  credential_fields: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true, placeholder: 'AIza...' },
  ],
  testConnection: async (creds) => {
    const key = creds.api_key || creds.extra?.api_key;
    if (!key) return { success: false, error: 'No API key provided' };
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${key}`);
      if (res.status === 400 || res.status === 403) return { success: false, error: 'Invalid API key' };
      if (!res.ok) return { success: false, error: `Gemini API error: ${res.status}` };
      return { success: true, account_name: 'Google Gemini' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to connect' };
    }
  },
});

// ── Claude AI ─────────────────────────────────────────────────
const claude = apiKeyProvider({
  slug: 'claude',
  display_name: 'Claude AI',
  credential_fields: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true, placeholder: 'sk-ant-...' },
  ],
  testConnection: async (creds) => {
    const key = creds.api_key || creds.extra?.api_key;
    if (!key) return { success: false, error: 'No API key provided' };
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }],
        }),
      });
      if (res.status === 401) return { success: false, error: 'Invalid API key' };
      // Any non-401 response means the key is valid
      return { success: true, account_name: 'Anthropic' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to connect' };
    }
  },
});

// ── ElevenLabs ────────────────────────────────────────────────
const elevenlabs = apiKeyProvider({
  slug: 'elevenlabs',
  display_name: 'ElevenLabs',
  credential_fields: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true },
  ],
  testConnection: async (creds) => {
    const key = creds.api_key || creds.extra?.api_key;
    if (!key) return { success: false, error: 'No API key provided' };
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': key },
      });
      if (res.status === 401) return { success: false, error: 'Invalid API key' };
      if (!res.ok) return { success: false, error: `ElevenLabs API error: ${res.status}` };
      const data = await res.json() as Record<string, unknown>;
      return { success: true, account_name: (data as any).first_name || 'ElevenLabs Account' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to connect' };
    }
  },
});

// ── GitHub ────────────────────────────────────────────────────
const github = apiKeyProvider({
  slug: 'github',
  display_name: 'GitHub',
  credential_fields: [
    { key: 'personal_access_token', label: 'Personal Access Token', type: 'password', required: true, placeholder: 'ghp_...' },
  ],
  testConnection: async (creds) => {
    const token = creds.extra?.personal_access_token || creds.api_key;
    if (!token) return { success: false, error: 'No token provided' };
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      });
      if (res.status === 401) return { success: false, error: 'Invalid token' };
      if (!res.ok) return { success: false, error: `GitHub API error: ${res.status}` };
      const data = await res.json() as Record<string, unknown>;
      return { success: true, account_name: (data as any).login || 'GitHub User', account_id: String((data as any).id || '') };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to connect' };
    }
  },
});

// ── Vercel ────────────────────────────────────────────────────
const vercel = apiKeyProvider({
  slug: 'vercel',
  display_name: 'Vercel',
  credential_fields: [
    { key: 'api_token', label: 'API Token', type: 'password', required: true },
  ],
  testConnection: async (creds) => {
    const token = creds.extra?.api_token || creds.api_key;
    if (!token) return { success: false, error: 'No token provided' };
    try {
      const res = await fetch('https://api.vercel.com/v2/user', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) return { success: false, error: 'Invalid token' };
      if (!res.ok) return { success: false, error: `Vercel API error: ${res.status}` };
      const data = await res.json() as Record<string, unknown>;
      const user = (data as any).user;
      return { success: true, account_name: user?.username || user?.name || 'Vercel Account', account_id: user?.id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to connect' };
    }
  },
});

// ── Mapbox ────────────────────────────────────────────────────
const mapbox = apiKeyProvider({
  slug: 'mapbox',
  display_name: 'Mapbox',
  credential_fields: [
    { key: 'access_token', label: 'Access Token', type: 'password', required: true, placeholder: 'pk.eyJ1...' },
  ],
  testConnection: async (creds) => {
    const token = creds.extra?.access_token || creds.api_key;
    if (!token) return { success: false, error: 'No access token provided' };
    try {
      const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/test.json?access_token=${token}`);
      if (res.status === 401) return { success: false, error: 'Invalid access token' };
      if (!res.ok) return { success: false, error: `Mapbox API error: ${res.status}` };
      return { success: true, account_name: 'Mapbox' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to connect' };
    }
  },
});

// ── Jotform ───────────────────────────────────────────────────
const jotform = apiKeyProvider({
  slug: 'jotform',
  display_name: 'Jotform',
  credential_fields: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true },
  ],
  testConnection: async (creds) => {
    const key = creds.api_key || creds.extra?.api_key;
    if (!key) return { success: false, error: 'No API key provided' };
    try {
      const res = await fetch('https://api.jotform.com/user?apiKey=' + key);
      if (res.status === 401) return { success: false, error: 'Invalid API key' };
      if (!res.ok) return { success: false, error: `Jotform API error: ${res.status}` };
      const data = await res.json() as Record<string, unknown>;
      const user = (data as any).content;
      return { success: true, account_name: user?.username || user?.name || 'Jotform Account' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to connect' };
    }
  },
});

// ── Klaviyo ───────────────────────────────────────────────────
const klaviyo = apiKeyProvider({
  slug: 'klaviyo',
  display_name: 'Klaviyo',
  credential_fields: [
    { key: 'api_key', label: 'Private API Key', type: 'password', required: true, placeholder: 'pk_...' },
  ],
  testConnection: async (creds) => {
    const key = creds.api_key || creds.extra?.api_key;
    if (!key) return { success: false, error: 'No API key provided' };
    try {
      const res = await fetch('https://a.klaviyo.com/api/accounts/', {
        headers: { Authorization: `Klaviyo-API-Key ${key}`, revision: '2024-02-15' },
      });
      if (res.status === 401 || res.status === 403) return { success: false, error: 'Invalid API key' };
      if (!res.ok) return { success: false, error: `Klaviyo API error: ${res.status}` };
      return { success: true, account_name: 'Klaviyo Account' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to connect' };
    }
  },
});

// ── PandaDoc ──────────────────────────────────────────────────
const pandadoc = apiKeyProvider({
  slug: 'pandadoc',
  display_name: 'PandaDoc',
  credential_fields: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true },
  ],
  testConnection: async (creds) => {
    const key = creds.api_key || creds.extra?.api_key;
    if (!key) return { success: false, error: 'No API key provided' };
    try {
      const res = await fetch('https://api.pandadoc.com/public/v1/documents?count=1', {
        headers: { Authorization: `API-Key ${key}` },
      });
      if (res.status === 401) return { success: false, error: 'Invalid API key' };
      if (!res.ok) return { success: false, error: `PandaDoc API error: ${res.status}` };
      return { success: true, account_name: 'PandaDoc Account' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to connect' };
    }
  },
});

// ── PayPal ────────────────────────────────────────────────────
const paypal = apiKeyProvider({
  slug: 'paypal',
  display_name: 'PayPal Business',
  credential_fields: [
    { key: 'client_id', label: 'Client ID', type: 'text', required: true },
    { key: 'client_secret', label: 'Client Secret', type: 'password', required: true },
    { key: 'environment', label: 'Environment', type: 'text', required: false, placeholder: 'sandbox or production' },
  ],
  testConnection: async (creds) => {
    const clientId = creds.extra?.client_id;
    const clientSecret = creds.extra?.client_secret || creds.api_secret;
    const env = creds.extra?.environment?.toLowerCase() === 'production' ? 'api-m' : 'api-m.sandbox';
    if (!clientId || !clientSecret) return { success: false, error: 'Client ID and Secret required' };
    try {
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const res = await fetch(`https://${env}.paypal.com/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      if (res.status === 401) return { success: false, error: 'Invalid Client ID or Secret' };
      if (!res.ok) return { success: false, error: `PayPal API error: ${res.status}` };
      const data = await res.json() as Record<string, unknown>;
      return { success: true, account_name: `PayPal (${(data as any).app_id || env})` };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to connect' };
    }
  },
});

// ── Square ────────────────────────────────────────────────────
const square = apiKeyProvider({
  slug: 'square',
  display_name: 'Square',
  credential_fields: [
    { key: 'access_token', label: 'Access Token', type: 'password', required: true },
  ],
  testConnection: async (creds) => {
    const token = creds.extra?.access_token || creds.api_key;
    if (!token) return { success: false, error: 'No access token provided' };
    try {
      const res = await fetch('https://connect.squareup.com/v2/merchants/me', {
        headers: { Authorization: `Bearer ${token}`, 'Square-Version': '2024-01-18' },
      });
      if (res.status === 401) return { success: false, error: 'Invalid access token' };
      if (!res.ok) return { success: false, error: `Square API error: ${res.status}` };
      const data = await res.json() as Record<string, unknown>;
      const merchant = (data as any).merchant;
      return { success: true, account_name: merchant?.business_name || 'Square Merchant', account_id: merchant?.id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to connect' };
    }
  },
});

// ── Dropbox ───────────────────────────────────────────────────
const dropbox = apiKeyProvider({
  slug: 'dropbox',
  display_name: 'Dropbox',
  credential_fields: [
    { key: 'access_token', label: 'Access Token', type: 'password', required: true },
  ],
  testConnection: async (creds) => {
    const token = creds.extra?.access_token || creds.api_key;
    if (!token) return { success: false, error: 'No access token provided' };
    try {
      const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) return { success: false, error: 'Invalid or expired token' };
      if (!res.ok) return { success: false, error: `Dropbox API error: ${res.status}` };
      const data = await res.json() as Record<string, unknown>;
      return { success: true, account_name: (data as any).name?.display_name || 'Dropbox Account', account_id: (data as any).account_id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to connect' };
    }
  },
});

// ── Xero — real API test via /api.xro/2.0/Organisation ──────────
const xero = apiKeyProvider({
  slug: 'xero',
  display_name: 'Xero',
  credential_fields: [
    { key: 'client_id', label: 'Client ID', type: 'text', required: true },
    { key: 'client_secret', label: 'Client Secret', type: 'password', required: true },
  ],
  testConnection: async (creds) => {
    const clientId = creds.extra?.client_id;
    const clientSecret = creds.extra?.client_secret || creds.api_secret;
    if (!clientId || !clientSecret) return { success: false, error: 'Client ID and Client Secret required' };
    try {
      // Xero uses OAuth2 client_credentials for app-level access
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const res = await fetch('https://identity.xero.com/connect/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basicAuth}`,
        },
        body: 'grant_type=client_credentials&scope=accounting.settings.read',
      });
      if (res.status === 401) return { success: false, error: 'Invalid Client ID or Client Secret' };
      if (!res.ok) {
        const body = await res.text();
        return { success: false, error: `Xero auth error (${res.status}): ${body.slice(0, 200)}` };
      }
      return { success: true, account_name: 'Xero Account' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to connect to Xero' };
    }
  },
});

// ── Webhook-based providers ───────────────────────────────────
const n8n = webhookProvider({ slug: 'n8n', display_name: 'n8n' });
const make = webhookProvider({ slug: 'make', display_name: 'Make' });

// ══════════════════════════════════════════════════════════════
// REGISTRATION
// ══════════════════════════════════════════════════════════════

export function registerGenericProviders(): void {
  const all = [
    mailchimp, openai, googleMaps, traccar,
    gemini, claude, elevenlabs, github, vercel, mapbox,
    jotform, klaviyo, pandadoc, paypal, square, dropbox,
    xero,
    n8n, make,
  ];
  for (const provider of all) {
    registerProvider(provider);
  }
}
