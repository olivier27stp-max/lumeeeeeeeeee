/**
 * Copier une automatisation vers les autres bureaux de l'entreprise.
 *
 * Les textes (courriel, texto), les étiquettes (par nom) et l'expéditeur
 * (résolu au bureau à l'exécution) se copient tels quels. Ce qui pointe vers
 * une ligne d'UN bureau (UUID) est retrouvé dans le bureau cible par son nom :
 *   pipeline_id → pipeline de même nom ; stage_id → étape de même nom dans ce pipeline ;
 *   field_id / champ_id → champ personnalisé de même clé (et même objet) ; option → même libellé ;
 *   rule_id → automatisation de même nom ; membre_id → gardé si la personne est membre du bureau cible.
 * Ce qui n'a pas d'équivalent est vidé, et la copie reste en BROUILLON (inactive)
 * avec la liste de ce qui est à revoir : jamais une règle active qui échouerait en silence.
 *
 * Un préréglage (preset_key) n'est pas dupliqué : son contenu remplace celui du
 * préréglage de même clé du bureau cible (le seeder ne l'écrase jamais).
 * Chaque bureau est lu et écrit avec l'identité de la personne et l'en-tête de
 * CE bureau (RLS), après vérification de automations.update dans ce bureau.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildSupabaseWithAuth, getServiceClient } from './supabase';
import { getUserContext, hasPermission } from './rbac';
import { bureauxMemeEntreprise } from './boite-unifiee';
import { logger } from './logger';

export interface Correspondances {
  pipelines: Map<string, string>;
  etapes: Map<string, string>;
  champs: Map<string, string>;
  options: Map<string, string>;
  regles: Map<string, string>;
  membres: Set<string>;
}

const CLES: Record<string, keyof Omit<Correspondances, 'membres'> | 'membres'> = {
  pipeline_id: 'pipelines',
  stage_id: 'etapes',
  field_id: 'champs',
  champ_id: 'champs',
  rule_id: 'regles',
  membre_id: 'membres',
};
const LIBELLES: Record<string, string> = {
  pipelines: 'pipeline', etapes: 'étape du pipeline', champs: 'champ personnalisé',
  regles: 'automatisation à démarrer', membres: 'personne assignée', options: 'option de champ',
};

/**
 * Pur : remplace chaque référence d'un bureau par son équivalent dans le bureau cible.
 * Parcourt tout le JSON (actions, étapes, conditions) : les mêmes clés y reviennent partout.
 */
