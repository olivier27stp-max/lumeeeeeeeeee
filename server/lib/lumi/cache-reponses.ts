/**
 * Étage 3 — cache exact de réponse (item 13, AGENTFORCE_GAP.md B3).
 * ─────────────────────────────────────────────────────────────
 * Le même énoncé, de la même personne, dans la même entreprise, tant que ses
 * données n'ont pas bougé → la réponse déjà produite par le modèle, sans
 * appel. Clé = sha256(énoncé normalisé + org + personne + version des
 * données) ; jamais partagée entre entreprises ni entre personnes (les
 * montants masqués d'un rôle ne doivent pas ressortir chez un autre).
 *
 * Fraîcheur, deux mécanismes :
 * - version d'org (`lumi:ver:<org>`) incrémentée à chaque écriture d'agent
 *   (executerIdempotent) : une action de Lumi ou du MCP invalide tout ;
 * - TTL court (60 s) : les écritures faites dans l'APPLICATION ne passent
 *   pas par l'agent, on ne les voit pas — 60 s est le maximum de retard
 *   qu'on accepte sur un chiffre.
 *
 * On ne met en cache que : le PREMIER message d'une conversation (sans
 * historique, l'énoncé se suffit), une réponse sans écriture ni proposition,
 * avec des outils de lecture seulement, non vide. Repli (« pas ça ») →
 * l'entrée est retirée.
 */
import crypto from 'node:crypto';
import { magasin } from './magasin';
import { normaliserEnonce } from './traces';
import type { Fiche } from './fiches';
import { TOOLS_BY_NAME } from '../agent/tools';

export const TTL_REPONSE_S = 60;

export interface ReponseEnCache {
  texte: string;
  fiches: Fiche[];
  outils: string[];
  /** Énoncé normalisé d'origine (repli, diagnostic). */
  enonce: string;
}

export function cleReponse(p: { orgId: string; userId: string; enonce: string; version: number }): string {
  const e = normaliserEnonce(p.enonce) ?? '';
  const h = crypto.createHash('sha256').update(`${p.orgId}\n${p.userId}\n${p.version}\n${e}`, 'utf8').digest('hex').slice(0, 32);
  return `lumi:rep:${p.orgId}:${p.userId}:${h}`;
}

export { versionOrg, invaliderOrg } from './version-org';
import { versionOrg } from './version-org';

/** Un tour est-il cachable ? Lecture seule, texte, pas de proposition, premier message. */
/** Un énoncé qui demande de retenir/oublier n'est jamais une lecture : on ne le met pas en cache, quoi qu'ait fait le tour. */
export const ENONCE_MEMOIRE = /^\s*(retiens|retiens-toi|souviens-toi|note que|oublie|n'oublie pas|remember|forget)\b/i;

export function tourCachable(t: { historiqueVide: boolean; texte: string; outils: string[]; proposition: boolean; resultat: string; ecritureExecutee?: boolean; enonce?: string | null }): boolean {
  // Une écriture exécutée d'office (anodine, ou mode « argent ») n'apparaît ni
  // dans `outils` ni comme proposition : sans ce garde, « C'est noté » était
  // mis en cache et rejoué sans rien écrire (audit du 2026-09-16, A5).
  if (!t.historiqueVide || t.proposition || t.resultat !== 'ok' || t.ecritureExecutee) return false;
  if (t.enonce && ENONCE_MEMOIRE.test(t.enonce)) return false;
  if (!t.texte.trim()) return false;
  return t.outils.every((o) => TOOLS_BY_NAME[o]?.kind === 'read');
}

export async function lireReponse(p: { orgId: string; userId: string; enonce: string }): Promise<ReponseEnCache | null> {
  const version = await versionOrg(p.orgId);
  return magasin().get<ReponseEnCache>(cleReponse({ ...p, version }));
}

export async function ecrireReponse(p: { orgId: string; userId: string; enonce: string }, r: Omit<ReponseEnCache, 'enonce'>): Promise<void> {
  const version = await versionOrg(p.orgId);
  await magasin().set(cleReponse({ ...p, version }), { ...r, enonce: normaliserEnonce(p.enonce) ?? '' } satisfies ReponseEnCache, TTL_REPONSE_S);
}

export async function retirerReponse(p: { orgId: string; userId: string; enonce: string }): Promise<void> {
  const version = await versionOrg(p.orgId);
  await magasin().del(cleReponse({ ...p, version }));
}
