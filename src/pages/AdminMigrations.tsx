// Console interne des migrations assistées — onglet « Migrations » du
// Creator Space (/creator-space/migrations ; l'ancienne URL /admin/migrations
// y redirige). Réservée aux comptes de platformAdminIds. Montée en mode
// `embedded` par le Creator Space, qui a déjà passé la sonde
// /api/creator-space/check (même liste platformAdminIds) ; montée seule, la
// page se gate elle-même via GET /api/migration-admin/check et redirige sinon.
// Le serveur re-vérifie de toute façon chaque requête. Périmètre limité aux
// projets de migration.

import { useEffect, useId, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { captureClientException } from '../lib/sentry';
import {
  ArrowLeft, Copy, Flag, Loader2, Plus, RefreshCw, Search, ShieldCheck, Database,
} from 'lucide-react';
import { useTranslation } from '../i18n';
import { type AuditBotMigration,
  checkPlatformAdmin, listMigrations, createMigration, getMigrationDetail, setMigrationStatus,
  generateInvitation, revokeInvitation, extendInvitation, decideMapping, resolveIssue,
  decideDuplicate, startAnalysis, startTestImport, requestApproval, startFinalImport,
  rollbackMigration, closeMigration, sendAdminMessage, getMigrationAudit, getFileDownloadUrl,
  reanalyzeFile, rejectFile, deleteFile, downloadRejectsCsv, retryErrors, getMigrationStaff, saveStaffMap,
  getMigrationMembers, listMappingTemplates, saveMappingTemplate, applyMappingTemplate, flagMapping,
  type AdminMigrationListItem, type MigrationStaffEntry, type MappingFlag,
} from '../lib/migrationAdminApi';
import { lancerBotMigration, attendreFinBot, getRapportBot, definirBotActif, definirModeBot, approuverAuNomDuClient, type RapportBotMigration } from '../lib/migrationAdminApi';
import { confirmer } from '../components/ui/ConfirmDialog';
import FieldTargetPicker, { ENTITY_LABELS_FR, type FieldCatalog } from '../components/migration/FieldTargetPicker';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  invitation_sent: 'Invitation envoyée',
  waiting_for_files: 'En attente du client',
  files_uploaded: 'Fichiers reçus',
  parsing: 'Analyse en cours',
  mapping: 'Correspondance',
  human_review: 'Validation humaine',
  waiting_for_client: 'En attente du client',
  ready_for_test: 'Prête pour test',
  testing: 'Import test…',
  test_review: 'Révision du test',
  waiting_for_approval: 'Attente d\'approbation',
  approved: 'Approuvée',
  ready_for_final_import: 'Prête pour import final',
  importing: 'Importation…',
  post_import_validation: 'Validation…',
  completed: 'Terminée',
  completed_with_warnings: 'Terminée (avertissements)',
  failed: 'Échouée',
  rolled_back: 'Annulée (rollback)',
  cancelled: 'Annulée',
};

const STATUS_FILTERS = [
  ['', 'Toutes'],
  ['waiting_for_files', 'En attente du client'],
  ['files_uploaded', 'Fichiers reçus'],
  ['parsing', 'Analyse en cours'],
  ['mapping', 'Correspondance'],
  ['human_review', 'Validation humaine'],
  ['test_review', 'Révision du test'],
  ['waiting_for_approval', 'Attente d\'approbation'],
  ['ready_for_final_import', 'Prête pour import'],
  ['importing', 'Importation'],
  ['completed', 'Terminée'],
  ['failed', 'Échouée'],
  ['cancelled', 'Annulée'],
] as const;

const CRM_LABELS: Record<string, string> = {
  jobber: 'Jobber', housecall_pro: 'Housecall Pro', servicetitan: 'ServiceTitan',
  gohighlevel: 'GoHighLevel', quickbooks: 'QuickBooks', other: 'Autre', custom_files: 'Fichiers',
};

const RISK_BADGE: Record<string, string> = {
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-red-50 text-red-700 border-red-200',
};

