// Creator Space — panneau de détails d'une compagnie. Colonne fixe à droite
// sur ordinateur (la liste reste visible), plein écran sur mobile. Le
// « Company ID » = orgs.id ; la seconde valeur technique = company_group_id
// (identifiant non sensible qui relie les bureaux d'une même compagnie —
// jamais de clé secrète, de token ni d'identifiant Stripe ici).

import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Loader2, Trash2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { confirmer } from '../../components/ui/ConfirmDialog';
import {
  addCompanyNote,
  deleteCompanyNote,
  getCompany,
  getCompanyBilling,
  getCompanyEngagement,
  getCompanyFeatures,
  getCompanyNotes,
  getCompanyPermissions,
  getCompanyUsers,
  setCompanyFeature,
  setCompanyOfficeQuota,
  type CompanyFeature,
  type FeatureOverrideState,
} from '../../lib/creatorSpaceApi';
import EmptyState from '../../components/ui/EmptyState';
import { EngagementBadge, ErrorState, MaskedActor, SubStatusBadge, fmtDate, fmtDateTime, fmtMoney } from './shared';

type Tab = 'users' | 'billing' | 'permissions' | 'features' | 'notes' | 'engagement';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'users', label: 'Users' },
  { id: 'billing', label: 'Billing' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'features', label: 'Features' },
  { id: 'notes', label: 'Notes' },
  { id: 'engagement', label: 'Engagement' },
];

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Admin',
  sales_rep: 'Vendeur',
  technician: 'Technicien',
};

