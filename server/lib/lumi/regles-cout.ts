/**
 * Règles de coût STRICTES de Lumi (audit B, 2026-09-16) — un seul endroit.
 * ─────────────────────────────────────────────────────────────────────
 * Chaque plafond est un cran d'arrêt en CODE, pas une consigne au modèle :
 *  - max_tokens_sortie          : sortie (réflexion incluse) bornée par appel ;
 *                                  p95 mesuré 656, max 827 → 2 048 laisse 2,5×.
 *  - plafond_cout_tour_cents    : un tour (boucle d'outils) s'arrête au-delà,
 *                                  historique cohérent, escalade humaine ; max
 *                                  mesuré 2,93 ¢ à froid → 6 ¢.
 *  - plafond_cout_conversation_cents : au-delà, la conversation répond par un
 *                                  gabarit « ouvre une nouvelle conversation » ;
 *                                  max mesuré 11,7 ¢ → 40 ¢.
 *  - part_budget_par_jour       : une org qui brûle ≥ 15 % de son plafond
 *                                  mensuel dans la journée passe en palier
 *                                  restreint (Haiku, 2 étapes) jusqu'à minuit :
 *                                  un script ne vide plus le mois en un jour.
 *  - effort_defaut              : réflexion basse par défaut (mandat §5.4.9 :
 *                                  pas de réflexion étendue hors sous-agents
 *                                  complexes) ; LUMI_EFFORT=medium pour revenir.
 *  - plafond_public_par_jour    : réponses du modèle sur le chat public du
 *                                  site, toutes IP confondues, par 24 h ; au-delà
 *                                  réponses fixes. Une ferme d'IP ne brûle plus
 *                                  le compte.
 * Chaque valeur se règle par variable d'environnement, bornée (jamais 0,
 * jamais l'infini). Tests : tests/lumi-regles-cout.test.ts.
 */

export interface ReglesCout {
  max_tokens_sortie: number;
  plafond_cout_tour_cents: number;
  plafond_cout_conversation_cents: number;
  part_budget_par_jour: number;
  effort_defaut: 'low' | 'medium';
  plafond_public_par_jour: number;
}

function nombre(env: NodeJS.ProcessEnv, cle: string, defaut: number, min: number, max: number, entier = false): number {
  const brut = env[cle];
  if (brut === undefined || brut === '') return defaut;
  const v = Number(brut);
  if (!Number.isFinite(v)) return defaut;
  const borne = Math.min(max, Math.max(min, v));
  return entier ? Math.round(borne) : borne;
}

export function reglesCout(env: NodeJS.ProcessEnv = process.env): ReglesCout {
  return {
    max_tokens_sortie: nombre(env, 'LUMI_MAX_TOKENS_SORTIE', 2048, 256, 8192, true),
    plafond_cout_tour_cents: nombre(env, 'LUMI_PLAFOND_TOUR_CENTS', 6, 1, 100),
    plafond_cout_conversation_cents: nombre(env, 'LUMI_PLAFOND_CONVERSATION_CENTS', 40, 5, 1000),
    part_budget_par_jour: nombre(env, 'LUMI_PART_BUDGET_PAR_JOUR', 0.15, 0.02, 1),
    effort_defaut: env.LUMI_EFFORT === 'medium' ? 'medium' : 'low',
    plafond_public_par_jour: nombre(env, 'LUMI_PLAFOND_PUBLIC_PAR_JOUR', 300, 10, 100_000, true),
  };
}

/** Gabarit (0 token) quand une conversation a dépassé son plafond de coût. */
export function messagePlafondConversation(langue: 'fr' | 'en'): string {
  return langue === 'fr'
    ? 'Cette conversation a beaucoup travaillé : pour continuer, ouvre une nouvelle conversation (le bouton en haut). Les actions rapides restent disponibles ici.'
    : 'This conversation has done a lot of work: to continue, start a new conversation (button at the top). Quick actions remain available here.';
}