function StatusBadgeMig({ status }: { status: string }) {
  const tone = ['completed', 'completed_with_warnings', 'approved'].includes(status)
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : ['failed', 'cancelled', 'rolled_back'].includes(status)
      ? 'bg-red-50 text-red-700 border-red-200'
      : ['importing', 'testing', 'parsing', 'post_import_validation'].includes(status)
        ? 'bg-blue-50 text-blue-700 border-blue-200'
        : 'bg-surface-secondary text-text-secondary border-outline';
  return (
    <span className={`inline-flex items-center px-2 h-5.5 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${tone}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export default function AdminMigrations({ embedded = false }: { embedded?: boolean }) {
  // Embarquée dans le Creator Space : la sonde /api/creator-space/check a déjà
  // validé l'appartenance à platformAdminIds, inutile de re-sonder ici.
  const gate = useQuery({ queryKey: ['migration-admin-check'], queryFn: checkPlatformAdmin, staleTime: 5 * 60_000, retry: false, enabled: !embedded });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!embedded) {
    if (gate.isLoading) {
      return <div className="flex items-center justify-center py-24 text-text-tertiary"><Loader2 size={22} className="animate-spin" /></div>;
    }
    if (!gate.data) return <Navigate to="/" replace />;
  }

  return (
    <div className={embedded ? undefined : 'px-8 py-6'}>
      {selectedId
        ? <MigrationDetail id={selectedId} onBack={() => setSelectedId(null)} />
        : <MigrationList onOpen={setSelectedId} />}
    </div>
  );
}

// ── Liste ────────────────────────────────────────────────────────────────

function MigrationList({ onOpen }: { onOpen: (id: string) => void }) {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const query = useQuery({
    queryKey: ['migration-admin-list', status, q, page],
    queryFn: () => listMigrations({ status: status || undefined, q: q || undefined, page }),
    refetchOnWindowFocus: false,
  });
  const rows = query.data?.data ?? [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <Database size={20} className="text-text-tertiary" />
        <h1 className="text-[28px] font-bold text-text-primary">Migrations assistées</h1>
        <span className="inline-flex items-center gap-1 px-2 h-6 rounded-full bg-surface-secondary border border-outline text-[11px] text-text-secondary font-semibold">
          <ShieldCheck size={12} /> Console interne
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => query.refetch()}
          className="h-10 px-4 bg-surface-card border border-outline text-text-secondary rounded-md text-[13px] font-medium hover:bg-surface-secondary inline-flex items-center gap-2"
        >
          <RefreshCw size={14} /> Actualiser
        </button>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 h-10 px-5 bg-[#d8d0c2] text-[#000] hover:bg-[#cabfad] rounded-md text-[14px] font-medium active:scale-[0.98] transition-all"
        >
          <Plus size={15} /> Nouvelle migration
        </button>
      </div>
      <p className="text-[13px] text-text-tertiary mb-5">
        Transfert supervisé des données d'un ancien CRM vers un workspace. Le client n'a jamais de bouton d'import permanent.
      </p>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {STATUS_FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => { setStatus(value); setPage(1); }}
            className={`h-8 px-3 rounded-full border text-[12px] font-medium transition-colors ${
              status === value ? 'bg-text-primary text-white border-text-primary' : 'bg-surface-card text-text-secondary border-outline hover:bg-surface-secondary'
            }`}
          >
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Entreprise, courriel, CRM, ID…"
            aria-label="Rechercher une migration"
            className="h-9 w-[240px] pl-8 pr-3 text-[13px] bg-surface-card border border-outline rounded-md text-text-primary placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-[#94a3b8]"
          />
        </div>
      </div>

      <div className="border border-outline rounded-md overflow-x-auto bg-white dark:bg-[#0e0e11]">
        <div className="grid min-w-[980px] text-[13px]" style={{ gridTemplateColumns: '1.4fr 110px 170px 70px 90px 80px 80px 130px 120px' }}>
          {['Workspace', 'CRM', 'Statut', 'Fichiers', 'Dossiers', 'Problèmes', 'Risque', 'Invitation', 'Approbation'].map((h) => (
            <div key={h} className="px-3 py-2.5 bg-surface-secondary/60 border-b border-outline font-semibold text-text-secondary text-[12px]">{h}</div>
          ))}
          {query.isLoading && (
            <div className="col-span-9 px-3 py-8 text-center text-text-tertiary"><Loader2 size={18} className="animate-spin inline" /></div>
          )}
          {!query.isLoading && rows.length === 0 && (
            <div className="col-span-9 px-3 py-10 text-center text-text-tertiary text-[13px]">Aucune migration.</div>
          )}
          {rows.map((m) => <ListRow key={m.id} m={m} onOpen={() => onOpen(m.id)} />)}
        </div>
      </div>

      {(query.data?.total ?? 0) > (query.data?.pageSize ?? 20) && (
        <div className="flex items-center gap-2 mt-3 text-[13px] text-text-secondary">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-8 px-3 border border-outline rounded-md disabled:opacity-40">Précédent</button>
          <span>Page {page}</span>
          <button
            type="button"
            disabled={page * (query.data?.pageSize ?? 20) >= (query.data?.total ?? 0)}
            onClick={() => setPage((p) => p + 1)}
            className="h-8 px-3 border border-outline rounded-md disabled:opacity-40"
          >
            Suivant
          </button>
        </div>
      )}

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={(id) => { setShowCreate(false); onOpen(id); }} />}
    </div>
  );
}

function ListRow({ m, onOpen }: { m: AdminMigrationListItem; onOpen: () => void }) {
  const cell = 'px-3 py-2.5 border-b border-outline/30 flex items-center min-w-0 text-text-primary';
  const detected = Object.values(m.detected_counts ?? {}).reduce((a, b) => a + b, 0);
  const invitationState = !m.invitation
    ? '—'
    : m.invitation.revoked_at
      ? 'Révoquée'
      : new Date(m.invitation.expires_at).getTime() < Date.now()
        ? 'Expirée'
        : `Expire ${new Date(m.invitation.expires_at).toLocaleDateString('fr-CA')}`;
  return (
    <>
      <button type="button" onClick={onOpen} className={`${cell} text-left crm-row-hover cursor-pointer`}>
        <div className="min-w-0">
          <div className="truncate font-medium">{m.org_name ?? m.org_id}</div>
          <div className="text-[11px] text-text-tertiary truncate">{m.invited_email ?? '—'}</div>
        </div>
      </button>
      <div className={cell}>{CRM_LABELS[m.source_crm] ?? m.source_crm}</div>
      <div className={cell}><StatusBadgeMig status={m.status} /></div>
      <div className={cell}>{m.files_count}</div>
      <div className={cell}>{detected}</div>
      <div className={cell}>{m.open_issues > 0 ? <span className="text-amber-700 font-semibold">{m.open_issues}</span> : '0'}</div>
      <div className={cell}>
        <span className={`inline-flex px-2 h-5 items-center rounded-full border text-[11px] font-semibold ${RISK_BADGE[m.risk_level]}`}>
          {m.risk_level === 'low' ? 'Faible' : m.risk_level === 'medium' ? 'Moyen' : 'Élevé'}
        </span>
      </div>
      <div className={`${cell} text-[12px] text-text-secondary`}>{invitationState}</div>
      <div className={`${cell} text-[12px] text-text-secondary`}>
        {m.latest_approval ? `${m.latest_approval.decision} (v${m.latest_approval.report_version})` : '—'}
      </div>
    </>
  );
}

const CATEGORY_OPTIONS = [
  ['taxes', 'Noms de taxes'], ['clients', 'Clients'], ['properties', 'Propriétés'], ['billing_addresses', 'Adresses de facturation'],
  ['services', 'Produits et services'],
  ['quotes', 'Soumissions'], ['jobs', 'Jobs'], ['visits', 'Visites'], ['invoices', 'Factures'],
] as const;

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const id = useId();
  const [orgId, setOrgId] = useState('');
  const [email, setEmail] = useState('');
  const [categories, setCategories] = useState<string[]>(['taxes', 'clients', 'properties', 'billing_addresses', 'services', 'quotes', 'jobs', 'visits', 'invoices']);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-[120] bg-black/30 flex items-center justify-center p-4" role="presentation" tabIndex={-1} onClick={onClose}>
      <div className="bg-surface-card border border-outline rounded-xl shadow-xl w-full max-w-[480px] p-6" role="dialog" aria-modal="true" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[17px] font-bold text-text-primary mb-4">Nouvelle migration</h2>
        <div className="space-y-3 text-[13px]">
          <div>
            <label htmlFor={`${id}-org`} className="block text-text-secondary font-medium mb-1">ID du workspace (org_id) *</label>
            <input id={`${id}-org`} value={orgId} onChange={(e) => setOrgId(e.target.value.trim())} placeholder="uuid du workspace" className="w-full h-9 px-3 bg-surface border border-outline rounded-md" />
          </div>
          <div>
            <label htmlFor={`${id}-email`} className="block text-text-secondary font-medium mb-1">Courriel du client invité</label>
            <input id={`${id}-email`} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="proprietaire@entreprise.com" className="w-full h-9 px-3 bg-surface border border-outline rounded-md" />
          </div>
          {/* Choix de l'ancien CRM retiré volontairement : pas de lien direct
              pour l'instant — toute migration part en mode générique (fichiers).
              Réactivable plus tard via PATCH source_crm côté serveur. */}
          <div>
            <span className="block text-text-secondary font-medium mb-1">Catégories à migrer</span>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map(([value, label]) => (
                <label key={value} className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={categories.includes(value)}
                    onChange={(e) => setCategories((c) => (e.target.checked ? [...c, value] : c.filter((x) => x !== value)))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor={`${id}-notes`} className="block text-text-secondary font-medium mb-1">Notes internes</label>
            <textarea id={`${id}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full h-16 px-3 py-2 bg-surface border border-outline rounded-md" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="h-9 px-4 border border-outline rounded-md text-[13px] text-text-secondary">Annuler</button>
          <button
            type="button"
            disabled={busy || !orgId}
            onClick={async () => {
              setBusy(true);
              try {
                const created = await createMigration({
                  org_id: orgId,
                  source_crm: 'custom_files',
                  categories,
                  invited_email: email.trim() || null,
                  internal_notes: notes.trim() || null,
                });
                toast.success('Migration créée');
                onCreated(created.id);
              } catch (err: any) {
                toast.error(err?.message ?? 'Erreur');
              } finally {
                setBusy(false);
              }
            }}
            className="h-9 px-5 bg-[#d8d0c2] text-black hover:bg-[#cabfad] rounded-md text-[13px] font-medium disabled:opacity-50"
          >
            {busy ? '…' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Détail ───────────────────────────────────────────────────────────────

type Tab = 'resume' | 'files' | 'mappings' | 'bot' | 'issues' | 'duplicates' | 'imports' | 'audit' | 'messages';
const TABS: { id: Tab; label: string }[] = [
  { id: 'resume', label: 'Résumé' },
  { id: 'files', label: 'Fichiers' },
  { id: 'mappings', label: 'Correspondances' },
  { id: 'bot', label: 'Rapport du bot' },
  { id: 'issues', label: 'Problèmes' },
  { id: 'duplicates', label: 'Doublons' },
  { id: 'imports', label: 'Imports' },
  { id: 'audit', label: 'Audit' },
  { id: 'messages', label: 'Messages' },
];

function MigrationDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('resume');
  const detail = useQuery({
    queryKey: ['migration-admin-detail', id],
    queryFn: () => getMigrationDetail(id),
    refetchInterval: (query) => {
      const migration = (query.state.data as any)?.migration;
      const status = migration?.status;
      if (passeBotActive(migration?.bot_dernier_rapport)) return 2500;
      return ['parsing', 'testing', 'importing', 'post_import_validation'].includes(status) ? 2500 : false;
    },
    refetchOnWindowFocus: false,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['migration-admin-detail', id] });

  if (detail.isLoading || !detail.data) {
    return <div className="flex items-center justify-center py-24 text-text-tertiary"><Loader2 size={22} className="animate-spin" /></div>;
  }
  const d = detail.data;
  const m = d.migration;

  return (
    <div>
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text-primary mb-3">
        <ArrowLeft size={14} /> Toutes les migrations
      </button>
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <h1 className="text-[26px] font-bold text-text-primary">{d.org_name ?? m.org_id}</h1>
        <StatusBadgeMig status={m.status} />
        <span className="text-[13px] text-text-tertiary">{CRM_LABELS[m.source_crm] ?? m.source_crm}</span>
        <div className="flex-1" />
        <ActionsBar m={m} d={d} onDone={refresh} />
      </div>
      <p className="text-[12px] text-text-tertiary mb-4">
        ID {m.id} · créée le {new Date(m.created_at).toLocaleDateString('fr-CA')} · dernière activité {new Date(m.last_activity_at).toLocaleString('fr-CA')}
      </p>

      <CarteImportEnCours d={d} />
      <CarteBotEnCours m={m} />

      <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-secondary/60 border border-outline w-fit mb-5 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`h-8 px-3.5 rounded-lg text-[13px] font-medium transition-colors ${tab === t.id ? 'bg-surface-card shadow-sm text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
          >
            {t.label}
            {t.id === 'issues' && d.issues.filter((i: any) => !i.resolved_at).length > 0 && (
              <span className="ml-1.5 text-amber-700 font-bold">{d.issues.filter((i: any) => !i.resolved_at).length}</span>
            )}
            {t.id === 'bot' && aFaireBot(m.bot_dernier_rapport) > 0 && (
              <span className="ml-1.5 text-amber-700 font-bold">{aFaireBot(m.bot_dernier_rapport)}</span>
            )}
            {t.id === 'duplicates' && doublonsATrancher(d.duplicates) > 0 && (
              <span className="ml-1.5 text-amber-700 font-bold">{doublonsATrancher(d.duplicates)}{(d.duplicates?.length ?? 0) >= 500 ? '+' : ''}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'resume' && <ResumeTab d={d} onChanged={refresh} onOuvrirOnglet={setTab} />}
      {tab === 'bot' && <RapportBotTab d={d} onOuvrirOnglet={setTab} />}
      {tab === 'files' && <FilesTab d={d} onChanged={refresh} />}
      {tab === 'mappings' && <MappingsTab d={d} onChanged={refresh} />}
      {tab === 'issues' && <IssuesTab d={d} onChanged={refresh} />}
      {tab === 'duplicates' && <DuplicatesTab d={d} onChanged={refresh} />}
      {tab === 'imports' && <ImportsTab d={d} />}
      {tab === 'audit' && <AuditTab id={m.id} />}
      {tab === 'messages' && <MessagesTab d={d} onChanged={refresh} />}
    </div>
  );
}

function formatDuree(secondes: number): string {
  if (secondes < 60) return `${secondes} s`;
  return `${Math.floor(secondes / 60)} min ${String(secondes % 60).padStart(2, '0')} s`;
}

/** Suivi en direct d'un import test ou final : étape courante, lignes faites,
 *  types de données faits, durée. Lit totals.progress du lot « running »
 *  (relu toutes les 2,5 s par la fiche) ; le chrono tourne localement. */
function CarteImportEnCours({ d }: { d: any }) {
  const m = d.migration;
  const lot = (d.batches ?? []).find((b: any) => b.status === 'running') ?? null;
  const actif = !!lot || ['testing', 'importing', 'post_import_validation'].includes(m.status);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    if (!actif) return;
    const t = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(t);
  }, [actif]);
  if (!actif) return null;
  const p = lot?.totals?.progress ?? null;
  const debut = lot?.started_at ? new Date(lot.started_at).getTime() : null;
  const secondes = debut ? Math.max(0, Math.round((maintenant - debut) / 1000)) : null;
  const titre = m.status === 'post_import_validation'
    ? 'Validation après import'
    : (lot?.kind === 'final' || m.status === 'importing') ? 'Import final en cours' : 'Import test en cours';
  const pctEntites = p && p.entites_total > 0 ? Math.round((p.entites_faites / p.entites_total) * 100) : null;
  const pctLignes = p && p.total > 0 ? Math.min(100, Math.round((p.processed / p.total) * 100)) : null;
  const depuisMaj = p?.updated_at ? Math.max(0, Math.round((maintenant - new Date(p.updated_at).getTime()) / 1000)) : null;
  return (
    <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50/60 p-4" role="status" aria-live="polite">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="relative flex h-2.5 w-2.5" aria-hidden="true"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600" /></span>
        <p className="text-[13px] font-semibold text-blue-900">{titre}{secondes !== null && ` — ${formatDuree(secondes)}`}</p>
        <span className="text-[11.5px] text-blue-900/60">{depuisMaj !== null ? `dernier signe de vie il y a ${depuisMaj} s` : 'la fiche se rafraîchit toute seule'}</span>
      </div>
      <p className="mt-1 text-[12.5px] text-blue-900/90">{p?.etape ?? 'Démarrage…'}</p>
      {pctEntites !== null && (
        <div className="mt-2">
          <div className="h-1.5 w-full rounded-full bg-blue-100 overflow-hidden"><div className="h-full bg-blue-500 transition-all" style={{ width: `${pctEntites}%` }} /></div>
          <p className="mt-1 text-[11.5px] text-blue-900/80">{p.entites_faites} / {p.entites_total} types de données faits</p>
        </div>
      )}
      {pctLignes !== null && (
        <div className="mt-2">
          <div className="h-1.5 w-full rounded-full bg-blue-100 overflow-hidden"><div className="h-full bg-blue-400 transition-all" style={{ width: `${pctLignes}%` }} /></div>
          <p className="mt-1 text-[11.5px] text-blue-900/80">{p.processed} / {p.total} lignes dans cette étape</p>
        </div>
      )}
    </div>
  );
}

/** Une passe du bot est-elle en cours d'après le rapport publié ? Même règle que le verrou serveur
 *  (bot.ts › passeBotEnCours) : `en_cours` vrai ET démarrée il y a moins de 20 min — au-delà, un
 *  drapeau resté vrai après un redémarrage du serveur ne fige plus la console. */
function passeBotActive(r: RapportBotMigration | null | undefined): boolean {
  if (!r?.en_cours || !r.debut) return false;
  return Date.now() - new Date(r.debut).getTime() < 20 * 60 * 1000;
}

function ActionsBar({ m, d, onDone }: { m: any; d: any; onDone: () => void }) {
  const [confirmKind, setConfirmKind] = useState<'final' | 'rollback' | null>(null);
  // Une action à la fois : absorbe les doubles clics (deux passes du bot lancées à 20 s d'écart le 2026-09-19).
  const [enCours, setEnCours] = useState(false);
  // Passe du bot en cours d'après le serveur : visible depuis n'importe quel onglet, et même après un
  // rechargement de la page (la fiche se rafraîchit toutes les 2,5 s tant que ça tourne).
  const rapportBot = (m.bot_dernier_rapport ?? null) as RapportBotMigration | null;
  const botEnCours = passeBotActive(rapportBot);
  const botOccupe = enCours || botEnCours;
  const btn = 'h-9 px-3.5 rounded-md text-[13px] font-medium border transition-colors';
  const subtle = `${btn} bg-surface-card border-outline text-text-secondary hover:bg-surface-secondary`;
  const primary = `${btn} bg-[#d8d0c2] border-transparent text-black hover:bg-[#cabfad]`;
  const danger = `${btn} bg-red-50 border-red-200 text-red-700 hover:bg-red-100`;

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    if (enCours) return;
    setEnCours(true);
    try {
      await fn();
      toast.success(okMsg);
      onDone();
    } catch (err: any) {
      toast.error(err?.message ?? 'Erreur');
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {['files_uploaded', 'parsing', 'mapping', 'human_review', 'waiting_for_client', 'ready_for_test', 'test_review'].includes(m.status) && (
        <button type="button" className={`${primary} inline-flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed`} disabled={botOccupe} onClick={() => act(async () => {
          const { depuis } = await lancerBotMigration(m.id);
          // Le bot publie « Démarrage… » dans la fiche quelques centaines de ms après le 202 : on
          // recharge tout de suite puis deux fois encore pour attraper en_cours et enclencher le
          // rafraîchissement automatique (bande verte au-dessus des onglets).
          onDone();
          setTimeout(onDone, 1500);
          setTimeout(onDone, 4000);
          toast.message('Passe du bot lancée : suivi en direct au-dessus des onglets, environ 1 minute par fichier.');
          const r = await attendreFinBot(m.id, depuis);
          if (!r) throw new Error('La passe du bot dépasse 20 minutes : rafraîchissez la page plus tard, le rapport apparaîtra dans la carte Bot.');
          toast.message(`Bot : ${r.decisions.length} décision${r.decisions.length > 1 ? 's' : ''} — ${r.arret}`);
        }, 'Passe du bot terminée')}>
          {botOccupe && <Loader2 size={13} className="animate-spin" />}
          {botOccupe ? 'Passe du bot en cours…' : 'Confier au bot'}
        </button>
      )}
      {botEnCours && (
        <span className="inline-flex items-center gap-1.5 text-[12px] text-text-tertiary">
          {rapportBot?.etape_courante ?? 'Le bot travaille'}
          {rapportBot?.progression && rapportBot.progression.fichiers_total > 0 ? ` — ${rapportBot.progression.fichiers_faits}/${rapportBot.progression.fichiers_total} fichiers` : ''}
        </span>
      )}
      {['files_uploaded', 'parsing', 'mapping', 'human_review', 'waiting_for_client'].includes(m.status) && (
        <button type="button" className={subtle} onClick={() => act(() => startAnalysis(m.id), 'Analyse relancée')}>Relancer l'analyse</button>
      )}
      {['mapping', 'human_review', 'waiting_for_client', 'ready_for_test', 'test_review'].includes(m.status) && (
        <button type="button" className={primary} onClick={() => act(() => startTestImport(m.id), 'Import test lancé')}>Lancer l'import test</button>
      )}
      {m.status === 'test_review' && (
        <button type="button" className={primary} onClick={() => act(() => requestApproval(m.id), 'Approbation demandée au client')}>Demander l'approbation</button>
      )}
      {m.status === 'waiting_for_approval' && (
        <button type="button" className={primary} onClick={async () => {
          const ok = await confirmer({ title: 'Approuver au nom du client', message: "Vous validez l'aperçu de l'import test à la place du client (mode autonome). L'approbation sera enregistrée à votre nom, avec un commentaire qui le dit, et le client en sera informé dans son portail. L'import final reste un geste séparé.", confirmLabel: 'Approuver au nom du client' });
          if (!ok) return;
          await act(() => approuverAuNomDuClient(m.id), 'Approuvée au nom du client — passez la migration « prête pour l\'import final »');
        }}>Approuver au nom du client</button>
      )}
      {(m.status === 'approved' || m.status === 'completed_with_warnings') && (
        <button type="button" className={primary} onClick={() => act(() => setMigrationStatus(m.id, 'ready_for_final_import'), 'Migration prête pour l\'import final')}>
          {m.status === 'approved' ? 'Marquer prête pour l\'import' : 'Préparer l\'import complémentaire'}
        </button>
      )}
      {['failed', 'completed_with_warnings'].includes(m.status) && (
        <button type="button" className={subtle} onClick={() => act(async () => { const r = await retryErrors(m.id); toast.success(`${r.reset} ligne(s) remises en file`); }, 'Lignes en erreur relancées')}>
          Relancer les lignes en erreur
        </button>
      )}
      {m.status === 'failed' && (
        // failed → ready_for_final_import (machine à états) : l'import est idempotent,
        // la reprise ne recrée rien (migration_import_records + ids déterministes).
        <button type="button" className={primary} onClick={() => act(async () => {
          const r = await retryErrors(m.id);
          await setMigrationStatus(m.id, 'ready_for_final_import');
          toast.message(`${r.reset} ligne(s) en erreur remises en file — cliquez maintenant « Lancer l'import final » : seules les lignes manquantes seront écrites.`);
        }, 'Prête pour la reprise de l\'import final')}>Reprendre l'import final</button>
      )}
      <button
        type="button"
        className={subtle}
        onClick={async () => {
          try {
            const csv = await downloadRejectsCsv(m.id);
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `rejets-${m.id.slice(0, 8)}.csv`; a.click();
            URL.revokeObjectURL(url);
          } catch (err: any) { toast.error(err?.message ?? 'Erreur'); }
        }}
      >
        Exporter les rejets (CSV)
      </button>
      {m.status === 'ready_for_final_import' && (
        <button type="button" className={danger} onClick={() => setConfirmKind('final')}>Lancer l'import final</button>
      )}
      {['completed', 'completed_with_warnings', 'failed'].includes(m.status) && (
        <button type="button" className={danger} onClick={() => setConfirmKind('rollback')}>Rollback</button>
      )}
      {!m.closed_at && ['completed', 'completed_with_warnings', 'rolled_back', 'cancelled', 'failed'].includes(m.status) && (
        <button type="button" className={subtle} onClick={() => act(() => closeMigration(m.id), 'Migration fermée')}>Fermer</button>
      )}
      {!['completed', 'completed_with_warnings', 'cancelled', 'rolled_back', 'importing'].includes(m.status) && (
        <button type="button" className={subtle} onClick={() => act(() => setMigrationStatus(m.id, 'cancelled'), 'Migration annulée')}>Annuler</button>
      )}
      {confirmKind && (
        <StrongConfirmModal
          kind={confirmKind}
          orgName={d.org_name ?? ''}
          summary={confirmKind === 'final'
            ? 'L\'import final écrira les données approuvées dans le workspace du client. Approbation client et absence d\'erreurs bloquantes déjà vérifiées côté serveur.'
            : 'Le rollback retire (soft-delete) UNIQUEMENT les dossiers créés par le dernier lot d\'import final. Les dossiers fusionnés et les données préexistantes ne sont pas touchés.'}
          onClose={() => setConfirmKind(null)}
          onConfirm={async (typed) => {
            if (confirmKind === 'final') await act(() => startFinalImport(m.id, typed), 'Import final démarré');
            else await act(() => rollbackMigration(m.id, typed), 'Rollback effectué');
            setConfirmKind(null);
          }}
        />
      )}
    </div>
  );
}

function StrongConfirmModal({ kind, orgName, summary, onClose, onConfirm }: {
  kind: 'final' | 'rollback'; orgName: string; summary: string; onClose: () => void; onConfirm: (typed: string) => Promise<void>;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-[120] bg-black/30 flex items-center justify-center p-4" role="presentation" tabIndex={-1} onClick={onClose}>
      <div className="bg-surface-card border border-outline rounded-xl shadow-xl w-full max-w-[440px] p-6" role="dialog" aria-modal="true" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[16px] font-bold text-text-primary mb-2">
          {kind === 'final' ? 'Confirmer l\'import final' : 'Confirmer le rollback'}
        </h2>
        <p className="text-[13px] text-text-secondary mb-4">{summary}</p>
        <p className="text-[12px] text-text-secondary mb-1.5">
          Saisissez le nom exact du workspace (<strong>{orgName}</strong>) pour confirmer :
        </p>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Nom exact du workspace" className="w-full h-9 px-3 text-[13px] bg-surface border border-outline rounded-md mb-4" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-4 border border-outline rounded-md text-[13px] text-text-secondary">Annuler</button>
          <button
            type="button"
            disabled={busy || typed.trim() !== orgName.trim() || !orgName}
            onClick={async () => { setBusy(true); await onConfirm(typed.trim()); setBusy(false); }}
            className="h-9 px-5 bg-red-600 text-white hover:bg-red-700 rounded-md text-[13px] font-medium disabled:opacity-40"
          >
            {busy ? '…' : 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StaffCard({ migrationId }: { migrationId: string }) {
  const qc = useQueryClient();
  const staffQ = useQuery({ queryKey: ['migration-staff', migrationId], queryFn: () => getMigrationStaff(migrationId), retry: false, refetchOnWindowFocus: false });
  const membersQ = useQuery({ queryKey: ['migration-members', migrationId], queryFn: () => getMigrationMembers(migrationId), refetchOnWindowFocus: false });
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  if (staffQ.isError) {
    return (
      <div className="section-card p-5">
        <h3 className="text-[14px] font-bold text-text-primary mb-2">Employés historiques</h3>
        <p className="text-[12px] text-amber-700">{(staffQ.error as any)?.message ?? 'Indisponible'}</p>
      </div>
    );
  }
  const staff = staffQ.data?.staff ?? [];
  if (staff.length === 0) {
    return (
      <div className="section-card p-5">
        <h3 className="text-[14px] font-bold text-text-primary mb-2">Employés historiques</h3>
        <p className="text-[13px] text-text-tertiary">Aucune colonne « assigné à / vendeur » détectée dans les fichiers.</p>
      </div>
    );
  }
  return (
    <div className="section-card p-5">
      <h3 className="text-[14px] font-bold text-text-primary mb-1">Employés historiques</h3>
      <p className="text-[12px] text-text-tertiary mb-3">
        Associez chaque nom trouvé dans les fichiers à un membre actuel — ou laissez « Non assigné » (aucun compte n'est créé).
      </p>
      <div className="space-y-2">
        {staff.map((entry: MigrationStaffEntry) => (
          <div key={entry.source_key} className="flex items-center gap-3 text-[13px]">
            <span className="w-[180px] truncate font-medium text-text-primary">{entry.label}</span>
            <span className="text-[11px] text-text-tertiary w-[70px]">{entry.count} ligne(s)</span>
            <select
              value={(entry.source_key in draft ? draft[entry.source_key] : entry.user_id) ?? ''}
              onChange={(e) => setDraft((prev) => ({ ...prev, [entry.source_key]: e.target.value || null }))}
              aria-label={`Membre associé à ${entry.label}`}
              className="h-8 px-2 bg-surface border border-outline rounded-md flex-1 max-w-[260px]"
            >
              <option value="">— Historique non assigné —</option>
              {(membersQ.data ?? []).map((mb) => <option key={mb.user_id} value={mb.user_id}>{mb.name} ({mb.role})</option>)}
            </select>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-3 h-9 px-4 bg-[#d8d0c2] text-black hover:bg-[#cabfad] rounded-md text-[13px] font-medium"
        onClick={async () => {
          try {
            const mappings = staff.map((entry) => ({
              source: entry.label,
              user_id: (entry.source_key in draft ? draft[entry.source_key] : entry.user_id) ?? null,
            }));
            const r = await saveStaffMap(migrationId, mappings);
            toast.success(`${r.saved} correspondance(s) enregistrée(s) — relancez l'import test pour les appliquer`);
            qc.invalidateQueries({ queryKey: ['migration-staff', migrationId] });
          } catch (err: any) { toast.error(err?.message ?? 'Erreur'); }
        }}
      >
        Enregistrer les correspondances
      </button>
    </div>
  );
}

/** Bande de suivi en direct d'une passe du bot, au-dessus des onglets (visible partout). La fiche se
 *  rafraîchit toutes les 2,5 s tant que `bot_dernier_rapport.en_cours` est vrai (refetchInterval). */
function CarteBotEnCours({ m }: { m: any }) {
  const rapport = (m.bot_dernier_rapport ?? null) as RapportBotMigration | null;
  const actif = passeBotActive(rapport);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    if (!actif) return;
    const t = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(t);
  }, [actif]);
  if (!actif || !rapport) return null;
  const secondes = Math.max(0, Math.round((maintenant - new Date(rapport.debut).getTime()) / 1000));
  const p = rapport.progression;
  return (
    <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4" role="status" aria-live="polite">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="relative flex h-2.5 w-2.5" aria-hidden="true"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-600" /></span>
        <p className="text-[13px] font-semibold text-emerald-900">Passe du bot en cours — {secondes} s</p>
        <span className="text-[11.5px] text-emerald-900/60">{rapport.declencheur === 'cron' ? 'lancée par le cron' : 'lancée à la main'} · la fiche se rafraîchit toute seule</span>
      </div>
      <p className="mt-1 text-[12.5px] text-emerald-900/90">{rapport.etape_courante ?? 'Démarrage…'}</p>
      {p && p.fichiers_total > 0 && (
        <div className="mt-2">
          <div className="h-1.5 w-full rounded-full bg-emerald-100 overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round((p.fichiers_faits / p.fichiers_total) * 100)}%` }} /></div>
          <p className="mt-1 text-[11.5px] text-emerald-900/80">{p.fichiers_faits} / {p.fichiers_total} fichiers</p>
        </div>
      )}
      {rapport.decisions.length > 0 && (
        <ul className="mt-2 space-y-0.5 max-h-32 overflow-auto text-[12px] text-emerald-950/90">
          {rapport.decisions.slice(-5).map((d, i) => <li key={`${rapport.decisions.length}-${i}`}>· {d.etape} — {d.cible} : {d.decision}</li>)}
        </ul>
      )}
    </div>
  );
}

/** Doublons encore à trancher (pending/review) — badge de l'onglet, même règle que le compteur du bot.
 *  La fiche n'en renvoie que 500 : au-delà, le badge porte un « + ». */
function doublonsATrancher(dupes: any[] | null | undefined): number {
  return (dupes ?? []).filter((d) => d.decision === 'pending' || d.decision === 'review').length;
}

/** Nombre d'éléments qui attendent quelqu'un (à trancher + manques) dans le dernier rapport du bot — badge de l'onglet. */
function aFaireBot(rapport: any): number {
  const a = (rapport as RapportBotMigration | null)?.audit;
  return a ? a.a_verifier.length + a.manques.length : 0;
}

async function copierTextePourClaude(texte: string, ouvrirTexte: () => void): Promise<void> {
  try { await navigator.clipboard.writeText(texte); toast.success('Audit copié : collez-le à Claude Code avec « applique l\'audit »'); }
  catch (err) { captureClientException(err, { where: 'copierTextePourClaude' }); toast.error('Copie impossible : sélectionnez le texte affiché'); ouvrirTexte(); }
}

/** Résumé compact dans la carte Bot : 4 compteurs + accès au rapport complet. */
function ResumeAuditBot({ audit, onOuvrir }: { audit: AuditBotMigration; onOuvrir: () => void }) {
  const tuiles: Array<{ n: number; label: string; ton: string }> = [
    { n: audit.a_verifier.length, label: 'à trancher par vous', ton: audit.a_verifier.length ? 'text-amber-700' : 'text-text-tertiary' },
    { n: audit.manques.length, label: 'manques pour Claude', ton: audit.manques.length ? 'text-violet-700' : 'text-text-tertiary' },
    { n: audit.corrections.length, label: 'corrections faites', ton: audit.corrections.length ? 'text-emerald-700' : 'text-text-tertiary' },
    { n: audit.alertes.length, label: 'alertes', ton: audit.alertes.length ? 'text-red-700' : 'text-text-tertiary' },
  ];
  return (
    <div className="mt-3 flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-4 flex-wrap">
        {tuiles.map((t) => (
          <div key={t.label} className="flex items-baseline gap-1.5"><span className={`text-[20px] font-bold leading-none ${t.ton}`}>{t.n}</span><span className="text-[12px] text-text-secondary">{t.label}</span></div>
        ))}
      </div>
      <div className="flex-1" />
      <button type="button" onClick={onOuvrir} className="h-8 px-3 rounded-md text-[12.5px] font-medium bg-[#d8d0c2] text-black hover:bg-[#cabfad]">Voir le rapport</button>
    </div>
  );
}

/** Regroupe des lignes par fichier, dans l'ordre d'apparition. */
function parFichier<T extends { fichier: string }>(items: T[]): Array<{ fichier: string; items: T[] }> {
  const groupes = new Map<string, T[]>();
  for (const it of items) groupes.set(it.fichier, [...(groupes.get(it.fichier) ?? []), it]);
  return [...groupes.entries()].map(([fichier, items]) => ({ fichier, items }));
}

function SectionRapport({ id, titre, sousTitre, n, ton, vide, enfants, action }: { id: string; titre: string; sousTitre: string; n: number; ton: string; vide: string; enfants: ReactNode; action?: ReactNode }) {
  return (
    <section id={id} className="section-card p-5 scroll-mt-4" aria-labelledby={`${id}-titre`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 id={`${id}-titre`} className="text-[15px] font-bold text-text-primary flex items-center gap-2">
            <span className={`inline-flex items-center justify-center min-w-[26px] h-[26px] px-1.5 rounded-full text-[12.5px] font-bold ${ton}`}>{n}</span>
            {titre}
          </h3>
          <p className="text-[12.5px] text-text-secondary mt-0.5">{sousTitre}</p>
        </div>
        {action}
      </div>
      <div className="mt-3">{n === 0 ? <p className="text-[13px] text-text-tertiary">{vide}</p> : enfants}</div>
    </section>
  );
}

/** Tableau groupé par fichier : le nom du fichier est un sous-en-tête, les colonnes restent lisibles à l'horizontale (overflow). */
function TableRapport<T extends { fichier: string }>({ items, colonnes }: { items: T[]; colonnes: Array<{ titre: string; largeur?: string; rendu: (it: T) => ReactNode }> }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-outline">
      <table className="w-full text-[12.5px]">
        <thead className="bg-surface-secondary/60 text-text-secondary">
          <tr>{colonnes.map((c) => <th key={c.titre} scope="col" className={`text-left font-semibold px-3 py-2 ${c.largeur ?? ''}`}>{c.titre}</th>)}</tr>
        </thead>
        {parFichier(items).map((g) => (
          <tbody key={g.fichier}>
            <tr className="bg-surface-secondary/30"><th scope="rowgroup" colSpan={colonnes.length} className="text-left px-3 py-1.5 text-[12px] font-semibold text-text-primary">📄 {g.fichier}</th></tr>
            {g.items.map((it, i) => (
              <tr key={i} className="border-t border-outline/40 align-top hover:bg-surface-secondary/20">
                {colonnes.map((c) => <td key={c.titre} className="px-3 py-2 text-text-secondary">{c.rendu(it)}</td>)}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

const Champ = ({ v }: { v: string | null }) => (v ? <span className="inline-block px-1.5 py-0.5 rounded bg-surface-secondary text-text-primary font-medium whitespace-nowrap">{v}</span> : <span className="text-text-tertiary italic">ne pas importer</span>);
const Colonne = ({ v }: { v: string }) => <span className="font-medium text-text-primary">« {v} »</span>;

/** Onglet « Rapport du bot » : la dernière passe, organisée par ce qu'il reste à faire. */
function RapportBotTab({ d, onOuvrirOnglet }: { d: any; onOuvrirOnglet: (t: Tab) => void }) {
  const m = d.migration;
  const rapport = (m.bot_dernier_rapport ?? null) as RapportBotMigration | null;
  const [texteOuvert, setTexteOuvert] = useState(false);
  const [journalOuvert, setJournalOuvert] = useState(false);
  if (!rapport) {
    return <div className="section-card p-6 text-[13px] text-text-secondary">Aucune passe du bot pour l'instant. Cliquez « Confier au bot » dans la barre d'actions : le rapport apparaîtra ici, organisé par ce qu'il vous reste à faire.</div>;
  }
  if (rapport.en_cours) {
    return <div className="section-card p-6 text-[13px] text-text-secondary">Une passe est en cours ({rapport.etape_courante ?? 'démarrage'}). Suivez-la en direct dans l'onglet Résumé ; le rapport s'affichera ici à la fin.</div>;
  }
  const a = rapport.audit;
  if (!a) {
    return <div className="section-card p-6 text-[13px] text-text-secondary">Ce rapport date d'avant la mise à jour du bot (pas d'audit détaillé). Relancez « Confier au bot » pour obtenir le rapport organisé.</div>;
  }
  const duree = Math.max(0, Math.round((new Date(rapport.fin).getTime() - new Date(rapport.debut).getTime()) / 1000));
  const aFaire: string[] = [];
  if (a.a_verifier.length) aFaire.push(`Tranchez ${a.a_verifier.length} colonne${a.a_verifier.length > 1 ? 's' : ''} dans Correspondances.`);
  if (a.manques.length) aFaire.push(`Copiez le rapport pour Claude : ${a.manques.length} manque${a.manques.length > 1 ? 's' : ''} à construire dans Lume.`);
  if (!aFaire.length) aFaire.push('Rien à trancher : le bot a tout réglé de son côté. Suite : import test, puis approbation.');
  const tuiles: Array<{ id: string; n: number; label: string; ton: string }> = [
    { id: 'rb-trancher', n: a.a_verifier.length, label: 'À trancher par vous', ton: 'bg-amber-100 text-amber-800' },
    { id: 'rb-manques', n: a.manques.length, label: 'Manques pour Claude', ton: 'bg-violet-100 text-violet-800' },
    { id: 'rb-corrections', n: a.corrections.length, label: 'Corrections faites', ton: 'bg-emerald-100 text-emerald-800' },
    { id: 'rb-alertes', n: a.alertes.length, label: 'Alertes des gardes', ton: 'bg-red-100 text-red-800' },
    { id: 'rb-journal', n: rapport.decisions.length, label: 'Décisions (journal)', ton: 'bg-surface-secondary text-text-primary' },
  ];
  const aller = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className="space-y-4">
      <div className="section-card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-[17px] font-bold text-text-primary">Rapport de la dernière passe</h2>
            <p className="text-[12.5px] text-text-secondary mt-0.5">
              {new Date(rapport.fin).toLocaleString('fr-CA')} · {rapport.declencheur === 'cron' ? 'automatique' : 'lancée à la main'} · {duree} s · {a.modele ?? 'sans appel modèle'}{rapport.cout_cents != null ? ` · ${rapport.cout_cents.toFixed(1)} ¢` : ''} · statut {rapport.statut_avant} → {rapport.statut_apres}
            </p>
            <p className="text-[12.5px] text-text-secondary mt-0.5">Arrêt : {rapport.arret || '—'}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setTexteOuvert((v) => !v)} className="h-9 px-3.5 rounded-md text-[13px] border border-outline bg-surface-card text-text-secondary hover:bg-surface-secondary">{texteOuvert ? 'Masquer le texte' : 'Voir le texte'}</button>
            <button type="button" onClick={() => copierTextePourClaude(a.texte_pour_claude, () => setTexteOuvert(true))} disabled={!a.texte_pour_claude} className="h-9 px-3.5 rounded-md text-[13px] font-medium bg-[#d8d0c2] text-black hover:bg-[#cabfad] disabled:opacity-50">Copier pour Claude</button>
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
          <p className="text-[12.5px] font-semibold text-amber-900">Quoi faire maintenant</p>
          <ol className="mt-1 list-decimal pl-5 text-[13px] text-amber-950 space-y-0.5">{aFaire.map((t, i) => <li key={i}>{t}</li>)}</ol>
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {tuiles.map((t) => (
            <button key={t.id} type="button" onClick={() => aller(t.id)} className="text-left rounded-lg border border-outline bg-surface-card p-3 hover:bg-surface-secondary/50 transition-colors">
              <span className={`inline-flex items-center justify-center min-w-[30px] h-[30px] px-2 rounded-full text-[14px] font-bold ${t.ton}`}>{t.n}</span>
              <p className="mt-1.5 text-[12.5px] text-text-secondary leading-tight">{t.label}</p>
            </button>
          ))}
        </div>
        {texteOuvert && <textarea readOnly aria-label="Audit à coller à Claude Code" value={a.texte_pour_claude} className="mt-4 w-full h-72 p-3 text-[12px] font-mono rounded-md border border-outline bg-surface-card text-text-primary" />}
      </div>

      <SectionRapport id="rb-trancher" titre="À trancher par vous" sousTitre="Le bot n'a pas osé décider : la proposition du moteur reste en place, à confirmer ou corriger." n={a.a_verifier.length} ton="bg-amber-100 text-amber-800"
        vide="Rien : toutes les colonnes ont été tranchées."
        action={a.a_verifier.length ? <button type="button" onClick={() => onOuvrirOnglet('mappings')} className="h-9 px-3.5 rounded-md text-[13px] font-medium bg-[#d8d0c2] text-black hover:bg-[#cabfad]">Ouvrir Correspondances</button> : undefined}
        enfants={<TableRapport items={a.a_verifier} colonnes={[
          { titre: 'Colonne', largeur: 'w-[22%]', rendu: (v) => <Colonne v={v.colonne} /> },
          { titre: 'Champ actuel', largeur: 'w-[16%]', rendu: (v) => <Champ v={v.actuel} /> },
          { titre: 'Candidats', largeur: 'w-[18%]', rendu: (v) => v.candidats.length ? v.candidats.join(' / ') : <span className="text-text-tertiary">—</span> },
          { titre: 'Pourquoi le bot hésite', rendu: (v) => v.pourquoi },
        ]} />} />

      <SectionRapport id="rb-manques" titre="Manques dans Lume" sousTitre="Données utiles sans champ Lume : à construire dans l'importeur. Copiez le rapport pour Claude, il s'en charge." n={a.manques.length} ton="bg-violet-100 text-violet-800"
        vide="Aucun : Lume a un champ pour tout ce que contiennent vos fichiers."
        action={a.manques.length ? <button type="button" onClick={() => copierTextePourClaude(a.texte_pour_claude, () => setTexteOuvert(true))} className="h-9 px-3.5 rounded-md text-[13px] font-medium bg-[#d8d0c2] text-black hover:bg-[#cabfad]">Copier pour Claude</button> : undefined}
        enfants={<TableRapport items={a.manques} colonnes={[
          { titre: 'Colonne', largeur: 'w-[22%]', rendu: (v) => <Colonne v={v.colonne} /> },
          { titre: 'Entité', largeur: 'w-[10%]', rendu: (v) => ENTITY_LABELS_FR[v.entite] ?? v.entite },
          { titre: 'Champ proposé', largeur: 'w-[18%]', rendu: (v) => <Champ v={v.proposition} /> },
          { titre: 'Ce que l\'importeur devrait en faire', rendu: (v) => v.besoin },
        ]} />} />

      <SectionRapport id="rb-corrections" titre="Corrections faites par le bot" sousTitre="Déjà appliquées dans Correspondances. Vérifiez d'un coup d'œil, rien à faire sauf désaccord." n={a.corrections.length} ton="bg-emerald-100 text-emerald-800"
        vide="Aucune : les propositions du moteur étaient bonnes."
        enfants={<TableRapport items={a.corrections} colonnes={[
          { titre: 'Colonne', largeur: 'w-[22%]', rendu: (v) => <Colonne v={v.colonne} /> },
          { titre: 'Avant', largeur: 'w-[16%]', rendu: (v) => <Champ v={v.avant} /> },
          { titre: 'Après', largeur: 'w-[16%]', rendu: (v) => <Champ v={v.apres} /> },
          { titre: 'Pourquoi', rendu: (v) => v.pourquoi },
        ]} />} />

      <SectionRapport id="rb-alertes" titre="Alertes des gardes" sousTitre="Pièges attrapés sans modèle (écrasement, type incompatible, tags, champs personnalisés…) et points à surveiller au dry-run." n={a.alertes.length} ton="bg-red-100 text-red-800"
        vide="Aucune alerte."
        enfants={<TableRapport items={a.alertes} colonnes={[
          { titre: 'Colonne', largeur: 'w-[22%]', rendu: (v) => <Colonne v={v.colonne} /> },
          { titre: 'Problème', rendu: (v) => v.message },
          { titre: 'Ce qui a été fait', largeur: 'w-[26%]', rendu: (v) => v.action },
        ]} />} />

      <section className="section-card p-5" aria-labelledby="rb-fichiers-titre">
        <h3 id="rb-fichiers-titre" className="text-[15px] font-bold text-text-primary">Fichiers examinés</h3>
        {a.fichiers.length === 0 ? <p className="mt-2 text-[13px] text-text-tertiary">Aucun fichier examiné dans cette passe.</p> : (
          <ul className="mt-2 divide-y divide-outline/40">
            {a.fichiers.map((f, i) => (
              <li key={i} className="py-2 flex items-start gap-3 flex-wrap text-[13px]">
                <span className="font-medium text-text-primary">📄 {f.nom}</span>
                <span className="text-text-tertiary">→ {f.entite ? (ENTITY_LABELS_FR[f.entite] ?? f.entite) : 'aucune entité (non importé)'}</span>
                {f.nature && <span className="basis-full text-text-secondary">{f.nature}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="rb-journal" className="section-card p-5 scroll-mt-4" aria-labelledby="rb-journal-titre">
        <div className="flex items-center justify-between gap-3">
          <h3 id="rb-journal-titre" className="text-[15px] font-bold text-text-primary">Journal des décisions <span className="text-text-tertiary font-normal">({rapport.decisions.length})</span></h3>
          <button type="button" onClick={() => setJournalOuvert((v) => !v)} className="h-8 px-3 rounded-md text-[12.5px] border border-outline bg-surface-card text-text-secondary hover:bg-surface-secondary">{journalOuvert ? 'Replier' : 'Déplier'}</button>
        </div>
        {journalOuvert && (
          <ul className="mt-3 space-y-1 text-[12.5px]">
            {rapport.decisions.map((dcs, i) => (
              <li key={i} className="flex gap-2"><span className="text-text-tertiary w-32 shrink-0">{dcs.etape}</span><span className="text-text-secondary">{dcs.cible} — <span className="text-text-primary">{dcs.decision}</span>{dcs.detail ? ` (${dcs.detail})` : ''}</span></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Le bot de migration : actif ou non, dernière passe, ses décisions. L'approbation et l'import final restent humains. */
function CarteBot({ m, onChanged, onOuvrirOnglet }: { m: any; onChanged: () => void; onOuvrirOnglet: (t: Tab) => void }) {
  const [live, setLive] = useState<RapportBotMigration | null>(null);
  const rapport = (live ?? m.bot_dernier_rapport ?? null) as RapportBotMigration | null;
  const [busy, setBusy] = useState(false);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  // Suivi en direct : tant qu'une passe est en cours, relire le rapport partiel toutes les 3 s ; à la fin, recharger la fiche.
  useEffect(() => {
    let arret = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (arret) return;
      try {
        const { rapport: r } = await getRapportBot(m.id);
        if (arret) return;
        setLive(r);
        setMaintenant(Date.now());
        if (r?.en_cours) timer = setTimeout(tick, 3000);
        else if (live?.en_cours) onChanged();
      } catch (err) {
        captureClientException(err, { where: 'CarteBot.suivi' });
        if (!arret) timer = setTimeout(tick, 6000);
      }
    };
    timer = setTimeout(tick, (m.bot_dernier_rapport as RapportBotMigration | null)?.en_cours ? 0 : 3000);
    return () => { arret = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- relance à chaque changement de fiche ; `live` est lu, pas suivi
  }, [m.id, m.bot_derniere_execution, (m.bot_dernier_rapport as RapportBotMigration | null)?.en_cours]);
  const autonome = m.bot_mode !== 'client';
  const basculer = async () => {
    setBusy(true);
    try { await definirBotActif(m.id, !m.bot_actif); toast.success(m.bot_actif ? 'Bot mis en pause' : 'Bot actif : il reprend la migration toutes les 10 minutes'); onChanged(); }
    catch (err: any) { toast.error(err?.message ?? 'Erreur'); }
    finally { setBusy(false); }
  };
  const changerMode = async (mode: 'client' | 'autonome') => {
    if ((mode === 'autonome') === autonome) return;
    setBusy(true);
    try { await definirModeBot(m.id, mode); toast.success(mode === 'autonome' ? 'Mode autonome : le client n\'a rien à faire, le bot vous prévient' : 'Mode client : les questions passent par le portail'); onChanged(); }
    catch (err: any) { toast.error(err?.message ?? 'Erreur'); }
    finally { setBusy(false); }
  };
  return (
    <div className="section-card p-5 lg:col-span-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-[14px] font-bold text-text-primary">Bot de migration</h3>
          <p className="text-[12.5px] text-text-secondary">Analyse, correspondances, doublons, import test. Jamais l'approbation ni l'import final.</p>
          <div className="mt-2 inline-flex rounded-md border border-outline overflow-hidden text-[12.5px]" role="group" aria-label="Mode du bot">
            <button type="button" disabled={busy} onClick={() => changerMode('autonome')} className={`px-3 h-8 ${autonome ? 'bg-[#d8d0c2] text-black font-medium' : 'bg-surface-card text-text-secondary hover:bg-surface-secondary'}`}>Autonome — le client n'a rien à faire</button>
            <button type="button" disabled={busy} onClick={() => changerMode('client')} className={`px-3 h-8 border-l border-outline ${!autonome ? 'bg-[#d8d0c2] text-black font-medium' : 'bg-surface-card text-text-secondary hover:bg-surface-secondary'}`}>Questions au client</button>
          </div>
          <p className="mt-1.5 text-[12px] text-text-tertiary">{autonome ? 'Colonne incertaine → conservée dans les notes ; doublon sur le nom seul → nouvelle fiche ; ce qui bloque vous est notifié, jamais au client. Quand l\'import test est propre, vous approuvez au nom du client.' : 'Les colonnes incertaines et les doublons sur le nom sont demandés au client dans son portail (statut « attente du client »).'}</p>
        </div>
        <button type="button" disabled={busy} onClick={basculer} className={`h-9 px-3.5 rounded-md text-[13px] font-medium border transition-colors ${m.bot_actif ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-surface-card border-outline text-text-secondary'}`}>
          {m.bot_actif ? 'Actif — mettre en pause' : 'Activer le bot (toutes les 10 min)'}
        </button>
      </div>
      {rapport?.en_cours && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3" role="status" aria-live="polite">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5" aria-hidden="true"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-600" /></span>
            <p className="text-[13px] font-semibold text-emerald-900">Bot en cours — {Math.max(0, Math.round((maintenant - new Date(rapport.debut).getTime()) / 1000))} s</p>
          </div>
          <p className="mt-1 text-[12.5px] text-emerald-900/90">{rapport.etape_courante ?? 'Démarrage…'}</p>
          {rapport.progression && rapport.progression.fichiers_total > 0 && (
            <div className="mt-2">
              <div className="h-1.5 w-full rounded-full bg-emerald-100 overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round((rapport.progression.fichiers_faits / rapport.progression.fichiers_total) * 100)}%` }} /></div>
              <p className="mt-1 text-[11.5px] text-emerald-900/80">{rapport.progression.fichiers_faits} / {rapport.progression.fichiers_total} fichiers</p>
            </div>
          )}
          {rapport.decisions.length > 0 && (
            <ul className="mt-2 space-y-0.5 max-h-40 overflow-auto text-[12px] text-emerald-950/90">
              {rapport.decisions.slice(-8).map((d, i) => <li key={`${rapport.decisions.length}-${i}`}>· {d.etape} — {d.cible} : {d.decision}</li>)}
            </ul>
          )}
        </div>
      )}
      {rapport && !rapport.en_cours ? (
        <div className="mt-3">
          <p className="text-[12.5px] text-text-secondary">
            Dernière passe {new Date(rapport.fin).toLocaleString('fr-CA')} ({rapport.declencheur}) : {rapport.statut_avant} → {rapport.statut_apres} · {rapport.decisions.length} décision{rapport.decisions.length > 1 ? 's' : ''} · {rapport.arret}
            {rapport.cout_cents != null ? ` · ${rapport.cout_cents.toFixed(2)} ¢ de modèle` : ''}
          </p>
          {rapport.decisions.length > 0 && (
            <ul className="mt-2 space-y-1 max-h-56 overflow-auto text-[12.5px]">
              {rapport.decisions.map((d, i) => (
                <li key={i} className="flex gap-2"><span className="text-text-tertiary w-28 shrink-0">{d.etape}</span><span className="text-text-secondary">{d.cible} — <span className="text-text-primary">{d.decision}</span>{d.detail ? ` (${d.detail})` : ''}</span></li>
              ))}
            </ul>
          )}
          {rapport.audit && <ResumeAuditBot audit={rapport.audit} onOuvrir={() => onOuvrirOnglet('bot')} />}
        </div>
      ) : !rapport ? (
        <p className="mt-3 text-[12.5px] text-text-tertiary">Aucune passe encore. « Confier au bot » lance une passe maintenant ; « Activer » le fait revenir tout seul.</p>
      ) : null}
    </div>
  );
}

function ResumeTab({ d, onChanged, onOuvrirOnglet }: { d: any; onChanged: () => void; onOuvrirOnglet: (t: Tab) => void }) {
  const m = d.migration;
  const [ttl, setTtl] = useState(48);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [generation, setGeneration] = useState(false);
  const activeInv = (d.invitations ?? []).find((i: any) => !i.revoked_at && !i.superseded_at);
  const staging = d.staging_counts ?? {};

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <CarteBot m={m} onChanged={onChanged} onOuvrirOnglet={onOuvrirOnglet} />
      <div className="section-card p-5">
        <h3 className="text-[14px] font-bold text-text-primary mb-3">Invitation</h3>
        {activeInv ? (
          <div className="text-[13px] text-text-secondary space-y-1 mb-3">
            <p>Expire : <strong>{new Date(activeInv.expires_at).toLocaleString('fr-CA')}</strong>{new Date(activeInv.expires_at).getTime() < Date.now() && <span className="text-red-600 font-semibold"> (expirée)</span>}</p>
            <p>Ouverte : {activeInv.opened_at ? new Date(activeInv.opened_at).toLocaleString('fr-CA') : 'jamais'}</p>
            <p>Tentatives échouées : {activeInv.failed_attempts}</p>
          </div>
        ) : (
          <p className="text-[13px] text-text-tertiary mb-3">Aucune invitation active.</p>
        )}
        {inviteUrl && (
          <div className="mb-3 p-3 rounded-md bg-amber-50 border border-amber-200">
            <p className="text-[12px] text-amber-800 font-semibold mb-1.5">Lien généré — visible une seule fois, copiez-le maintenant :</p>
            <div className="flex items-center gap-2">
              <code className="text-[11px] break-all flex-1 text-amber-900">{inviteUrl}</code>
              <button
                type="button"
                onClick={() => { navigator.clipboard.writeText(inviteUrl); toast.success('Lien copié'); }}
                aria-label="Copier le lien"
                className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md border border-amber-300 text-amber-800 hover:bg-amber-100"
              >
                <Copy size={13} />
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap text-[13px]">
          <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))} aria-label="Durée de validité du lien" className="h-9 px-2 bg-surface border border-outline rounded-md">
            <option value={24}>24 h</option>
            <option value={48}>48 h</option>
            <option value={96}>4 jours</option>
            <option value={168}>7 jours</option>
          </select>
          <button
            type="button"
            disabled={generation}
            onClick={async () => {
              if (generation) return;
              setGeneration(true);
              try {
                const res = await generateInvitation(m.id, ttl);
                setInviteUrl(res.invite_url);
                toast.success('Invitation générée (l\'ancienne est invalidée)');
                onChanged();
              } catch (err: any) { toast.error(err?.message ?? 'Erreur'); } finally { setGeneration(false); }
            }}
            className="h-9 px-4 bg-[#d8d0c2] text-black hover:bg-[#cabfad] rounded-md font-medium"
          >
            {generation ? 'Génération…' : activeInv ? 'Regénérer le lien' : 'Générer le lien'}
          </button>
          {activeInv && (
            <>
              <button
                type="button"
                onClick={async () => { try { await extendInvitation(m.id, ttl); toast.success('Expiration prolongée'); onChanged(); } catch (err: any) { toast.error(err?.message ?? 'Erreur'); } }}
                className="h-9 px-4 border border-outline rounded-md text-text-secondary hover:bg-surface-secondary"
              >
                Prolonger
              </button>
              <button
                type="button"
                onClick={async () => { try { await revokeInvitation(m.id); toast.success('Invitation révoquée'); onChanged(); } catch (err: any) { toast.error(err?.message ?? 'Erreur'); } }}
                className="h-9 px-4 border border-red-200 bg-red-50 text-red-700 rounded-md hover:bg-red-100"
              >
                Révoquer
              </button>
            </>
          )}
        </div>
        <p className="text-[11px] text-text-tertiary mt-2">
          Invité : {m.invited_email ?? m.invited_user_id ?? 'non précisé (tout owner/admin du workspace)'}
        </p>
      </div>

      <div className="section-card p-5">
        <h3 className="text-[14px] font-bold text-text-primary mb-3">Données détectées (staging)</h3>
        {Object.keys(staging).length === 0 ? (
          <p className="text-[13px] text-text-tertiary">Aucune donnée analysée pour le moment.</p>
        ) : (
          <div className="space-y-1.5 text-[13px]">
            {Object.entries(staging).map(([entity, statuses]: [string, any]) => (
              <div key={entity} className="flex items-center justify-between border-b border-outline/30 pb-1">
                <span className="font-medium text-text-primary capitalize">{entity}</span>
                <span className="text-text-secondary text-[12px]">
                  {Object.entries(statuses).map(([s, n]) => `${s}: ${n}`).join(' · ')}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 text-[12px] text-text-tertiary space-y-0.5">
          <p>Catégories : {(m.categories ?? []).join(', ')}</p>
          <p>Priorité : {m.priority} · Date cible : {m.target_date ?? '—'}</p>
          {m.internal_notes && <p>Notes : {m.internal_notes}</p>}
        </div>
      </div>
      <div className="lg:col-span-2"><StaffCard migrationId={m.id} /></div>
    </div>
  );
}

function FilesTab({ d, onChanged }: { d: any; onChanged: () => void }) {
  const m = d.migration;
  return (
    <div className="section-card p-5">
      {(d.files ?? []).length === 0 ? (
        <p className="text-[13px] text-text-tertiary">Aucun fichier reçu.</p>
      ) : (
        <div className="border border-outline rounded-md overflow-x-auto">
          <div className="grid min-w-[860px] text-[12px]" style={{ gridTemplateColumns: '1.4fr 80px 110px 70px 70px 110px 110px 190px' }}>
            {['Fichier', 'Taille', 'Catégorie', 'Lignes', 'Col.', 'Sécurité', 'Analyse', 'Actions'].map((h) => (
              <div key={h} className="px-3 py-2 bg-surface-secondary/60 border-b border-outline font-semibold text-text-secondary">{h}</div>
            ))}
            {(d.files ?? []).map((f: any) => {
              const cell = 'px-3 py-2 border-b border-outline/30 flex items-center min-w-0 text-text-primary';
              return (
                <FileAdminRow key={f.id} f={f} cell={cell} migrationId={m.id} onChanged={onChanged} />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function FileAdminRow({ f, cell, migrationId, onChanged }: { f: any; cell: string; migrationId: string; onChanged: () => void }) {
  return (
    <>
      <div className={cell}><span className="truncate font-medium">{f.original_name}</span></div>
      <div className={cell}>{(f.size_bytes / 1024).toFixed(0)} Ko</div>
      <div className={cell}>{f.category_detected ?? '—'}</div>
      <div className={cell}>{f.row_count ?? '—'}</div>
      <div className={cell}>{f.column_count ?? '—'}</div>
      <div className={cell}>
        <span className={f.security_status === 'safe' ? 'text-emerald-700' : f.security_status === 'rejected' ? 'text-red-600' : 'text-text-tertiary'}>
          {f.security_status}
        </span>
      </div>
      <div className={cell}>
        <span className={f.parse_status === 'parsed' ? 'text-emerald-700' : f.parse_status === 'failed' ? 'text-red-600' : 'text-text-tertiary'}>
          {f.parse_status}{f.parse_error ? ` (${f.parse_error})` : ''}
        </span>
      </div>
      <div className={`${cell} gap-2 text-[12px]`}>
        <button
          type="button"
          className="underline text-text-secondary hover:text-text-primary"
          onClick={async () => {
            try {
              const { url } = await getFileDownloadUrl(migrationId, f.id);
              window.open(url, '_blank', 'noopener');
            } catch (err: any) { toast.error(err?.message ?? 'Erreur'); }
          }}
        >
          Télécharger
        </button>
        <button
          type="button"
          className="underline text-text-secondary hover:text-text-primary"
          onClick={async () => { try { await reanalyzeFile(migrationId, f.id); toast.success('Ré-analyse lancée'); onChanged(); } catch (err: any) { toast.error(err?.message ?? 'Erreur'); } }}
        >
          Ré-analyser
        </button>
        {f.security_status !== 'rejected' && (
          <button
            type="button"
            className="underline text-red-600"
            onClick={async () => { try { await rejectFile(migrationId, f.id); toast.success('Fichier rejeté'); onChanged(); } catch (err: any) { toast.error(err?.message ?? 'Erreur'); } }}
          >
            Rejeter
          </button>
        )}
        <button
          type="button"
          className="underline text-red-600 font-semibold"
          onClick={async () => {
            const ok = await confirmer({ title: 'Supprimer le fichier', message: `Supprimer définitivement « ${f.original_name} » et ses correspondances ? Cette action est irréversible.`, confirmLabel: 'Supprimer', danger: true });
            if (!ok) return;
            try {
              await deleteFile(migrationId, f.id);
              toast.success('Fichier supprimé');
              onChanged();
            } catch (err: any) {
              toast.error(err?.message ?? 'Erreur');
            }
          }}
        >
          Supprimer
        </button>
      </div>
    </>
  );
}

function TemplateControls({ migrationId, sourceCrm, onChanged }: { migrationId: string; sourceCrm: string; onChanged: () => void }) {
  const tplQ = useQuery({ queryKey: ['migration-templates', sourceCrm], queryFn: () => listMappingTemplates(sourceCrm), retry: false, refetchOnWindowFocus: false });
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  return (
    <div className="flex items-center gap-2 flex-wrap mb-4 text-[13px]">
      <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Gabarit de correspondance" className="h-9 px-2 bg-surface border border-outline rounded-md">
        <option value="">{tplQ.isError ? 'Gabarits non provisionnés (SQL requis)' : 'Choisir un gabarit…'}</option>
        {(tplQ.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <button
        type="button"
        disabled={!selected}
        className="h-9 px-4 border border-outline rounded-md text-text-secondary hover:bg-surface-secondary disabled:opacity-40"
        onClick={async () => {
          try { const r = await applyMappingTemplate(migrationId, selected); toast.success(`Gabarit appliqué : ${r.applied} colonne(s) confirmée(s)`); onChanged(); }
          catch (err: any) { toast.error(err?.message ?? 'Erreur'); }
        }}
      >
        Appliquer
      </button>
      <span className="text-text-tertiary">·</span>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du gabarit (ex. Jobber v1)" aria-label="Nom du gabarit" className="h-9 px-3 bg-surface border border-outline rounded-md w-[200px]" />
      <button
        type="button"
        disabled={!name.trim()}
        className="h-9 px-4 border border-outline rounded-md text-text-secondary hover:bg-surface-secondary disabled:opacity-40"
        onClick={async () => {
          try { const r = await saveMappingTemplate(migrationId, name.trim()); toast.success(`Gabarit sauvegardé (${r.headers} colonnes)`); setName(''); }
          catch (err: any) { toast.error(err?.message ?? 'Erreur'); }
        }}
      >
        Sauvegarder le mappage actuel
      </button>
    </div>
  );
}

const MAPPING_STATUS_LABELS_FR: Record<string, string> = {
  suggested: 'Proposé', confirmed: 'Confirmé', corrected: 'Corrigé', rejected: 'Ignoré', needs_review: 'À vérifier',
};
// Miroir de entityForCategory (server/lib/migration/mapping.ts) : catégorie
// détectée d'un fichier → entité ouverte par défaut dans le sélecteur.
const CATEGORY_TO_ENTITY: Record<string, string> = {
  taxes: 'tax_config', clients: 'client', properties: 'property', billing_addresses: 'billing_property',
  services: 'service', quotes: 'quote', jobs: 'job', visits: 'visit', invoices: 'invoice', payments: 'payment',
};

/** Entité par défaut d'un fichier : sa catégorie détectée, sinon l'entité la plus fréquente parmi ses correspondances. */
function defaultEntityForFile(file: any, mappings: any[]): string | null {
  const fromCategory = CATEGORY_TO_ENTITY[file?.category_detected ?? ''];
  if (fromCategory) return fromCategory;
  const counts = new Map<string, number>();
  for (const mp of mappings) if (mp?.target_entity) counts.set(mp.target_entity, (counts.get(mp.target_entity) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [entity, n] of counts) if (n > bestN) { best = entity; bestN = n; }
  return best;
}

function ConfidenceBadge({ value }: { value: number }) {
  const cls = value >= 90
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : value >= 70
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-red-50 text-red-700 border-red-200';
  return <span className={`inline-flex items-center px-2 h-5 rounded-full border text-[11px] font-semibold ${cls}`}>{value}%</span>;
}

// Même tableau que le portail client (MigrationPortal › Correspondance des colonnes) :
// un sélecteur par colonne (FieldTargetPicker), alimenté par FIELD_CATALOG, « Ne pas importer » = rejet.
function MappingsTab({ d, onChanged }: { d: any; onChanged: () => void }) {
  const qc = useQueryClient();
  const m = d.migration;
  const catalog: FieldCatalog = d.field_catalog ?? {};
  // Décisions en vol : appliquées à l'écran immédiatement, confirmées (ou annulées) au retour du serveur.
  const [pending, setPending] = useState<Record<string, Partial<any>>>({});
  const columns = ((d.columns ?? []) as any[]).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const mappingByColumn = new Map<string, any>(
    (d.mappings ?? []).map((mp: any) => [mp.column_id, pending[mp.id] ? { ...mp, ...pending[mp.id] } : mp]),
  );
  const byFile = new Map<string, any[]>();
  for (const c of columns) {
    const arr = byFile.get(c.file_id) ?? [];
    arr.push(c);
    byFile.set(c.file_id, arr);
  }
  const files = ((d.files ?? []) as any[]).filter((f) => byFile.has(f.id));
  for (const fileId of byFile.keys()) {
    if (!files.some((f) => f.id === fileId)) files.push({ id: fileId, original_name: fileId });
  }

  if (columns.length === 0) return <div className="section-card p-5 text-[13px] text-text-tertiary">Aucune correspondance (analyse pas encore faite).</div>;

  const decide = async (mp: any, payload: { status: string; target_entity?: string | null; target_field?: string | null }, okMsg: string) => {
    const clearPending = () => setPending((prev) => { const next = { ...prev }; delete next[mp.id]; return next; });
    setPending((prev) => ({ ...prev, [mp.id]: payload }));
    try {
      const saved = await decideMapping(m.id, mp.id, payload);
      // Patch ciblé du cache : pas de rechargement des dix requêtes du détail.
      qc.setQueryData(['migration-admin-detail', m.id], (prev: any) => prev
        ? { ...prev, mappings: (prev.mappings ?? []).map((x: any) => (x.id === mp.id ? { ...x, ...saved } : x)) }
        : prev);
      clearPending();
      toast.success(okMsg, { duration: 1200 });
    } catch (err: any) {
      clearPending();
      toast.error(err?.message ?? 'Erreur');
    }
  };

  // Drapeau de couleur : note interne admin, invisible pour le client. null = retirer.
  const setFlag = async (mp: any, flag: MappingFlag | null) => {
    const clearPending = () => setPending((prev) => { const next = { ...prev }; delete next[mp.id]; return next; });
    setPending((prev) => ({ ...prev, [mp.id]: { ...(prev[mp.id] ?? {}), admin_flag: flag } }));
    try {
      const saved = await flagMapping(m.id, mp.id, flag);
      qc.setQueryData(['migration-admin-detail', m.id], (prev: any) => prev
        ? { ...prev, mappings: (prev.mappings ?? []).map((x: any) => (x.id === mp.id ? { ...x, ...saved } : x)) }
        : prev);
      clearPending();
    } catch (err: any) {
      clearPending();
      toast.error(err?.message ?? 'Erreur');
    }
  };
  const flaggedCount = [...mappingByColumn.values()].filter((mp: any) => !!mp?.admin_flag).length;

  return (
    <div className="section-card p-5">
      <TemplateControls migrationId={m.id} sourceCrm={m.source_crm} onChanged={onChanged} />
      <p className="text-[12px] text-text-tertiary mb-3">
        Choisir un champ Lume dans la liste corrige la colonne; « Ne pas importer » l'ignore. Les décisions prises ici priment sur les gabarits.
        {' '}Le drapeau colore une ligne pour vous seul (le client ne le voit pas){flaggedCount > 0 ? ` — ${flaggedCount} ligne(s) marquée(s)` : ''}.
      </p>
      <div className="space-y-5">
        {files.map((file) => (
          <div key={file.id}>
            <div className="text-[12px] font-semibold text-text-secondary mb-1.5">{file.original_name}</div>
            <div className="border border-outline rounded-md overflow-x-auto">
              <div className="grid min-w-[760px] text-[12px]" style={{ gridTemplateColumns: '40px 1.1fr 1.3fr 1.3fr 70px 150px' }}>
                {['', 'Colonne', 'Aperçu (masqué)', 'Champ Lume', 'Conf.', 'Statut'].map((h, i) => (
                  <div key={h || `h${i}`} className="px-3 py-2 bg-surface-secondary/60 border-b border-outline font-semibold text-text-secondary">{h}</div>
                ))}
                {(byFile.get(file.id) ?? []).map((col) => (
                  <MappingAdminRow
                    key={col.id}
                    col={col}
                    mapping={mappingByColumn.get(col.id)}
                    catalog={catalog}
                    defaultEntity={defaultEntityForFile(file, (byFile.get(file.id) ?? []).map((c) => mappingByColumn.get(c.id)))}
                    onSelect={(mp, entity, field) => {
                      if (!entity || !field) return decide(mp, { status: 'rejected', target_entity: null, target_field: null }, 'Colonne ignorée');
                      return decide(mp, { status: 'corrected', target_entity: entity, target_field: field }, 'Correspondance mise à jour');
                    }}
                    onConfirm={(mp) => decide(mp, { status: 'confirmed' }, 'Correspondance confirmée')}
                    onFlag={setFlag}
                  />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Couleurs de drapeau : fond de ligne + pastille. Pas de rouge/vert ambigu avec les
// badges de confiance : le drapeau est un repère personnel, pas un statut.
const FLAG_COLORS: { id: MappingFlag; label: string; row: string; dot: string }[] = [
  { id: 'red', label: 'Rouge', row: 'bg-red-50', dot: 'bg-red-500' },
  { id: 'amber', label: 'Ambre', row: 'bg-amber-50', dot: 'bg-amber-500' },
  { id: 'green', label: 'Vert', row: 'bg-emerald-50', dot: 'bg-emerald-500' },
  { id: 'blue', label: 'Bleu', row: 'bg-sky-50', dot: 'bg-sky-500' },
  { id: 'purple', label: 'Mauve', row: 'bg-violet-50', dot: 'bg-violet-500' },
];

function FlagPicker({ value, onChange, label }: { value: MappingFlag | null; onChange: (f: MappingFlag | null) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const current = FLAG_COLORS.find((c) => c.id === value);
  return (
    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <button
        type="button"
        aria-label={current ? `Drapeau ${current.label} sur ${label} — modifier` : `Marquer ${label} d'un drapeau`}
        aria-expanded={open}
        title={current ? `Drapeau ${current.label}` : 'Drapeau (note interne)'}
        onClick={() => setOpen((o) => !o)}
        className={`h-7 w-7 inline-flex items-center justify-center rounded-md border transition-colors ${
          current ? `${current.dot} border-transparent text-white` : 'border-transparent text-text-tertiary hover:border-outline hover:text-text-secondary'
        }`}
      >
        <Flag className="w-3.5 h-3.5" fill={current ? 'currentColor' : 'none'} />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-8 z-20 flex items-center gap-1.5 p-1.5 bg-surface-card border border-outline rounded-md shadow-md">
          {FLAG_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitem"
              aria-label={`Drapeau ${c.label}`}
              title={c.label}
              onClick={() => { onChange(c.id); setOpen(false); }}
              className={`h-5 w-5 rounded-full ${c.dot} ${value === c.id ? 'ring-2 ring-offset-1 ring-text-primary' : 'hover:scale-110'} transition-transform`}
            />
          ))}
          {value && (
            <button
              type="button"
              role="menuitem"
              onClick={() => { onChange(null); setOpen(false); }}
              className="ml-1 px-1.5 h-5 text-[11px] rounded border border-outline text-text-secondary hover:bg-surface-secondary whitespace-nowrap"
            >
              Retirer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MappingAdminRow({ col, mapping, catalog, defaultEntity, onSelect, onConfirm, onFlag }: {
  col: any;
  mapping?: any;
  catalog: FieldCatalog;
  defaultEntity: string | null;
  onSelect: (mp: any, entity: string | null, field: string | null) => void;
  onConfirm: (mp: any) => void;
  onFlag: (mp: any, flag: MappingFlag | null) => void;
}) {
  const flag = FLAG_COLORS.find((c) => c.id === mapping?.admin_flag) ?? null;
  const cell = `px-3 py-2 border-b border-outline/30 flex items-center min-w-0 text-text-primary ${flag ? flag.row : ''}`;
  const value = mapping?.target_entity && mapping?.target_field ? { entity: mapping.target_entity as string, field: mapping.target_field as string } : null;
  const canConfirm = mapping && (mapping.status === 'suggested' || mapping.status === 'needs_review') && !!mapping.target_field;
  return (
    <>
      <div className={`${cell} px-1.5 justify-center`}>
        {mapping ? <FlagPicker value={flag?.id ?? null} label={col.header} onChange={(f) => onFlag(mapping, f)} /> : null}
      </div>
      <div className={cell}>
        <div className="min-w-0">
          <div className="truncate font-medium">{col.header}</div>
          <div className="text-[10px] text-text-tertiary">{col.detected_type}</div>
        </div>
      </div>
      <div className={`${cell} text-text-tertiary`}>
        <span className="truncate">{(col.samples_masked ?? []).slice(0, 3).join(' · ') || '—'}</span>
      </div>
      <div className={cell}>
        {mapping ? (
          <FieldTargetPicker
            catalog={catalog}
            value={value}
            excluded={mapping.status === 'rejected'}
            defaultEntity={defaultEntity}
            columnLabel={col.header}
            onChange={(entity, field) => onSelect(mapping, entity, field)}
          />
        ) : (
          <span className="text-text-tertiary">—</span>
        )}
      </div>
      <div className={cell}>{mapping ? <ConfidenceBadge value={mapping.confidence} /> : '—'}</div>
      <div className={`${cell} gap-2 text-text-secondary`}>
        <span>{mapping ? (MAPPING_STATUS_LABELS_FR[mapping.status] ?? mapping.status) : '—'}</span>
        {canConfirm && (
          <button type="button" className="underline text-emerald-700" onClick={() => onConfirm(mapping)}>Confirmer</button>
        )}
      </div>
    </>
  );
}

function IssuesTab({ d, onChanged }: { d: any; onChanged: () => void }) {
  const m = d.migration;
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const issues = d.issues ?? [];
  if (issues.length === 0) return <div className="section-card p-5 text-[13px] text-text-tertiary">Aucun problème.</div>;
  return (
    <div className="space-y-3">
      {issues.map((issue: any) => (
        <div key={issue.id} className={`section-card p-4 ${issue.resolved_at ? 'opacity-60' : ''}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex px-2 h-5 items-center rounded-full border text-[11px] font-semibold ${
              issue.severity === 'blocking' || issue.severity === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
            >
              {issue.severity}
            </span>
            <span className="text-[13px] font-semibold text-text-primary">{issue.title}</span>
            <span className="text-[11px] text-text-tertiary">{issue.type}{issue.client_visible ? ' · visible client' : ''}</span>
          </div>
          {issue.client_answer && (
            <p className="text-[12px] text-text-secondary mt-1.5">Réponse du client : « {issue.client_answer} »</p>
          )}
          {issue.resolved_at ? (
            <p className="text-[12px] text-emerald-700 mt-1.5">Résolu : {issue.resolution}</p>
          ) : (
            <div className="flex gap-2 mt-2.5">
              <input
                value={resolutions[issue.id] ?? ''}
                onChange={(e) => setResolutions((r) => ({ ...r, [issue.id]: e.target.value }))}
                placeholder="Résolution…"
                aria-label="Résolution"
                className="flex-1 h-8 px-3 text-[12px] bg-surface border border-outline rounded-md"
              />
              <button
                type="button"
                onClick={async () => {
                  const resolution = (resolutions[issue.id] ?? '').trim();
                  if (!resolution) return;
                  try { await resolveIssue(m.id, issue.id, resolution); toast.success('Problème résolu'); onChanged(); } catch (err: any) { toast.error(err?.message ?? 'Erreur'); }
                }}
                className="h-8 px-3.5 bg-[#d8d0c2] text-black hover:bg-[#cabfad] rounded-md text-[12px] font-medium"
              >
                Résoudre
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DuplicatesTab({ d, onChanged }: { d: any; onChanged: () => void }) {
  const m = d.migration;
  const dupes = d.duplicates ?? [];
  if (dupes.length === 0) return <div className="section-card p-5 text-[13px] text-text-tertiary">Aucun doublon détecté.</div>;
  return (
    <div className="section-card p-5">
      <div className="border border-outline rounded-md overflow-x-auto">
        <div className="grid min-w-[760px] text-[12px]" style={{ gridTemplateColumns: '110px 1fr 70px 110px 220px' }}>
          {['Table', 'Raisons', 'Score', 'Décision', 'Actions'].map((h) => (
            <div key={h} className="px-3 py-2 bg-surface-secondary/60 border-b border-outline font-semibold text-text-secondary">{h}</div>
          ))}
          {dupes.map((dup: any) => {
            const cell = 'px-3 py-2 border-b border-outline/30 flex items-center min-w-0 text-text-primary';
            return (
              <DuplicateRow key={dup.id} dup={dup} cell={cell} migrationId={m.id} onChanged={onChanged} />
            );
          })}
        </div>
      </div>
      <p className="text-[11px] text-text-tertiary mt-2">
        « Fusionner » rattache les enfants (jobs, factures…) au dossier existant sans modifier celui-ci. Jamais de fusion automatique.
      </p>
    </div>
  );
}

function DuplicateRow({ dup, cell, migrationId, onChanged }: any) {
  const decide = async (decision: string) => {
    try { await decideDuplicate(migrationId, dup.id, decision); onChanged(); } catch (err: any) { toast.error(err?.message ?? 'Erreur'); }
  };
  return (
    <>
      <div className={cell}>{dup.existing_table}</div>
      <div className={cell}><span className="truncate">{(dup.match_reasons ?? []).join(', ')}</span></div>
      <div className={cell}>{dup.score}</div>
      <div className={cell}>{dup.decision}</div>
      <div className={`${cell} gap-2 text-[12px]`}>
        {['merge', 'create_new', 'skip'].map((decision) => (
          <button
            key={decision}
            type="button"
            disabled={dup.decision === decision}
            onClick={() => decide(decision)}
            className={`underline disabled:no-underline disabled:font-bold ${decision === 'merge' ? 'text-emerald-700' : decision === 'skip' ? 'text-red-600' : 'text-text-secondary'}`}
          >
            {decision === 'merge' ? 'Fusionner' : decision === 'create_new' ? 'Créer' : 'Ignorer'}
          </button>
        ))}
      </div>
    </>
  );
}

function ImportsTab({ d }: { d: any }) {
  const batches = d.batches ?? [];
  const approvals = d.approvals ?? [];
  return (
    <div className="space-y-4">
      {approvals.length > 0 && (
        <div className="section-card p-5">
          <h3 className="text-[14px] font-bold text-text-primary mb-2">Approbations client</h3>
          <div className="space-y-1 text-[13px] text-text-secondary">
            {approvals.map((a: any) => (
              <p key={a.id}>
                <strong className={a.decision === 'approved' ? 'text-emerald-700' : 'text-red-600'}>{a.decision}</strong>
                {' '}v{a.report_version} · {new Date(a.created_at).toLocaleString('fr-CA')}
                {a.comment && ` · « ${a.comment} »`}
              </p>
            ))}
          </div>
        </div>
      )}
      {batches.length === 0 ? (
        <div className="section-card p-5 text-[13px] text-text-tertiary">Aucun lot d'import.</div>
      ) : batches.map((b: any) => (
        <div key={b.id} className="section-card p-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[13px] font-bold text-text-primary">{b.kind === 'test' ? 'Import test' : 'Import final'}</span>
            <StatusBadgeMig status={b.status} />
            <span className="text-[11px] text-text-tertiary">{new Date(b.started_at).toLocaleString('fr-CA')}</span>
            <span className="text-[10px] text-text-tertiary">lot {b.id.slice(0, 8)}</span>
          </div>
          {b.status === 'running' && b.totals?.progress?.etape && (
            <p className="text-[12px] text-blue-900/90 mb-1">En cours : {b.totals.progress.etape}{b.totals.progress.total > 0 ? ` (${b.totals.progress.processed} / ${b.totals.progress.total} lignes)` : ''}</p>
          )}
          {b.totals?.byEntity && (
            <div className="border border-outline rounded-md overflow-hidden mt-1 max-w-[560px]">
              <div className="grid text-[12px]" style={{ gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr' }}>
                {['Type', 'Créés', 'Fusionnés', 'Exclus', 'Erreurs'].map((h) => (
                  <div key={h} className="px-3 py-1.5 bg-surface-secondary/60 border-b border-outline font-semibold text-text-secondary">{h}</div>
                ))}
                {Object.entries(b.totals.byEntity).map(([entity, c]: [string, any]) => (
                  <BatchEntityRow key={entity} entity={entity} c={c} />
                ))}
              </div>
            </div>
          )}
          {(b.totals?.notes ?? []).length > 0 && (
            <ul className="text-[12px] text-text-secondary mt-2 space-y-0.5">
              {b.totals.notes.map((n: string, i: number) => <li key={i}>· {n}</li>)}
            </ul>
          )}
          {b.error && <p className="text-[12px] text-red-600 mt-1">Erreur : {b.error}</p>}
        </div>
      ))}
    </div>
  );
}

function BatchEntityRow({ entity, c }: { entity: string; c: any }) {
  const cell = 'px-3 py-1.5 border-b border-outline/30 text-text-primary';
  return (
    <>
      <div className={`${cell} font-medium capitalize`}>{entity}</div>
      <div className={cell}>{c.wouldCreate ?? 0}</div>
      <div className={cell}>{c.wouldMerge ?? 0}</div>
      <div className={cell}>{c.ignored ?? 0}</div>
      <div className={cell}>{c.errors ?? 0}</div>
    </>
  );
}

function AuditTab({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['migration-admin-audit', id, page],
    queryFn: () => getMigrationAudit(id, page),
    refetchOnWindowFocus: false,
  });
  const rows = q.data?.data ?? [];
  return (
    <div className="section-card p-5">
      {rows.length === 0 ? (
        <p className="text-[13px] text-text-tertiary">Aucune entrée.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((e: any) => (
            <div key={e.id} className="flex items-center gap-3 text-[12px] border-b border-outline/30 py-1.5">
              <span className="text-text-tertiary w-[130px] shrink-0">{new Date(e.created_at).toLocaleString('fr-CA')}</span>
              <span className="font-mono font-medium text-text-primary">{e.action}</span>
              <span className="text-text-tertiary">{e.actor_role}</span>
              {e.target && <span className="text-text-tertiary truncate">{e.target}</span>}
            </div>
          ))}
        </div>
      )}
      {(q.data?.total ?? 0) > 50 && (
        <div className="flex gap-2 mt-3 text-[12px]">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-7 px-2.5 border border-outline rounded-md disabled:opacity-40">Précédent</button>
          <button type="button" disabled={page * 50 >= (q.data?.total ?? 0)} onClick={() => setPage((p) => p + 1)} className="h-7 px-2.5 border border-outline rounded-md disabled:opacity-40">Suivant</button>
        </div>
      )}
    </div>
  );
}

function MessagesTab({ d, onChanged }: { d: any; onChanged: () => void }) {
  const m = d.migration;
  const [draft, setDraft] = useState('');
  const messages = d.messages ?? [];
  return (
    <div className="section-card p-5 max-w-[680px]">
      <div className="space-y-2 mb-3 max-h-[320px] overflow-y-auto">
        {messages.length === 0 && <p className="text-[13px] text-text-tertiary">Aucun message.</p>}
        {messages.map((msg: any) => (
          <div key={msg.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-[13px] ${msg.author_kind === 'client' ? 'bg-surface-secondary' : 'ml-auto bg-[#eeeae0] text-black'}`}>
            <div className="text-[10px] text-text-tertiary mb-0.5">
              {msg.author_kind === 'client' ? 'Client' : 'Lume'} · {new Date(msg.created_at).toLocaleString('fr-CA')}
            </div>
            {msg.body}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Répondre au client…"
          aria-label="Répondre au client"
          className="flex-1 h-9 px-3 text-[13px] bg-surface border border-outline rounded-md"
        />
        <button
          type="button"
          onClick={async () => {
            const body = draft.trim();
            if (!body) return;
            try { await sendAdminMessage(m.id, body); setDraft(''); onChanged(); } catch (err: any) { toast.error(err?.message ?? 'Erreur'); }
          }}
          className="h-9 px-4 bg-[#d8d0c2] text-black hover:bg-[#cabfad] rounded-md text-[13px] font-medium"
        >
          Envoyer
        </button>
      </div>
    </div>
  );
}
