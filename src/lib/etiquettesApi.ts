/* ═══════════════════════════════════════════════════════════════
   API — étiquettes des clients (Réglages → Étiquettes, sélecteur commun)

   Les étiquettes sont du TEXTE posé sur les clients (`client_tags`) ; le
   catalogue du serveur (server/routes/etiquettes.ts) porte la couleur.
   Lire : tout membre. Créer, recolorer, renommer, supprimer : « Réglages ».
   Poser / retirer une étiquette sur UN client reste une écriture directe
   (RLS de client_tags) suivie de l'annonce au moteur (automationEventsApi).
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';
import { getCurrentOrgId } from './orgApi';
import { emitClientTagged, emitClientUntagged } from './automationEventsApi';

export interface Etiquette {
  nom: string;
  /** Null : l'étiquette est posée sur des clients mais n'a jamais reçu de couleur. */
  couleur: string | null;
  nb_clients: number;
  catalogue: boolean;
}

/** Couleur d'une étiquette sans couleur choisie : neutre, lisible sur les deux thèmes. */
export const COULEUR_ETIQUETTE_DEFAUT = '#64748b';

export class ErreurEtiquettes extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function appel<T>(chemin: string, init: RequestInit = {}, repli = 'Action impossible.'): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ErreurEtiquettes('Session expirée.', 401);
  const orgId = await getCurrentOrgId();
  const reponse = await fetch(chemin, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(orgId ? { 'x-org-id': orgId } : {}) },
  });
  let corps: Record<string, unknown> | null = null;
  try { corps = await reponse.json(); } catch { corps = null; }
  if (!reponse.ok) throw new ErreurEtiquettes(typeof corps?.error === 'string' ? corps.error : repli, reponse.status);
  return corps as T;
}

export async function listerEtiquettes(): Promise<Etiquette[]> {
  const r = await appel<{ etiquettes: Array<Omit<Etiquette, 'nb_clients'> & { nb_clients: number | string }> }>(
    '/api/etiquettes', {}, 'Impossible de charger les étiquettes.');
  return r.etiquettes.map((e) => ({ ...e, nb_clients: Number(e.nb_clients) || 0 }));
}

export function creerEtiquette(nom: string, couleur?: string | null) {
  return appel<{ nom: string; couleur: string; existait: boolean }>('/api/etiquettes', {
    method: 'POST', body: JSON.stringify({ nom, couleur: couleur ?? null }),
  }, 'Impossible de créer l’étiquette.');
}

export function modifierEtiquette(nom: string, changements: { nouveau_nom?: string | null; couleur?: string | null }) {
  return appel<{ ok: true; nom: string; nb_clients: number | null }>('/api/etiquettes', {
    method: 'PATCH', body: JSON.stringify({ nom, ...changements }),
  }, 'Impossible de modifier l’étiquette.');
}

export function supprimerEtiquette(nom: string) {
  return appel<{ ok: true; retiree_de: number }>('/api/etiquettes/supprimer', {
    method: 'POST', body: JSON.stringify({ nom }),
  }, 'Impossible de supprimer l’étiquette.');
}

/** Pose une étiquette sur un client, puis prévient le moteur (« Étiquette ajoutée »). */
export async function poserEtiquette(clientId: string, tag: string): Promise<void> {
  const { error } = await supabase.from('client_tags').insert({ client_id: clientId, tag });
  // Déjà posée : le résultat voulu est atteint, rien à annoncer.
  if (error && error.code === '23505') return;
  if (error) throw error;
  emitClientTagged({ clientId, tag });
}

/** Retire une étiquette d'un client, puis prévient le moteur (« Étiquette retirée »). */
export async function retirerEtiquette(clientId: string, tag: string): Promise<void> {
  const { error } = await supabase.from('client_tags').delete().eq('client_id', clientId).eq('tag', tag);
  if (error) throw error;
  emitClientUntagged({ clientId, tag });
}

/** Étiquettes de plusieurs clients d'un coup (cartes de la pipeline, listes). */
export async function etiquettesDesClients(clientIds: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (clientIds.length === 0) return out;
  for (let i = 0; i < clientIds.length; i += 500) {
    const { data, error } = await supabase.from('client_tags').select('client_id, tag').in('client_id', clientIds.slice(i, i + 500));
    if (error) throw error;
    for (const r of (data ?? []) as Array<{ client_id: string; tag: string }>) (out[r.client_id] ??= []).push(r.tag);
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
  return out;
}

/** Couleur d'une étiquette par son nom (insensible à la casse), sinon la couleur neutre. */
export function couleurDe(etiquettes: Etiquette[] | undefined, nom: string): string {
  const e = etiquettes?.find((x) => x.nom.toLowerCase() === nom.toLowerCase());
  return e?.couleur || COULEUR_ETIQUETTE_DEFAUT;
}
