// Console interne des migrations assistées — /admin/migrations
// Réservée à l'administrateur plateforme Lume (PLATFORM_OWNER_ID). La page se
// gate elle-même via GET /api/migration-admin/check et redirige sinon ; le
// serveur re-vérifie de toute façon chaque requête. Hors navigation : on y
// accède par URL directe. Périmètre limité aux projets de migration.

import { useId, useState } from 'react';
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
  reanalyzeFile, rejectFile, downloadRejectsCsv, retryErrors, getMigrationStaff, saveStaffMap,
  getMigrationMembers, listMappingTemplates, saveMappingTemplate, applyMappingTemplate,
  type AdminMigrationListItem, type MigrationStaffEntry,
} from '../lib/migrationAdminApi';
import { lancerBotMigration, definirBotActif, definirModeBot, approuverAuNomDuClient, type RapportBotMigration } from '../lib/migrationAdminApi';
import { confirmer } from '../components/ui/ConfirmDialog';

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
  ['taxes', 'Noms de taxes'], ['clients', 'Clients'], ['properties', 'Propriétés'], ['services', 'Produits et services'],
  ['quotes', 'Soumissions'], ['jobs', 'Jobs'], ['visits', 'Visites'], ['invoices', 'Factures'],
] as const;

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const id = useId();
  const [orgId, setOrgId] = useState('');
  const [email, setEmail] = useState('');
  const [categories, setCategories] = useState<string[]>(['taxes', 'clients', 'properties', 'services', 'quotes', 'jobs', 'visits', 'invoices']);
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
      {['files_uploaded', 'parsing', 'mapping', 'human_review', 'waiting_for_client', 'ready_for_test', 'test_review'].includes(m.status) && (
        <button type="button" className={primary} onClick={() => act(async () => { const r = await lancerBotMigration(m.id); toast.message(`Bot : ${r.decisions.length} décision${r.decisions.length > 1 ? 's' : ''} — ${r.arret}`); }, 'Passe du bot terminée')}>Confier au bot</button>
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

/** Le bot de migration : actif ou non, dernière passe, ses décisions. L'approbation et l'import final restent humains. */
function CarteBot({ m, onChanged }: { m: any; onChanged: () => void }) {
  const rapport = (m.bot_dernier_rapport ?? null) as RapportBotMigration | null;
  const [busy, setBusy] = useState(false);
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
      {rapport ? (
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
        </div>
      ) : (
        <p className="mt-3 text-[12.5px] text-text-tertiary">Aucune passe encore. « Confier au bot » lance une passe maintenant ; « Activer » le fait revenir tout seul.</p>
      )}
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
      <CarteBot m={m} onChanged={onChanged} />
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
const ENTITY_LABELS_FR: Record<string, string> = {
  tax_config: 'Noms de taxes', client: 'Clients', property: 'Propriétés', service: 'Produits et services', quote: 'Soumissions',
  job: 'Jobs', visit: 'Visites', invoice: 'Factures', line_item: 'Lignes', payment: 'Paiements',
};
type FieldCatalog = Record<string, { field: string; labelFr: string; labelEn: string }[]>;

function ConfidenceBadge({ value }: { value: number }) {
  const cls = value >= 90
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : value >= 70
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-red-50 text-red-700 border-red-200';
  return <span className={`inline-flex items-center px-2 h-5 rounded-full border text-[11px] font-semibold ${cls}`}>{value}%</span>;
}

// Même tableau que le portail client (MigrationPortal › Correspondance des colonnes) :
// une liste déroulante par colonne, alimentée par FIELD_CATALOG, « Ne pas importer » = rejet.
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

  return (
    <div className="section-card p-5">
      <TemplateControls migrationId={m.id} sourceCrm={m.source_crm} onChanged={onChanged} />
      <p className="text-[12px] text-text-tertiary mb-3">
        Choisir un champ Lume dans la liste corrige la colonne; « Ne pas importer » l'ignore. Les décisions prises ici priment sur les gabarits.
      </p>
      <div className="space-y-5">
        {files.map((file) => (
          <div key={file.id}>
            <div className="text-[12px] font-semibold text-text-secondary mb-1.5">{file.original_name}</div>
            <div className="border border-outline rounded-md overflow-x-auto">
              <div className="grid min-w-[720px] text-[12px]" style={{ gridTemplateColumns: '1.1fr 1.3fr 1.3fr 70px 150px' }}>
                {['Colonne', 'Aperçu (masqué)', 'Champ Lume', 'Conf.', 'Statut'].map((h) => (
                  <div key={h} className="px-3 py-2 bg-surface-secondary/60 border-b border-outline font-semibold text-text-secondary">{h}</div>
                ))}
                {(byFile.get(file.id) ?? []).map((col) => (
                  <MappingAdminRow
                    key={col.id}
                    col={col}
                    mapping={mappingByColumn.get(col.id)}
                    catalog={catalog}
                    onSelect={(mp, entity, field) => {
                      if (!entity || !field) return decide(mp, { status: 'rejected', target_entity: null, target_field: null }, 'Colonne ignorée');
                      return decide(mp, { status: 'corrected', target_entity: entity, target_field: field }, 'Correspondance mise à jour');
                    }}
                    onConfirm={(mp) => decide(mp, { status: 'confirmed' }, 'Correspondance confirmée')}
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

function MappingAdminRow({ col, mapping, catalog, onSelect, onConfirm }: {
  col: any;
  mapping?: any;
  catalog: FieldCatalog;
  onSelect: (mp: any, entity: string | null, field: string | null) => void;
  onConfirm: (mp: any) => void;
}) {
  const cell = 'px-3 py-2 border-b border-outline/30 flex items-center min-w-0 text-text-primary';
  const value = mapping?.target_entity && mapping?.target_field ? `${mapping.target_entity}:${mapping.target_field}` : '';
  const knownValue = !value || (catalog[mapping.target_entity] ?? []).some((f) => f.field === mapping.target_field);
  const canConfirm = mapping && (mapping.status === 'suggested' || mapping.status === 'needs_review') && !!mapping.target_field;
  return (
    <>
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
          <select
            aria-label={`Champ cible pour ${col.header}`}
            className="w-full h-8 px-2 text-[12px] bg-surface-card border border-outline rounded-md"
            value={value}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) onSelect(mapping, null, null);
              else {
                const [entity, field] = v.split(':');
                onSelect(mapping, entity, field);
              }
            }}
          >
            <option value="">— Ne pas importer —</option>
            {!knownValue && <option value={value}>{ENTITY_LABELS_FR[mapping.target_entity] ?? mapping.target_entity} · {mapping.target_field}</option>}
            {Object.entries(catalog).map(([entity, fields]) => (
              <optgroup key={entity} label={ENTITY_LABELS_FR[entity] ?? entity}>
                {fields.map((f) => (
                  <option key={`${entity}:${f.field}`} value={`${entity}:${f.field}`}>{f.labelFr}</option>
                ))}
              </optgroup>
            ))}
          </select>
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
