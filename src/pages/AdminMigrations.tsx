// Console interne des migrations assistées — /admin/migrations
// Réservée à l'administrateur plateforme Lume (PLATFORM_OWNER_ID). La page se
// gate elle-même via GET /api/migration-admin/check et redirige sinon ; le
// serveur re-vérifie de toute façon chaque requête. Hors navigation : on y
// accède par URL directe. Périmètre limité aux projets de migration.

import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft, Copy, Loader2, Plus, RefreshCw, Search, ShieldCheck, Database,
} from 'lucide-react';
import { useTranslation } from '../i18n';
import {
  checkPlatformAdmin, listMigrations, createMigration, getMigrationDetail, setMigrationStatus,
  generateInvitation, revokeInvitation, extendInvitation, decideMapping, resolveIssue,
  decideDuplicate, startAnalysis, startTestImport, requestApproval, startFinalImport,
  rollbackMigration, closeMigration, sendAdminMessage, getMigrationAudit, getFileDownloadUrl,
  reanalyzeFile, rejectFile, type AdminMigrationListItem,
} from '../lib/migrationAdminApi';

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

export default function AdminMigrations() {
  const gate = useQuery({ queryKey: ['migration-admin-check'], queryFn: checkPlatformAdmin, staleTime: 5 * 60_000, retry: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (gate.isLoading) {
    return <div className="flex items-center justify-center py-24 text-text-tertiary"><Loader2 size={22} className="animate-spin" /></div>;
  }
  if (!gate.data) return <Navigate to="/" replace />;

  return (
    <div className="px-8 py-6">
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
  ['clients', 'Clients'], ['properties', 'Propriétés'], ['services', 'Produits et services'],
  ['quotes', 'Soumissions'], ['jobs', 'Jobs'], ['visits', 'Visites'], ['invoices', 'Factures'],
] as const;

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [orgId, setOrgId] = useState('');
  const [email, setEmail] = useState('');
  const [categories, setCategories] = useState<string[]>(['clients', 'properties', 'jobs', 'visits', 'invoices']);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-[120] bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-card border border-outline rounded-xl shadow-xl w-full max-w-[480px] p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[17px] font-bold text-text-primary mb-4">Nouvelle migration</h2>
        <div className="space-y-3 text-[13px]">
          <div>
            <label className="block text-text-secondary font-medium mb-1">ID du workspace (org_id) *</label>
            <input value={orgId} onChange={(e) => setOrgId(e.target.value.trim())} placeholder="uuid du workspace" className="w-full h-9 px-3 bg-surface border border-outline rounded-md" />
          </div>
          <div>
            <label className="block text-text-secondary font-medium mb-1">Courriel du client invité</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="proprietaire@entreprise.com" className="w-full h-9 px-3 bg-surface border border-outline rounded-md" />
          </div>
          {/* Choix de l'ancien CRM retiré volontairement : pas de lien direct
              pour l'instant — toute migration part en mode générique (fichiers).
              Réactivable plus tard via PATCH source_crm côté serveur. */}
          <div>
            <label className="block text-text-secondary font-medium mb-1">Catégories à migrer</label>
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
            <label className="block text-text-secondary font-medium mb-1">Notes internes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full h-16 px-3 py-2 bg-surface border border-outline rounded-md" />
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

type Tab = 'resume' | 'files' | 'mappings' | 'issues' | 'duplicates' | 'imports' | 'audit' | 'messages';
const TABS: { id: Tab; label: string }[] = [
  { id: 'resume', label: 'Résumé' },
  { id: 'files', label: 'Fichiers' },
  { id: 'mappings', label: 'Correspondances' },
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
      const status = (query.state.data as any)?.migration?.status;
      return ['parsing', 'testing', 'importing', 'post_import_validation'].includes(status) ? 4000 : false;
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
          </button>
        ))}
      </div>

      {tab === 'resume' && <ResumeTab d={d} onChanged={refresh} />}
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

function ActionsBar({ m, d, onDone }: { m: any; d: any; onDone: () => void }) {
  const [confirmKind, setConfirmKind] = useState<'final' | 'rollback' | null>(null);
  const btn = 'h-9 px-3.5 rounded-md text-[13px] font-medium border transition-colors';
  const subtle = `${btn} bg-surface-card border-outline text-text-secondary hover:bg-surface-secondary`;
  const primary = `${btn} bg-[#d8d0c2] border-transparent text-black hover:bg-[#cabfad]`;
  const danger = `${btn} bg-red-50 border-red-200 text-red-700 hover:bg-red-100`;

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    try {
      await fn();
      toast.success(okMsg);
      onDone();
    } catch (err: any) {
      toast.error(err?.message ?? 'Erreur');
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {['files_uploaded', 'parsing', 'mapping', 'human_review', 'waiting_for_client'].includes(m.status) && (
        <button type="button" className={subtle} onClick={() => act(() => startAnalysis(m.id), 'Analyse relancée')}>Relancer l'analyse</button>
      )}
      {['mapping', 'human_review', 'waiting_for_client', 'ready_for_test', 'test_review'].includes(m.status) && (
        <button type="button" className={primary} onClick={() => act(() => startTestImport(m.id), 'Import test lancé')}>Lancer l'import test</button>
      )}
      {m.status === 'test_review' && (
        <button type="button" className={primary} onClick={() => act(() => requestApproval(m.id), 'Approbation demandée au client')}>Demander l'approbation</button>
      )}
      {m.status === 'approved' && (
        <button type="button" className={primary} onClick={() => act(() => setMigrationStatus(m.id, 'ready_for_final_import'), 'Migration prête pour l\'import final')}>
          Marquer prête pour l'import
        </button>
      )}
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
    <div className="fixed inset-0 z-[120] bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-card border border-outline rounded-xl shadow-xl w-full max-w-[440px] p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[16px] font-bold text-text-primary mb-2">
          {kind === 'final' ? 'Confirmer l\'import final' : 'Confirmer le rollback'}
        </h2>
        <p className="text-[13px] text-text-secondary mb-4">{summary}</p>
        <p className="text-[12px] text-text-secondary mb-1.5">
          Saisissez le nom exact du workspace (<strong>{orgName}</strong>) pour confirmer :
        </p>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} className="w-full h-9 px-3 text-[13px] bg-surface border border-outline rounded-md mb-4" />
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

function ResumeTab({ d, onChanged }: { d: any; onChanged: () => void }) {
  const m = d.migration;
  const [ttl, setTtl] = useState(48);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const activeInv = (d.invitations ?? []).find((i: any) => !i.revoked_at && !i.superseded_at);
  const staging = d.staging_counts ?? {};

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
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
                className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md border border-amber-300 text-amber-800 hover:bg-amber-100"
              >
                <Copy size={13} />
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap text-[13px]">
          <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))} className="h-9 px-2 bg-surface border border-outline rounded-md">
            <option value={24}>24 h</option>
            <option value={48}>48 h</option>
            <option value={96}>4 jours</option>
            <option value={168}>7 jours</option>
          </select>
          <button
            type="button"
            onClick={async () => {
              try {
                const res = await generateInvitation(m.id, ttl);
                setInviteUrl(res.invite_url);
                toast.success('Invitation générée (l\'ancienne est invalidée)');
                onChanged();
              } catch (err: any) { toast.error(err?.message ?? 'Erreur'); }
            }}
            className="h-9 px-4 bg-[#d8d0c2] text-black hover:bg-[#cabfad] rounded-md font-medium"
          >
            {activeInv ? 'Regénérer le lien' : 'Générer le lien'}
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
      </div>
    </>
  );
}

