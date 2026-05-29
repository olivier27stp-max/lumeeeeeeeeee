/**
 * Bilingual legal content for the Privacy Policy and Terms of Service pages.
 *
 * Kept out of the i18n bundle (src/i18n/*) on purpose: these are long-form
 * documents, not UI strings. The pages read the active language from
 * useTranslation().language and pick the matching block here.
 *
 * ⚠️ Template content — must be reviewed by legal counsel before relying on it.
 */
import type { Language } from '../i18n';

export interface Subprocessor {
  name: string;
  purpose: string;
  location: string;
}

export interface RetentionRow {
  label: string;
  value: string;
}

export interface LegalLabels {
  backToHome: string;
  toc: string;
  version: string;
  lastUpdated: string;
}

export const LEGAL_LABELS: Record<Language, LegalLabels> = {
  fr: {
    backToHome: "← Retour à l'accueil",
    toc: 'Sommaire',
    version: 'Version',
    lastUpdated: 'Dernière mise à jour',
  },
  en: {
    backToHome: '← Back to home',
    toc: 'Contents',
    version: 'Version',
    lastUpdated: 'Last updated',
  },
};

export const SUBPROCESSORS: Record<Language, Subprocessor[]> = {
  fr: [
    { name: 'Supabase Inc.', purpose: 'Base de données, authentification, stockage', location: 'États-Unis (AWS us-east-1)' },
    { name: 'Stripe Inc.', purpose: 'Traitement des paiements', location: 'États-Unis / international' },
    { name: 'PayPal Holdings', purpose: 'Paiements alternatifs', location: 'États-Unis / international' },
    { name: 'Twilio Inc.', purpose: 'Envoi de SMS', location: 'États-Unis' },
    { name: 'Resend', purpose: 'Courriels transactionnels', location: 'États-Unis' },
    { name: 'Google LLC', purpose: 'Cartographie, géocodage, IA (Gemini)', location: 'États-Unis / international' },
    { name: 'Upstash', purpose: 'Cache de limitation de débit (optionnel)', location: 'États-Unis / international' },
  ],
  en: [
    { name: 'Supabase Inc.', purpose: 'Database, authentication, storage', location: 'United States (AWS us-east-1)' },
    { name: 'Stripe Inc.', purpose: 'Payment processing', location: 'United States / international' },
    { name: 'PayPal Holdings', purpose: 'Alternative payments', location: 'United States / international' },
    { name: 'Twilio Inc.', purpose: 'SMS delivery', location: 'United States' },
    { name: 'Resend', purpose: 'Transactional email', location: 'United States' },
    { name: 'Google LLC', purpose: 'Maps, geocoding, AI (Gemini)', location: 'United States / international' },
    { name: 'Upstash', purpose: 'Rate-limiting cache (optional)', location: 'United States / international' },
  ],
};

export const RETENTION: Record<Language, RetentionRow[]> = {
  fr: [
    { label: 'Données de compte actif', value: 'Conservées pendant toute la durée du service.' },
    { label: 'Prospects inactifs', value: "Anonymisés après 24 mois d'inactivité." },
    { label: 'Factures et paiements', value: 'Conservés 10 ans (obligation fiscale).' },
    { label: "Journaux d'audit", value: 'Conservés 3 ans, puis purgés automatiquement.' },
    { label: 'Communications marketing', value: 'Conservées tant que le consentement est actif ; supprimées au retrait.' },
  ],
  en: [
    { label: 'Active account data', value: 'Kept for the duration of the service.' },
    { label: 'Inactive leads', value: 'Anonymized after 24 months of inactivity.' },
    { label: 'Invoices & payments', value: 'Kept 10 years (tax obligation).' },
    { label: 'Audit logs', value: 'Kept 3 years, then purged automatically.' },
    { label: 'Marketing communications', value: 'Kept while consent is active; deleted on withdrawal.' },
  ],
};
