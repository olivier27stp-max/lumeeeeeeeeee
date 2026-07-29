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

export interface Integration {
  id: string;
  slug: string;
  name: string;
  description_short: string;
  description_long: string;
  category: string;
  connection_type: ConnectionType;
  logo_url?: string;
  logo_color: string;
  logo_text_color?: string;
  logo_initials: string;
  auth_fields: AuthField[];
  supported_features: string[];
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
  'Comptabilite',
];

// ── Integration Catalog ───────────────────────────────────────

export const INTEGRATIONS: Integration[] = [
  {
    id: 'stripe',
    slug: 'stripe',
    name: 'Stripe',
    description_short: 'Vos clients paient par carte, directement dans Lume.',
    description_long:
      "Les paiements de Lume passent par Stripe. Vos clients reglent leurs factures et soumissions par carte, et l'argent est depose dans votre compte bancaire. Rien a installer : tout est deja inclus dans votre abonnement.",
    category: 'Paiements',
    connection_type: 'native',
    logo_url: '/integrations/stripe.svg?v=2',
    logo_color: '#635BFF',
    logo_initials: 'S',
    auth_fields: [],
    supported_features: [
      'Paiement par carte',
      'Factures et soumissions payables en ligne',
      'Depots automatiques',
      'Remboursements',
    ],
    featured: true,
    manage_route: '/settings/payments',
    official_site_url: 'https://stripe.com',
  },
  {
    id: 'twilio',
    slug: 'twilio',
    name: 'Messagerie SMS',
    description_short: 'Textez vos clients depuis Lume avec votre numero.',
    description_long:
      "Votre organisation obtient son propre numero de telephone pour envoyer et recevoir des textos directement dans Lume : rappels de rendez-vous, confirmations et suivis. Inclus avec les forfaits qui comprennent les SMS.",
    category: 'Communication',
    connection_type: 'native',
    logo_url: '/integrations/twilio.svg?v=2',
    logo_color: '#F22F46',
    logo_initials: 'SMS',
    auth_fields: [],
    supported_features: [
      'Textos sortants',
      'Textos entrants',
      'Rappels automatiques',
      'Numero dedie a votre entreprise',
    ],
    featured: true,
    manage_route: '/settings/messaging',
  },
  {
    id: 'quickbooks',
    slug: 'quickbooks',
    name: 'QuickBooks',
    description_short: 'Envoyez vos factures a votre comptabilite.',
    description_long:
      'Synchronisez vos factures et vos paiements avec QuickBooks Online pour garder votre comptabilite a jour sans double saisie. Connectez votre compte QuickBooks en une fois, la synchronisation se fait ensuite toute seule.',
    category: 'Comptabilite',
    connection_type: 'oauth',
    logo_url: '/integrations/quickbooks.svg?v=2',
    logo_color: '#2CA01C',
    logo_initials: 'QB',
    auth_fields: [],
    supported_features: [
      'Sync des factures',
      'Sync des paiements',
      'Plan comptable',
      'Rapports comptables',
    ],
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
