/**
 * Agent E — outils communs des tests d'intégration (vrai moteur, pile LOCALE,
 * mes bureaux « (e) » en bac à sable). Bâtis sur le harnais existant
 * (tests/automations-suite/harnais + 20-cde-outils) : rien n'est réinventé.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  Menage, creerClient, creerRegle, journaux, taches, avancer, envoisMarques, attendreJournaux,
} from '../../../automations-suite/integration/20-cde-outils';
import { attendre } from '../../../automations-suite/harnais/moteur';

export { Menage, creerClient, creerRegle, journaux, taches, avancer, envoisMarques, attendreJournaux, attendre };

/** Ces tests ne tournent QUE sur la pile locale (jamais staging ni la prod). */
export const PILE_LOCALE = /localhost|127\.0\.0\.1/.test(process.env.VITE_SUPABASE_URL ?? '')
  && (process.env.QA_AUTO_SUFFIXE ?? '') === 'e';

export type Bureau = { admin: SupabaseClient; orgA: string; orgB: string; users: Record<string, string>; eventBus: { emit: (t: any, d: any) => Promise<boolean> } };

/** Les envois réellement « partis » (fournisseur simulé en succès) portant la marque. */
export async function partis(b: Bureau, depuis: string, m: string) {
  return (await envoisMarques(b, depuis, m)).filter((e) => (e.meta as { mode?: string } | null)?.mode !== 'panne' && (e.meta as { mode?: string } | null)?.mode !== 'delai');
}

/** Le motif écrit au journal pour chaque ligne d'une règle : « envoye », ou le code du saut, ou « echec ». */
export async function verdicts(b: Bureau, ruleId: string): Promise<string[]> {
  return (await journaux(b, ruleId)).map((l) => {
    const d = (l.result_data ?? {}) as { saute_code?: string };
    if (d.saute_code) return d.saute_code;
    return l.result_success ? 'envoye' : `echec:${String(l.result_error ?? '').slice(0, 60)}`;
  });
}

/** Tous les textes de saut écrits au journal par une règle (ce que l'onglet Journaux affiche). */
export async function motifs(b: Bureau, ruleId: string): Promise<string[]> {
  return (await journaux(b, ruleId)).map((l) => String(((l.result_data ?? {}) as { saute?: string }).saute ?? '')).filter(Boolean);
}

/** Pose une étiquette sur un client (table client_tags, comme la fiche). */
export async function etiqueter(b: Bureau, clientId: string, ...tags: string[]): Promise<void> {
  for (const tag of tags) {
    const { error } = await b.admin.from('client_tags').upsert({ client_id: clientId, tag }, { onConflict: 'client_id,tag', ignoreDuplicates: true });
    if (error) throw new Error(`étiquette ${tag} : ${error.message}`);
  }
}

/** Le champ personnalisé (non archivé) d'un objet par sa clé, dans le bureau A. */
export async function champParCle(b: Bureau, objet: string, cle: string): Promise<{ id: string; field_type: string } | null> {
  const { data, error } = await b.admin.from('custom_fields').select('id, field_type')
    .eq('org_id', b.orgA).eq('object_type', objet).eq('key', cle).is('archived_at', null).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string; field_type: string } | null) ?? null;
}

/** Écrit la valeur d'un champ personnalisé par le vrai service (mêmes règles que l'écran). */
export async function ecrireChamp(b: Bureau, objet: 'client' | 'job' | 'quote' | 'invoice' | 'deal', entiteId: string, fieldId: string, valeur: unknown): Promise<void> {
  const { ecrireValeurs } = await import('../../../../server/lib/champs/service');
  const [r] = await ecrireValeurs(b.admin, b.orgA, objet, entiteId, [{ field_id: fieldId, value: valeur as never }], { source: 'automation' });
  if (!r?.ok) throw new Error(`écriture du champ : ${r?.erreur ?? 'refusée'}`);
}

/** Lit un drapeau `org_features` du bureau A, le pose, et rend de quoi le remettre. */
export async function poserDrapeau(b: Bureau, cle: string, actif: boolean): Promise<() => Promise<void>> {
  const { data: avant } = await b.admin.from('org_features').select('enabled').eq('org_id', b.orgA).eq('feature', cle).maybeSingle();
  const { error } = await b.admin.from('org_features').upsert({ org_id: b.orgA, feature: cle, enabled: actif }, { onConflict: 'org_id,feature' });
  if (error) throw new Error(`drapeau ${cle} : ${error.message}`);
  const { oublierDrapeaux } = await import('../../../../server/lib/automations-drapeaux');
  oublierDrapeaux(b.orgA);
  return async () => {
    if (avant) await b.admin.from('org_features').update({ enabled: (avant as { enabled: boolean }).enabled }).eq('org_id', b.orgA).eq('feature', cle);
    else await b.admin.from('org_features').delete().eq('org_id', b.orgA).eq('feature', cle);
    oublierDrapeaux(b.orgA);
  };
}
