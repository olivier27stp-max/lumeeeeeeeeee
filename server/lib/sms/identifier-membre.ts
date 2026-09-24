/**
 * À qui parle-t-on quand un texto arrive ?
 * ────────────────────────────────────────
 * Un numéro qui écrit au numéro de l'entreprise, c'est soit un CLIENT (et le
 * message va dans la messagerie, comme aujourd'hui), soit quelqu'un de
 * L'ÉQUIPE qui s'adresse à Lumi.
 *
 * Ce module ne répond qu'à cette question, et il le fait strictement :
 *
 *   · le numéro doit être rattaché à un membre ACTIF de l'org PROPRIÉTAIRE du
 *     numéro appelé — jamais d'une autre org ;
 *   · le membre doit avoir un `user_id` : sans compte, pas de permissions à
 *     appliquer, donc pas de Lumi ;
 *   · en cas d'ambiguïté (deux membres, même numéro), on refuse plutôt que
 *     de deviner — répondre à la mauvaise personne avec les données d'une
 *     entreprise serait une fuite.
 *
 * C'est la frontière de sécurité du canal SMS : tout ce qui passe ici obtient
 * les droits d'un utilisateur réel.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeE164 } from '../helpers';
import { logger } from '../logger';

export interface MembreIdentifie {
  userId: string;
  orgId: string;
  prenom: string;
  /** Rôle tel qu'il est écrit dans `team_members` (owner, admin, technician…). */
  role: string;
  langue: 'fr' | 'en';
}

/**
 * Le membre de l'équipe derrière ce numéro, ou `null`.
 *
 * `orgId` est l'org propriétaire du numéro qui a REÇU le texto : le borner est
 * ce qui empêche un numéro connu dans deux entreprises de se faire répondre
 * avec les données de la mauvaise.
 */
export async function membreParTelephone(
  admin: SupabaseClient,
  opts: { telephone: string; orgId: string },
): Promise<MembreIdentifie | null> {
  const normalise = normalizeE164(opts.telephone);
  if (!normalise || !opts.orgId) return null;

  // Les numéros sont saisis à la main : « 514-555-0199 », « (514) 555 0199 ».
  // On compare donc aussi sur les chiffres seuls, sans indicatif de pays.
  const chiffres = normalise.replace(/\D/g, '');
  const variantes = new Set<string>([normalise, chiffres]);
  if (chiffres.startsWith('1') && chiffres.length === 11) variantes.add(chiffres.slice(1));

  const { data, error } = await admin
    .from('team_members')
    .select('user_id, org_id, first_name, role, status, phone')
    .eq('org_id', opts.orgId)
    .eq('status', 'active')
    .not('user_id', 'is', null)
    .not('phone', 'eq', '');

  if (error) {
    logger.error('[sms/membre] lecture de l’équipe impossible', { error: error.message });
    return null;
  }

  // Le filtrage final se fait ici plutôt qu'en base : les numéros stockés ont
  // des formats hétérogènes, seule la comparaison normalisée est fiable.
  const correspondants = (data ?? []).filter((m: any) => {
    const p = normalizeE164(String(m.phone ?? ''));
    if (!p) return false;
    const c = p.replace(/\D/g, '');
    return variantes.has(p) || variantes.has(c) || (c.startsWith('1') && variantes.has(c.slice(1)));
  });

  if (correspondants.length === 0) return null;
  if (correspondants.length > 1) {
    // Deux membres avec le même numéro : on ne choisit pas. Le message
    // retombera dans la messagerie client, visible par l'équipe.
    logger.error('[sms/membre] plusieurs membres pour un même numéro — on refuse de deviner', {
      orgId: opts.orgId, nb: correspondants.length,
    });
    return null;
  }

  const m: any = correspondants[0];
  return {
    userId: String(m.user_id),
    orgId: String(m.org_id),
    prenom: String(m.first_name ?? '').trim(),
    role: String(m.role ?? ''),
    langue: 'fr',
  };
}

/**
 * Les mots qui valent « oui » et « non » dans un texto.
 *
 * Le webhook traite déjà « oui »/« yes » comme un consentement LCAP (START).
 * Une confirmation adressée à Lumi n'est PAS un opt-in : la distinction se
 * fait sur le contexte — une proposition en attente — et non sur le mot.
 * Voir `estConfirmation` / `estAnnulation`.
 */
const OUI = /^(oui|ouais|yes|ok|okay|correct|c'?est bon|vas-?y|envoie|go|parfait|exact|👍|✅)\s*[.!]*$/i;
const NON = /^(non|nope|no|annule|laisse|laisse faire|pas tout de suite|attends|stop ça|oublie ça|❌|👎)\s*[.!]*$/i;

export function estConfirmation(texte: string): boolean {
  return OUI.test((texte || '').trim());
}

export function estAnnulation(texte: string): boolean {
  return NON.test((texte || '').trim());
}
