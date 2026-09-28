/*
 * Étiquettes des clients — le SEUL endroit qui annonce au moteur qu'une
 * étiquette a été posée ou retirée (2026-09-28).
 *
 * Avant, « Étiquette ajoutée » ne partait que du navigateur, après un ajout
 * À LA MAIN sur la fiche client. Une étiquette posée par une automatisation
 * ne déclenchait donc rien : impossible d'enchaîner « A pose VIP → B réagit à
 * VIP ». Désormais la fiche (via sa route) ET les actions passent par ici.
 *
 * Garde anti-boucle : l'événement porte `chaine`, la liste des règles qui
 * l'ont produit. Le moteur ne relance jamais une règle déjà dans la chaîne
 * (A retire X → B remet X → A retire X…), et coupe au-delà de
 * CHAINE_MAX maillons. Une étiquette déjà présente n'est jamais ré-annoncée :
 * poser « VIP » sur un client VIP ne déclenche rien.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { eventBus } from './eventBus';
import { logger } from './logger';

export const CHAINE_MAX = 5;

export interface AnnonceEtiquette {
  orgId: string;
  clientId: string;
  tag: string;
  sens: 'ajoutee' | 'retiree';
  actorId?: string | null;
  /** Règles d'automatisation qui ont produit ce changement (anti-boucle). */
  chaine?: string[];
}

export async function annoncerEtiquette(admin: SupabaseClient, a: AnnonceEtiquette): Promise<void> {
  try {
    const { data: client } = await admin
      .from('clients')
      .select('first_name, last_name, email, phone')
      .eq('id', a.clientId)
      .eq('org_id', a.orgId)
      .maybeSingle();
    if (!client) return;
    await eventBus.emit(a.sens === 'ajoutee' ? 'client.tagged' : 'client.untagged', {
      orgId: a.orgId,
      entityType: 'client',
      entityId: a.clientId,
      actorId: a.actorId ?? undefined,
      metadata: {
        // `tag` sert aux conditions : « quand l'étiquette est “À rappeler” ».
        tag: a.tag,
        client_name: `${client.first_name || ''} ${client.last_name || ''}`.trim(),
        email: client.email || '',
        phone: client.phone || '',
        ...(a.chaine?.length ? { chaine: a.chaine } : {}),
      },
    });
  } catch (err: any) {
    // L'étiquette est posée ; seule l'annonce a raté. On le dit, sans défaire l'écriture.
    logger.error('[etiquettes] annonce impossible', { clientId: a.clientId, sens: a.sens, error: err?.message || String(err) });
  }
}

/**
 * Filtres « le client a / n'a pas l'étiquette » d'une règle, jugés sur les
 * étiquettes ACTUELLES du client de la fiche. Sans filtre : vrai. Un filtre
 * posé sur une fiche sans client : faux (on ne prévient pas au hasard).
 */
export async function conditionsEtiquettesOk(
  admin: SupabaseClient,
  clientId: () => Promise<string | null>,
  conditions: Record<string, unknown> | null | undefined,
): Promise<boolean> {
  const texte = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
  const a = texte(conditions?.client_a_etiquette);
  const sans = texte(conditions?.client_sans_etiquette);
  if (!a && !sans) return true;
  const id = await clientId();
  if (!id) return false;
  const { data, error } = await admin.from('client_tags').select('tag').eq('client_id', id);
  if (error) {
    logger.error('[etiquettes] filtre illisible — règle retenue', { clientId: id, error: error.message });
    return false;
  }
  const posees = new Set(((data ?? []) as Array<{ tag: string }>).map((r) => r.tag.toLowerCase()));
  if (a && !posees.has(a)) return false;
  if (sans && posees.has(sans)) return false;
  return true;
}

/** La règle `ruleId` doit-elle être ignorée pour cet événement (boucle) ? */
export function regleDansLaChaine(metadata: Record<string, unknown> | undefined, ruleId: string): boolean {
  const chaine = Array.isArray(metadata?.chaine) ? (metadata!.chaine as unknown[]) : [];
  return chaine.length >= CHAINE_MAX || chaine.includes(ruleId);
}
