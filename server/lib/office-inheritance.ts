// Héritage des réglages d'un bureau source vers un bureau fraîchement créé.
//
// Un bureau = un org. Les tables de réglages sont scopées par org_id, donc
// un nouveau bureau démarre vide. Ce module copie, section par section, ce
// que le propriétaire a coché sur le formulaire « Nouveau bureau ».
//
// Les fonctions `map*` sont pures (source → lignes à insérer) pour être
// testables sans base ; `copyOfficeSettings` orchestre les lectures/écritures
// avec le client service (bypass RLS — le nouveau bureau vient d'être créé,
// la membership du créateur n'est pas encore dans son JWT).
//
// NON copié, volontairement :
//   - le catalogue produits/services : predefined_services est déjà partagé
//     entre les bureaux d'une compagnie (migration 20260910000000) ;
//   - les presets d'automatisation : seedés par ensureAutomationPresets (la
//     section « modèles » leur donne ensuite l'état et les messages de la source) ;
//   - les numéros de taxes, le numéro SMS et le compte de paiement : propres à
//     l'entité légale ou payants, la fiche de santé les signale ;
//   - les avis Google/Facebook : l'URL d'avis est propre à chaque adresse.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface InheritOptions {
  /** Logo, site web, devise, fuseau horaire, unité par défaut, industrie. */
  branding: boolean;
  /** tax_configs + tax_groups + tax_group_items + groupe par défaut. */
  taxes: boolean;
  /** Modèles de courriel (email_templates). */
  email_templates: boolean;
  /** Étiquettes de jobs et sources de leads. (pipeline_stages est déprécié.) */
  tags_sources: boolean;
  /**
   * Tout le reste de la configuration : rôles, modèles de facture / devis /
   * job / liste de vérification, champs personnalisés, rappels de paiement,
   * préférences de paiement et état + messages des automatisations.
   * Optionnel : les anciens appelants n'en parlent pas.
   */
  modeles?: boolean;
}

export const NO_INHERIT: InheritOptions = {
  branding: false,
  taxes: false,
  email_templates: false,
  tags_sources: false,
  modeles: false,
};

/** Colonnes jamais recopiées d'une ligne de modèle : identité et horodatage. */
const COLONNES_PROPRES_A_LA_LIGNE = new Set(['id', 'org_id', 'created_at', 'updated_at']);

/** Copie conforme d'une ligne de modèle vers un autre bureau (nouvel id, nouveau propriétaire). */
export function clonerLigne(r: Row, targetOrgId: string, createdBy: string, retirer: string[] = []): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) {
    if (COLONNES_PROPRES_A_LA_LIGNE.has(k) || retirer.includes(k)) continue;
    out[k] = v;
  }
  out.org_id = targetOrgId;
  if ('created_by' in r) out.created_by = createdBy;
  if ('updated_by' in r) out.updated_by = createdBy;
  return out;
}

/** Modèles « simples » : une ligne = un modèle, aucun lien vers une autre ligne du bureau. */
export const TABLES_MODELES: ReadonlyArray<{ table: string; actifs: string[] }> = [
  { table: 'invoice_templates', actifs: ['deleted_at', 'archived_at'] },
  { table: 'quote_templates', actifs: ['deleted_at'] },
  { table: 'job_templates', actifs: [] },
  { table: 'checklist_templates', actifs: [] },
];

/** Réglages à une ligne par bureau (clé primaire org_id). */
export const REGLAGES_UNIQUES = ['reminder_settings', 'payment_settings'] as const;

/** Champs d'une automatisation préréglée qui portent la configuration du bureau. */
export const CHAMPS_AUTOMATISATION = [
  'name', 'description', 'trigger_event', 'conditions', 'delay_seconds',
  'actions', 'steps', 'settings', 'is_active',
] as const;

/** Colonnes de company_settings portées par « identité & préférences ». */
export const BRANDING_COLUMNS = [
  'logo_url',
  'website',
  'currency',
  'timezone',
  'default_unit',
  'industry',
] as const;

type Row = Record<string, any>;

/** Ne garde que les colonnes d'identité renseignées (jamais de null écrasant). */
export function pickBranding(source: Row | null | undefined): Row {
  const out: Row = {};
  if (!source) return out;
  for (const col of BRANDING_COLUMNS) {
    const v = source[col];
    if (v !== null && v !== undefined && v !== '') out[col] = v;
  }
  return out;
}

