/* ═══════════════════════════════════════════════════════════════
   « Tu en as déjà une » — ce que Lumi ne voit pas tout seul.

   « Construire avec Lumi » bâtit un parcours à partir d'une phrase ; il
   ne lit pas les automatisations du bureau. Vrai cas de prod
   (2026-10-01, Coquin lavage) : « fais un message pour notifier le rep
   qui a envoyé le devis » a produit une notification à la première
   ouverture du devis… alors que le bureau avait DÉJÀ, publiée,
   « Me notifier quand un client ouvre sa soumission » (rep assigné,
   propriétaires et admins, cloche + courriel). Publiée, la nouvelle
   aurait notifié le rep deux fois, et personne ne l'aurait su.

   Le serveur le dit donc lui-même, sous la réponse de Lumi : les
   automatisations PUBLIÉES du bureau sur le même déclencheur, avec ce
   qu'elles font. Une lecture, bornée au bureau par la RLS du client de
   l'utilisateur ; jamais une écriture.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { trouverAction, trouverDeclencheur } from '../../../src/lib/automationCatalogue';
import { localizeAutomationName } from '../../../src/lib/automationNames';

export interface DejaPubliee {
  nom: string;
  /** Les types d'action, dans l'ordre, sans doublon (`send_sms`, `create_notification`…). */
  actions: string[];
}

/** Les types d'action d'une règle, format d'origine (`actions`) ou parcours (`steps`). */
export function typesDAction(regle: { steps?: unknown; actions?: unknown }): string[] {
  const steps = Array.isArray(regle.steps) ? regle.steps : [];
  const source = steps.length > 0
    ? steps.map((e) => (e as { action?: { type?: unknown } })?.action?.type)
    : (Array.isArray(regle.actions) ? regle.actions : []).map((a) => (a as { type?: unknown })?.type);
  return [...new Set(source.filter((t): t is string => typeof t === 'string' && t !== 'log_activity'))];
}

/**
 * Les automatisations publiées du bureau sur ce déclencheur, hors celle
 * qu'on est en train de bâtir. Vide si la lecture échoue : cette note est
 * une aide, elle ne doit jamais faire échouer une génération.
 */
export async function lireDejaPubliees(
  client: SupabaseClient,
  orgId: string,
  declencheur: string,
  saufId: string | null,
  langue: 'fr' | 'en',
): Promise<DejaPubliee[]> {
  let requete = client
    .from('automation_rules')
    .select('id, name, steps, actions')
    .eq('org_id', orgId)
    .eq('trigger_event', declencheur)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('created_at')
    .limit(6);
  if (saufId && /^[0-9a-f-]{36}$/i.test(saufId)) requete = requete.neq('id', saufId);
  const { data, error } = await requete;
  if (error || !data) return [];
  return data.map((r) => ({
    nom: localizeAutomationName(String(r.name ?? ''), langue),
    actions: typesDAction(r as { steps?: unknown; actions?: unknown }),
  }));
}

/**
 * La note ajoutée sous la réponse de Lumi. Vide s'il n'y a rien à signaler.
 *
 * `actionsNouvelles` : les types d'action du parcours qu'on vient de bâtir.
 * On ne cite que les automatisations qui font LA MÊME CHOSE (au moins un type
 * d'action en commun) : sur « Devis envoyé », cinq relances par texto et
 * courriel ne sont pas un doublon d'une notification interne — les lister
 * noyait l'information utile (constaté sur lumecrm.net le 2026-10-01).
 */
export function noteDejaPubliees(toutes: DejaPubliee[], declencheur: string, langue: 'fr' | 'en', actionsNouvelles: string[]): string {
  const regles = toutes.filter((r) => r.actions.some((t) => actionsNouvelles.includes(t)));
  if (!regles.length) return '';
  const fr = langue === 'fr';
  const decl = trouverDeclencheur(declencheur);
  const quand = decl ? (fr ? decl.fr : decl.en) : declencheur;
  const montrees = regles.slice(0, 5);
  const lignes = montrees.map((r) => {
    const fait = r.actions.map((t) => { const a = trouverAction(t); return a ? (fr ? a.fr : a.en) : null; }).filter(Boolean).join(', ');
    return `• « ${r.nom} »${fait ? ` — ${fait}` : ''}`;
  });
  if (regles.length > montrees.length) lignes.push(fr ? '• … et d’autres.' : '• … and more.');
  const n = regles.length;
  return fr
    ? `\n\nÀ savoir : tu as déjà ${n > 1 ? 'des automatisations publiées qui font' : 'une automatisation publiée qui fait'} la même chose sur ce déclencheur (« ${quand} ») :\n${lignes.join('\n')}\nVérifie ${n > 1 ? 'qu’elles ne font' : 'qu’elle ne fait'} pas double emploi avant de publier celle-ci.`
    : `\n\nGood to know: you already have ${n > 1 ? 'published automations that do' : 'a published automation that does'} the same thing on this trigger (“${quand}”):\n${lignes.join('\n')}\nCheck ${n > 1 ? 'they do' : 'it does'} not overlap before publishing this one.`;
}
