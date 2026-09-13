/**
 * Version des données d'une org (caches des étages 3-4).
 * Module minimal, sans dépendance vers les outils : il est importé par
 * executerIdempotent (tools-etendus.ts) et par les caches — un import des
 * outils ici recréerait le cycle tools → tools-etendus → caches → tools qui a
 * cassé le chargement des modules (vu en CI le 2026-09-13).
 */
import { magasin } from './magasin';

export async function versionOrg(orgId: string): Promise<number> {
  return Number((await magasin().get<number>(`lumi:ver:${orgId}`)) ?? 0) || 0;
}

/** À appeler après toute écriture d'agent : tout ce qui est en cache pour l'org devient obsolète. */
export async function invaliderOrg(orgId: string): Promise<void> {
  await magasin().incr(`lumi:ver:${orgId}`);
}
