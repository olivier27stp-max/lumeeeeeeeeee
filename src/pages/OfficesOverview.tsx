/**
 * Vue d'ensemble des bureaux — pour le propriétaire d'une entreprise à
 * plusieurs bureaux : les chiffres de chaque bureau côte à côte, et le total.
 *
 * Mêmes chiffres que la page Rapports de chaque bureau (le serveur appelle les
 * mêmes fonctions, bureau par bureau, avec l'identité du propriétaire).
 * Cliquer un bureau bascule dessus. Tableau sur ordinateur, fiches sur téléphone.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { useTranslation } from '../i18n';
import { useCompany } from '../contexts/CompanyContext';
import { FilterPill } from '../components/ui';
import { fetchOfficesOverview, type OfficeFigures } from '../lib/officesApi';
import { formatMoneyFromCents } from '../lib/invoicesApi';

type Periode = 'mois' | 'mois_dernier' | '30j' | 'annee';

/** Date locale AAAA-MM-JJ (le fuseau de l'appareil, comme la page Rapports). */
const ymd = (d: Date) => d.toLocaleDateString('en-CA');

function bornes(p: Periode, maintenant = new Date()): { from: string; to: string } {
  const a = maintenant.getFullYear();
  const m = maintenant.getMonth();
  switch (p) {
    case 'mois_dernier': return { from: ymd(new Date(a, m - 1, 1)), to: ymd(new Date(a, m, 0)) };
    case '30j': return { from: ymd(new Date(a, m, maintenant.getDate() - 29)), to: ymd(maintenant) };
    case 'annee': return { from: ymd(new Date(a, 0, 1)), to: ymd(maintenant) };
    default: return { from: ymd(new Date(a, m, 1)), to: ymd(maintenant) };
  }
}

interface Colonne { cle: keyof OfficeFigures; fr: string; en: string; argent?: boolean; alerte?: boolean }
const COLONNES: Colonne[] = [
  { cle: 'revenue_cents', fr: 'Encaissé', en: 'Collected', argent: true },
  { cle: 'invoiced_cents', fr: 'Facturé', en: 'Invoiced', argent: true },
  { cle: 'outstanding_cents', fr: 'À encaisser', en: 'Outstanding', argent: true },
  { cle: 'past_due_count', fr: 'Factures en retard', en: 'Overdue invoices', alerte: true },
  { cle: 'new_leads', fr: 'Nouveaux prospects', en: 'New leads' },
  { cle: 'converted_quotes', fr: 'Devis convertis', en: 'Converted quotes' },
  { cle: 'new_jobs', fr: 'Nouvelles jobs', en: 'New jobs' },
  { cle: 'requests', fr: 'Demandes', en: 'Requests' },
  { cle: 'unread_conversations', fr: 'Conversations non lues', en: 'Unread conversations', alerte: true },
];

