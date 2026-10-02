/* ═══════════════════════════════════════════════════════════════
   DOUBLONS — l'AVERTISSEMENT à la création et à la publication.

   Décision du propriétaire : on avertit, on ne bloque jamais. La garde d'envoi
   (`server/lib/actions/doublons.ts`) empêche qu'un client reçoive deux fois le
   même message ; ici on dit, AVANT de publier, qu'une autre automatisation
   publiée écrit déjà aux mêmes clients au même moment — et on la NOMME.

   Deux automatisations sont en conflit quand les quatre conditions tiennent :
     1. même déclencheur ;
     2. même occurrence : les réglages qui disent QUEL événement est visé
        (`CLES_DE_CIBLAGE` du moteur : jours de retard, étiquette posée, étape du
        pipeline…) sont égaux, ou absents d'un côté — « 3 jours de retard » et
        « 15 jours de retard » ne se marchent pas dessus ;
     3. au moins un canal client en commun (texto, courriel ; une demande
        d'avis compte pour les deux) ;
     4. des ciblages qui se chevauchent (`ciblagesSeChevauchent` : « oui » sauf
        quand on peut prouver le contraire).

   `meme_message` précise le cas grave : un texte identique ou quasi identique
   (même mesure que la garde d'envoi) — là, un seul des deux partira.

   Une lecture ratée ne rend AUCUN conflit et laisse une trace : cet
   avertissement est une aide, il ne doit jamais empêcher de publier.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  lireCiblage, ciblagesSeChevauchent, canauxDeLaRegle, actionsDUneRegle, type CanalClient,
} from '../../src/lib/automationCiblage';
import { localizeAutomationName } from '../../src/lib/automationNames';
import { CLES_DE_CIBLAGE } from './automationEngine';
import { similarite, SEUIL_QUASI_IDENTIQUE } from './actions/doublons';
import { logger } from './logger';

/** Ce qu'on lit d'une règle pour la comparer. */
export interface RegleComparee {
  id?: string | null;
  name?: string | null;
  trigger_event?: string | null;
  conditions?: Record<string, unknown> | null;
  steps?: unknown;
  actions?: unknown;
  preset_key?: string | null;
}

export interface Conflit {
  regle_id: string;
  /** Le nom affiché de l'automatisation en conflit (un préréglage porte son nom traduit). */
  nom: string;
  /** Les canaux en commun. */
  canaux: CanalClient[];
  /** Un message identique ou quasi identique sur un canal commun : un seul des deux partira. */
  meme_message: boolean;
}

/** `{ eq: 3 }` et `3` disent la même chose ; une chaîne se compare sans casse. */
function valeurOccurrence(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  const brut = v && typeof v === 'object' && !Array.isArray(v) && 'eq' in (v as Record<string, unknown>) ? (v as { eq?: unknown }).eq : v;
  if (brut === undefined || brut === null || brut === '') return null;
  return typeof brut === 'object' ? JSON.stringify(brut) : String(brut).trim().toLowerCase();
}

/** Les deux règles visent-elles la même occurrence de l'événement ? (égales, ou absentes d'un côté) */
export function memeOccurrence(declencheur: string, a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined): boolean {
  for (const cle of CLES_DE_CIBLAGE[declencheur] ?? []) {
    const x = valeurOccurrence(a?.[cle]);
    const y = valeurOccurrence(b?.[cle]);
    if (x !== null && y !== null && x !== y) return false;
  }
  return true;
}

/** Les textes qu'une règle envoie sur un canal (objet + corps pour un courriel, les deux langues). */
function textesDuCanal(regle: RegleComparee, canal: CanalClient): string[] {
  const type = canal === 'sms' ? 'send_sms' : 'send_email';
  return actionsDUneRegle(regle).filter((a) => a.type === type).flatMap((a) => {
    const texte = (suffixe: string) => [a.config[`subject${suffixe}`], a.config[`body${suffixe}`]]
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '').join('\n');
    return [texte(''), texte('_en')].filter((t) => t !== '');
  });
}

/**
 * Parmi `autres` (des règles PUBLIÉES du même bureau), celles qui sont en
 * conflit avec `regle`. Fonction pure : c'est elle que les tests éprouvent.
 */
