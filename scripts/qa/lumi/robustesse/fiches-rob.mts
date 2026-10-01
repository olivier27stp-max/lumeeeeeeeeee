/**
 * Robustesse des conversations de Lumi — les fiches [ROB] (écritures de service).
 * ─────────────────────────────────────────────────────────────────────────
 * La batterie n'écrit pour vrai que des TÂCHES dont le titre commence par [ROB] :
 *  - celles que Lumi crée quand la batterie confirme une carte « créer une tâche » ;
 *  - celle que la batterie crée elle-même, avec la clé de service, pour le test de l'outil qui échoue.
 * Tout est retiré à la fin par suppression DOUCE (`deleted_at`) — jamais par suppression dure. Une tâche n'a ni
 * courriel ni téléphone : même une action mal comprise ne peut écrire à personne.
 *
 * Ce qui reste en base, sans corbeille possible : les conversations de test, leurs traces, leurs lignes du grand
 * livre, et les empreintes d'écriture (`agent_actions`, purgées par le produit après 24 h).
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MARQUEUR_ROB } from './types.mts';

interface Erreur { message: string }
type Requete = PromiseLike<{ data: unknown; error: Erreur | null }>;

/** Le mot de la convention que la famille « longue » donne au tour 4 : s'il se retrouve en mémoire permanente, le ménage le désactive. */
export const CONVENTION_LONGUE = 'dossier bleu';

/** Titre d'une tâche de la batterie : « [ROB] <sujet> <jeton de passe> ». */
export const titreRob = (sujet: string, nonce: string): string => `${MARQUEUR_ROB} ${sujet} ${nonce}`;

/** Crée une tâche [ROB] ouverte dans le bureau, avec la clé de service. */
export async function creerTacheRob(admin: SupabaseClient, org: string, proprietaireId: string, titre: string): Promise<{ id: string; titre: string }> {
  if (!titre.startsWith(`${MARQUEUR_ROB} `)) throw new Error(`REFUS : une tâche de la batterie porte le marqueur ${MARQUEUR_ROB} (« ${titre} »).`);
  const id = randomUUID();
  const { error } = await admin.from('tasks').insert({ id, org_id: org, created_by: proprietaireId, title: titre, description: `${MARQUEUR_ROB} tâche de la batterie de robustesse — à ignorer`, status: 'open', priority: 'low', type: 'Admin' }).select('id');
  if (error) throw new Error(`tâche ${titre} : ${error.message}`);
  return { id, titre };
}

/** Met une tâche [ROB] à la corbeille (pour que l'outil de Lumi échoue pour vrai à la confirmation). */
export async function mettreTacheALaCorbeille(admin: SupabaseClient, org: string, id: string): Promise<void> {
  const { error } = await admin.from('tasks').update({ deleted_at: new Date().toISOString() }).eq('org_id', org).eq('id', id).like('title', `${MARQUEUR_ROB}%`).select('id');
  if (error) throw new Error(`corbeille de la tâche ${id} : ${error.message}`);
}

/**
 * Retire tout ce que la batterie a écrit dans le bureau — suppression douce. Rend ce qui a été fait, et ce qui n'a
 * pas pu l'être. Peut être relancé seul (`run.mts --nettoyer`).
 */
export async function retirerFichesRob(admin: SupabaseClient, org: string): Promise<{ fait: string[]; erreurs: string[] }> {
  const fait: string[] = [];
  const erreurs: string[] = [];
  const etape = async (quoi: string, p: Requete): Promise<void> => {
    const { data, error } = await p;
    if (error) erreurs.push(`${quoi} : ${error.message}`);
    else fait.push(`${quoi} : ${Array.isArray(data) ? data.length : 0}`);
  };
  await etape('tâches [ROB] mises à la corbeille', admin.from('tasks').update({ deleted_at: new Date().toISOString() }).eq('org_id', org).like('title', `${MARQUEUR_ROB}%`).is('deleted_at', null).select('id'));
  // Filet : si Lumi a retenu pour toujours une « convention de conversation » de la famille longue, elle entrerait dans le prompt de tous les tours suivants du bureau.
  for (const motif of [`%${MARQUEUR_ROB}%`, `%${CONVENTION_LONGUE}%`]) {
    await etape(`notes de mémoire « ${motif.replace(/%/g, '')} » désactivées`, admin.from('org_knowledge').update({ is_active: false }).eq('org_id', org).eq('category', 'assistant').ilike('value', motif).eq('is_active', true).select('id'));
  }
  return { fait, erreurs };
}
