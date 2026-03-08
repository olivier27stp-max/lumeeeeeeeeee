import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { decryptSecret } from './crypto';

interface StripeClientOptions {
  orgId: string;
  supabaseUrl: string;
  serviceRoleKey: string;
}

function getAdminClient(options: StripeClientOptions) {
  if (!options.supabaseUrl || !options.serviceRoleKey) {
    throw new Error('Missing Supabase admin credentials for Stripe client.');
  }
  return createClient(options.supabaseUrl, options.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getStripeClient(options: StripeClientOptions): Promise<{
  stripe: Stripe;
  publishableKey: string | null;
}> {
  const admin = getAdminClient(options);
  const { data, error } = await admin
    .from('payment_provider_secrets')
    .select('stripe_publishable_key,stripe_secret_key_enc')
    .eq('org_id', options.orgId)
    .maybeSingle();

  if (error) throw error;
  const encrypted = String(data?.stripe_secret_key_enc || '').trim();
  if (!encrypted) {
    throw new Error('Stripe secret key is not configured for this organization.');
  }

  const secretKey = decryptSecret(encrypted);
  return {
    stripe: new Stripe(secretKey),
    publishableKey: data?.stripe_publishable_key || null,
  };
}

