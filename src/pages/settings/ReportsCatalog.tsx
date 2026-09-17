import React, { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Landmark, Wrench, Users, Contact, MapPinned, ExternalLink, Search } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { fetchReportCatalogue, type ReportCategory, type ReportSummary } from '../../lib/reportsApi';

const CATEGORY_ICON: Record<ReportCategory, React.ComponentType<{ size?: number; className?: string }>> = {
  finances: Landmark,
  operations: Wrench,
  team: Users,
  clients: Contact,
  field: MapPinned,
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

  return (
    <div className="max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-surface-secondary flex items-center justify-center shrink-0">
            <BarChart3 size={22} className="text-text-tertiary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">{fr ? 'Rapports' : 'Reports'}</h1>
            <p className="text-sm text-text-tertiary">
              {fr
                ? 'Consulte tes données en tableau, filtre, trie, puis exporte en CSV.'
                : 'Browse your data as tables, filter, sort, then export to CSV.'}
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
              <h2 className="text-[17px] font-bold text-text-primary tracking-tight mb-3 flex items-center gap-2">
                <Icon size={16} className="text-text-tertiary" />
                {cat.label[lang]}
              </h2>
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
  return (
    <Link
      to={to}
      className="group rounded-2xl border border-outline bg-surface-card p-5 flex flex-col gap-1.5 hover:border-outline-strong hover:shadow-card transition-all focus-visible:ring-2 focus-visible:ring-[#94a3b8]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[14px] font-semibold text-text-primary group-hover:text-primary transition-colors">{report.title[lang]}</div>
        {report.link && <ExternalLink size={14} className="text-text-tertiary shrink-0 mt-0.5" />}
      </div>
      <p className="text-[12px] text-text-tertiary leading-relaxed">{report.description[lang]}</p>
    </Link>
  );
}
