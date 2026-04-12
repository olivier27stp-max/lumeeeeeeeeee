/* ═══════════════════════════════════════════════════════════════
   Integration Catalog
   Static catalog of all integrations available in the Marketplace.
   Types, data and helpers used by AppMarketplace.tsx.
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

export interface Integration {
  id: string;
  slug: string;
  name: string;
  description_short: string;
  description_long: string;
  category: string;
  connection_type: 'oauth' | 'api_key' | 'webhook' | 'manual' | 'internal' | 'coming_soon';
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
}

// ── Categories ────────────────────────────────────────────────

export const CATEGORIES: string[] = [
  'Paiements',
  'Comptabilite',
  'Communication',
  'Marketing',
  'IA & Automatisation',
  'Developpement',
  'Cartographie',
  'Formulaires',
  'Stockage',
  'Documents',
];

// ── Integration Catalog ───────────────────────────────────────

export const INTEGRATIONS: Integration[] = [
  // ── Paiements ──
  {
    id: 'stripe',
    slug: 'stripe',
    name: 'Stripe',
    description_short: 'Paiements en ligne, facturation et abonnements.',
    description_long: 'Acceptez les paiements par carte de credit, gerez les abonnements et suivez les revenus directement dans Lume CRM. Stripe est la plateforme de paiement la plus utilisee par les entreprises de services.',
    category: 'Paiements',
    connection_type: 'oauth',
    logo_url: 'https://cdn.brandfetch.io/stripe.com/icon/theme/light',
    logo_color: '#635BFF',
    logo_initials: 'S',
    auth_fields: [],
    supported_features: ['Paiements en ligne', 'Facturation automatique', 'Abonnements', 'Remboursements', 'Rapports financiers'],
    featured: true,
    oauth_provider: 'Stripe',
    official_setup_url: 'https://dashboard.stripe.com/apikeys',
    official_site_url: 'https://stripe.com',
    docs_url: 'https://stripe.com/docs/api',
  },
  {
    id: 'paypal',
    slug: 'paypal',
    name: 'PayPal Business',
    description_short: 'Paiements PayPal pour vos factures et soumissions.',
    description_long: 'Permettez a vos clients de payer avec PayPal. Integration complete pour les factures, les soumissions et les paiements recurrents.',
    category: 'Paiements',
    connection_type: 'api_key',
    logo_url: 'https://cdn.brandfetch.io/paypal.com/icon/theme/light',
    logo_color: '#003087',
    logo_initials: 'PP',
    auth_fields: [
      { key: 'client_id', label: 'Client ID', type: 'text', required: true, placeholder: 'Votre Client ID PayPal' },
      { key: 'client_secret', label: 'Client Secret', type: 'password', required: true, placeholder: 'Votre Client Secret PayPal' },
      { key: 'environment', label: 'Environnement', type: 'select', required: false, placeholder: 'Choisir...', options: ['sandbox', 'production'] },
    ],
    supported_features: ['Paiements en ligne', 'Facturation', 'Remboursements'],
    official_setup_url: 'https://developer.paypal.com/dashboard/applications',
    official_site_url: 'https://www.paypal.com/business',
  },
  {
    id: 'square',
    slug: 'square',
    name: 'Square',
    description_short: 'Paiements en personne et en ligne avec Square.',
    description_long: 'Integrez Square pour accepter les paiements en personne et en ligne. Synchronisez les transactions et gerez votre comptabilite.',
    category: 'Paiements',
    connection_type: 'api_key',
    logo_color: '#006AFF',
    logo_initials: 'Sq',
    auth_fields: [
      { key: 'access_token', label: 'Access Token', type: 'password', required: true },
    ],
    supported_features: ['Paiements en personne', 'Paiements en ligne', 'Inventaire'],
    official_setup_url: 'https://developer.squareup.com/apps',
    official_site_url: 'https://squareup.com',
  },

  // ── Comptabilite ──
  {
    id: 'quickbooks',
    slug: 'quickbooks',
    name: 'QuickBooks',
    description_short: 'Synchronisation comptable avec QuickBooks Online.',
    description_long: 'Synchronisez vos factures, paiements et depenses avec QuickBooks Online. Gardez votre comptabilite a jour automatiquement.',
    category: 'Comptabilite',
    connection_type: 'oauth',
    logo_url: 'https://cdn.brandfetch.io/quickbooks.intuit.com/icon/theme/light',
    logo_color: '#2CA01C',
    logo_initials: 'QB',
    auth_fields: [],
    supported_features: ['Sync factures', 'Sync paiements', 'Rapports comptables', 'Plan comptable'],
    featured: true,
    oauth_provider: 'Intuit',
    official_setup_url: 'https://developer.intuit.com/app/developer/qbo/docs/get-started',
    official_site_url: 'https://quickbooks.intuit.com',
    docs_url: 'https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account',
  },
  {
    id: 'xero',
    slug: 'xero',
    name: 'Xero',
    description_short: 'Comptabilite cloud avec Xero.',
    description_long: 'Connectez Xero pour synchroniser vos factures, contacts et rapports financiers. Ideal pour les PME qui utilisent Xero comme logiciel comptable.',
    category: 'Comptabilite',
    connection_type: 'api_key',
    logo_color: '#13B5EA',
    logo_initials: 'X',
    auth_fields: [
      { key: 'client_id', label: 'Client ID', type: 'text', required: true },
      { key: 'client_secret', label: 'Client Secret', type: 'password', required: true },
    ],
    supported_features: ['Sync factures', 'Sync contacts', 'Rapports financiers'],
    official_setup_url: 'https://developer.xero.com/app/manage',
    official_site_url: 'https://www.xero.com',
  },

  // ── Communication ──
  {
    id: 'slack',
    slug: 'slack',
    name: 'Slack',
    description_short: 'Notifications et alertes dans vos canaux Slack.',
    description_long: 'Recevez des notifications en temps reel dans Slack lorsque des evenements importants se produisent dans Lume CRM: nouveaux clients, paiements recus, taches assignees.',
    category: 'Communication',
    connection_type: 'oauth',
    logo_url: 'https://cdn.brandfetch.io/slack.com/icon/theme/light',
    logo_color: '#4A154B',
    logo_initials: 'Sl',
    auth_fields: [],
    supported_features: ['Notifications temps reel', 'Alertes personnalisees', 'Canaux dedies', 'Messages interactifs'],
    featured: true,
    oauth_provider: 'Slack',
    official_setup_url: 'https://api.slack.com/apps',
    official_site_url: 'https://slack.com',
    docs_url: 'https://api.slack.com/docs',
  },
  {
    id: 'twilio',
    slug: 'twilio',
    name: 'Twilio',
    description_short: 'SMS et appels pour la communication client.',
    description_long: 'Envoyez des SMS et passez des appels directement depuis Lume CRM. Ideal pour les rappels de rendez-vous, confirmations et suivis.',
    category: 'Communication',
    connection_type: 'api_key',
    logo_color: '#F22F46',
    logo_initials: 'Tw',
    auth_fields: [
      { key: 'account_sid', label: 'Account SID', type: 'text', required: true, placeholder: 'AC...' },
      { key: 'auth_token', label: 'Auth Token', type: 'password', required: true },
      { key: 'phone_number', label: 'Phone Number', type: 'text', required: true, placeholder: '+1...' },
    ],
    supported_features: ['SMS sortants', 'Rappels automatiques', 'SMS entrants'],
    official_setup_url: 'https://console.twilio.com',
    official_site_url: 'https://www.twilio.com',
    docs_url: 'https://www.twilio.com/docs',
  },

  // ── Marketing ──
  {
    id: 'mailchimp',
    slug: 'mailchimp',
    name: 'Mailchimp',
    description_short: 'Email marketing et campagnes automatisees.',
    description_long: 'Synchronisez vos contacts avec Mailchimp pour envoyer des campagnes email ciblees. Suivez les ouvertures, clics et conversions.',
    category: 'Marketing',
    connection_type: 'api_key',
    logo_url: 'https://cdn.brandfetch.io/mailchimp.com/icon/theme/light',
    logo_color: '#FFE01B',
    logo_text_color: '#241C15',
    logo_initials: 'MC',
    auth_fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true, placeholder: 'xxxxxxxx-us21', helpText: 'Trouvez votre cle dans Account > Extras > API Keys' },
      { key: 'server_prefix', label: 'Server Prefix', type: 'text', required: true, placeholder: 'us21', helpText: 'Les derniers caracteres de votre cle API (apres le tiret)' },
    ],
    supported_features: ['Sync contacts', 'Campagnes email', 'Segments', 'Rapports'],
    official_setup_url: 'https://us1.admin.mailchimp.com/account/api/',
    official_site_url: 'https://mailchimp.com',
    docs_url: 'https://mailchimp.com/developer/',
  },
  {
    id: 'klaviyo',
    slug: 'klaviyo',
    name: 'Klaviyo',
    description_short: 'Marketing automation et segmentation avancee.',
    description_long: 'Connectez Klaviyo pour des campagnes email et SMS personnalisees basees sur les donnees de votre CRM.',
    category: 'Marketing',
    connection_type: 'api_key',
    logo_color: '#000000',
    logo_text_color: '#FFFFFF',
    logo_initials: 'Kl',
    auth_fields: [
      { key: 'api_key', label: 'Private API Key', type: 'password', required: true, placeholder: 'pk_...' },
    ],
    supported_features: ['Email marketing', 'SMS marketing', 'Segmentation', 'Automatisations'],
    official_setup_url: 'https://www.klaviyo.com/settings/account/api-keys',
    official_site_url: 'https://www.klaviyo.com',
  },

  // ── IA & Automatisation ──
  {
    id: 'gemini',
    slug: 'gemini',
    name: 'Gemini',
    description_short: 'IA Google pour l\'analyse et la generation de contenu.',
    description_long: 'Utilisez les modeles Gemini de Google pour l\'analyse avancee, la generation de contenu et l\'assistance IA dans Lume CRM.',
    category: 'IA & Automatisation',
    connection_type: 'internal',
    logo_color: '#4285F4',
    logo_initials: 'Ge',
    auth_fields: [],
    supported_features: ['Analyse IA', 'Generation de contenu', 'Scenarios', 'Recommandations'],
    featured: true,
    official_site_url: 'https://ai.google.dev',
  },
  {
    id: 'openai',
    slug: 'openai',
    name: 'OpenAI',
    description_short: 'Modeles GPT pour l\'assistance intelligente.',
    description_long: 'Integrez les modeles OpenAI (GPT-4, etc.) pour des capacites IA supplementaires dans votre CRM.',
    category: 'IA & Automatisation',
    connection_type: 'api_key',
    logo_color: '#000000',
    logo_text_color: '#FFFFFF',
    logo_initials: 'AI',
    auth_fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true, placeholder: 'sk-...' },
    ],
    supported_features: ['Modeles GPT', 'Embeddings', 'Vision', 'Assistants'],
    official_setup_url: 'https://platform.openai.com/api-keys',
    official_site_url: 'https://openai.com',
    docs_url: 'https://platform.openai.com/docs',
  },
  {
    id: 'claude',
    slug: 'claude',
    name: 'Claude AI',
    description_short: 'IA Anthropic pour des reponses nuancees et fiables.',
    description_long: 'Utilisez Claude d\'Anthropic pour une IA conversationnelle avancee, l\'analyse de documents et la generation de contenu de haute qualite.',
    category: 'IA & Automatisation',
    connection_type: 'api_key',
    logo_color: '#D4A574',
    logo_text_color: '#FFFFFF',
    logo_initials: 'Cl',
    auth_fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true, placeholder: 'sk-ant-...' },
    ],
    supported_features: ['Chat IA', 'Analyse de documents', 'Generation de contenu'],
    official_setup_url: 'https://console.anthropic.com/settings/keys',
    official_site_url: 'https://anthropic.com',
    docs_url: 'https://docs.anthropic.com',
  },
  {
    id: 'elevenlabs',
    slug: 'elevenlabs',
    name: 'ElevenLabs',
    description_short: 'Synthese vocale IA pour la communication.',
    description_long: 'Generez des voix naturelles avec ElevenLabs pour les appels automatises, les messages vocaux et les assistants vocaux.',
    category: 'IA & Automatisation',
    connection_type: 'api_key',
    logo_color: '#000000',
    logo_text_color: '#FFFFFF',
    logo_initials: 'EL',
    auth_fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
    ],
    supported_features: ['Synthese vocale', 'Voix personnalisees', 'Audio streaming'],
    official_setup_url: 'https://elevenlabs.io/app/settings/api-keys',
    official_site_url: 'https://elevenlabs.io',
  },
  {
    id: 'n8n',
    slug: 'n8n',
    name: 'n8n',
    description_short: 'Automatisations et workflows personnalises.',
    description_long: 'Connectez n8n pour creer des automatisations puissantes entre Lume CRM et des centaines d\'autres services via des webhooks.',
    category: 'IA & Automatisation',
    connection_type: 'webhook',
    logo_color: '#EA4B71',
    logo_initials: 'n8',
    auth_fields: [
      { key: 'webhook_url', label: 'Webhook URL', type: 'url', required: true, placeholder: 'https://your-n8n.com/webhook/...' },
    ],
    supported_features: ['Webhooks', 'Workflows', 'Automatisations'],
    webhook_instructions: 'Copiez cette URL dans votre noeud Webhook n8n pour recevoir les evenements de Lume CRM.',
    official_site_url: 'https://n8n.io',
    docs_url: 'https://docs.n8n.io',
  },
  {
    id: 'make',
    slug: 'make',
    name: 'Make',
    description_short: 'Automatisations visuelles avec Make (Integromat).',
    description_long: 'Creez des scenarios d\'automatisation visuelle avec Make pour connecter Lume CRM a des milliers d\'applications.',
    category: 'IA & Automatisation',
    connection_type: 'webhook',
    logo_color: '#6D00CC',
    logo_initials: 'Mk',
    auth_fields: [
      { key: 'webhook_url', label: 'Webhook URL', type: 'url', required: true, placeholder: 'https://hook.make.com/...' },
    ],
    supported_features: ['Scenarios', 'Webhooks', 'Automatisations visuelles'],
    webhook_instructions: 'Copiez cette URL dans votre module Webhook Make pour recevoir les evenements de Lume CRM.',
    official_site_url: 'https://www.make.com',
    docs_url: 'https://www.make.com/en/help',
  },

  // ── Developpement ──
  {
    id: 'github',
    slug: 'github',
    name: 'GitHub',
    description_short: 'Integration avec vos repositories GitHub.',
    description_long: 'Connectez GitHub pour suivre les issues, pull requests et deployments lies a vos projets clients.',
    category: 'Developpement',
    connection_type: 'api_key',
    logo_color: '#24292F',
    logo_text_color: '#FFFFFF',
    logo_initials: 'GH',
    auth_fields: [
      { key: 'personal_access_token', label: 'Personal Access Token', type: 'password', required: true, placeholder: 'ghp_...' },
    ],
    supported_features: ['Issues', 'Pull requests', 'Repositories', 'Webhooks'],
    official_setup_url: 'https://github.com/settings/tokens',
    official_site_url: 'https://github.com',
    docs_url: 'https://docs.github.com/en/rest',
  },
  {
    id: 'vercel',
    slug: 'vercel',
    name: 'Vercel',
    description_short: 'Suivi des deploiements Vercel.',
    description_long: 'Suivez les deploiements de vos projets clients heberges sur Vercel. Recevez des notifications sur les statuts de build.',
    category: 'Developpement',
    connection_type: 'api_key',
    logo_color: '#000000',
    logo_text_color: '#FFFFFF',
    logo_initials: 'Vc',
    auth_fields: [
      { key: 'api_token', label: 'API Token', type: 'password', required: true },
    ],
    supported_features: ['Deployments', 'Domaines', 'Logs'],
    official_setup_url: 'https://vercel.com/account/tokens',
    official_site_url: 'https://vercel.com',
  },

  // ── Cartographie ──
  {
    id: 'google-maps',
    slug: 'google-maps',
    name: 'Google Maps',
    description_short: 'Geocodage et cartographie pour vos adresses clients.',
    description_long: 'Utilisez Google Maps pour geocoder les adresses clients, calculer les distances et afficher les cartes dans Lume CRM.',
    category: 'Cartographie',
    connection_type: 'api_key',
    logo_color: '#4285F4',
    logo_initials: 'GM',
    auth_fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true, placeholder: 'AIza...' },
    ],
    supported_features: ['Geocodage', 'Calcul distances', 'Cartes', 'Autocomplete adresses'],
    official_setup_url: 'https://console.cloud.google.com/google/maps-apis',
    official_site_url: 'https://developers.google.com/maps',
    docs_url: 'https://developers.google.com/maps/documentation',
  },
  {
    id: 'mapbox',
    slug: 'mapbox',
    name: 'Mapbox',
    description_short: 'Cartes personnalisees et navigation.',
    description_long: 'Creez des cartes personnalisees avec Mapbox pour visualiser vos clients, zones de service et itineraires.',
    category: 'Cartographie',
    connection_type: 'api_key',
    logo_color: '#000000',
    logo_text_color: '#FFFFFF',
    logo_initials: 'Mb',
    auth_fields: [
      { key: 'access_token', label: 'Access Token', type: 'password', required: true, placeholder: 'pk.eyJ1...' },
    ],
    supported_features: ['Cartes personnalisees', 'Geocodage', 'Navigation', 'Heatmaps'],
    official_setup_url: 'https://account.mapbox.com/access-tokens/',
    official_site_url: 'https://www.mapbox.com',
  },
  {
    id: 'traccar',
    slug: 'traccar',
    name: 'Traccar',
    description_short: 'Suivi GPS de vos vehicules et equipements.',
    description_long: 'Connectez Traccar pour suivre en temps reel la position de vos vehicules et equipements de service sur le terrain.',
    category: 'Cartographie',
    connection_type: 'api_key',
    logo_color: '#1A73E8',
    logo_initials: 'Tc',
    auth_fields: [
      { key: 'server_url', label: 'Server URL', type: 'url', required: true, placeholder: 'https://your-traccar.com' },
      { key: 'username', label: 'Username', type: 'text', required: true },
      { key: 'password', label: 'Password', type: 'password', required: true },
    ],
    supported_features: ['Suivi GPS temps reel', 'Historique de positions', 'Geofences', 'Alertes'],
    official_site_url: 'https://www.traccar.org',
    docs_url: 'https://www.traccar.org/api-reference/',
  },

  // ── Formulaires ──
  {
    id: 'jotform',
    slug: 'jotform',
    name: 'Jotform',
    description_short: 'Formulaires en ligne pour la capture de leads.',
    description_long: 'Connectez Jotform pour recevoir automatiquement les soumissions de formulaires comme nouveaux leads dans Lume CRM.',
    category: 'Formulaires',
    connection_type: 'api_key',
    logo_color: '#FF6100',
    logo_initials: 'JF',
    auth_fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
    ],
    supported_features: ['Capture de leads', 'Formulaires personnalises', 'Notifications'],
    official_setup_url: 'https://www.jotform.com/myaccount/api',
    official_site_url: 'https://www.jotform.com',
  },

  // ── Stockage ──
  {
    id: 'dropbox',
    slug: 'dropbox',
    name: 'Dropbox',
    description_short: 'Stockage et partage de fichiers dans le cloud.',
    description_long: 'Connectez Dropbox pour stocker et partager les documents de vos projets clients directement depuis Lume CRM.',
    category: 'Stockage',
    connection_type: 'api_key',
    logo_color: '#0061FF',
    logo_initials: 'Db',
    auth_fields: [
      { key: 'access_token', label: 'Access Token', type: 'password', required: true },
    ],
    supported_features: ['Stockage fichiers', 'Partage', 'Synchronisation'],
    official_setup_url: 'https://www.dropbox.com/developers/apps',
    official_site_url: 'https://www.dropbox.com',
  },

  // ── Documents ──
  {
    id: 'pandadoc',
    slug: 'pandadoc',
    name: 'PandaDoc',
    description_short: 'Creation et signature electronique de documents.',
    description_long: 'Creez des propositions, contrats et devis professionnels avec PandaDoc. Obtenez des signatures electroniques directement depuis Lume CRM.',
    category: 'Documents',
    connection_type: 'api_key',
    logo_color: '#4FBE59',
    logo_initials: 'PD',
    auth_fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
    ],
    supported_features: ['Creation de documents', 'Signature electronique', 'Templates', 'Suivi'],
    official_setup_url: 'https://app.pandadoc.com/a/#/settings/integrations/api',
    official_site_url: 'https://www.pandadoc.com',
  },
];

// ── Helpers ───────────────────────────────────────────────────

export function getFeaturedIntegrations(): Integration[] {
  return INTEGRATIONS.filter((app) => app.featured === true);
}
