// Creator Space — Billing : tableau de bord des abonnements de la plateforme.
// Une ligne par workspace abonné (ou suspendu / parti récemment), triée par
// urgence : suspendus, impayés en grâce, anomalies, versements dus,
// renouvellements à 7 j, départs programmés, essais qui finissent,
// renouvellements à 30 j, puis le reste. Chaque chiffre vient du serveur
// (/api/creator-space/billing/watch) — même calcul de grâce que le gate
// d'accès, jamais une estimation côté navigateur.
//
// Actions : ouvrir la fiche compagnie (panneau à droite, ?org= dans l'URL),
// sauter dans Stripe (lien résolu côté serveur, journalisé), consigner un
// contact (note interne = même table que l'onglet Notes de la fiche).

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronRight, CreditCard, ExternalLink, Loader2, MessageSquarePlus, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  addCompanyNote,
  getBillingWatch,
  getStripeLink,
  type BillingSituation,
  type BillingWatch,
  type BillingWatchRow,
} from '../../lib/creatorSpaceApi';
import { CardSkeleton, TableSkeleton } from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import { EngagementBadge, ErrorState, StatTile, SubStatusBadge, fmtDate, fmtDateTime, fmtMoney, useDebounced } from './shared';
import CompanyPanel from './CompanyPanel';

type Filtre = 'attention' | 'all' | BillingSituation;

