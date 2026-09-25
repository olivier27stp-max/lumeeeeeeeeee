// Catalogue des fonctionnalités qu'un administrateur plateforme peut forcer
// (activer ou bloquer) sur un workspace depuis le Creator Space, par-dessus
// le forfait. Une entrée = une clé de la table org_features.
//
// Deux familles :
//   - « plan »   : colonnes includes_* de la table plans (le forfait décide
//                  par défaut ; l'override plateforme prime).
//   - « module » : modules que le tenant active lui-même (org_features) ;
//                  l'override plateforme retire ou impose ce choix.
//
// Une ligne org_features portant metadata.platform_override = true est
// réservée à la plateforme : le tenant ne peut plus la modifier via
// PUT /api/features/:feature (voir routes/feature-flags.ts).

export type PlatformFeatureKind = 'plan' | 'module';

export interface PlatformFeature {
  key: string;
  kind: PlatformFeatureKind;
  label: string;
  description: string;
}

export const PLATFORM_FEATURES: readonly PlatformFeature[] = [
  { key: 'includes_sms', kind: 'plan', label: 'SMS / Messages', description: 'Messagerie SMS avec les clients (Twilio).' },
  { key: 'includes_ai', kind: 'plan', label: 'Lumi (IA)', description: 'Assistant IA Lumi et briefings.' },
  { key: 'includes_d2d', kind: 'plan', label: 'Vente porte-à-porte', description: 'Vente Map, pipeline, leaderboard, commissions.' },
  { key: 'includes_courses', kind: 'plan', label: 'Cours', description: 'Section formation / cours.' },
  { key: 'includes_api', kind: 'plan', label: 'API', description: 'Accès API et clés d’intégration.' },
  { key: 'includes_automations', kind: 'plan', label: 'Automations', description: 'Workflows automatisés.' },
  { key: 'includes_marketplace', kind: 'plan', label: 'Marketplace', description: 'Intégrations et webhooks.' },
  { key: 'includes_timesheets', kind: 'plan', label: 'Feuilles de temps', description: 'Suivi des heures des employés.' },
  { key: 'includes_request_forms', kind: 'plan', label: 'Formulaires de demande', description: 'Formulaires publics de demande de service.' },
  { key: 'includes_advanced_roles', kind: 'plan', label: 'Rôles avancés', description: 'Permissions personnalisées par membre.' },
  { key: 'module_vente', kind: 'module', label: 'Module Vente (activation)', description: 'Activation du module Vente par le workspace (exige aussi le forfait D2D).' },
  // « Le Reçu » — section « l'argent qui dort » dans le briefing du matin.
  // Module et non forfait : le briefing lui-même est déjà réservé aux plans
  // avec Lumi (includes_ai), cet interrupteur ne fait qu'ajouter ou retirer
  // la section. Coupé, le briefing est identique au mot près.
  { key: 'recu_lumi', kind: 'module', label: 'Le Reçu (briefing)', description: 'Ajoute « l’argent qui dort » au briefing du matin : devis sans suivi récent et factures échues.' },
  // Champs personnalisés v2 (modèle GoHighLevel) : Réglages → Champs
  // personnalisés, panneaux sur les fiches, cartes et filtres du pipeline.
  // Coupé = aucun écran v2 ; les outils MCP/Lumi et les automatisations
  // continuent de fonctionner (même service).
  { key: 'custom_fields_v2', kind: 'module', label: 'Champs personnalisés v2', description: 'Gestionnaire de champs personnalisés (type GoHighLevel) : réglages, fiches, pipeline.' },
];

const KEYS = new Set(PLATFORM_FEATURES.map((f) => f.key));

export function isPlatformFeatureKey(key: unknown): key is string {
  return typeof key === 'string' && KEYS.has(key);
}

/** Clés de forfait (colonnes plans.includes_*) — celles que billing/current
 *  renvoie comme feature_overrides au front. */
export const PLAN_FEATURE_KEYS: readonly string[] = PLATFORM_FEATURES.filter((f) => f.kind === 'plan').map((f) => f.key);

/** Flags dérivés côté front quand la colonne n'existe pas encore en base
 *  (même règle que src/lib/billingApi.ts → fetchPlans). Gardés identiques ici
 *  pour que le Creator Space affiche le vrai défaut du forfait. */