export function reglesEnConflit(regle: RegleComparee, autres: RegleComparee[], langue: 'fr' | 'en' = 'fr'): Conflit[] {
  const declencheur = regle.trigger_event ?? '';
  const canaux = canauxDeLaRegle(regle);
  if (!declencheur || canaux.length === 0) return [];
  const ciblage = lireCiblage(regle.conditions);
  const conflits: Conflit[] = [];
  for (const autre of autres) {
    if (!autre.id || autre.id === regle.id) continue;
    if (autre.trigger_event !== declencheur) continue;
    if (!memeOccurrence(declencheur, regle.conditions, autre.conditions)) continue;
    const communs = canauxDeLaRegle(autre).filter((c) => canaux.includes(c));
    if (communs.length === 0) continue;
    if (!ciblagesSeChevauchent(ciblage, lireCiblage(autre.conditions))) continue;
    const memeMessage = communs.some((canal) => textesDuCanal(regle, canal)
      .some((t) => textesDuCanal(autre, canal).some((u) => similarite(t, u) >= SEUIL_QUASI_IDENTIQUE)));
    conflits.push({
      regle_id: autre.id,
      nom: localizeAutomationName(String(autre.name ?? ''), langue),
      canaux: communs,
      meme_message: memeMessage,
    });
  }
  // Le cas grave d'abord.
  return conflits.sort((x, y) => Number(y.meme_message) - Number(x.meme_message));
}

/**
 * Les automatisations PUBLIÉES du bureau en conflit avec cette règle (qu'elle
 * soit déjà enregistrée ou non). `client` : celui de l'utilisateur (la RLS
 * borne au bureau) ou le rôle de service — dans les deux cas le bureau est
 * filtré explicitement.
 */
export async function conflitsDePublication(
  client: SupabaseClient, orgId: string, regle: RegleComparee, langue: 'fr' | 'en' = 'fr',
): Promise<Conflit[]> {
  if (!regle.trigger_event || canauxDeLaRegle(regle).length === 0) return [];
  try {
    const { data, error } = await client
      .from('automation_rules')
      .select('id, name, trigger_event, conditions, steps, actions, preset_key')
      .eq('org_id', orgId)
      .eq('trigger_event', regle.trigger_event)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('created_at')
      .limit(50);
    if (error) {
      logger.error('[automations-conflits] lecture impossible — aucun avertissement de doublon', { orgId, rule_id: regle.id ?? null, message: error.message });
      return [];
    }
    return reglesEnConflit(regle, (data ?? []) as RegleComparee[], langue);
  } catch (err) {
    logger.error('[automations-conflits] lecture impossible — aucun avertissement de doublon', {
      orgId, rule_id: regle.id ?? null, message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

const NOM_CANAUX: Record<string, [string, string]> = {
  sms: ['un texto', 'a text'],
  email: ['un courriel', 'an email'],
  'sms+email': ['un texto et un courriel', 'a text and an email'],
};

/**
 * La phrase d'avertissement — elle NOMME l'automatisation en conflit.
 *   « « Relance de facture — 3, 7, 14 et 30 jours » envoie déjà un texto aux
 *     mêmes clients sur ce déclencheur. Les deux partiront : un message
 *     identique ne sera envoyé qu’une fois. »
 */
export function phraseConflit(c: Conflit, fr = true): string {
  const quoi = NOM_CANAUX[c.canaux.join('+')]?.[fr ? 0 : 1] ?? (fr ? 'un message' : 'a message');
  if (c.meme_message) {
    return fr
      ? `« ${c.nom} » envoie déjà presque le même message (${quoi}) aux mêmes clients sur ce déclencheur. Un seul des deux partira : le second sera ignoré comme doublon.`
      : `“${c.nom}” already sends almost the same message (${quoi}) to the same clients on this trigger. Only one of the two will go out: the second is skipped as a duplicate.`;
  }
  return fr
    ? `« ${c.nom} » envoie déjà ${quoi} aux mêmes clients sur ce déclencheur. Les deux partiront : un message identique ne sera envoyé qu’une fois.`
    : `“${c.nom}” already sends ${quoi} to the same clients on this trigger. Both will go out: an identical message is only sent once.`;
}

export interface AvertissementConflit extends Conflit { message: string }

/** Au-delà, on résume : une liste de dix noms ne se lit plus. */
export const CONFLITS_NOMMES_MAX = 3;

/**
 * Ce que la route de publication (et Lumi) rend : chaque conflit avec sa
 * phrase. Les `CONFLITS_NOMMES_MAX` premiers sont nommés un par un ; le reste
 * tient en une ligne.
 */
export function avertissementsDeConflit(conflits: Conflit[], fr = true): AvertissementConflit[] {
  return conflits.map((c) => ({ ...c, message: phraseConflit(c, fr) }));
}

/** Les lignes à AFFICHER (confirmation de publication, réponse de Lumi). */
export function lignesDeConflit(conflits: Conflit[], fr = true): string[] {
  const lignes = conflits.slice(0, CONFLITS_NOMMES_MAX).map((c) => phraseConflit(c, fr));
  const reste = conflits.length - CONFLITS_NOMMES_MAX;
  if (reste > 0) {
    lignes.push(fr
      ? `… et ${reste} autre${reste > 1 ? 's' : ''} automatisation${reste > 1 ? 's' : ''} publiée${reste > 1 ? 's' : ''} sur ce déclencheur.`
      : `… and ${reste} more published automation${reste > 1 ? 's' : ''} on this trigger.`);
  }
  return lignes;
}
