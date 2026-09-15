// Helpers purs du formulaire de création de workspace (POST /workspaces/create).
//
// Un workspace = la compagnie de l'utilisateur (un seul par compte) ; ses
// bureaux sont limités par le forfait. L'org existe déjà (auto-provisionné
// au 1er login) : le formulaire la complète après paiement.
//
// Schéma prod (baseline 01_schema.sql) : `orgs` = name / employee_count /
// logo_url / company_group_id. Tout le reste vit dans company_settings.

export interface WorkspaceAddress {
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

export interface WorkspaceInput {
  company: {
    name: string;
    industry: string;
    employee_count: string;
    logo_url?: string | null;
  };
  profile?: { full_name?: string | null } | null;
  contact?: {
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    address?: WorkspaceAddress | null;
  } | null;
  preferences?: {
    currency?: 'CAD' | 'USD' | null;
    timezone?: string | null;
    revenue_goal_cents?: number | null;
  } | null;
  reviews?: {
    enabled?: boolean | null;
    google_review_url?: string | null;
    facebook_review_url?: string | null;
  } | null;
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Patch orgs — uniquement les colonnes que la prod possède. */
export function buildWorkspaceOrgPatch(input: WorkspaceInput): Record<string, any> {
  const row: Record<string, any> = {
    name: clean(input.company.name),
    employee_count: clean(input.company.employee_count),
  };
  if (clean(input.company.logo_url)) row.logo_url = clean(input.company.logo_url);
  return row;
}

/**
 * Upsert company_settings (source d'affichage du CRM : documents, switcher,
 * météo, avis). Les champs vides ne sont pas écrits : un upsert en mode
 * onboarding ne doit jamais effacer ce qu'un autre écran a déjà rempli.
 */
export function buildWorkspaceSettingsUpsert(
  input: WorkspaceInput,
  orgId: string,
  createdBy: string,
): Record<string, any> {
  const row: Record<string, any> = {
    org_id: orgId,
    created_by: createdBy,
    company_name: clean(input.company.name),
    industry: clean(input.company.industry),
  };
  if (clean(input.company.logo_url)) row.logo_url = clean(input.company.logo_url);

  const c = input.contact;
  if (c) {
    if (clean(c.phone)) row.phone = clean(c.phone);
    if (clean(c.email)) row.email = clean(c.email).toLowerCase();
    if (clean(c.website)) row.website = clean(c.website);
    const a = c.address;
    if (a) {
      if (clean(a.street1)) row.street1 = clean(a.street1);
      if (clean(a.street2)) row.street2 = clean(a.street2);
      if (clean(a.city)) row.city = clean(a.city);
      if (clean(a.province)) row.province = clean(a.province);
      if (clean(a.postal_code)) row.postal_code = clean(a.postal_code);
      if (clean(a.country)) row.country = clean(a.country);
    }
  }

  const p = input.preferences;
  if (p) {
    if (p.currency === 'CAD' || p.currency === 'USD') row.currency = p.currency;
    if (clean(p.timezone)) row.timezone = clean(p.timezone);
    if (typeof p.revenue_goal_cents === 'number' && Number.isFinite(p.revenue_goal_cents) && p.revenue_goal_cents > 0) {
      row.revenue_goal_cents = Math.round(p.revenue_goal_cents);
    }
  }

  const r = input.reviews;
  if (r) {
    const google = clean(r.google_review_url);
    const facebook = clean(r.facebook_review_url);
    if (google) row.google_review_url = google;
    if (facebook) row.facebook_review_url = facebook;
    // Activer sans aucun lien n'a pas de sens : le sondage n'aurait nulle
    // part où envoyer les 4-5 étoiles.
    if (r.enabled === true && (google || facebook)) row.review_enabled = true;
  }

  return row;
}

/** Régions de taxes connues du seed (server/lib/seedOrgDefaults.ts). */
const CA_PROVINCES: Record<string, string> = {
  qc: 'QC', quebec: 'QC', 'québec': 'QC',
  on: 'ON', ontario: 'ON',
  bc: 'BC', 'british columbia': 'BC', 'colombie-britannique': 'BC',
};
const US_STATES: Record<string, string> = {
  ca: 'US-CA', california: 'US-CA', californie: 'US-CA',
  tx: 'US-TX', texas: 'US-TX',
  fl: 'US-FL', florida: 'US-FL', floride: 'US-FL',
};

/**
 * Région de taxes à semer depuis l'adresse. Défaut QC (comme l'onboarding
 * existant) quand la province est inconnue ou absente.
 */
export function taxRegionFor(province?: string | null, country?: string | null): string {
  const p = clean(province).toLowerCase();
  const c = clean(country).toUpperCase();
  if (!p) return 'QC';
  const isUS = c === 'US' || c === 'USA' || c === 'UNITED STATES' || c === 'ÉTATS-UNIS';
  if (isUS) return US_STATES[p] || 'QC';
  return CA_PROVINCES[p] || 'QC';
}