const SITUATION: Record<BillingSituation, { label: string; cls: string }> = {
  suspended: { label: 'Suspendu (impayé)', cls: 'bg-red-600 text-white border-red-600' },
  past_due: { label: 'Impayé · en grâce', cls: 'bg-red-50 text-red-700 border-red-200' },
  anomaly: { label: 'Anomalie', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  installment_due: { label: 'Versement dû', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  renewing_7d: { label: 'Renouvelle ≤ 7 j', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  cancel_scheduled: { label: 'Départ programmé', cls: 'bg-surface-secondary text-text-primary border-outline' },
  trial_ending: { label: 'Essai se termine', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  renewing_30d: { label: 'Renouvelle ≤ 30 j', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  churned: { label: 'Parti', cls: 'bg-surface-secondary text-text-tertiary border-outline' },
  ok: { label: 'À jour', cls: 'bg-surface-secondary text-text-secondary border-outline' },
};

const EMAIL_LABEL: Record<string, string> = {
  payment_receipt: 'Reçu de paiement',
  subscription_changed: 'Changement de forfait',
  subscription_canceled: 'Annulation confirmée',
  payment_failed: 'Échec de paiement',
  dunning_reminder: 'Relance impayé',
  access_suspended: 'Accès suspendu',
};

const FILTRES: Array<{ id: Filtre; label: string }> = [
  { id: 'attention', label: 'À traiter' },
  { id: 'all', label: 'Tous' },
  { id: 'past_due', label: 'Impayés' },
  { id: 'suspended', label: 'Suspendus' },
  { id: 'anomaly', label: 'Anomalies' },
  { id: 'installment_due', label: 'Versements' },
  { id: 'renewing_7d', label: 'Renouvelle ≤ 7 j' },
  { id: 'renewing_30d', label: 'Renouvelle ≤ 30 j' },
  { id: 'cancel_scheduled', label: 'Départs programmés' },
  { id: 'trial_ending', label: 'Essais' },
  { id: 'churned', label: 'Partis' },
];

const ATTENTION = new Set<BillingSituation>(['suspended', 'past_due', 'anomaly', 'installment_due', 'renewing_7d', 'cancel_scheduled', 'trial_ending']);

function fmtDevises(map: Record<string, number>): string {
  const entries = Object.entries(map).filter(([, v]) => v > 0);
  if (!entries.length) return '$0';
  return entries.map(([cur, cents]) => fmtMoney(cents, cur)).join(' + ');
}

function joursLibelle(days: number | null): string {
  if (days == null) return '—';
  if (days < 0) return `il y a ${Math.abs(days)} j`;
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'demain';
  return `dans ${days} j`;
}

export default function Billing() {
  const [filtre, setFiltre] = useState<Filtre>('attention');
  const [q, setQ] = useState('');
  const debouncedQ = useDebounced(q);
  const [ouverts, setOuverts] = useState<Set<string>>(new Set());
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedOrg = searchParams.get('org');

  const query = useQuery({
    queryKey: ['creator-space', 'billing', 'watch'],
    queryFn: getBillingWatch,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const rows = query.data?.rows ?? [];
  const comptes = useMemo(() => {
    const c: Record<Filtre, number> = { attention: 0, all: rows.length } as Record<Filtre, number>;
    for (const s of Object.keys(SITUATION) as BillingSituation[]) c[s] = 0;
    for (const r of rows) {
      c[r.situation] += 1;
      if (ATTENTION.has(r.situation)) c.attention += 1;
    }
    return c;
  }, [rows]);

  const visibles = useMemo(() => {
    const needle = debouncedQ.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtre === 'attention' && !ATTENTION.has(r.situation)) return false;
      if (filtre !== 'attention' && filtre !== 'all' && r.situation !== filtre) return false;
      if (!needle) return true;
      return (
        r.org_name.toLowerCase().includes(needle) ||
        (r.owner_name ?? '').toLowerCase().includes(needle) ||
        (r.contact_email ?? '').toLowerCase().includes(needle) ||
        (r.plan_name ?? '').toLowerCase().includes(needle) ||
        r.org_id.toLowerCase().includes(needle)
      );
    });
  }, [rows, filtre, debouncedQ]);

  const select = (orgId: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (orgId) next.set('org', orgId);
    else next.delete('org');
    setSearchParams(next, { replace: !orgId });
  };
  const toggle = (id: string) =>
    setOuverts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (query.isLoading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <TableSkeleton rows={8} cols={6} />
      </div>
    );
  }
  if (query.isError) return <ErrorState message={(query.error as Error)?.message} onRetry={() => query.refetch()} />;

  const data = query.data as BillingWatch;
  const s = data.summary;

  return (
    <div className="flex items-start gap-5">
      <div className="flex-1 min-w-0 space-y-5">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[22px] font-bold text-text-primary">Billing</h1>
            <p className="text-[12px] text-text-tertiary">
              Calculé le {fmtDateTime(data.generated_at)} · grâce d’impayé {data.grace_days} j · départs conservés {data.churn_window_days} j
            </p>
            {!data.installments_available && (
              <p className="mt-1 inline-flex items-center gap-1 text-[12px] text-orange-700">
                <AlertTriangle size={12} /> Migration 20260927140000 non appliquée : versements et dates d’annulation programmées invisibles.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => query.refetch()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-outline bg-surface text-[12.5px] font-medium text-text-secondary hover:bg-surface-secondary"
          >
            <RefreshCw size={13} className={cn(query.isFetching && 'animate-spin')} /> Actualiser
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="À encaisser 7 j" value={fmtDevises(s.due_7d_cents)} hint={`${s.renewing_7d} renouvellement${s.renewing_7d > 1 ? 's' : ''}`} />
          <StatTile label="À encaisser 30 j" value={fmtDevises(s.due_30d_cents)} hint={`${s.renewing_30d + s.renewing_7d} renouvellements · ${s.installments_due_30d} versement${s.installments_due_30d > 1 ? 's' : ''}`} />
          <StatTile label="MRR normalisé" value={fmtDevises(s.mrr_cents)} hint="mensuel + annuel ÷ 12, actifs et impayés" />
          <StatTile label="Abonnés actifs" value={s.active} hint={`${s.trialing} en essai · ${s.installments_active} en versements`} />
          <StatTile label="Impayés en grâce" value={s.past_due} hint={s.past_due ? 'accès encore ouvert' : 'aucun'} />
          <StatTile label="Suspendus" value={s.suspended} hint="grâce écoulée, accès fermé" />
          <StatTile label="Départs programmés" value={s.cancel_scheduled} hint={`${s.churned_30d} parti${s.churned_30d > 1 ? 's' : ''} sur 30 j`} />
          <StatTile label="Anomalies" value={s.anomalies} hint={s.anomalies ? 'chaîne Stripe → base à vérifier' : 'aucune'} />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex flex-wrap gap-1.5">
            {FILTRES.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFiltre(f.id)}
                className={cn(
                  'h-7 px-2.5 rounded-full border text-[12px] font-medium transition-colors',
                  filtre === f.id ? 'bg-text-primary text-white border-text-primary' : 'bg-surface text-text-secondary border-outline hover:bg-surface-secondary',
                )}
              >
                {f.label}
                <span className={cn('ml-1.5 tabular-nums', filtre === f.id ? 'text-white/70' : 'text-text-tertiary')}>{comptes[f.id] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="relative ml-auto">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Workspace, propriétaire, courriel, forfait…"
              aria-label="Filtrer le tableau de facturation"
              className="h-8 w-[260px] pl-8 pr-3 rounded-md border border-outline bg-surface text-[12.5px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
        </div>

        {visibles.length === 0 ? (
          <div className="rounded-lg border border-outline bg-surface-card">
            <EmptyState
              icon={CreditCard}
              title={filtre === 'attention' ? 'Rien à traiter' : 'Aucun abonnement dans cette vue'}
              description={
                filtre === 'attention'
                  ? 'Aucun impayé, aucune anomalie, aucun renouvellement ni versement dans les 7 prochains jours.'
                  : 'Changez de filtre ou élargissez la recherche.'
              }
            />
          </div>
        ) : (
          <div className="rounded-lg border border-outline bg-surface-card overflow-hidden">
            <div className="overflow-x-auto">
              <div className="min-w-[980px]">
                <div className="grid grid-cols-[28px_minmax(200px,2fr)_150px_minmax(150px,1.4fr)_minmax(140px,1.2fr)_120px_minmax(150px,1.2fr)] gap-3 px-4 py-2.5 border-b border-outline text-[11px] uppercase tracking-wide text-text-tertiary font-semibold">
                  <span />
                  <span>Workspace</span>
                  <span>Situation</span>
                  <span>Forfait</span>
                  <span>Prochaine charge</span>
                  <span>Activité</span>
                  <span>Dernier courriel / suivi</span>
                </div>
                <ul>
                  {visibles.map((r) => (
                    <LigneAbonnement
                      key={r.org_id}
                      row={r}
                      open={ouverts.has(r.org_id)}
                      selected={selectedOrg === r.org_id}
                      onToggle={() => toggle(r.org_id)}
                      onOpenCompany={() => select(r.org_id)}
                    />
                  ))}
                </ul>
              </div>
            </div>
            <div className="px-4 py-2 border-t border-outline text-[12px] text-text-tertiary">
              {visibles.length} sur {rows.length} abonnement{rows.length > 1 ? 's' : ''}
            </div>
          </div>
        )}
      </div>

      {selectedOrg && <CompanyPanel orgId={selectedOrg} onClose={() => select(null)} />}
    </div>
  );
}

function SituationBadge({ situation }: { situation: BillingSituation }) {
  const st = SITUATION[situation];
  return <span className={cn('inline-flex items-center px-2 h-[22px] rounded-full border text-[11px] font-semibold whitespace-nowrap', st.cls)}>{st.label}</span>;
}

function LigneAbonnement({
  row: r,
  open,
  selected,
  onToggle,
  onOpenCompany,
}: {
  row: BillingWatchRow;
  open: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpenCompany: () => void;
}) {
  const parVersement = r.installments ? `${fmtMoney(r.installments.amount_cents, r.currency)} × ${r.installments.count}` : null;
  const perInterval = r.interval === 'yearly' ? 'an' : 'mois';

  return (
    <li className={cn('border-b border-outline last:border-b-0', selected && 'bg-surface-secondary/60')}>
      <div className="grid grid-cols-[28px_minmax(200px,2fr)_150px_minmax(150px,1.4fr)_minmax(140px,1.2fr)_120px_minmax(150px,1.2fr)] gap-3 items-center px-4 py-3 text-[13px] hover:bg-surface-secondary/40 transition-colors">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? `Replier ${r.org_name}` : `Détails de ${r.org_name}`}
          className="h-7 w-7 -ml-1 flex items-center justify-center rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-secondary"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <button type="button" onClick={onOpenCompany} className="min-w-0 text-left">
          <span className="block font-medium text-text-primary truncate">{r.org_name}</span>
          <span className="block text-[11.5px] text-text-tertiary truncate">
            {r.owner_name ?? 'Propriétaire inconnu'}
            {r.contact_email ? ` · ${r.contact_email}` : ''}
          </span>
        </button>

        <span className="min-w-0">
          <SituationBadge situation={r.situation} />
          {r.grace && r.status === 'past_due' && (
            <span className="block text-[11px] text-red-700 mt-0.5">
              {r.grace.actif ? `suspension ${joursLibelle(r.grace.jours_restants)}` : 'grâce écoulée'}
            </span>
          )}
          {r.suspended && r.canceled_at && <span className="block text-[11px] text-text-tertiary mt-0.5">depuis le {fmtDate(r.canceled_at)}</span>}
          {r.alerts.length > 0 && r.situation !== 'anomaly' && (
            <span className="block text-[11px] text-orange-700 mt-0.5">{r.alerts.length} anomalie{r.alerts.length > 1 ? 's' : ''}</span>
          )}
        </span>

        <span className="min-w-0">
          <span className="block text-text-primary truncate">
            {r.plan_name ?? '—'} <span className="text-text-tertiary">· {r.interval === 'yearly' ? 'annuel' : 'mensuel'}</span>
          </span>
          <span className="block text-[11.5px] text-text-tertiary truncate">
            {r.installments
              ? `Versement ${r.installments.paid}/${r.installments.count} · ${parVersement}`
              : `${fmtMoney(r.amount_cents, r.currency)} / ${perInterval}`}
          </span>
        </span>

        <span className="min-w-0">
          {r.next_charge_at ? (
            <>
              <span className={cn('block tabular-nums', (r.days_to_next_charge ?? 99) <= 7 ? 'font-semibold text-text-primary' : 'text-text-secondary')}>
                {fmtMoney(r.next_charge_cents, r.currency)} · {joursLibelle(r.days_to_next_charge)}
              </span>
              <span className="block text-[11.5px] text-text-tertiary">{fmtDate(r.next_charge_at)}</span>
            </>
          ) : r.cancel_at_period_end && r.cancel_effective_at ? (
            <>
              <span className="block text-text-secondary">Aucune · départ</span>
              <span className="block text-[11.5px] text-text-tertiary">{fmtDate(r.cancel_effective_at)}</span>
            </>
          ) : (
            <span className="text-text-tertiary">—</span>
          )}
        </span>

        <span className="min-w-0">
          <EngagementBadge level={r.engagement} />
          <span className="block text-[11px] text-text-tertiary mt-0.5">
            {r.member_count} membre{r.member_count > 1 ? 's' : ''}
            {r.days_since_activity != null ? ` · ${r.days_since_activity === 0 ? "aujourd'hui" : `il y a ${r.days_since_activity} j`}` : ''}
          </span>
        </span>

        <span className="min-w-0 text-[12px]">
          {r.last_email ? (
            <span className="block text-text-secondary truncate">
              {EMAIL_LABEL[r.last_email.type] ?? r.last_email.type}
              <span className="text-text-tertiary"> · {fmtDate(r.last_email.at)}{r.last_email.status !== 'sent' ? ` (${r.last_email.status})` : ''}</span>
            </span>
          ) : (
            <span className="block text-text-tertiary">Aucun courriel</span>
          )}
          {r.last_note ? (
            <span className="block text-[11px] text-text-tertiary truncate">Suivi {fmtDate(r.last_note.at)}{r.last_note.author_name ? ` · ${r.last_note.author_name}` : ''}</span>
          ) : (
            <span className="block text-[11px] text-text-tertiary">Aucun suivi</span>
          )}
        </span>
      </div>

      {open && <DetailsAbonnement row={r} onOpenCompany={onOpenCompany} />}
    </li>
  );
}

function DetailsAbonnement({ row: r, onOpenCompany }: { row: BillingWatchRow; onOpenCompany: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [noteOuverte, setNoteOuverte] = useState(false);
  const [stripeErreur, setStripeErreur] = useState<string | null>(null);
  const [stripeChargement, setStripeChargement] = useState(false);

  const ajouter = useMutation({
    mutationFn: (body: string) => addCompanyNote(r.org_id, body),
    onSuccess: () => {
      setNote('');
      setNoteOuverte(false);
      qc.invalidateQueries({ queryKey: ['creator-space', 'billing', 'watch'] });
      qc.invalidateQueries({ queryKey: ['creator-space', 'company', r.org_id, 'notes'] });
    },
  });

  const ouvrirStripe = async () => {
    setStripeErreur(null);
    setStripeChargement(true);
    try {
      const { url } = await getStripeLink(r.org_id);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setStripeErreur((e as Error).message);
    } finally {
      setStripeChargement(false);
    }
  };

  return (
    <div className="bg-surface/60 border-t border-outline/60 px-4 py-3 pl-12 text-[12.5px]">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <dl className="space-y-1">
          <Row k="Statut brut" v={<SubStatusBadge status={r.status} />} />
          <Row k="Client depuis" v={fmtDate(r.customer_since)} />
          <Row k="Paiement confirmé" v={fmtDate(r.payment_confirmed_at)} />
          <Row k="Fin de période" v={`${fmtDate(r.current_period_end)} (${joursLibelle(r.days_to_period_end)})`} />
          <Row k="Stripe" v={r.has_stripe_subscription ? 'abonnement lié' : 'aucun abonnement Stripe'} />
          {r.scheduled_plan_name && <Row k="Changement prévu" v={`${r.scheduled_plan_name} le ${fmtDate(r.scheduled_at)}`} />}
        </dl>

        <dl className="space-y-1">
          {r.past_due_since && <Row k="Impayé depuis" v={fmtDate(r.past_due_since)} />}
          {r.grace && <Row k="Suspension prévue" v={`${fmtDate(r.grace.expire_le)} (${r.grace.actif ? `${r.grace.jours_restants} j restants` : 'écoulée'})`} />}
          {r.cancel_at_period_end && <Row k="Départ effectif" v={fmtDate(r.cancel_effective_at)} />}
          {r.canceled_at && <Row k="Annulé le" v={fmtDate(r.canceled_at)} />}
          {r.cancellation_feedback && <Row k="Motif" v={r.cancellation_feedback} />}
          {r.cancellation_comment && <Row k="Commentaire" v={r.cancellation_comment} />}
          {r.installments && (
            <>
              <Row k="Versements" v={`${r.installments.paid} sur ${r.installments.count} encaissés · ${fmtMoney(r.installments.amount_cents, r.currency)} chacun`} />
              <Row k="Prochain versement" v={r.installments.next_at ? `${fmtDate(r.installments.next_at)} (${joursLibelle(r.days_to_next_charge)})` : '—'} />
              <Row k="Fin d’engagement" v={`${fmtDate(r.installments.commitment_end)} (${joursLibelle(r.installments.days_to_commitment_end)})`} />
              <Row k="Reste à encaisser" v={fmtMoney(Math.max(0, r.installments.count - r.installments.paid) * r.installments.amount_cents, r.currency)} />
            </>
          )}
          {!r.past_due_since && !r.cancel_at_period_end && !r.canceled_at && !r.installments && (
            <p className="text-text-tertiary">Rien à signaler : ni impayé, ni départ, ni versements.</p>
          )}
        </dl>

        <div className="space-y-2">
          {r.alerts.length > 0 && (
            <ul className="space-y-1">
              {r.alerts.map((a) => (
                <li key={a.code} className="flex items-start gap-1.5 text-orange-800">
                  <ShieldAlert size={13} className="mt-0.5 shrink-0" />
                  <span>{a.label}</span>
                </li>
              ))}
            </ul>
          )}
          {r.last_note && (
            <p className="text-text-secondary">
              <span className="text-text-tertiary">Dernier suivi ({fmtDateTime(r.last_note.at)}{r.last_note.author_name ? `, ${r.last_note.author_name}` : ''}) : </span>
              {r.last_note.excerpt}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={onOpenCompany} className="h-7 px-2.5 rounded-md border border-outline bg-surface text-[12px] font-medium text-text-secondary hover:bg-surface-secondary">
              Fiche compagnie
            </button>
            <button
              type="button"
              onClick={ouvrirStripe}
              disabled={stripeChargement}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-outline bg-surface text-[12px] font-medium text-text-secondary hover:bg-surface-secondary disabled:opacity-50"
            >
              {stripeChargement ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />} Stripe
            </button>
            <button
              type="button"
              onClick={() => setNoteOuverte((v) => !v)}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-outline bg-surface text-[12px] font-medium text-text-secondary hover:bg-surface-secondary"
            >
              <MessageSquarePlus size={12} /> Consigner un contact
            </button>
          </div>
          {stripeErreur && (
            <p className="flex items-center gap-1 text-[12px] text-red-700"><AlertTriangle size={12} /> {stripeErreur}</p>
          )}
          {noteOuverte && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const body = note.trim();
                if (body) ajouter.mutate(`[Suivi facturation] ${body}`);
              }}
              className="space-y-1.5"
            >
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="Note de suivi de facturation"
                rows={2}
                maxLength={3900}
                placeholder="Ex. : appelé le propriétaire, carte mise à jour promise pour vendredi."
                className="w-full rounded-md border border-outline bg-surface px-2.5 py-1.5 text-[12.5px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={ajouter.isPending || !note.trim()}
                  className="h-7 px-3 rounded-md bg-text-primary text-white text-[12px] font-medium disabled:opacity-50"
                >
                  {ajouter.isPending ? 'Enregistrement…' : 'Enregistrer le suivi'}
                </button>
                {ajouter.isError && <span className="text-[12px] text-red-700">{(ajouter.error as Error).message}</span>}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-[130px] shrink-0 text-text-tertiary">{k}</dt>
      <dd className="min-w-0 text-text-primary break-words">{v}</dd>
    </div>
  );
}