function MappingsTab({ d, onChanged }: { d: any; onChanged: () => void }) {
  const m = d.migration;
  const colById = new Map((d.columns ?? []).map((c: any) => [c.id, c]));
  const fileById = new Map((d.files ?? []).map((f: any) => [f.id, f]));
  const rows = (d.mappings ?? []).slice().sort((a: any, b: any) => {
    const ca = colById.get(a.column_id) as any;
    const cb = colById.get(b.column_id) as any;
    return `${a.file_id}${ca?.position ?? 0}`.localeCompare(`${b.file_id}${cb?.position ?? 0}`);
  });
  if (rows.length === 0) return <div className="section-card p-5 text-[13px] text-text-tertiary">Aucune correspondance (analyse pas encore faite).</div>;
  return (
    <div className="section-card p-5">
      <div className="border border-outline rounded-md overflow-x-auto">
        <div className="grid min-w-[900px] text-[12px]" style={{ gridTemplateColumns: '1fr 1fr 1.2fr 70px 110px 160px' }}>
          {['Fichier', 'Colonne', 'Aperçu masqué', 'Conf.', 'Statut', 'Décision'].map((h) => (
            <div key={h} className="px-3 py-2 bg-surface-secondary/60 border-b border-outline font-semibold text-text-secondary">{h}</div>
          ))}
          {rows.map((mp: any) => {
            const col = colById.get(mp.column_id) as any;
            const file = fileById.get(mp.file_id) as any;
            const cell = 'px-3 py-2 border-b border-outline/30 flex items-center min-w-0 text-text-primary';
            return (
              <MappingAdminRow key={mp.id} mp={mp} col={col} file={file} cell={cell} migrationId={m.id} onChanged={onChanged} />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MappingAdminRow({ mp, col, file, cell, migrationId, onChanged }: any) {
  return (
    <>
      <div className={cell}><span className="truncate text-text-secondary">{file?.original_name ?? '—'}</span></div>
      <div className={cell}>
        <div className="min-w-0">
          <div className="truncate font-medium">{col?.header ?? '—'}</div>
          <div className="text-[10px] text-text-tertiary">{col?.detected_type} → {mp.target_entity ?? '?'}·{mp.target_field ?? '—'}</div>
        </div>
      </div>
      <div className={`${cell} text-text-tertiary`}><span className="truncate">{(col?.samples_masked ?? []).slice(0, 3).join(' · ')}</span></div>
      <div className={cell}>{mp.confidence}%</div>
      <div className={cell}>{mp.status}</div>
      <div className={`${cell} gap-2 text-[12px]`}>
        {mp.status !== 'confirmed' && (
          <button
            type="button"
            className="underline text-emerald-700"
            onClick={async () => { try { await decideMapping(migrationId, mp.id, { status: 'confirmed' }); onChanged(); } catch (err: any) { toast.error(err?.message ?? 'Erreur'); } }}
          >
            Confirmer
          </button>
        )}
        {mp.status !== 'rejected' && (
          <button
            type="button"
            className="underline text-red-600"
            onClick={async () => { try { await decideMapping(migrationId, mp.id, { status: 'rejected', target_entity: null, target_field: null }); onChanged(); } catch (err: any) { toast.error(err?.message ?? 'Erreur'); } }}
          >
            Rejeter
          </button>
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
