import dotenv from 'dotenv';
import Stripe from 'stripe';
import Twilio from 'twilio';

dotenv.config({ path: '.env.local' });
dotenv.config();

export const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
export const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
export const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const mapboxGeocodingToken = process.env.MAPBOX_GEOCODING_TOKEN || '';

export const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
export const paypalWebhookId = process.env.PAYPAL_WEBHOOK_ID || '';
export const paypalEnv = String(process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';

// Twilio SMS config
export const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID || '';
export const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN || '';
export const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER || ''; // E.164 format
export const twilioClient = twilioAccountSid && twilioAuthToken && twilioAccountSid.startsWith('AC')
  ? Twilio(twilioAccountSid, twilioAuthToken)
  : null;

export const stripeWebhookClient = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY for API server.');
}

/**
 * Safe base URL helper. In production, FRONTEND_URL MUST be set.
 * Prevents accidentally generating localhost links in invite emails,
 * OAuth redirects, and quote share URLs.
 */
export function getBaseUrl(): string {
  const url = process.env.FRONTEND_URL?.trim();
  if (url) return url.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: FRONTEND_URL must be set in production');
  }
  return `http://localhost:${process.env.API_PORT || 5173}`;
}

// Director Panel — AI provider keys
export const falApiKey = process.env.FAL_API_KEY || '';

// Email config (SMTP via Nodemailer — see server/lib/mailer.ts)
export const emailFrom = process.env.EMAIL_FROM || `Lume CRM <${process.env.SMTP_USER || 'noreply@lume.crm'}>`;

// Platform admin
export const platformOwnerId = process.env.PLATFORM_OWNER_ID || '';

// Re-export Twilio for webhook validation
export { default as Twilio } from 'twilio';
