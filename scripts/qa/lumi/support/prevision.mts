/**
 * Batterie de l'agent de support — l'étage PRÉVU d'une question (pur : ni base, ni réseau).
 * ─────────────────────────────────────────────────────────────────────────
 * Le chat de support répond par étages (server/routes/support.ts) : la FAQ écrite (0), le cache
 * sémantique (4), le centre d'aide (5), puis le modèle (6). Les étages 0 et 5 sont du code pur :
 * on les rejoue ici, avec le code de CETTE branche, pour dire dans le plan combien de questions
 * iront au modèle — c'est lui qui coûte, et le serveur n'en accepte que 60 réponses par bureau
 * et par 24 heures.
 *
 * Prévision, pas mesure : la production peut porter un code plus récent, son index d'aide contient
 * en plus les réponses retenues par l'équipe (server/lib/support/savoir.ts), et le cache sémantique
 * (étage 4) sert sans modèle une question déjà posée. L'étage réel est relu dans lumi_traces.
 */
import { reponseFaqPour } from '../../../../server/lib/support/faq.ts';
import { reponseAideMulti } from '../../../../server/lib/support/aide-multi.ts';
import { reponseAideDirecte } from '../../../../server/lib/support/articles-dabord.ts';
import { PLAFOND_MODELE_PAR_JOUR } from '../../../../server/lib/support/garde-fous.ts';
import type { TestSupport } from './types.mts';

export { PLAFOND_MODELE_PAR_JOUR };

export interface EtagePrevu {
  /** 0 FAQ écrite, 5 centre d'aide, 6 modèle ; null : aucun assistant (transfert direct) ou aucune question. */
  etage: 0 | 5 | 6 | null;
  par: string;
}

/**
 * L'étage qui répondrait à une première question, d'après le code de cette branche. La langue est
 * celle du COMPTE (français pour les comptes de test), quelle que soit la langue de la question.
 */
export function etagePrevu(question: string | undefined, o: { humain?: boolean } = {}): EtagePrevu {
  if (!question) return { etage: null, par: 'aucune question' };
  if (o.humain) return { etage: null, par: 'transfert direct à un humain, sans assistant' };
  const faq = reponseFaqPour(question, 'fr');
  if (faq) return { etage: 0, par: `réponse écrite de la FAQ (${faq.id})` };
  const multi = reponseAideMulti(question, 'fr');
  if (multi) return { etage: 0, par: `plusieurs questions, réponses écrites (${multi.ids.join(', ')})` };
  const aide = reponseAideDirecte(question, 'fr', { premierMessage: true });
  if (aide) return { etage: 5, par: `centre d’aide (${aide.pages[0] ?? 'page non nommée'})` };
  return { etage: 6, par: 'modèle (ou cache sémantique si la question a déjà été posée)' };
}

/** Réponses du modèle prévues pour une liste de tests (une par question que ni la FAQ ni le centre d'aide ne servent). */
export function reponsesModelePrevues(tests: TestSupport[]): number {
  return tests.filter((t) => t.appels > 0 && etagePrevu(t.question, { humain: t.humain }).etage === 6).length;
}

/** Pire cas : toute question qui passe par l'assistant finit au modèle. */
export function reponsesModeleAuPire(tests: TestSupport[]): number {
  return tests.filter((t) => t.appels > 0 && !t.humain).length;
}
