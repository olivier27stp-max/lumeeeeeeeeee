/**
 * En-tête d'un export de rapport (Excel, PDF) : entreprise, titre, période,
 * filtres appliqués en clair, auteur et horodatage.
 *
 * Le fichier doit pouvoir être lu seul, des semaines plus tard, par
 * quelqu'un qui n'a pas vu l'écran : on y écrit donc ce qui a été demandé
 * (période, filtres avec leurs libellés résolus), pas seulement les lignes.
 */
import { FUSEAU_PAR_DEFAUT } from '../date-seule';
import type { Lang, ReportContext, ReportDefinition, ReportQuery } from './types';
import { publicDefinition } from './registry';
import { lookupMembers } from './lookups';
import { DATE_ONLY_RE } from './dates';

export interface ExportFilterLine {
  label: string;
  value: string;
}

export interface ExportMeta {
  reportId: string;
  title: string;
  description: string;
  company: string;
  /** Période en clair (« Du 1 juin 2026 au 30 juin 2026 », « Toute la période »…). */
  period: string;
  periodFrom: string | null;
  periodTo: string | null;
  /** Colonne de date sur laquelle porte la période, si le rapport en propose plusieurs. */
  dateField: string | null;
  filters: ExportFilterLine[];
  generatedAt: string;
  generatedAtLabel: string;
  generatedBy: string;
  lang: Lang;
  rowCount: number;
}

function locale(lang: Lang): string {
  return lang === 'fr' ? 'fr-CA' : 'en-CA';
}

/** « 30 juin 2026 » / « Jun 30, 2026 » à partir d'une date seule. */
export function formatDateOnly(ymd: string, lang: Lang): string {
  if (!DATE_ONLY_RE.test(ymd)) return ymd;
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat(locale(lang), { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** « 25 sept. 2026, 14:32 » dans le fuseau de l'org. */
export function formatGeneratedAt(at: Date, lang: Lang, tz: string = FUSEAU_PAR_DEFAUT): string {
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: tz, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(at);
}

export function periodLabel(from: string | undefined, to: string | undefined, lang: Lang): string {
  const fr = lang === 'fr';
  if (from && to) return fr ? `Du ${formatDateOnly(from, lang)} au ${formatDateOnly(to, lang)}` : `${formatDateOnly(from, lang)} to ${formatDateOnly(to, lang)}`;
  if (from) return fr ? `Depuis le ${formatDateOnly(from, lang)}` : `From ${formatDateOnly(from, lang)}`;
  if (to) return fr ? `Jusqu'au ${formatDateOnly(to, lang)}` : `Up to ${formatDateOnly(to, lang)}`;
  return fr ? 'Toute la période' : 'All time';
}

/**
 * Filtres actifs en clair. Les listes (« select ») sont traduites via leurs
 * options — résolues pour l'org quand elles viennent d'une source dynamique
 * (membres, équipes, tags). Un filtre à « all » ou vide n'apparaît pas.
 */
export async function describeFilters(def: ReportDefinition, ctx: ReportContext, q: ReportQuery): Promise<ExportFilterLine[]> {
  const out: ExportFilterLine[] = [];
  if (!def.filters.length) return out;
  const pub = await publicDefinition(def, ctx);
  for (const f of pub.filters) {
    const raw = q.filters[f.key];
    if (!raw || raw === 'all') continue;
    const opt = f.type === 'select' ? f.options.find((o) => o.value === raw) : undefined;
    out.push({ label: f.label[ctx.lang], value: opt ? opt.label[ctx.lang] : raw });
  }
  if (def.dateFilter?.fields && def.dateFilter.fields.length > 1) {
    const chosen = def.dateFilter.fields.find((f) => f.value === q.dateField) || def.dateFilter.fields[0];
    if (chosen && (q.from || q.to)) out.unshift({ label: ctx.lang === 'fr' ? 'Date de référence' : 'Date column', value: chosen.label[ctx.lang] });
  }
  return out;
}

export async function buildExportMeta(def: ReportDefinition, ctx: ReportContext, q: ReportQuery, rowCount: number, now: Date = new Date()): Promise<ExportMeta> {
  const [company, members, filters] = await Promise.all([
    ctx.service.from('company_settings').select('company_name').eq('org_id', ctx.orgId).limit(1).maybeSingle(),
    lookupMembers(ctx.service, ctx.orgId, [ctx.userId]),
    describeFilters(def, ctx, q),
  ]);
  return {
    reportId: def.id,
    title: def.title[ctx.lang],
    description: def.description[ctx.lang],
    company: String((company.data as any)?.company_name || '').trim(),
    period: periodLabel(q.from, q.to, ctx.lang),
    periodFrom: q.from || null,
    periodTo: q.to || null,
    dateField: q.dateField || null,
    filters,
    generatedAt: now.toISOString(),
    generatedAtLabel: formatGeneratedAt(now, ctx.lang),
    generatedBy: members.get(ctx.userId) || '',
    lang: ctx.lang,
    rowCount,
  };
}