export function mapTaxConfigs(rows: Row[], targetOrgId: string): Row[] {
  return rows.map((r) => ({
    org_id: targetOrgId,
    name: r.name,
    rate: r.rate,
    type: r.type,
    region: r.region ?? '',
    country: r.country ?? 'CA',
    is_compound: !!r.is_compound,
    is_active: r.is_active !== false,
    sort_order: r.sort_order ?? 0,
  }));
}

export function mapTaxGroups(rows: Row[], targetOrgId: string): Row[] {
  return rows.map((r) => ({
    org_id: targetOrgId,
    name: r.name,
    region: r.region ?? '',
    country: r.country ?? 'CA',
    is_default: !!r.is_default,
    is_active: r.is_active !== false,
  }));
}

/**
 * Remappe les liens groupe ↔ taxe vers les nouveaux ids. Un lien dont l'un
 * des deux côtés n'a pas été copié (taxe inactive filtrée, etc.) est ignoré
 * plutôt que de faire échouer toute la copie.
 */
export function mapTaxGroupItems(
  items: Row[],
  groupIdMap: Map<string, string>,
  configIdMap: Map<string, string>,
): Row[] {
  const out: Row[] = [];
  for (const it of items) {
    const g = groupIdMap.get(String(it.tax_group_id));
    const c = configIdMap.get(String(it.tax_config_id));
    if (!g || !c) continue;
    out.push({ tax_group_id: g, tax_config_id: c, sort_order: it.sort_order ?? 0 });
  }
  return out;
}

export function mapEmailTemplates(rows: Row[], targetOrgId: string, createdBy: string): Row[] {
  return rows.map((r) => ({
    org_id: targetOrgId,
    created_by: createdBy,
    name: r.name,
    type: r.type ?? 'generic',
    subject: r.subject ?? '',
    body: r.body ?? '',
    variables: r.variables ?? [],
    is_active: r.is_active !== false,
    is_default: !!r.is_default,
  }));
}

export function mapJobTags(rows: Row[], targetOrgId: string): Row[] {
  return rows
    .filter((r) => !r.deleted_at)
    .map((r) => ({ org_id: targetOrgId, name: r.name, color_hex: r.color_hex ?? '#b8c4b0' }));
}

export function mapLeadSources(rows: Row[], targetOrgId: string, createdBy: string): Row[] {
  return rows.map((r) => ({ org_id: targetOrgId, name: r.name, created_by: createdBy }));
}

/**
 * Taxes à recopier : celles reliées à une région (`items`), ou, si la source
 * n'a aucune région (`items` = null), ses taxes actives.
 */
export function filtrerTaxesACopier(configs: Row[], items: Row[] | null): Row[] {
  if (items === null) return configs.filter((c) => c.is_active !== false);
  const reliees = new Set(items.map((i) => String(i.tax_config_id)));
  return configs.filter((c) => reliees.has(String(c.id)));
}

/** Construit la map ancien id → nouvel id en alignant sur l'ordre d'insertion. */
export function zipIds(sourceRows: Row[], insertedRows: Row[]): Map<string, string> {
  const m = new Map<string, string>();
  const n = Math.min(sourceRows.length, insertedRows.length);
  for (let i = 0; i < n; i++) m.set(String(sourceRows[i].id), String(insertedRows[i].id));
  return m;
}

export interface CopyReport {
  branding: boolean;
  tax_configs: number;
  tax_groups: number;
  tax_group_items: number;
  email_templates: number;
  job_tags: number;
  lead_sources: number;
  /** Nombre de lignes copiées par table, section « modèles ». */
  modeles: Record<string, number>;
  warnings: string[];
}

export interface CopyOptions {
  /**
   * Bureau DÉJÀ en service (« Reprendre du bureau de base » dans la fiche de
   * santé) : on ne complète que ce qui est vide, on n'écrase jamais un réglage
   * du bureau. Les rôles ne sont copiés que si le bureau n'en a aucun ; les
   * automatisations ne sont pas touchées (déjà ajustées sur place).
   */
  seulementSiVide?: boolean;
}

/**
 * Copie les sections cochées de `sourceOrgId` vers `targetOrgId`. Chaque
 * section est best-effort et indépendante : un échec est consigné dans
 * `warnings` sans annuler les autres (le bureau existe déjà à ce stade).
 */
