/**
 * Traduction FR des features de plans.
 *
 * La table `plans` stocke `features` en anglais uniquement (pas de colonne
 * features_fr). Plutôt qu'une migration DDL, on traduit à l'affichage via ce
 * dictionnaire. Une feature inconnue passe telle quelle (anglais) — ajouter
 * sa traduction ici quand une nouvelle entrée apparaît en base.
 */
const FEATURES_FR: Record<string, string> = {
  // ── Minimum (starter) ──
  'CRM dashboard': 'Tableau de bord CRM',
  'Client management + client portal': 'Gestion des clients + portail client',
  'Quotes & invoicing': 'Devis et facturation',
  'Jobs & calendar': 'Jobs et calendrier',
  'Online payments (Stripe & PayPal)': 'Paiements en ligne (Stripe et PayPal)',
  'Tasks & leads pipeline': 'Tâches et pipeline de prospects',
  // Minimum n'a pas le pipeline (Scale et Autopilot) : le libellé ne le promet plus (2026-09-25).
  'Tasks & leads': 'Tâches et prospects',
  'Email communications': 'Communications par courriel',
  'Mobile access': 'Accès mobile',
  'Basic reporting': 'Rapports de base',
  // ── Scale (pro) ──
  'Everything in Minimum': 'Tout du plan Minimum',
  'Two-way SMS texting with customers (dedicated number)': 'SMS bidirectionnels avec les clients (numéro dédié)',
  'Automated quote & invoice follow-ups': 'Relances automatiques de devis et factures',
  'Quote templates, presets & satellite measure tool': 'Modèles de devis, préréglages et mesure satellite',
  'Employee timesheets': 'Feuilles de temps des employés',
  'Track employee performance': 'Suivi de la performance des employés',
  'Recurring jobs, checklists & GPS tracking': 'Jobs récurrents, checklists et suivi GPS',
  'Dispatch map & batch messaging': 'Carte de répartition et messages groupés',
  'Internal team chat': "Chat d'équipe interne",
  'Advanced analytics & insights': 'Analyses et statistiques avancées',
  'QuickBooks export': 'Export QuickBooks',
  'Marketplace integrations & webhooks': 'Intégrations marketplace et webhooks',
  'Custom request forms': 'Formulaires de demande personnalisés',
  // ── Autopilot ──
  'Everything in Scale': 'Tout du plan Scale',
  // Lumi en crédits (2026-09-30) : le libellé en base devient celui-ci.
  'Lume AI Agent (voice) — 1,000 Lumi credits / month': 'Agent IA Lume (voix) — 1 000 crédits Lumi / mois',
  'Door-to-door sales suite (map, pipeline, leaderboard, commissions)': 'Suite porte-à-porte (carte, pipeline, classement, commissions)',
  'Courses / LMS for team training': "Formations / LMS pour l'équipe",
  'Multi-team management': 'Gestion multi-équipes',
  'Advanced roles & permissions': 'Rôles et permissions avancés',
  'Full API access': 'Accès API complet',
  'Team availability management': "Gestion des disponibilités d'équipe",
  'Automated satisfaction surveys': 'Sondages de satisfaction automatisés',
  'Premium support': 'Support premium',
  'Dedicated onboarding specialist': "Spécialiste d'intégration dédié",
};

/**
 * Anciens libellés encore en base le temps de la migration de données :
 * affichés sous leur NOUVEAU libellé, dans les deux langues. L'ancien
 * promettait un agent « illimité » — faux depuis les crédits Lumi.
 */
const ANCIENS_LIBELLES: Record<string, string> = {
  'Lume AI Agent (voice + unlimited)': 'Lume AI Agent (voice) — 1,000 Lumi credits / month',
};

/** Rend une feature de plan dans la langue demandée (fallback : texte d'origine). */
export function translatePlanFeature(feature: string, isFr: boolean): string {
  const actuel = ANCIENS_LIBELLES[feature.trim()] ?? feature;
  if (!isFr) return actuel;
  return FEATURES_FR[actuel.trim()] ?? actuel;
}
