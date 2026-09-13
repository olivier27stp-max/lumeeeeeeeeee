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
//   - les presets d'automatisation : seedés par ensureAutomationPresets ;
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
}

export const NO_INHERIT: InheritOptions = {
  branding: false,
  taxes: false,
  email_templates: false,
  tags_sources: false,
};

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
  warnings: string[];
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
): Promise<CopyReport> {
  const report: CopyReport = {
    branding: false,
    tax_configs: 0,
    tax_groups: 0,
    tax_group_items: 0,
    email_templates: 0,
    job_tags: 0,
    lead_sources: 0,
    warnings: [],
  };
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
        // Miroir sur orgs pour le logo et la devise (lus par certains écrans).
        const orgPatch: Row = {};
        if (patch.logo_url) orgPatch.logo_url = patch.logo_url;
        if (patch.currency) orgPatch.currency = patch.currency;
        if (patch.industry) orgPatch.industry = patch.industry;
        if (Object.keys(orgPatch).length > 0) {
          await admin.from('orgs').update(orgPatch).eq('id', targetOrgId);
        }
        report.branding = true;
      }
    } catch (e: any) {
      warn('branding', e?.message);
    }
  }

  // ── Taxes ──
  if (inherit.taxes) {
    try {
      const [{ data: configs, error: cErr }, { data: groups, error: gErr }] = await Promise.all([
        admin.from('tax_configs').select('*').eq('org_id', sourceOrgId).order('sort_order'),
        admin.from('tax_groups').select('*').eq('org_id', sourceOrgId).order('created_at'),
      ]);
      if (cErr) throw new Error(cErr.message);
      if (gErr) throw new Error(gErr.message);
      const srcConfigs = configs || [];
      const srcGroups = groups || [];

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

        const { data: items, error: iErr } = await admin
          .from('tax_group_items')
          .select('*')
          .in('tax_group_id', srcGroups.map((g: Row) => g.id));
        if (iErr) throw new Error(iErr.message);
        const mapped = mapTaxGroupItems(items || [], groupIdMap, configIdMap);
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

  return report;
}