export async function copyOfficeSettings(
  admin: SupabaseClient,
  sourceOrgId: string,
  targetOrgId: string,
  createdBy: string,
  inherit: InheritOptions,
  options: CopyOptions = {},
): Promise<CopyReport> {
  const report: CopyReport = {
    branding: false,
    tax_configs: 0,
    tax_groups: 0,
    tax_group_items: 0,
    email_templates: 0,
    job_tags: 0,
    lead_sources: 0,
    modeles: {},
    warnings: [],
  };
  const seulementSiVide = options.seulementSiVide === true;
  const warn = (section: string, msg?: string) => {
    report.warnings.push(`${section}: ${msg || 'unknown error'}`);
  };

  // ── Identité & préférences ──
  if (inherit.branding) {
    try {
      const { data: src, error } = await admin
        .from('company_settings')
        .select('*')
        .eq('org_id', sourceOrgId)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const patch = pickBranding(src);
      if (Object.keys(patch).length > 0) {
        const { error: upErr } = await admin
          .from('company_settings')
          .update(patch)
          .eq('org_id', targetOrgId);
        if (upErr) throw new Error(upErr.message);
        // Miroir du logo sur orgs (seule colonne d'identité que `orgs` porte
        // en prod : name / employee_count / logo_url / company_group_id).
        if (patch.logo_url) {
          const { error: oErr } = await admin.from('orgs').update({ logo_url: patch.logo_url }).eq('id', targetOrgId);
          if (oErr) report.warnings.push(`branding(orgs.logo_url): ${oErr.message}`);
        }
        report.branding = true;
      }
    } catch (e: any) {
      warn('branding', e?.message);
    }
  }

  // ── Taxes ──
  if (inherit.taxes && seulementSiVide && (await compter(admin, 'tax_groups', targetOrgId)) > 0) {
    report.warnings.push('taxes: le bureau a déjà ses taxes, rien de copié');
  } else if (inherit.taxes) {
    try {
      const [{ data: configs, error: cErr }, { data: groups, error: gErr }] = await Promise.all([
        admin.from('tax_configs').select('*').eq('org_id', sourceOrgId).order('sort_order'),
        admin.from('tax_groups').select('*').eq('org_id', sourceOrgId).order('created_at'),
      ]);
      if (cErr) throw new Error(cErr.message);
      if (gErr) throw new Error(gErr.message);
      const srcGroups = groups || [];
      // Seulement les taxes rattachées à une région de la source : une taxe
      // orpheline (région supprimée) est invisible dans Réglages → Taxes, et la
      // recopier la ferait s'additionner chez la cible. Sans aucune région
      // (ancien bureau), les taxes actives restent la vérité.
      let srcItems: Row[] = [];
      if (srcGroups.length > 0) {
        const { data: it, error: itErr } = await admin.from('tax_group_items').select('*')
          .in('tax_group_id', srcGroups.map((g: Row) => g.id));
        if (itErr) throw new Error(itErr.message);
        srcItems = it || [];
      }
      const srcConfigs = filtrerTaxesACopier(configs || [], srcGroups.length > 0 ? srcItems : null);

      let configIdMap = new Map<string, string>();
      if (srcConfigs.length > 0) {
        const { data: ins, error } = await admin
          .from('tax_configs')
          .insert(mapTaxConfigs(srcConfigs, targetOrgId))
          .select('id');
        if (error) throw new Error(error.message);
        configIdMap = zipIds(srcConfigs, ins || []);
        report.tax_configs = ins?.length || 0;
      }

      let groupIdMap = new Map<string, string>();
      if (srcGroups.length > 0) {
        const { data: ins, error } = await admin
          .from('tax_groups')
          .insert(mapTaxGroups(srcGroups, targetOrgId))
          .select('id');
        if (error) throw new Error(error.message);
        groupIdMap = zipIds(srcGroups, ins || []);
        report.tax_groups = ins?.length || 0;

        const mapped = mapTaxGroupItems(srcItems, groupIdMap, configIdMap);
        if (mapped.length > 0) {
          const { error: miErr } = await admin.from('tax_group_items').insert(mapped);
          if (miErr) throw new Error(miErr.message);
          report.tax_group_items = mapped.length;
        }

        // Groupe par défaut du bureau source → son équivalent copié.
        const { data: srcSettings } = await admin
          .from('company_settings')
          .select('default_tax_group_id')
          .eq('org_id', sourceOrgId)
          .limit(1)
          .maybeSingle();
        const newDefault = srcSettings?.default_tax_group_id
          ? groupIdMap.get(String(srcSettings.default_tax_group_id))
          : null;
        if (newDefault) {
          await admin
            .from('company_settings')
            .update({ default_tax_group_id: newDefault })
            .eq('org_id', targetOrgId);
        }
      }
    } catch (e: any) {
      warn('taxes', e?.message);
    }
  }

  // ── Modèles de courriel ──
  if (inherit.email_templates) {
    try {
      const { data: rows, error } = await admin
        .from('email_templates')
        .select('*')
        .eq('org_id', sourceOrgId);
      if (error) throw new Error(error.message);
      const mapped = mapEmailTemplates(rows || [], targetOrgId, createdBy);
      if (mapped.length > 0) {
        const { error: insErr } = await admin.from('email_templates').insert(mapped);
        if (insErr) throw new Error(insErr.message);
        report.email_templates = mapped.length;
      }
    } catch (e: any) {
      warn('email_templates', e?.message);
    }
  }

  // ── Étiquettes et sources de leads ──
  if (inherit.tags_sources) {
    try {
      const { data: rows, error } = await admin
        .from('job_tags')
        .select('*')
        .eq('org_id', sourceOrgId)
        .is('deleted_at', null);
      if (error) throw new Error(error.message);
      const mapped = mapJobTags(rows || [], targetOrgId);
      if (mapped.length > 0) {
        const { error: insErr } = await admin.from('job_tags').insert(mapped);
        if (insErr) throw new Error(insErr.message);
        report.job_tags = mapped.length;
      }
    } catch (e: any) {
      warn('job_tags', e?.message);
    }
    try {
      const { data: rows, error } = await admin
        .from('lead_sources')
        .select('*')
        .eq('org_id', sourceOrgId);
      if (error) throw new Error(error.message);
      const mapped = mapLeadSources(rows || [], targetOrgId, createdBy);
      if (mapped.length > 0) {
        const { error: insErr } = await admin
          .from('lead_sources')
          .upsert(mapped, { onConflict: 'org_id,name', ignoreDuplicates: true });
        if (insErr) throw new Error(insErr.message);
        report.lead_sources = mapped.length;
      }
    } catch (e: any) {
      warn('lead_sources', e?.message);
    }
  }

  // ── Modèles, rôles, champs personnalisés, rappels, automatisations ──
  if (inherit.modeles) await copierModeles(admin, sourceOrgId, targetOrgId, createdBy, seulementSiVide, report, warn);

  return report;
}