export default function CompanyPanel({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('users');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const header = useQuery({
    queryKey: ['creator-space', 'company', orgId],
    queryFn: () => getCompany(orgId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  return (
    <aside
      className="fixed inset-0 z-40 bg-surface md:static md:z-auto md:w-[430px] md:shrink-0 md:rounded-lg md:border md:border-outline md:bg-surface-card md:max-h-[calc(100vh-140px)] flex flex-col overflow-hidden"
      aria-label="Détails de la compagnie"
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3.5 border-b border-outline shrink-0">
        {header.isLoading ? (
          <div className="flex items-center gap-2 text-text-tertiary py-1">
            <Loader2 size={16} className="animate-spin" /> <span className="text-[13px]">Chargement…</span>
          </div>
        ) : header.isError ? (
          <p className="text-[13px] text-text-secondary py-1">Compagnie introuvable.</p>
        ) : (
          <div className="min-w-0">
            <h2 className="text-[16px] font-bold text-text-primary truncate">{header.data!.name}</h2>
            <TechValue label="Company ID" value={header.data!.id} />
            <TechValue label="Group key" value={header.data!.company_group_id ?? '—'} />
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer le panneau"
          className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        >
          <X size={15} />
        </button>
      </div>

      <div className="flex border-b border-outline shrink-0" role="tablist" aria-label="Sections de la compagnie">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 px-2 py-2 text-[12.5px] font-medium transition-colors border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40',
              tab === t.id
                ? 'border-text-primary text-text-primary'
                : 'border-transparent text-text-tertiary hover:text-text-secondary',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === 'users' && <UsersTab orgId={orgId} />}
        {tab === 'billing' && <BillingTab orgId={orgId} />}
        {tab === 'permissions' && <PermissionsTab orgId={orgId} />}
        {tab === 'features' && <FeaturesTab orgId={orgId} />}
        {tab === 'notes' && <NotesTab orgId={orgId} />}
        {tab === 'engagement' && <EngagementTab orgId={orgId} />}
      </div>
    </aside>
  );
}

function TechValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copyable = value !== '—';
  return (
    <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
      <span className="text-[10.5px] uppercase tracking-wide text-text-tertiary font-semibold shrink-0">{label}</span>
      <span className="text-[11px] font-mono text-text-secondary truncate">{value}</span>
      {copyable && (
        <button
          type="button"
          title={`Copier ${label}`}
          onClick={() => {
            navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="shrink-0 text-text-tertiary hover:text-text-primary focus-visible:outline-none"
        >
          {copied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
        </button>
      )}
    </div>
  );
}

function TabLoading() {
  return (
    <div className="flex items-center justify-center py-10 text-text-tertiary">
      <Loader2 size={18} className="animate-spin" />
    </div>
  );
}

function UsersTab({ orgId }: { orgId: string }) {
  const query = useQuery({
    queryKey: ['creator-space', 'company', orgId, 'users'],
    queryFn: () => getCompanyUsers(orgId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  if (query.isLoading) return <TabLoading />;
  if (query.isError) return <ErrorState message={(query.error as Error)?.message} onRetry={() => query.refetch()} />;
  const users = query.data?.data ?? [];
  if (!users.length) return <EmptyState title="Aucun utilisateur" description="Cette compagnie n’a aucun membre." />;
  return (
    <ul className="space-y-2.5">
      {users.map((u) => (
        <li key={u.user_id} className="rounded-md border border-outline px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-text-primary truncate">{u.name ?? 'Sans nom'}</span>
            <span className="shrink-0 text-[11px] font-semibold text-text-secondary bg-surface-secondary border border-outline rounded-full px-2 leading-[20px]">
              {ROLE_LABELS[u.role] ?? u.role}
            </span>
          </div>
          {u.email && <p className="text-[12px] text-text-tertiary truncate mt-0.5">{u.email}</p>}
          <p className="text-[11.5px] text-text-tertiary mt-1">
            {u.status === 'active' ? 'Actif' : u.status === 'pending' ? 'En attente' : 'Suspendu'} · membre depuis {fmtDate(u.created_at)}
            {u.last_sign_in_at && <> · dernière connexion {fmtDate(u.last_sign_in_at)}</>}
          </p>
        </li>
      ))}
    </ul>
  );
}

function BillingTab({ orgId }: { orgId: string }) {
  const query = useQuery({
    queryKey: ['creator-space', 'company', orgId, 'billing'],
    queryFn: () => getCompanyBilling(orgId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  if (query.isLoading) return <TabLoading />;
  if (query.isError) return <ErrorState message={(query.error as Error)?.message} onRetry={() => query.refetch()} />;
  const b = query.data!;
  if (!b.current) return <EmptyState title="Aucun abonnement" description="Cette compagnie n’a aucun abonnement enregistré." />;
  const c = b.current;
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-outline px-3.5 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[14px] font-semibold text-text-primary">{c.plan?.name_fr || c.plan?.name || 'Forfait'}</span>
          <SubStatusBadge status={c.status} />
        </div>
        <dl className="mt-2 space-y-1 text-[12.5px]">
          <Row k="Montant" v={`${fmtMoney(c.amount_cents, c.currency)} / ${c.interval === 'yearly' ? 'an' : 'mois'}`} />
          <Row k="Prochaine échéance" v={fmtDate(c.current_period_end)} />
          {c.trial_end && <Row k="Fin d’essai" v={fmtDate(c.trial_end)} />}
          {c.cancel_at_period_end && <Row k="Annulation" v={`prévue le ${fmtDate(c.current_period_end)}`} />}
          {c.canceled_at && <Row k="Annulé le" v={fmtDate(c.canceled_at)} />}
          <Row k="Sièges" v={`${c.plan?.seats_included ?? '—'} inclus${c.extra_seats ? ` + ${c.extra_seats} extra` : ''}`} />
          <Row k="Client depuis" v={fmtDate(c.created_at)} />
        </dl>
      </div>
      {b.receipts.length > 0 && (
        <div>
          <h3 className="text-[11px] uppercase tracking-wide text-text-tertiary font-semibold mb-1.5">Reçus récents</h3>
          <ul className="space-y-1.5">
            {b.receipts.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                <span className="text-text-secondary truncate">
                  {r.plan_name ?? r.email_type} · {fmtMoney(r.amount_cents, r.currency)}
                </span>
                <span className="shrink-0 text-text-tertiary">{fmtDate(r.sent_at ?? r.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PermissionsTab({ orgId }: { orgId: string }) {
  const query = useQuery({
    queryKey: ['creator-space', 'company', orgId, 'permissions'],
    queryFn: () => getCompanyPermissions(orgId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  if (query.isLoading) return <TabLoading />;
  if (query.isError) return <ErrorState message={(query.error as Error)?.message} onRetry={() => query.refetch()} />;
  const p = query.data!;
  if (!p.data.length) return <EmptyState title="Aucune permission" description="Cette compagnie n’a aucun membre." />;
  return (
    <div className="space-y-4">
      <p className="text-[11.5px] text-text-tertiary">Lecture seule — les permissions se modifient dans le CRM de la compagnie.</p>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(p.role_counts).map(([role, count]) => (
          <span key={role} className="text-[11px] font-semibold text-text-secondary bg-surface-secondary border border-outline rounded-full px-2 leading-[20px]">
            {ROLE_LABELS[role] ?? role} · {count}
          </span>
        ))}
      </div>
      <ul className="space-y-2.5">
        {p.data.map((m) => (
          <li key={m.user_id} className="rounded-md border border-outline px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-text-primary truncate">{m.name ?? 'Sans nom'}</span>
              <span className="shrink-0 text-[11.5px] text-text-secondary">
                {ROLE_LABELS[m.role] ?? m.role} · portée {m.scope}
              </span>
            </div>
            {m.permissions_custom && m.overrides.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {m.overrides.map((o) => (
                  <span
                    key={o.key}
                    className={cn(
                      'text-[10.5px] font-mono rounded border px-1.5 leading-[18px]',
                      o.value ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200',
                    )}
                  >
                    {o.key}: {o.value ? 'oui' : 'non'}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Features : activer / bloquer par-dessus le forfait ────────────────────
// Trois états par fonctionnalité : Forfait (hérité), Activé (forcé), Bloqué.
// Chaque changement exige une raison, journalisée côté serveur avant
// l'écriture (creator_space_feature_override) et s'applique à tous les
// bureaux de la compagnie.

const STATE_LABEL: Record<FeatureOverrideState, string> = { inherit: 'Forfait', on: 'Activé', off: 'Bloqué' };

function FeaturesTab({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['creator-space', 'company', orgId, 'features'],
    queryFn: () => getCompanyFeatures(orgId),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
  type Pending = { type: 'feature'; key: string; state: FeatureOverrideState } | { type: 'quota'; quota: number };
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: async (p: Pending & { reason: string }): Promise<unknown> =>
      p.type === 'quota'
        ? setCompanyOfficeQuota(orgId, p.quota, p.reason)
        : setCompanyFeature(orgId, p.key, p.state, p.reason),
    onSuccess: () => {
      setPending(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['creator-space', 'company', orgId, 'features'] });
      qc.invalidateQueries({ queryKey: ['creator-space', 'companies'] });
    },
  });

  if (query.isLoading) return <TabLoading />;
  if (query.isError) return <ErrorState message={(query.error as Error)?.message} onRetry={() => query.refetch()} />;
  const d = query.data!;
  const plans = d.features.filter((f) => f.kind === 'plan');
  const modules = d.features.filter((f) => f.kind === 'module');

  const annuler = () => { setPending(null); setReason(''); mutation.reset(); };
  const valider = () => {
    if (!pending || reason.trim().length < 5) return;
    mutation.mutate({ ...pending, reason: reason.trim() });
  };
  const pick = (p: Pending) => { setPending(p); setReason(''); mutation.reset(); };
  const pendingKey = pending?.type === 'feature' ? pending.key : null;
  const o = d.offices;

  return (
    <div className="space-y-4">
      <div className="text-[11.5px] text-text-tertiary space-y-0.5">
        <p>
          Forfait actuel : <span className="font-medium text-text-secondary">{d.plan?.name_fr || d.plan?.name || 'aucun'}</span>
          {d.office_count > 1 && <> · s’applique aux {d.office_count} bureaux de la compagnie</>}
        </p>
        <p>« Forfait » = le forfait décide. « Activé » / « Bloqué » = override plateforme, prime sur le forfait. Chaque changement est journalisé.</p>
      </div>

      {pending && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 space-y-2">
          <p className="text-[12.5px] text-amber-900">
            {pending.type === 'quota' ? (
              <><span className="font-semibold">Bureaux autorisés</span> → {pending.quota}</>
            ) : (
              <><span className="font-semibold">{d.features.find((f) => f.key === pending.key)?.label}</span> → {STATE_LABEL[pending.state]}</>
            )}
          </p>
          <input
            type="text"
            autoFocus
            value={reason}
            disabled={mutation.isPending}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') valider();
              if (e.key === 'Escape') annuler();
            }}
            placeholder="Raison (journalisée, min. 5 caractères)…"
            aria-label="Raison du changement, journalisée"
            className="h-7 w-full px-2 rounded border border-amber-300 bg-surface text-[12px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-amber-500/40"
          />
          {mutation.isError && <p className="text-[11.5px] text-red-700">{(mutation.error as Error)?.message || 'Échec de la modification.'}</p>}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={annuler}
              disabled={mutation.isPending}
              className="h-7 px-2.5 rounded-md border border-outline bg-surface text-[12px] font-medium text-text-secondary hover:bg-surface-secondary disabled:opacity-40"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={valider}
              disabled={mutation.isPending || reason.trim().length < 5}
              className="h-7 px-2.5 rounded-md bg-text-primary text-surface text-[12px] font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              {mutation.isPending && <Loader2 size={12} className="animate-spin" />}
              Confirmer
            </button>
          </div>
        </div>
      )}

      {/* Bureaux : quota par workspace (1 par défaut, jamais vendu par forfait) */}
      <div>
        <h3 className="text-[11px] uppercase tracking-wide text-text-tertiary font-semibold mb-1.5">Bureaux</h3>
        <div className={cn('rounded-md border px-3 py-2.5', pending?.type === 'quota' ? 'border-amber-300' : 'border-outline')}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-text-primary">
                {o.used} / {o.quota} bureau{o.quota > 1 ? 'x' : ''} autorisé{o.quota > 1 ? 's' : ''}
                {o.quota !== Math.max(o.default_quota, o.plan_quota ?? 0) && <span className="ml-1.5 text-[10.5px] font-semibold text-text-tertiary uppercase tracking-wide">forcé</span>}
              </p>
              <p className="text-[11.5px] text-text-tertiary mt-0.5">
                {(o.plan_quota ?? 0) > o.default_quota ? `${o.plan_quota} compris dans le forfait` : `${o.default_quota} par défaut`} · abaisser sous les bureaux existants n’en supprime aucun, le workspace ne peut plus en créer.
                {o.updated_at && <> · quota posé le {fmtDate(o.updated_at)}</>}
              </p>
            </div>
            <div className="inline-flex items-center rounded-md border border-outline overflow-hidden shrink-0" role="group" aria-label="Quota de bureaux">
              <button
                type="button"
                aria-label="Enlever un bureau autorisé"
                disabled={o.quota <= 1 || mutation.isPending}
                onClick={() => pick({ type: 'quota', quota: o.quota - 1 })}
                className="h-7 w-8 text-[14px] font-semibold text-text-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40"
              >
                −
              </button>
              <span className="h-7 min-w-[32px] px-1 inline-flex items-center justify-center text-[13px] font-semibold text-text-primary border-x border-outline tabular-nums">{o.quota}</span>
              <button
                type="button"
                aria-label="Ajouter un bureau autorisé"
                disabled={o.quota >= o.max_quota || mutation.isPending}
                onClick={() => pick({ type: 'quota', quota: o.quota + 1 })}
                className="h-7 w-8 text-[14px] font-semibold text-text-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40"
              >
                +
              </button>
            </div>
          </div>
          {o.list.length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-outline/60 pt-2">
              {o.list.map((b, i) => (
                <li key={b.id} className={cn('flex items-center justify-between gap-2 text-[12px]', i >= o.quota && 'text-amber-700')}>
                  <span className="truncate">
                    {b.name}
                    {b.is_current && <span className="ml-1.5 text-[10.5px] text-text-tertiary uppercase tracking-wide">ce bureau</span>}
                    {i >= o.quota && <span className="ml-1.5 text-[10.5px] uppercase tracking-wide">hors quota</span>}
                  </span>
                  <span className="shrink-0 text-text-tertiary">{fmtDate(b.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <FeatureGroup title="Fonctionnalités du forfait" features={plans} pendingKey={pendingKey} onPick={(key, state) => pick({ type: 'feature', key, state })} />
      <FeatureGroup title="Modules activés par le workspace" features={modules} pendingKey={pendingKey} onPick={(key, state) => pick({ type: 'feature', key, state })} />
    </div>
  );
}

function FeatureGroup({ title, features, pendingKey, onPick }: {
  title: string;
  features: CompanyFeature[];
  pendingKey: string | null;
  onPick: (key: string, state: FeatureOverrideState) => void;
}) {
  if (!features.length) return null;
  return (
    <div>
      <h3 className="text-[11px] uppercase tracking-wide text-text-tertiary font-semibold mb-1.5">{title}</h3>
      <ul className="space-y-2">
        {features.map((f) => (
          <li key={f.key} className={cn('rounded-md border px-3 py-2.5', pendingKey === f.key ? 'border-amber-300' : 'border-outline')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[13px] font-medium text-text-primary">{f.label}</span>
                  <span
                    className={cn(
                      'text-[10.5px] font-semibold rounded-full border px-1.5 leading-[17px]',
                      f.effective ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-surface-secondary text-text-tertiary border-outline',
                    )}
                    title={f.override === 'inherit' ? 'État hérité' : 'Override plateforme'}
                  >
                    {f.effective ? 'actif' : 'inactif'}
                    {f.override !== 'inherit' && ' · forcé'}
                  </span>
                </div>
                <p className="text-[11.5px] text-text-tertiary mt-0.5">{f.description}</p>
                <p className="text-[11px] text-text-tertiary mt-0.5">
                  {f.kind === 'plan'
                    ? `Forfait : ${f.inherited == null ? 'aucun forfait' : f.inherited ? 'inclus' : 'non inclus'}`
                    : `Workspace : ${f.inherited ? 'activé' : 'non activé'}`}
                  {f.updated_at && <> · override posé le {fmtDate(f.updated_at)}</>}
                </p>
              </div>
            </div>
            <div className="mt-2 inline-flex rounded-md border border-outline overflow-hidden" role="radiogroup" aria-label={`État de ${f.label}`}>
              {(['inherit', 'on', 'off'] as FeatureOverrideState[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={f.override === s}
                  disabled={f.override === s}
                  onClick={() => onPick(f.key, s)}
                  className={cn(
                    'h-7 px-2.5 text-[11.5px] font-medium transition-colors border-r border-outline last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40',
                    f.override === s
                      ? s === 'off'
                        ? 'bg-red-50 text-red-700 cursor-default'
                        : s === 'on'
                          ? 'bg-emerald-50 text-emerald-700 cursor-default'
                          : 'bg-surface-secondary text-text-primary cursor-default'
                      : 'bg-surface text-text-tertiary hover:text-text-primary hover:bg-surface-secondary',
                  )}
                >
                  {STATE_LABEL[s]}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Notes : communication d'équipe interne sur le workspace ───────────────
// Table dédiée, jamais la table tenant `notes` : le client ne voit jamais
// ces notes. Pas de raison à saisir (contrairement aux overrides de
// Features) — c'est une note libre, pas un changement d'état du compte.

function NotesTab({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['creator-space', 'company', orgId, 'notes'],
    queryFn: () => getCompanyNotes(orgId),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
  const [draft, setDraft] = useState('');
  const addMutation = useMutation({
    mutationFn: (body: string) => addCompanyNote(orgId, body),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['creator-space', 'company', orgId, 'notes'] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (noteId: string) => deleteCompanyNote(orgId, noteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['creator-space', 'company', orgId, 'notes'] }),
  });

  const submit = () => {
    const body = draft.trim();
    if (!body || addMutation.isPending) return;
    addMutation.mutate(body);
  };

  if (query.isLoading) return <TabLoading />;
  if (query.isError) return <ErrorState message={(query.error as Error)?.message} onRetry={() => query.refetch()} />;
  const notes = query.data?.data ?? [];

  return (
    <div className="space-y-4">
      <p className="text-[11.5px] text-text-tertiary">Notes internes à l’équipe plateforme — jamais visibles par ce client.</p>

      <div className="space-y-2">
        <textarea
          value={draft}
          disabled={addMutation.isPending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder="Ajouter une note (Cmd/Ctrl+Entrée pour envoyer)…"
          aria-label="Nouvelle note"
          rows={3}
          maxLength={4000}
          className="w-full px-3 py-2 rounded-md border border-outline bg-surface text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none"
        />
        {addMutation.isError && <p className="text-[11.5px] text-red-700">{(addMutation.error as Error)?.message || 'Échec de l’ajout.'}</p>}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || addMutation.isPending}
            className="h-7 px-3 rounded-md bg-text-primary text-surface text-[12px] font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {addMutation.isPending && <Loader2 size={12} className="animate-spin" />}
            Ajouter
          </button>
        </div>
      </div>

      {notes.length === 0 ? (
        <EmptyState title="Aucune note" description="Aucune note interne pour ce workspace pour l’instant." />
      ) : (
        <ul className="space-y-2.5">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md border border-outline px-3 py-2.5">
              <p className="text-[13px] text-text-primary whitespace-pre-wrap break-words">{n.body}</p>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <p className="text-[11px] text-text-tertiary">
                  {n.author_name ?? 'Équipe Lume'} · {fmtDateTime(n.created_at)}
                </p>
                {n.can_delete && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!(await confirmer({ message: 'Retirer cette note ?', danger: true }))) return;
                      deleteMutation.mutate(n.id);
                    }}
                    disabled={deleteMutation.isPending}
                    aria-label="Retirer cette note"
                    title="Retirer cette note"
                    className="shrink-0 text-text-tertiary hover:text-red-600 disabled:opacity-40 focus-visible:outline-none"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EngagementTab({ orgId }: { orgId: string }) {
  const query = useQuery({
    queryKey: ['creator-space', 'company', orgId, 'engagement'],
    queryFn: () => getCompanyEngagement(orgId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  if (query.isLoading) return <TabLoading />;
  if (query.isError) return <ErrorState message={(query.error as Error)?.message} onRetry={() => query.refetch()} />;
  const e = query.data!;
  const days = e.last_activity ? Math.floor((Date.now() - new Date(e.last_activity).getTime()) / 86400000) : null;
  const level = days == null ? 'inactive' : days <= 1 ? 'high' : days <= 7 ? 'medium' : days <= 30 ? 'low' : 'inactive';
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <EngagementBadge level={level} />
        <span className="text-[12.5px] text-text-secondary">
          Dernière activité : {e.last_activity ? fmtDateTime(e.last_activity) : 'aucune donnée'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <MiniStat label="Connexions (30 j)" value={e.logins_30d} />
        <MiniStat label="Utilisateurs actifs (30 j)" value={e.active_users_30d} />
        <MiniStat label="Jobs créés (30 j)" value={e.jobs_30d} />
        <MiniStat label="Clients au total" value={e.totals.clients} />
        <MiniStat label="Jobs au total" value={e.totals.jobs} />
        <MiniStat label="Devis / Factures" value={`${e.totals.quotes} / ${e.totals.invoices}`} />
      </div>
      <div>
        <h3 className="text-[11px] uppercase tracking-wide text-text-tertiary font-semibold mb-1.5">Activité récente</h3>
        {e.recent_activity.length === 0 ? (
          <p className="text-[12.5px] text-text-tertiary">Aucune activité enregistrée pour cette compagnie.</p>
        ) : (
          <ul className="space-y-1.5">
            {e.recent_activity.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                <span className="text-text-secondary truncate">
                  {a.event_type} · {a.entity_type}
                  {a.actor_id && (
                    <span className="text-text-tertiary">
                      {' · '}
                      <MaskedActor userId={a.actor_id} />
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-text-tertiary">{fmtDateTime(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11px] text-text-tertiary">
        Seules les connexions réussies sont captées ; les connexions multi-bureaux sont attribuées au premier bureau.
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-text-tertiary">{k}</dt>
      <dd className="text-text-secondary text-right">{v}</dd>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-outline px-3 py-2">
      <p className="text-[10.5px] uppercase tracking-wide text-text-tertiary font-semibold">{label}</p>
      <p className="text-[17px] font-bold text-text-primary leading-snug">{value}</p>
    </div>
  );
}
