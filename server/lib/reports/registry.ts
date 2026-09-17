/**
 * Registre des rapports : la liste ordonnée par catégorie et la vue publique
 * d'une définition (options de filtres résolues pour l'org).
 */
import type { ReportContext, ReportDefinition, ReportDefinitionPublic } from './types';
import { resolveFilterSource } from './lookups';
import { FINANCE_REPORTS } from './definitions/finances';
import { OPERATIONS_REPORTS } from './definitions/operations';
import { TEAM_REPORTS } from './definitions/team';
import { CLIENT_REPORTS } from './definitions/clients';
import { FIELD_REPORTS } from './definitions/field';

const ALL: ReportDefinition[] = [
  ...FINANCE_REPORTS,
  ...OPERATIONS_REPORTS,
  ...TEAM_REPORTS,
  ...CLIENT_REPORTS,
  ...FIELD_REPORTS,
];

const BY_ID = new Map<string, ReportDefinition>();
for (const def of ALL) {
  if (BY_ID.has(def.id)) throw new Error(`Rapport en double : ${def.id}`);
  BY_ID.set(def.id, def);
}

export function listReports(): ReportDefinition[] {
  return ALL;
}

export function getReport(id: string): ReportDefinition | undefined {
  return BY_ID.get(id);
}

export async function publicDefinition(def: ReportDefinition, ctx: ReportContext): Promise<ReportDefinitionPublic> {
  const filters = [];
  for (const f of def.filters) {
    if (f.type === 'select' && f.source) {
      const resolved = await resolveFilterSource(ctx, f.source);
      filters.push({ ...f, options: resolved.map((o) => ({ value: o.value, label: { fr: o.label, en: o.label } })) });
    } else {
      filters.push({ ...f, options: f.options || [] });
    }
  }
  return {
    id: def.id,
    category: def.category,
    title: def.title,
    description: def.description,
    columns: def.columns,
    filters,
    dateFilter: def.dateFilter || null,
    defaultSort: def.defaultSort,
    link: def.link || null,
  };
}