export function remapper<T>(valeur: T, c: Correspondances, manquants: Set<string>): T {
  const marcher = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(marcher);
    if (!v || typeof v !== 'object') return v;
    const sortie: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const table = CLES[k];
      if (table && typeof x === 'string' && x) {
        if (table === 'membres') {
          if (c.membres.has(x)) sortie[k] = x;
          else { sortie[k] = null; manquants.add(LIBELLES.membres); }
        } else {
          const cible = c[table].get(x);
          if (cible) sortie[k] = cible;
          else { sortie[k] = null; manquants.add(LIBELLES[table]); }
        }
      } else if ((k === 'value' || k === 'value2') && typeof x === 'string' && c.options.has(x)) {
        sortie[k] = c.options.get(x);
      } else if ((k === 'value' || k === 'value2') && Array.isArray(x)) {
        sortie[k] = x.map((o) => (typeof o === 'string' && c.options.has(o) ? c.options.get(o) : o));
      } else {
        sortie[k] = marcher(x);
      }
    }
    return sortie;
  };
  return marcher(valeur) as T;
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** Construit les correspondances source → cible, en lisant chaque bureau avec SON client. */
export async function correspondances(source: SupabaseClient, orgSource: string, cible: SupabaseClient, orgCible: string): Promise<Correspondances> {
  const lire = async (client: SupabaseClient, org: string) => {
    const [p, e, ch, op, r, m] = await Promise.all([
      client.from('pipelines_ventes').select('id, name').eq('org_id', org),
      client.from('pipeline_stages').select('id, pipeline_id, name_fr, name_en').eq('org_id', org).is('archived_at', null),
      client.from('custom_fields').select('id, object_type, key').eq('org_id', org).is('archived_at', null),
      client.from('custom_field_options').select('id, field_id, label').eq('org_id', org).is('archived_at', null),
      client.from('automation_rules').select('id, name').eq('org_id', org).is('deleted_at', null),
      client.from('memberships').select('user_id').eq('org_id', org).eq('status', 'active'),
    ]);
    for (const x of [p, e, ch, op, r, m]) if (x.error) throw x.error;
    return { pipelines: p.data || [], etapes: e.data || [], champs: ch.data || [], options: op.data || [], regles: r.data || [], membres: m.data || [] };
  };
  const [s, t] = await Promise.all([lire(source, orgSource), lire(cible, orgCible)]);

  const pipelines = new Map<string, string>();
  for (const a of s.pipelines) { const b = t.pipelines.find((x: any) => norm(x.name) === norm(a.name)); if (b) pipelines.set(a.id, b.id); }
  const etapes = new Map<string, string>();
  for (const a of s.etapes) {
    const pipe = pipelines.get(a.pipeline_id);
    const b = t.etapes.find((x: any) => x.pipeline_id === pipe && (norm(x.name_fr) === norm(a.name_fr) || norm(x.name_en) === norm(a.name_en)));
    if (b) etapes.set(a.id, b.id);
  }
  const champs = new Map<string, string>();
  for (const a of s.champs) { const b = t.champs.find((x: any) => x.object_type === a.object_type && x.key === a.key); if (b) champs.set(a.id, b.id); }
  const options = new Map<string, string>();
  for (const a of s.options) {
    const champ = champs.get(a.field_id);
    const b = t.options.find((x: any) => x.field_id === champ && norm(x.label) === norm(a.label));
    if (b) options.set(a.id, b.id);
  }
  const regles = new Map<string, string>();
  for (const a of s.regles) { const b = t.regles.find((x: any) => norm(x.name) === norm(a.name)); if (b) regles.set(a.id, b.id); }
  return { pipelines, etapes, champs, options, regles, membres: new Set(t.membres.map((x: any) => String(x.user_id))) };
}

export interface BureauCible { org_id: string; name: string }

/** Bureaux de la même entreprise (hors bureau actif) où la personne a automations.update. */
export async function bureauxCibles(userId: string, orgActif: string): Promise<BureauCible[]> {
  const admin = getServiceClient();
  const { data: actif, error: eActif } = await admin.from('orgs').select('company_group_id').eq('id', orgActif).maybeSingle();
  if (eActif) throw eActif;
  const { data: adhesions, error } = await admin
    .from('memberships')
    .select('org_id, orgs!inner(id, name, created_at, deleted_at, archived_at, company_group_id)')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (error) throw error;
  const candidats = bureauxMemeEntreprise(orgActif, actif?.company_group_id ?? null, (adhesions || []).map((a: any) => a.orgs).filter(Boolean))
    .filter((o) => o.id !== orgActif);
  const permis: typeof candidats = [];
  for (const o of candidats) {
    const ctx = await getUserContext(admin, userId, o.id);
    if (ctx && hasPermission(ctx, 'automations.update')) permis.push(o);
  }
  if (!permis.length) return [];
  const { data: reglages } = await admin.from('company_settings').select('org_id, company_name').in('org_id', permis.map((o) => o.id));
  const nom = new Map((reglages || []).filter((r: any) => r.company_name).map((r: any) => [String(r.org_id), String(r.company_name)]));
  return permis.map((o) => ({ org_id: o.id, name: nom.get(o.id) || String(o.name || '') }));
}

