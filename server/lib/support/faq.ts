/**
 * Questions classiques du support (étage 0) — comme les suggestions du widget
 * d'accueil : un clic sur une question de la FAQ a une réponse écrite à la
 * main, la même à chaque fois. La faire répondre par le modèle coûterait un
 * appel pour une réponse qu'on connaît d'avance.
 *
 * Correspondance EXACTE (normalisée) avec une question de la FAQ
 * (src/components/supportArticles.ts, la même liste que le tiroir d'aide) ;
 * une variante descend au modèle, qui a la FAQ dans son prompt de toute façon.
 */
import { ARTICLES } from '../../../src/components/supportArticles';
import { normaliser } from '../lumi/normaliser';

const cle = (s: string): string => normaliser(s).join(' ');

export interface ReponseFaq { id: string; reponse: string; path: string | null }

export function reponseFaqPour(message: string, langue: 'fr' | 'en'): ReponseFaq | null {
  const k = cle(message);
  if (!k) return null;
  for (const a of ARTICLES) {
    if (cle(a.q_fr) === k || cle(a.q_en) === k) {
      const reponse = langue === 'fr' ? a.a_fr : a.a_en;
      const page = a.path ? (langue === 'fr' ? ` (page : ${a.path})` : ` (page: ${a.path})`) : '';
      return { id: a.id, reponse: `${reponse}${page}`, path: a.path ?? null };
    }
  }
  return null;
}
