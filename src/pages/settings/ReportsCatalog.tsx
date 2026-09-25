import React, { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Landmark, Wrench, Users, Contact, MapPinned, ExternalLink, Search, ArrowRight, FileSpreadsheet, FileText, FileType } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { fetchReportCatalogue, type ReportCategory, type ReportSummary } from '../../lib/reportsApi';

const CATEGORY_ICON: Record<ReportCategory, React.ComponentType<{ size?: number; className?: string }>> = {
  finances: Landmark,
  operations: Wrench,
  team: Users,
  clients: Contact,
  field: MapPinned,
};

const CATEGORY_BLURB: Record<ReportCategory, { fr: string; en: string }> = {
  finances: { fr: 'Facturation, encaissements, soldes et taxes.', en: 'Invoicing, collections, balances and taxes.' },
  operations: { fr: 'Jobs, visites et devis, avec leur statut.', en: 'Jobs, visits and quotes, with their status.' },
  team: { fr: 'Ventes, commissions, heures et paie.', en: 'Sales, commissions, hours and payroll.' },
  clients: { fr: 'Fichier client complet.', en: 'Your complete client file.' },
  field: { fr: 'Pipeline et activité porte-à-porte.', en: 'Pipeline and door-to-door activity.' },
};

/**
 * Réglages → Rapports : catalogue par catégorie. Chaque carte ouvre le
 * tableau du rapport (ou une page existante pour les rapports « lien »).
 */
export default function ReportsCatalog() {
  const { language } = useTranslation();
  const lang = language === 'fr' ? 'fr' : 'en';
  const fr = lang === 'fr';
  const [query, setQuery] = useState('');
  const searchId = useId();

  const catalogueQ = useQuery({
    queryKey: ['reports-catalogue', lang],
    queryFn: () => fetchReportCatalogue(lang),
    staleTime: 5 * 60_000,
  });

  const grouped = useMemo(() => {
    const data = catalogueQ.data;
    if (!data) return [];
    const term = query.trim().toLowerCase();
    return data.categories
      .map((cat) => ({
        ...cat,
        reports: data.reports.filter((r) => r.category === cat.key && (!term || `${r.title[lang]} ${r.description[lang]}`.toLowerCase().includes(term))),
      }))
      .filter((cat) => cat.reports.length > 0);
  }, [catalogueQ.data, query, lang]);

  const totalReports = catalogueQ.data?.reports?.length ?? 0;

  return (
    <div className="max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-surface-secondary flex items-center justify-center shrink-0">
            <BarChart3 size={22} className="text-text-tertiary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-text-primary">{fr ? 'Rapports' : 'Reports'}</h1>
            <p className="text-sm text-text-tertiary">
              {fr
                ? 'Filtre, trie, puis exporte en Excel, PDF ou CSV — le fichier reprend exactement ce qui est affiché.'
                : 'Filter, sort, then export to Excel, PDF or CSV — the file matches exactly what is on screen.'}
            </p>
          </div>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
          <input
            id={searchId}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={fr ? 'Chercher un rapport…' : 'Search reports…'}
            aria-label={fr ? 'Chercher un rapport' : 'Search reports'}
            className="h-9 w-[240px] pl-8 pr-3 text-[13px] bg-surface-card border border-outline rounded-md text-text-primary placeholder:text-text-tertiary focus-visible:ring-1 focus-visible:ring-[#94a3b8] focus-visible:border-[#94a3b8]"
          />
        </div>
      </div>

      {catalogueQ.data && !query && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-6 px-4 py-3 rounded-xl border border-outline bg-surface-card text-[12.5px] text-text-secondary">
          <span className="font-medium text-text-primary">
            {fr ? `${totalReports} rapports disponibles` : `${totalReports} reports available`}
          </span>
          <span className="inline-flex items-center gap-1.5"><FileSpreadsheet size={14} className="text-text-tertiary" /> {fr ? 'Excel mis en forme, totaux en formules' : 'Formatted Excel with formula totals'}</span>
          <span className="inline-flex items-center gap-1.5"><FileText size={14} className="text-text-tertiary" /> {fr ? 'PDF avec votre logo, prêt à envoyer' : 'PDF with your logo, ready to send'}</span>
          <span className="inline-flex items-center gap-1.5"><FileType size={14} className="text-text-tertiary" /> {fr ? 'CSV pour votre comptable' : 'CSV for your accountant'}</span>
        </div>
      )}

      {catalogueQ.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-28 rounded-2xl bg-surface-secondary animate-pulse" />)}
        </div>
      )}

      {catalogueQ.isError && (
        <div className="rounded-2xl border border-outline bg-surface-card p-6 text-sm text-text-secondary">
          {fr ? 'Impossible de charger les rapports.' : 'Could not load reports.'} {(catalogueQ.error as Error)?.message}
        </div>
      )}

      {!catalogueQ.isLoading && !catalogueQ.isError && grouped.length === 0 && (
        <div className="rounded-2xl border border-outline bg-surface-card p-6 text-sm text-text-secondary">
          {query ? (fr ? 'Aucun rapport ne correspond.' : 'No report matches.') : (fr ? 'Aucun rapport disponible pour ton rôle.' : 'No report available for your role.')}
        </div>
      )}

      <div className="space-y-8">
        {grouped.map((cat) => {
          const Icon = CATEGORY_ICON[cat.key] || BarChart3;
          return (
            <section key={cat.key}>
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-lg bg-surface-secondary flex items-center justify-center shrink-0">
                  <Icon size={15} className="text-text-secondary" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-[16px] font-semibold text-text-primary tracking-tight leading-tight">
                    {cat.label[lang]}
                    <span className="ml-2 text-[12px] font-normal text-text-tertiary tabular-nums">{cat.reports.length}</span>
                  </h2>
                  <p className="text-[12px] text-text-tertiary">{CATEGORY_BLURB[cat.key]?.[lang]}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {cat.reports.map((r) => <ReportCard key={r.id} report={r} lang={lang} />)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ReportCard({ report, lang }: { report: ReportSummary; lang: 'fr' | 'en' }) {
  const to = report.link || `/settings/reports/${report.id}`;
  const fr = lang === 'fr';
  return (
    <Link
      to={to}
      className="group rounded-2xl border border-outline bg-surface-card p-5 flex flex-col gap-1.5 hover:border-outline-strong hover:shadow-card-hover transition-all focus-visible:ring-2 focus-visible:ring-[#94a3b8]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[14px] font-semibold text-text-primary">{report.title[lang]}</div>
        {report.link
          ? <ExternalLink size={14} className="text-text-tertiary shrink-0 mt-0.5" />
          : <ArrowRight size={14} className="text-text-tertiary shrink-0 mt-0.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />}
      </div>
      <p className="text-[12px] text-text-tertiary leading-relaxed">{report.description[lang]}</p>
      {!report.link && (
        <div className="mt-auto pt-2 text-[11px] text-text-tertiary">
          {fr ? 'Tableau · Excel · PDF · CSV' : 'Table · Excel · PDF · CSV'}
        </div>
      )}
    </Link>
  );
}