export interface ResultatCopie {
  org_id: string;
  name: string;
  statut: 'copiee' | 'mise_a_jour' | 'preset_mis_a_jour' | 'existe_deja' | 'sans_droit' | 'echec';
  active?: boolean;
  a_revoir?: string[];
  rule_id?: string;
  erreur?: string;
}

const CHAMPS_REGLE = 'id, name, description, trigger_event, conditions, delay_seconds, actions, steps, settings, is_active, is_preset, preset_key, pipeline_id, stage_id';

type Regle = {
  id: string; name: string; description: string | null; trigger_event: string; conditions: unknown; delay_seconds: number;
  actions: unknown; steps: unknown; settings: unknown; is_active: boolean; is_preset: boolean; preset_key: string | null;
  pipeline_id: string | null; stage_id: string | null;
};

/** Contenu de la règle, références retrouvées dans le bureau cible (ce qui manque est noté). */
function contenuPour(regle: Regle, c: Correspondances, manquants: Set<string>) {
  return {
    name: regle.name,
    description: regle.description ?? '',
    trigger_event: regle.trigger_event,
    conditions: remapper(regle.conditions ?? {}, c, manquants),
    delay_seconds: regle.delay_seconds,
    actions: remapper(regle.actions ?? [], c, manquants),
    steps: regle.steps ? remapper(regle.steps, c, manquants) : null,
    settings: regle.settings ?? null,
    pipeline_id: remapper({ pipeline_id: regle.pipeline_id }, c, manquants).pipeline_id ?? null,
    stage_id: remapper({ stage_id: regle.stage_id }, c, manquants).stage_id ?? null,
  };
}

async function lireRegle(client: SupabaseClient, org: string, ruleId: string): Promise<Regle | null> {
  const { data, error } = await client.from('automation_rules').select(CHAMPS_REGLE)
    .eq('id', ruleId).eq('org_id', org).is('deleted_at', null).maybeSingle();
  if (error) throw error;
  return (data as Regle | null) ?? null;
}

const messageErreur = (e: any) => (e?.code === '42501' ? 'Votre rôle ne permet pas de modifier les automatisations de ce bureau.' : 'Copie impossible.');

/**
 * Copie la règle vers chaque bureau demandé. `lier` : la copie suit le modèle
 * (modele_id) — une règle de même nom et même déclencheur déjà présente est
 * alors mise à jour et liée plutôt que dupliquée.
 */
export async function copierVersBureaux(
  authorization: string, userId: string, orgSource: string, ruleId: string, orgIds: string[], lier = true,
): Promise<ResultatCopie[] | null> {
  const source = buildSupabaseWithAuth(authorization, orgSource);
  const regle = await lireRegle(source, orgSource, ruleId);
  if (!regle) return null;

  const permis = new Map((await bureauxCibles(userId, orgSource)).map((b) => [b.org_id, b.name]));
  const resultats: ResultatCopie[] = [];
  for (const org of [...new Set(orgIds)]) {
    const name = permis.get(org);
    if (!name) { resultats.push({ org_id: org, name: '', statut: 'sans_droit', erreur: 'Bureau hors de votre entreprise ou sans droit sur les automatisations.' }); continue; }
    try {
      const cible = buildSupabaseWithAuth(authorization, org);
      const manquants = new Set<string>();
      const contenu = contenuPour(regle, await correspondances(source, orgSource, cible, org), manquants);
      const a_revoir = [...manquants];
      const active = !!regle.is_active && a_revoir.length === 0;
      const lien = lier ? { modele_id: regle.id } : {};

      // Déjà présente dans le bureau cible : préréglage de même clé, ou règle de même nom et même déclencheur.
      const { data: existante, error: eEx } = regle.preset_key
        ? await cible.from('automation_rules').select('id').eq('org_id', org).eq('preset_key', regle.preset_key).is('deleted_at', null).limit(1)
        : await cible.from('automation_rules').select('id').eq('org_id', org).eq('trigger_event', regle.trigger_event).is('deleted_at', null)
          .ilike('name', regle.name.replace(/[%_\\]/g, '\\$&')).limit(1);
      if (eEx) throw eEx;
      if (existante && existante.length) {
        if (!regle.preset_key && !lier) { resultats.push({ org_id: org, name, statut: 'existe_deja', rule_id: existante[0].id }); continue; }
        const { error: eMaj } = await cible.from('automation_rules')
          .update({ ...contenu, ...lien, is_active: active, updated_at: new Date().toISOString() })
          .eq('id', existante[0].id).eq('org_id', org);
        if (eMaj) throw eMaj;
        resultats.push({ org_id: org, name, statut: regle.preset_key ? 'preset_mis_a_jour' : 'mise_a_jour', active, a_revoir, rule_id: existante[0].id });
        continue;
      }
      const { data: cree, error: eIns } = await cible.from('automation_rules')
        .insert({ ...contenu, ...lien, org_id: org, is_active: active, is_preset: false, preset_key: null })
        .select('id').single();
      if (eIns) throw eIns;
      resultats.push({ org_id: org, name, statut: 'copiee', active, a_revoir, rule_id: cree.id });
    } catch (e: any) {
      logger.error('[automatisations-bureaux] copie échouée', { rule_id: ruleId, org_cible: org, code: e?.code, message: e?.message });
      resultats.push({ org_id: org, name, statut: 'echec', erreur: messageErreur(e) });
    }
  }
  return resultats;
}

