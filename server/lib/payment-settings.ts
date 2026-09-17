/**
 * Réglages Lume Payments par organisation (table payment_settings).
 *
 * Lecture : une ligne absente vaut les défauts (aucune insertion à la lecture,
 * une route publique ne doit rien écrire). Écriture : upsert par le serveur
 * après contrôle admin/owner — la table n'a aucune policy d'écriture pour
 * `authenticated`.
 *
 * Ces réglages sont VÉRIFIÉS sur les routes publiques (public-pay,
 * quotes/public/deposit-intent, payment-requests, invoices/public) : un
 * interrupteur d'interface seul n'empêcherait rien.
 */
import { getServiceClient } from './supabase';
import { isSchemaNotReadyError } from './payments';

export interface PaymentSettings {
  org_id: string;
  quote_payments_enabled: boolean;
  invoice_payments_enabled: boolean;
  tips_enabled: boolean;
  wallets_enabled: boolean;
  require_payment_method_default: boolean;
  notify_owner_email: boolean;
  updated_at: string | null;
}

export type PaymentSettingsPatch = Partial<Omit<PaymentSettings, 'org_id' | 'updated_at'>>;

export const CHAMPS_MODIFIABLES = [
  'quote_payments_enabled',
  'invoice_payments_enabled',
  'tips_enabled',
  'wallets_enabled',
  'require_payment_method_default',
  'notify_owner_email',
] as const;

export function reglagesParDefaut(orgId: string): PaymentSettings {
  return {
    org_id: orgId,
    quote_payments_enabled: true,
    invoice_payments_enabled: true,
    tips_enabled: false,
    wallets_enabled: true,
    require_payment_method_default: false,
    notify_owner_email: true,
    updated_at: null,
  };
}

/** Normalise une ligne brute (ou null) en réglages complets. */
export function normaliserReglages(orgId: string, row: Record<string, unknown> | null | undefined): PaymentSettings {
  const defauts = reglagesParDefaut(orgId);
  if (!row) return defauts;
  const bool = (cle: keyof PaymentSettings) =>
    typeof row[cle] === 'boolean' ? (row[cle] as boolean) : (defauts[cle] as boolean);
  return {
    org_id: orgId,
    quote_payments_enabled: bool('quote_payments_enabled'),
    invoice_payments_enabled: bool('invoice_payments_enabled'),
    tips_enabled: bool('tips_enabled'),
    wallets_enabled: bool('wallets_enabled'),
    require_payment_method_default: bool('require_payment_method_default'),
    notify_owner_email: bool('notify_owner_email'),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
  };
}

/**
 * Ne garde que les booléens connus. Toute autre clé (org_id, updated_at,
 * colonne inventée) est ignorée : un client ne choisit pas les colonnes.
 */
export function nettoyerPatch(body: unknown): PaymentSettingsPatch {
  const patch: PaymentSettingsPatch = {};
  if (!body || typeof body !== 'object') return patch;
  const b = body as Record<string, unknown>;
  for (const cle of CHAMPS_MODIFIABLES) {
    if (typeof b[cle] === 'boolean') patch[cle] = b[cle] as boolean;
  }
  return patch;
}

export async function getPaymentSettings(orgId: string): Promise<PaymentSettings> {
  const admin = getServiceClient();
  const { data, error } = await admin
    .from('payment_settings')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) {
    // Migration pas encore appliquée : on sert les défauts plutôt que de
    // casser la page de paiement d'un client.
    if (isSchemaNotReadyError(error)) return reglagesParDefaut(orgId);
    throw error;
  }
  return normaliserReglages(orgId, data);
}

export async function updatePaymentSettings(orgId: string, patch: PaymentSettingsPatch, userId: string | null): Promise<PaymentSettings> {
  const admin = getServiceClient();
  const { data, error } = await admin
    .from('payment_settings')
    .upsert(
      { org_id: orgId, ...patch, updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: 'org_id' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return normaliserReglages(orgId, data);
}

// ── Pourboires ──

/** Plafond absolu d'un pourboire : 1 000 $. */
export const POURBOIRE_MAX_CENTS = 100_000;

/**
 * Un pourboire est un entier en cents, jamais négatif, jamais supérieur au
 * solde payé ni à 1 000 $. Retourne null si la valeur est irrecevable
 * (le serveur répond 400 — on ne « corrige » pas en silence un montant
 * d'argent envoyé par un inconnu).
 */
export function plafonnerPourboire(brut: unknown, soldeCents: number): number | null {
  const n = typeof brut === 'number' ? brut : Number(brut);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  const plafond = Math.min(Math.max(0, Math.floor(soldeCents)), POURBOIRE_MAX_CENTS);
  if (n > plafond) return null;
  return n;
}

/**
 * Sépare ce que Stripe a réellement encaissé entre la part facture et le
 * pourboire annoncé dans les métadonnées du PaymentIntent. Le pourboire ne
 * peut jamais dépasser le montant reçu (métadonnée falsifiée ou paiement
 * partiel) : la facture reçoit toujours au moins 0 et le pourboire est
 * borné par le reçu.
 */
export function repartirMontantRecu(amountReceivedCents: number, tipMeta: unknown): { factureCents: number; pourboireCents: number } {
  const recu = Math.max(0, Math.round(Number(amountReceivedCents) || 0));
  const tipBrut = Math.round(Number(tipMeta) || 0);
  const pourboireCents = Math.min(recu, Math.max(0, tipBrut));
  return { factureCents: recu - pourboireCents, pourboireCents };
}
