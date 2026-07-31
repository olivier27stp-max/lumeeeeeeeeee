/* ═══════════════════════════════════════════════════════════════
   Integration Catalog
   Static catalog of all integrations available in the Marketplace.
   Types, data and helpers used by AppMarketplace.tsx.

   SCOPE — deliberately small. The catalog only lists integrations that
   actually DO something in Lume. An add-on whose credentials are stored
   but never read is a false promise to the customer, so it does not
   belong here. Adding one back means wiring its real behaviour first.

   • Stripe     — native, via Lume Payments (Stripe Connect)
   • Twilio     — native, via the plan-included SMS number
   • QuickBooks — the only customer-actionable connection (OAuth/Intuit)
   ═══════════════════════════════════════════════════════════════ */

// ── Types ─────────────────────────────────────────────────────

export interface AuthField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url' | 'select';
  required: boolean;
  placeholder?: string;
  helpText?: string;
  options?: string[];
}

/**
 * `native` — provisioned by Lume itself. The org has nothing to connect;
 * the card reflects real state read from /integrations/native-status.
 */
export type ConnectionType =
  | 'oauth'
  | 'api_key'
  | 'webhook'
  | 'manual'
  | 'internal'
  | 'native'
  | 'coming_soon';

/** Display copy available in both app languages. */
export interface LocalizedText {
  fr: string;
  en: string;
}

export interface Integration {
  id: string;
  slug: string;
  name: string;
  /** English display name when it differs from `name` (e.g. « Messagerie SMS »). */
  name_en?: string;
  description_short: LocalizedText;
  description_long: LocalizedText;
  category: string;
  connection_type: ConnectionType;
  logo_url?: string;
  logo_color: string;
  logo_text_color?: string;
  logo_initials: string;
  auth_fields: AuthField[];
  supported_features: { fr: string[]; en: string[] };
  featured?: boolean;
  oauth_provider?: string;
  official_setup_url?: string;
  official_site_url?: string;
  docs_url?: string;
  webhook_instructions?: string;
  /** Where the customer goes to act on a native integration. */
  manage_route?: string;
}

// ── Categories ────────────────────────────────────────────────

export const CATEGORIES: string[] = [
  'Paiements',
  'Communication',
  'Comptabilité',
];

// ── Integration Catalog ───────────────────────────────────────

export const INTEGRATIONS: Integration[] = [
  {
    id: 'stripe',
    slug: 'stripe',
    name: 'Stripe',
    description_short: {
      fr: 'Vos clients paient par carte, directement dans Lume.',
      en: 'Your clients pay by card, directly in Lume.',
    },
    description_long: {
      fr: "Les paiements de Lume passent par Stripe. Vos clients règlent leurs factures et soumissions par carte, et l'argent est déposé dans votre compte bancaire. Rien à installer : tout est déjà inclus dans votre abonnement.",
      en: "Lume payments run on Stripe. Your clients pay their invoices and quotes by card, and the money is deposited into your bank account. Nothing to install: it's already included in your subscription.",
    },
    category: 'Paiements',
    connection_type: 'native',
    logo_url: '/integrations/stripe.svg?v=2',
    logo_color: '#635BFF',
    logo_initials: 'S',
    auth_fields: [],
    supported_features: {
      fr: [
        'Paiement par carte',
        'Factures et soumissions payables en ligne',
        'Dépôts automatiques',
        'Remboursements',
      ],
      en: [
        'Card payments',
        'Invoices and quotes payable online',
        'Automatic payouts',
        'Refunds',
      ],
    },
    featured: true,
    manage_route: '/settings/payments',
    official_site_url: 'https://stripe.com',
  },
  {
    id: 'twilio',
    slug: 'twilio',
    name: 'Messagerie SMS',
    name_en: 'SMS Messaging',
    description_short: {
      fr: 'Textez vos clients depuis Lume avec votre numéro.',
      en: 'Text your clients from Lume with your own number.',
    },
    description_long: {
      fr: 'Votre organisation obtient son propre numéro de téléphone pour envoyer et recevoir des textos directement dans Lume : rappels de rendez-vous, confirmations et suivis. Inclus avec les forfaits qui comprennent les SMS.',
      en: 'Your organization gets its own phone number to send and receive texts directly in Lume: appointment reminders, confirmations and follow-ups. Included with plans that include SMS.',
    },
    category: 'Communication',
    connection_type: 'native',
    logo_url: '/integrations/twilio.svg?v=2',
    logo_color: '#F22F46',
    logo_initials: 'SMS',
    auth_fields: [],
    supported_features: {
      fr: [
        'Textos sortants',
        'Textos entrants',
        'Rappels automatiques',
        'Numéro dédié à votre entreprise',
      ],
      en: [
        'Outgoing texts',
        'Incoming texts',
        'Automatic reminders',
        'Dedicated number for your business',
      ],
    },
    featured: true,
    manage_route: '/settings/messaging',
  },
  {
    id: 'quickbooks',
    slug: 'quickbooks',
    name: 'QuickBooks',
    description_short: {
      fr: 'Envoyez vos factures à votre comptabilité.',
      en: 'Send your invoices to your accounting.',
    },
    description_long: {
      fr: 'Synchronisez vos factures et vos paiements avec QuickBooks Online pour garder votre comptabilité à jour sans double saisie. Connectez votre compte QuickBooks une seule fois, la synchronisation se fait ensuite toute seule.',
      en: 'Sync your invoices and payments with QuickBooks Online to keep your books up to date without double entry. Connect your QuickBooks account once, and syncing then happens on its own.',
    },
    category: 'Comptabilité',
    connection_type: 'oauth',
    logo_url: '/integrations/quickbooks.svg?v=2',
    logo_color: '#2CA01C',
    logo_initials: 'QB',
    auth_fields: [],
    supported_features: {
      fr: [
        'Sync des factures',
        'Sync des paiements',
        'Plan comptable',
        'Rapports comptables',
      ],
      en: [
        'Invoice sync',
        'Payment sync',
        'Chart of accounts',
        'Accounting reports',
      ],
    },
    featured: true,
    oauth_provider: 'Intuit',
    official_site_url: 'https://quickbooks.intuit.com',
    docs_url:
      'https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account',
  },
];

// ── Helpers ───────────────────────────────────────────────────

export function getFeaturedIntegrations(): Integration[] {
  return INTEGRATIONS.filter((app) => app.featured === true);
}