/**
 * Le modèle vient d'être modifié : ses copies liées (autres bureaux) reçoivent
 * le nouveau contenu, références retrouvées dans chaque bureau. L'état
 * actif/inactif de chaque copie est gardé, sauf si une référence manque : la
 * copie repasse alors en brouillon plutôt que d'échouer en silence.
 * Un bureau où la personne n'a pas automations.update n'est pas touché.
 */
export async function propagerAuxCopies(
  authorization: string, userId: string, orgSource: string, ruleId: string,
): Promise<ResultatCopie[]> {
  const admin = getServiceClient();
  const { data: copies, error } = await admin.from('automation_rules').select('id, org_id, is_active')
    .eq('modele_id', ruleId).is('deleted_at', null);
  if (error) throw error;
  if (!copies || !copies.length) return [];

  const source = buildSupabaseWithAuth(authorization, orgSource);
  const regle = await lireRegle(source, orgSource, ruleId);
  if (!regle) return [];
  const permis = new Map((await bureauxCibles(userId, orgSource)).map((b) => [b.org_id, b.name]));
  const resultats: ResultatCopie[] = [];
  for (const copie of copies) {
    const org = String(copie.org_id);
    const name = permis.get(org);
    if (!name) { resultats.push({ org_id: org, name: '', statut: 'sans_droit', rule_id: copie.id }); continue; }
    try {
      const cible = buildSupabaseWithAuth(authorization, org);
      const manquants = new Set<string>();
      const contenu = contenuPour(regle, await correspondances(source, orgSource, cible, org), manquants);
      const a_revoir = [...manquants];
      const active = !!copie.is_active && a_revoir.length === 0;
      const { error: eMaj } = await cible.from('automation_rules')
        .update({ ...contenu, is_active: active, updated_at: new Date().toISOString() })
        .eq('id', copie.id).eq('org_id', org).eq('modele_id', ruleId);
      if (eMaj) throw eMaj;
      resultats.push({ org_id: org, name, statut: 'mise_a_jour', active, a_revoir, rule_id: copie.id });
    } catch (e: any) {
      logger.error('[automatisations-bureaux] propagation échouée', { rule_id: ruleId, copie: copie.id, code: e?.code, message: e?.message });
      resultats.push({ org_id: org, name, statut: 'echec', erreur: messageErreur(e), rule_id: copie.id });
    }
  }
  return resultats;
}
