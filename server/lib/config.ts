import dotenv from 'dotenv';
import Stripe from 'stripe';
import Twilio from 'twilio';
import { envelopperTwilio } from './qa-redirect';

dotenv.config({ path: '.env.local' });
dotenv.config();

export const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
export const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
export const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
// Geocoding providers. MAPBOX_GEOCODING_TOKEN was never set in prod, which
// silently disabled Mapbox and sent every server-side geocode to Nominatim
// (street-centerline results) — hence the VITE_ fallbacks: those vars are
// already present at runtime on Railway. Dedicated server keys still win.
export const mapboxGeocodingToken = process.env.MAPBOX_GEOCODING_TOKEN || process.env.VITE_MAPBOX_TOKEN || '';
export const googleGeocodingKey = process.env.GOOGLE_GEOCODING_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '';

export const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
export const stripeConnectWebhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET || '';
export const paypalWebhookId = process.env.PAYPAL_WEBHOOK_ID || '';
export const paypalEnv = String(process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';

// Twilio SMS config
export const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID || '';
export const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN || '';
export const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER || ''; // E.164 format
// Le client est enveloppé par le mode QA : quand QA_REDIRECT_TO est défini, tout
// `messages.create` part vers ce numéro au lieu du client réel. On enveloppe ici,
// à l'unique point d'instanciation, plutôt qu'aux 8 sites d'appel dispersés — un
// neuvième appelant est ainsi couvert d'office. Sans la variable, `envelopperTwilio`
// renvoie le client inchangé.
export const twilioClient = envelopperTwilio(
  twilioAccountSid && twilioAuthToken && twilioAccountSid.startsWith('AC')
    // timeout : sans borne, une lenteur réseau Twilio suspend l'appelant
    // indéfiniment (l'agent MCP, une automatisation…). 20 s est très au-delà
    // d'un envoi normal (~1-2 s) et libère la requête en cas de blocage.
    ? Twilio(twilioAccountSid, twilioAuthToken, { timeout: 20_000 })
    : null,
);

/**
 * URL du callback de statut Twilio, à passer à CHAQUE `messages.create`.
 *
 * Sans ce paramètre par message, Twilio ne renvoie jamais l'accusé de
 * réception d'un SMS sortant : tous les messages restaient éternellement au
 * statut `sent` — qui signifie seulement « l'API Twilio a accepté l'appel »,
 * pas « le téléphone du client l'a reçu ». Un message rejeté par l'opérateur
 * apparaissait donc comme livré, pour toujours.
 *
 * (Le `statusCallback` configuré sur le numéro à l'achat ne couvre que les
 * messages ENTRANTS ; il ne remplace pas ce paramètre.)
 *
 * L'ordre des variables reproduit exactement celui de la validation de
 * signature dans `routes/messages.ts` : la signature se valide contre l'URL
 * EXACTE appelée par Twilio, donc toute divergence ferait rejeter 100 % des
 * callbacks. Retourne `undefined` si aucune URL publique n'est configurée —
 * on n'envoie alors pas de callback plutôt qu'une URL relative invalide.
 */
export function getTwilioStatusCallbackUrl(): string | undefined {
  const base = (
    process.env.TWILIO_WEBHOOK_BASE_URL
    || process.env.PUBLIC_URL
    || process.env.PUBLIC_BASE_URL
    || process.env.FRONTEND_URL
    || ''
  ).trim().replace(/\/$/, '');

  if (!base || !/^https?:\/\//.test(base)) return undefined;
  // Twilio ne peut pas joindre une machine locale : inutile d'annoncer une URL
  // qu'il ne pourra jamais appeler.
  if (/localhost|127\.0\.0\.1/.test(base)) return undefined;
  return `${base}/api/messages/status`;
}

export const stripeWebhookClient = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// ── Lume Agent (Google Gemini) ──
// Free API key from Google AI Studio (https://aistudio.google.com/apikey).
// Model is configurable; gemini-2.5-flash supports function calling on the free tier.
export const geminiApiKey = process.env.GEMINI_API_KEY || '';
export const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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

// Email config (SMTP via Nodemailer — see server/lib/mailer.ts)
export const emailFrom = process.env.EMAIL_FROM || `Lume CRM <${process.env.SMTP_USER || 'noreply@lume.crm'}>`;

// Inbox that receives in-app support requests. Override with SUPPORT_EMAIL in .env.local.
// Le défaut doit rester sur le domaine canonique (lumecrm.net, cf. CANONICAL_HOST
// dans server/index.ts) : un défaut pointant ailleurs envoie les demandes des
// clients à un domaine qui ne nous appartient pas, sans erreur visible.
export const supportEmail = process.env.SUPPORT_EMAIL || 'support@lumecrm.net';

// Platform admin
export const platformOwnerId = process.env.PLATFORM_OWNER_ID || '';

// Admins plateforme (console des migrations assistées) : union de
// PLATFORM_OWNER_ID et de la liste optionnelle PLATFORM_ADMIN_IDS
// (UUID séparés par des virgules). Ensemble vide = console désactivée (503).
export const platformAdminIds: ReadonlySet<string> = new Set(
  [platformOwnerId, ...(process.env.PLATFORM_ADMIN_IDS || '').split(',')]
    .map((v) => v.trim())
    .filter((v) => v.length > 0),
);

// Re-export Twilio for webhook validation
export { default as Twilio } from 'twilio';