export default function OfficesOverview() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const { current, switchCompany } = useCompany();
  const [periode, setPeriode] = useState<Periode>('mois');
  const { from, to } = useMemo(() => bornes(periode), [periode]);
  const { data, isLoading, error } = useQuery({
    queryKey: ['offices-overview', current?.orgId, from, to],
    queryFn: () => fetchOfficesOverview(from, to),
    enabled: !!current,
    staleTime: 60_000,
  });

  const valeur = (c: Colonne, v: number) => (c.argent ? formatMoneyFromCents(v, 'CAD', fr ? 'fr-CA' : 'en-CA') : new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA').format(v));
  const allerAuBureau = (orgId: string) => {
    if (orgId === current?.orgId) return;
    switchCompany(orgId);
    window.location.assign('/');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold text-text-primary leading-tight">{fr ? 'Vue d’ensemble des bureaux' : 'Offices overview'}</h1>
          <p className="mt-1 text-[13px] text-text-tertiary">
            {fr ? 'Les chiffres de chacun de vos bureaux, côte à côte. Cliquez un bureau pour y aller.' : 'Each of your offices side by side. Click an office to switch to it.'}
          </p>
        </div>
        <FilterPill
          label={fr ? 'Période' : 'Period'}
          value={periode}
          onChange={(v) => setPeriode(v as Periode)}
          options={[
            { value: 'mois', label: fr ? 'Ce mois-ci' : 'This month' },
            { value: 'mois_dernier', label: fr ? 'Le mois dernier' : 'Last month' },
            { value: '30j', label: fr ? '30 derniers jours' : 'Last 30 days' },
            { value: 'annee', label: fr ? 'Cette année' : 'This year' },
          ]}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {error instanceof Error ? error.message : String(error)}
        </p>
      )}
      {isLoading && <div className="h-40 animate-pulse rounded-xl bg-surface-secondary" />}

      {data && (
        <>
          {/* Ordinateur : tableau, bureaux en lignes, total en bas. */}
          <div className="hidden overflow-x-auto rounded-xl border border-outline bg-surface-card md:block">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-outline text-left text-text-tertiary">
                  <th scope="col" className="px-4 py-3 font-medium">{fr ? 'Bureau' : 'Office'}</th>
                  {COLONNES.map((c) => <th key={c.cle} scope="col" className="px-4 py-3 text-right font-medium">{fr ? c.fr : c.en}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.offices.map((b) => (
                  <tr key={b.org_id} className="border-b border-outline/40 last:border-0">
                    <th scope="row" className="px-4 py-3 text-left font-medium">
                      <button type="button" onClick={() => allerAuBureau(b.org_id)}
                        className="inline-flex items-center gap-2 text-text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded">
                        <Building2 size={14} className="text-text-tertiary" aria-hidden />
                        {b.name || (fr ? 'Bureau sans nom' : 'Unnamed office')}
                        {b.org_id === current?.orgId && <span className="rounded bg-primary/10 px-1.5 text-[11px] text-primary">{fr ? 'actif' : 'active'}</span>}
                      </button>
                    </th>
                    {COLONNES.map((c) => (
                      <td key={c.cle} className={`px-4 py-3 text-right tabular-nums ${c.alerte && b.chiffres[c.cle] > 0 ? 'text-red-600 dark:text-red-400' : 'text-text-primary'}`}>
                        {valeur(c, b.chiffres[c.cle])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {data.offices.length > 1 && (
                <tfoot>
                  <tr className="border-t border-outline bg-surface-secondary/60 font-semibold">
                    <th scope="row" className="px-4 py-3 text-left text-text-primary">{fr ? 'Total' : 'Total'}</th>
                    {COLONNES.map((c) => <td key={c.cle} className="px-4 py-3 text-right tabular-nums text-text-primary">{valeur(c, data.totals[c.cle])}</td>)}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Téléphone : une fiche par bureau, puis le total. */}
          <div className="space-y-3 md:hidden">
            {[...data.offices.map((b) => ({ ...b, total: false })), ...(data.offices.length > 1 ? [{ org_id: 'total', name: fr ? 'Total' : 'Total', chiffres: data.totals, total: true }] : [])].map((b) => (
              <section key={b.org_id} className={`rounded-xl border border-outline p-4 ${b.total ? 'bg-surface-secondary/60' : 'bg-surface-card'}`}>
                {b.total ? (
                  <h2 className="text-[15px] font-semibold text-text-primary">{b.name}</h2>
                ) : (
                  <button type="button" onClick={() => allerAuBureau(b.org_id)}
                    className="inline-flex items-center gap-2 text-[15px] font-semibold text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded">
                    <Building2 size={15} className="text-text-tertiary" aria-hidden />{b.name || (fr ? 'Bureau sans nom' : 'Unnamed office')}
                  </button>
                )}
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                  {COLONNES.map((c) => (
                    <div key={c.cle} className="min-w-0">
                      <dt className="truncate text-text-tertiary">{fr ? c.fr : c.en}</dt>
                      <dd className={`tabular-nums font-medium ${c.alerte && b.chiffres[c.cle] > 0 ? 'text-red-600 dark:text-red-400' : 'text-text-primary'}`}>{valeur(c, b.chiffres[c.cle])}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
