/**
 * Outils par domaine (couverture d'exécution à 100 %, 2026-09-16).
 * ─────────────────────────────────────────────────────────────────
 * L'audit avait mesuré ~30 actions couvertes sur ~175 que l'app permet.
 * Chaque domaine vit dans son module (tools-leads, tools-argent, tools-terrain,
 * tools-equipe, tools-reglages, tools-d2d-formations) et exporte ses outils
 * ET ses manifestes : attributs d'écriture (registre), permission par outil
 * (garde), topic (routeur / sous-agents). Ce fichier les fusionne — les
 * modules du cœur (registre.ts, garde.ts, topics.ts, tools.ts) n'importent
 * que lui. Un doublon de nom entre modules fait échouer le démarrage.
 */
import type { AgentTool } from './tools';
import type { PermissionKey } from '../../../src/lib/permissions';
import type { IdTopic } from '../lumi/topics';
import { OUTILS_LEADS, REGISTRE_LEADS, PERMISSIONS_LEADS, TOPICS_LEADS } from './tools-leads';
import { OUTILS_ARGENT, REGISTRE_ARGENT, PERMISSIONS_ARGENT, TOPICS_ARGENT } from './tools-argent';
import { OUTILS_TERRAIN, REGISTRE_TERRAIN, PERMISSIONS_TERRAIN, TOPICS_TERRAIN } from './tools-terrain';
import { OUTILS_EQUIPE, REGISTRE_EQUIPE, PERMISSIONS_EQUIPE, TOPICS_EQUIPE } from './tools-equipe';
import { OUTILS_REGLAGES, REGISTRE_REGLAGES, PERMISSIONS_REGLAGES, TOPICS_REGLAGES } from './tools-reglages';
import { OUTILS_D2D_FORMATIONS, REGISTRE_D2D_FORMATIONS, PERMISSIONS_D2D_FORMATIONS, TOPICS_D2D_FORMATIONS } from './tools-d2d-formations';

export interface AttributsEcritureDomaine { sensible: boolean; reversible: boolean; vers_client: boolean }

const MODULES = [
  { outils: OUTILS_LEADS, registre: REGISTRE_LEADS, permissions: PERMISSIONS_LEADS, topics: TOPICS_LEADS },
  { outils: OUTILS_ARGENT, registre: REGISTRE_ARGENT, permissions: PERMISSIONS_ARGENT, topics: TOPICS_ARGENT },
  { outils: OUTILS_TERRAIN, registre: REGISTRE_TERRAIN, permissions: PERMISSIONS_TERRAIN, topics: TOPICS_TERRAIN },
  { outils: OUTILS_EQUIPE, registre: REGISTRE_EQUIPE, permissions: PERMISSIONS_EQUIPE, topics: TOPICS_EQUIPE },
  { outils: OUTILS_REGLAGES, registre: REGISTRE_REGLAGES, permissions: PERMISSIONS_REGLAGES, topics: TOPICS_REGLAGES },
  { outils: OUTILS_D2D_FORMATIONS, registre: REGISTRE_D2D_FORMATIONS, permissions: PERMISSIONS_D2D_FORMATIONS, topics: TOPICS_D2D_FORMATIONS },
];

/** Tous les outils des domaines, dans un ordre stable (cache des définitions différées). */
export const OUTILS_DOMAINES: AgentTool[] = MODULES.flatMap((m) => m.outils);

const noms = OUTILS_DOMAINES.map((t) => t.declaration.name);
const doublons = noms.filter((n, i) => noms.indexOf(n) !== i);
if (doublons.length) throw new Error(`outils-domaines : noms en double ${doublons.join(', ')}`);

/** Attributs d'écriture (fusionnés dans REGISTRE_ECRITURES). */
export const REGISTRE_DOMAINES: Readonly<Record<string, AttributsEcritureDomaine>> = Object.assign({}, ...MODULES.map((m) => m.registre));

/** Permission par outil (fusionnée dans PERMISSION_PAR_OUTIL). */
export const PERMISSIONS_DOMAINES: Readonly<Record<string, { cle: PermissionKey; capacite: string }>> = Object.assign({}, ...MODULES.map((m) => m.permissions));

/** Outils par topic (fusionnés dans TOPICS[].outils). */
export const TOPICS_DOMAINES: Readonly<Partial<Record<IdTopic, string[]>>> = MODULES.reduce<Partial<Record<IdTopic, string[]>>>((acc, m) => {
  for (const [topic, liste] of Object.entries(m.topics) as Array<[IdTopic, string[]]>) acc[topic] = [...(acc[topic] ?? []), ...liste];
  return acc;
}, {});

/** Outils qui touchent l'argent (masquage des montants selon le rôle, voir garde.ts OUTILS_FINANCIERS). */
export const OUTILS_FINANCIERS_DOMAINES: readonly string[] = [
  ...OUTILS_ARGENT.map((t) => t.declaration.name),
  ...OUTILS_EQUIPE.map((t) => t.declaration.name).filter((n) => /payroll|hourly_rate|paie/.test(n)),
  // Facturation par jalon / visite (terrain) : renvoie des montants.
  ...OUTILS_TERRAIN.map((t) => t.declaration.name).filter((n) => /billing|invoice/.test(n)),
];