async function compter(admin: SupabaseClient, table: string, orgId: string): Promise<number> {
  const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true }).eq('org_id', orgId);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function lireActifs(admin: SupabaseClient, table: string, orgId: string, actifs: string[]): Promise<Row[]> {
  let q = admin.from(table).select('*').eq('org_id', orgId);
  for (const col of actifs) q = q.is(col, null);
  const { data, error } = await q.order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function copierModeles(
  admin: SupabaseClient,
  sourceOrgId: string,
  targetOrgId: string,
  createdBy: string,
  seulementSiVide: boolean,
  report: CopyReport,
  warn: (section: string, msg?: string) => void,
): Promise<void> {
  // Rôles : le préréglage de chaque rôle (permissions, portée) du bureau de base.
  // En reprise, seulement si le bureau n'a encore aucun rôle réglé.
  if (!seulementSiVide || (await compter(admin, 'role_templates', targetOrgId).catch(() => 1)) === 0) {
    try {
      const { data: roles, error } = await admin.from('role_templates').select('*').eq('org_id', sourceOrgId);
      if (error) throw new Error(error.message);
      if (roles?.length) {
        const { error: e } = await admin.from('role_templates')
          .upsert(roles.map((r: Row) => clonerLigne(r, targetOrgId, createdBy)), { onConflict: 'org_id,slug' });
        if (e) throw new Error(e.message);
        report.modeles.role_templates = roles.length;
      }
    } catch (e: any) { warn('role_templates', e?.message); }
  }

  for (const { table, actifs } of TABLES_MODELES) {
    try {
      if (seulementSiVide && (await compter(admin, table, targetOrgId)) > 0) continue;
      const rows = await lireActifs(admin, table, sourceOrgId, actifs);
      if (rows.length === 0) continue;
      const { error } = await admin.from(table).insert(rows.map((r) => clonerLigne(r, targetOrgId, createdBy)));
      if (error) throw new Error(error.message);
      report.modeles[table] = rows.length;
    } catch (e: any) { warn(table, e?.message); }
  }

  for (const table of REGLAGES_UNIQUES) {
    try {
      const { data: r, error } = await admin.from(table).select('*').eq('org_id', sourceOrgId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!r) continue;
      const { error: e } = await admin.from(table)
        .upsert(clonerLigne(r, targetOrgId, createdBy), { onConflict: 'org_id', ignoreDuplicates: seulementSiVide });
      if (e) throw new Error(e.message);
      report.modeles[table] = 1;
    } catch (e: any) { warn(table, e?.message); }
  }

  // Champs personnalisés : dossiers → champs → options, ids remappés.
  try {
    if (!seulementSiVide || (await compter(admin, 'custom_fields', targetOrgId)) === 0) {
      const dossiers = await lireActifs(admin, 'custom_field_folders', sourceOrgId, []);
      const champs = await lireActifs(admin, 'custom_fields', sourceOrgId, ['archived_at']);
      if (champs.length > 0) {
        let dossierIds = new Map<string, string>();
        if (dossiers.length > 0) {
          const { data: ins, error } = await admin.from('custom_field_folders')
            .insert(dossiers.map((d) => clonerLigne(d, targetOrgId, createdBy))).select('id');
          if (error) throw new Error(error.message);
          dossierIds = zipIds(dossiers, ins || []);
        }
        const { data: insChamps, error: eChamps } = await admin.from('custom_fields')
          .insert(champs.map((c) => ({
            ...clonerLigne(c, targetOrgId, createdBy, ['legacy_column_id']),
            folder_id: c.folder_id ? dossierIds.get(String(c.folder_id)) ?? null : null,
          })))
          .select('id');
        if (eChamps) throw new Error(eChamps.message);
        const champIds = zipIds(champs, insChamps || []);
        report.modeles.custom_fields = insChamps?.length || 0;

        const { data: opts, error: eOpts } = await admin.from('custom_field_options').select('*')
          .in('field_id', champs.map((c) => c.id)).is('archived_at', null).order('position');
        if (eOpts) throw new Error(eOpts.message);
        const mapped = (opts || [])
          .filter((o: Row) => champIds.has(String(o.field_id)))
          .map((o: Row) => ({ ...clonerLigne(o, targetOrgId, createdBy), field_id: champIds.get(String(o.field_id)) }));
        if (mapped.length > 0) {
          const { error } = await admin.from('custom_field_options').insert(mapped);
          if (error) throw new Error(error.message);
          report.modeles.custom_field_options = mapped.length;
        }
      }
    }
  } catch (e: any) { warn('custom_fields', e?.message); }

  // Automatisations : les préréglages existent déjà dans le nouveau bureau
  // (ensureAutomationPresets) ; on leur donne l'état et les messages du bureau
  // de base. Les automatisations créées à la main suivent, sauf celles liées
  // à un pipeline (les pipelines sont propres à chaque bureau).
  if (!seulementSiVide) {
    try {
      const { data: regles, error } = await admin.from('automation_rules').select('*').eq('org_id', sourceOrgId);
      if (error) throw new Error(error.message);
      let n = 0;
      for (const r of (regles || []).filter((x: Row) => x.is_preset && x.preset_key)) {
        const patch: Row = {};
        for (const k of CHAMPS_AUTOMATISATION) patch[k] = r[k];
        const { error: e } = await admin.from('automation_rules').update(patch)
          .eq('org_id', targetOrgId).eq('preset_key', r.preset_key);
        if (e) throw new Error(e.message);
        n++;
      }
      const perso = (regles || []).filter((x: Row) => !x.is_preset && !x.pipeline_id && !x.stage_id);
      if (perso.length > 0) {
        const { error: e } = await admin.from('automation_rules')
          .insert(perso.map((r: Row) => clonerLigne(r, targetOrgId, createdBy)));
        if (e) throw new Error(e.message);
        n += perso.length;
      }
      report.modeles.automation_rules = n;
    } catch (e: any) { warn('automation_rules', e?.message); }
  }
}
