/**
 * Champs personnalisés × automatisations.
 *
 *   · Condition : la clé réservée `champs_perso` d'un objet de conditions
 *     (règle simple ou étape « si ») porte une liste de Condition du moteur
 *     partagé (src/lib/champs/filtres.ts). Elle est jugée sur les valeurs
 *     ACTUELLES de l'entité, dans le fuseau de l'entreprise.
 *   · Action `update_custom_field` : { field_id, value } — n'écrit QUE sur
 *     l'entité de l'événement, et seulement un champ de son objet.
 *   · Déclencheur `custom_field.changed` : émis par customFieldsService.
 *     Une écriture faite PAR une automatisation ne le ré-émet pas : sans ça,
 *     « quand X change → mettre X à jour » tournerait à l'infini.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ObjetChamp, ValeurChamp } from '../../../src/lib/champs/types';
import { evaluerCondition, type Condition } from '../../../src/lib/champs/filtres';
import { listerChamps, lireValeursLot, ecrireValeurs } from './service';
import { logger } from '../logger';

export const CLE_CONDITIONS_CHAMPS = 'champs_perso';

/** Le type d'entité d'un événement → l'objet de ses champs personnalisés. */
export function objetDeLEntite(entityType: string): ObjetChamp | null {
  switch (entityType) {
    case 'client': case 'lead': return 'client';
    case 'deal': return 'deal';
    case 'job': return 'job';
    case 'quote': case 'estimate': return 'quote';
    case 'invoice': return 'invoice';
    default: return null;
  }
}

/**
 * Les conditions de champs personnalisés tiennent-elles ?
 * Aucune condition → vrai. Entité sans champs (rendez-vous…) ou champ
 * disparu → faux : on ne déclenche pas sur ce qu'on ne peut pas vérifier.
 */
export async function conditionsChampsOk(
  supabase: SupabaseClient, orgId: string, entityType: string, entityId: string, conditions: unknown,
): Promise<boolean> {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  const objet = objetDeLEntite(entityType);
  if (!objet) return false;
  try {
    const { champs } = await listerChamps(supabase, orgId, { objet, inclureArchives: true });
    const valeurs = (await lireValeursLot(supabase, orgId, objet, [entityId], champs))[entityId] ?? {};
    const { data: cs } = await supabase.from('company_settings').select('timezone').eq('org_id', orgId).maybeSingle();
    const fuseau = (cs?.timezone as string | undefined) || 'America/Toronto';
    return (conditions as Condition[]).every((c) => {
      const champ = champs.find((x) => x.id === c.field_id);
      if (!champ) return false;
      return evaluerCondition(champ.field_type, valeurs[champ.id]?.value ?? null, c,
        { fuseau, avecHeure: !!champ.config.include_time });
    });
  } catch (err) {
    logger.error('[champs] condition d’automatisation illisible — règle non déclenchée', {
      entity_type: entityType, entity_id: entityId, message: String(err),
    });
    return false;
  }
}

/** Action « mettre à jour un champ personnalisé ». */
export async function executerMajChamp(
  supabase: SupabaseClient,
  ctx: { orgId: string; entityType: string; entityId: string },
  config: { field_id?: string; value?: ValeurChamp },
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const objet = objetDeLEntite(ctx.entityType);
  if (!objet) return { success: false, error: `Cet événement (${ctx.entityType}) n'a pas de champs personnalisés.` };
  if (!config.field_id) return { success: false, error: 'Aucun champ choisi.' };
  const { champs } = await listerChamps(supabase, ctx.orgId, { objet, ids: [config.field_id] });
  if (!champs[0]) {
    return { success: false, error: 'Ce champ n’appartient pas à l’objet de l’événement (ou il est archivé).' };
  }
  // Une valeur de texte venue du builder se convertit selon le type du champ.
  let valeur: ValeurChamp = config.value ?? null;
  // Une option se désigne par son id OU par son libellé (ce qu'on tape dans le builder).
  const option = (x: string) => champs[0].options.find((o) => !o.archived_at && (o.id === x || o.label.toLowerCase() === x.toLowerCase()))?.id ?? x;
  if (typeof valeur === 'string') {
    const t = valeur.trim();
    if (champs[0].field_type === 'number') valeur = t === '' ? null : Number(t.replace(',', '.'));
    else if (champs[0].field_type === 'monetary') valeur = t === '' ? null : Math.round(Number(t.replace(/[\s$]/g, '').replace(',', '.')) * 100);
    else if (champs[0].field_type === 'dropdown_single') valeur = t === '' ? null : option(t);
    else if (champs[0].field_type === 'dropdown_multi') valeur = t === '' ? null : t.split(',').map((x) => option(x.trim()));
  }
  const [r] = await ecrireValeurs(supabase, ctx.orgId, objet, ctx.entityId,
    [{ field_id: champs[0].id, value: valeur }], { source: 'automation' });
  return r?.ok
    ? { success: true, data: { field: champs[0].label, changed: r.changed } }
    : { success: false, error: r?.erreur ?? 'Écriture refusée.' };
}
