/* ═══════════════════════════════════════════════════════════════
   Les adresses d'appel — le client de l'écran.

   La GESTION passe par le serveur, comme les règles : la RLS y est la
   garde de fond, et la clé est générée par la BASE (32 octets
   aléatoires). Laisser le navigateur proposer sa clé permettrait d'en
   choisir une faible, et une adresse faible est une porte ouverte sur
   les automatisations de l'entreprise.

   La RÉCEPTION, elle, est publique et vit dans
   `server/routes/webhooks-entrants.ts`.
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';
import { getCurrentOrgId } from './orgApi';

export interface AdresseDAppel {
  id: string;
  name: string;
  api_key: string;
  enabled: boolean;
  created_at: string;
}

/**
 * `x-org-id` : sans lui, le serveur retomberait sur le premier bureau de
 * la personne — l'adresse serait créée dans la mauvaise entreprise.
 */
async function entetes(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Session expirée.');
  const orgId = await getCurrentOrgId();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(orgId ? { 'x-org-id': orgId } : {}),
  };
}

/** Le message du serveur s'il en donne un — il est déjà en français. */
async function erreur(reponse: Response): Promise<Error> {
  try {
    const corps = await reponse.json();
    if (corps?.error && typeof corps.error === 'string') return new Error(corps.error);
  } catch {
    // Réponse sans JSON : le repli ci-dessous suffit.
  }
  return new Error('Action impossible pour le moment.');
}

export async function listerAdressesDAppel(): Promise<AdresseDAppel[]> {
  const reponse = await fetch('/api/automations/webhooks', { headers: await entetes() });
  if (!reponse.ok) throw await erreur(reponse);
  const corps = await reponse.json();
  return corps.webhooks ?? [];
}

export async function creerAdresseDAppel(name: string): Promise<AdresseDAppel> {
  const reponse = await fetch('/api/automations/webhooks', {
    method: 'POST',
    headers: await entetes(),
    body: JSON.stringify({ name }),
  });
  if (!reponse.ok) throw await erreur(reponse);
  return reponse.json();
}

export async function basculerAdresseDAppel(id: string, enabled: boolean): Promise<AdresseDAppel> {
  const reponse = await fetch(`/api/automations/webhooks/${id}`, {
    method: 'PATCH',
    headers: await entetes(),
    body: JSON.stringify({ enabled }),
  });
  if (!reponse.ok) throw await erreur(reponse);
  return reponse.json();
}

export async function supprimerAdresseDAppel(id: string): Promise<void> {
  const reponse = await fetch(`/api/automations/webhooks/${id}`, {
    method: 'DELETE',
    headers: await entetes(),
  });
  if (!reponse.ok) throw await erreur(reponse);
}

/* ── Mettre ses automatisations en pause ─────────────────

   L'interrupteur du CLIENT : le jour où des messages partent qu'il ne
   veut pas, il arrête en un clic sans nous appeler. La file est
   CONSERVÉE — reprendre repart où on en était. */

export interface EtatPause {
  paused: boolean;
  pausedAt: string | null;
}

export async function lireEtatPause(): Promise<EtatPause> {
  const reponse = await fetch('/api/automations/pause', { headers: await entetes() });
  if (!reponse.ok) throw await erreur(reponse);
  return reponse.json();
}

export async function basculerPause(paused: boolean): Promise<void> {
  const reponse = await fetch('/api/automations/pause', {
    method: 'POST',
    headers: await entetes(),
    body: JSON.stringify({ paused }),
  });
  if (!reponse.ok) throw await erreur(reponse);
}
