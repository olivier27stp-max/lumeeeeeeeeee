/**
 * Le client demande-t-il, en toutes lettres, à parler à une personne ?
 * ───────────────────────────────────────────────────────────────────
 * Le bouton « Parler à un humain » du chat transmet déjà la conversation.
 * Mais écrit au clavier — « je veux parler à une vraie personne » — la demande
 * tombait sur l'article de la FAQ, qui répond : « Dites-le simplement ici
 * ("je veux parler à quelqu'un") ». Le client venait de le dire.
 *
 * Deux signaux ensemble : un verbe de contact ET un mot qui désigne une
 * personne de l'équipe. Une question sur la marche à suivre (« Comment parler
 * à un humain ? ») garde l'article : elle demande comment faire, pas de le faire.
 * Dans le doute : non — le modèle sait aussi transférer, et un transfert à tort
 * dérange une vraie personne.
 *
 * Tests : tests/support/demande-humain.test.ts
 */
import { normaliser } from '../lumi/normaliser';

const MARCHE_A_SUIVRE = /^(comment|how|ou|where|c est quoi|what is)\b/;
const CONTACT = /\b(parler|parle|jaser|discuter|joindre|contacter|rejoindre|ecrire a|transfere\w*|transferer|transfert|passe\w* moi|mets? moi en contact|talk|speak|chat with|reach|contact|connect me|get me|transfer me|put me through)\b/;
const PERSONNE = /\b(humain|humaine|vraie? personne|personne reelle|quelqu un|qqn|un agent|une agente|conseiller|conseillere|representant|representante|l equipe de support|le support|un employe de lume|real person|a human|human being|a person|someone|somebody|an agent|live agent|representative|support team)\b/;
/** Formes courtes sans verbe : « un humain svp », « humain », « agent ! ». */
const COURT = /^(un |une |a |an )?(humain|humaine|vraie? personne|real person|human|agent|live agent)( svp| stp| s il vous plait| s il te plait| please)?$/;

export function demandeUnHumain(message: string): boolean {
  const plat = normaliser(message).join(' ');
  if (!plat) return false;
  if (COURT.test(plat)) return true;
  if (MARCHE_A_SUIVRE.test(plat)) return false;
  return CONTACT.test(plat) && PERSONNE.test(plat);
}