export function planGrants(plan: Record<string, any> | null, key: string): boolean | null {
  if (!plan) return null;
  if (typeof plan[key] === 'boolean') return plan[key];
  const slug = plan.slug as string | undefined;
  switch (key) {
    case 'includes_automations':
    case 'includes_timesheets':
    case 'includes_request_forms':
      return slug !== 'starter';
    case 'includes_marketplace':
    case 'includes_advanced_roles':
      return slug === 'autopilot';
    default:
      return false;
  }
}

// ── Quota de bureaux par workspace ─────────────────────────────────────────
// Les bureaux ne sont plus vendus par forfait (les anciennes colonnes de
// forfait/abonnement dédiées aux bureaux ont été supprimées, migration
// 20260917000000) : chaque workspace a droit à UN bureau, et seule la
// plateforme (Creator Space) peut en accorder davantage. Le quota vit dans
// org_features { feature: 'office_quota', metadata.quota }, posé sur tous les
// bureaux du company_group.
export const OFFICE_QUOTA_KEY = 'office_quota';
export const DEFAULT_OFFICE_QUOTA = 1;
export const MAX_OFFICE_QUOTA = 50;

/**
 * Bureaux inclus dans chaque forfait.
 *
 * Les bureaux avaient été retirés des forfaits (migration 20260917000000) :
 * tout le monde à 1, et seule la plateforme pouvait en accorder plus. En
 * pratique Autopilot, qui vend la « gestion multi-équipes », butait sur un
 * seul bureau — il a fallu poser des lignes `org_features` à la main pour
 * deux organisations le 2026-09-25. Autopilot en inclut donc 2.
 *
 * Ce n'est PAS le retour de l'ancien système : la plateforme garde le dernier
 * mot (voir `quotaEffectifBureaux`), et un forfait ne fait qu'établir un
 * plancher.
 */
export const BUREAUX_PAR_FORFAIT: Readonly<Record<string, number>> = {
  starter: 1,
  pro: 1,
  autopilot: 2,
};

/** Bureaux inclus par le forfait d'une organisation. 1 si le forfait est inconnu. */
export function quotaBureauxDuForfait(plan: { slug?: string | null } | null | undefined): number {
  const slug = plan?.slug;
  if (typeof slug !== 'string') return DEFAULT_OFFICE_QUOTA;
  const n = BUREAUX_PAR_FORFAIT[slug];
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_OFFICE_QUOTA) : DEFAULT_OFFICE_QUOTA;
}

/**
 * Le quota qui fait foi : le PLUS GRAND entre le forfait et ce que la
 * plateforme a accordé.
 *
 * Prendre le plus grand, et non le quota du forfait seul, est délibéré :
 * deux organisations ont déjà un quota plateforme de 2, dont une sans aucun
 * abonnement. Aligner sur le forfait leur retirerait un bureau déjà créé —
 * on ne retire jamais une capacité en service. Inversement, une exception
 * accordée à un cas particulier continue de l'emporter sur son forfait.
 */
export function quotaEffectifBureaux(
  plan: { slug?: string | null } | null | undefined,
  rowsOrgFeatures: Array<{ feature: string; enabled?: boolean; metadata: unknown }> | null | undefined,
): number {
  return Math.max(quotaBureauxDuForfait(plan), resolveOfficeQuota(rowsOrgFeatures));
}

/** Quota effectif d'une compagnie à partir de ses lignes org_features
 *  (n'importe quel bureau du groupe) : le plus grand quota plateforme, sinon 1. */
export function resolveOfficeQuota(rows: Array<{ feature: string; enabled?: boolean; metadata: unknown }> | null | undefined): number {
  let quota = DEFAULT_OFFICE_QUOTA;
  for (const r of rows ?? []) {
    if (r.feature !== OFFICE_QUOTA_KEY || !isPlatformOverride(r.metadata)) continue;
    const q = Number((r.metadata as any).quota);
    if (Number.isInteger(q) && q > quota) quota = Math.min(q, MAX_OFFICE_QUOTA);
  }
  return quota;
}

/** Vrai si la ligne org_features a été posée par la plateforme. */
export function isPlatformOverride(metadata: unknown): boolean {
  return !!metadata && typeof metadata === 'object' && (metadata as any).platform_override === true;
}
