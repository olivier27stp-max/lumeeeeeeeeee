// Portail temporaire de migration assistée — /migration/invite/:token
// Page hors shell CRM (aucune navigation Lume) : le client authentifié du bon
// workspace y téléverse ses exports, suit l'analyse, corrige les
// correspondances, répond aux questions et approuve (ou non) l'import final.
// Toujours en thème clair (page publique) ; peint son propre arrière-plan.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import {
  ShieldCheck, Clock, LogOut, UploadCloud, FileText, CheckCircle2, AlertCircle,
  Loader2, Trash2, MessageSquare, ChevronDown, ChevronRight, Send, Lock,
} from 'lucide-react';
import { useTranslation } from '../i18n';
import { supabase } from '../lib/supabase';
import {
  PortalError,
  answerPortalIssue,
  correctPortalMapping,
  deletePortalFile,
  getPortalInstructions,
  getPortalMappings,
  getPortalPreview,
  getPortalReport,
  getPortalSession,
  listPortalFiles,
  listPortalIssues,
  listPortalMessages,
  sendPortalMessage,
  submitPortalApproval,
  uploadPortalFile,
  type PortalFile,
  type PortalSession,
} from '../lib/migrationPortalApi';

const CRM_LABELS: Record<string, string> = {
  jobber: 'Jobber',
  housecall_pro: 'Housecall Pro',
  servicetitan: 'ServiceTitan',
  gohighlevel: 'GoHighLevel',
  quickbooks: 'QuickBooks',
  other: 'Autre CRM',
  custom_files: 'Fichiers personnalisés',
};

const ENTITY_LABELS_FR: Record<string, string> = {
  client: 'Clients', property: 'Propriétés', service: 'Produits et services', quote: 'Soumissions',
  job: 'Jobs', visit: 'Visites', invoice: 'Factures', line_item: 'Lignes', payment: 'Paiements',
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

function remainingLabel(expiresAt: string, fr: boolean): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return fr ? 'Expiré' : 'Expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 48) return fr ? `${Math.floor(h / 24)} jours` : `${Math.floor(h / 24)} days`;
  return `${h} h ${m.toString().padStart(2, '0')}`;
}

function ConfidenceBadge({ value }: { value: number }) {
  const cls = value >= 90
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : value >= 70
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-red-50 text-red-700 border-red-200';
  return <span className={`inline-flex items-center px-2 h-5 rounded-full border text-[11px] font-semibold ${cls}`}>{value}%</span>;
}

function SectionCard({ title, icon, children, defaultOpen = true }: { title: string; icon?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-[#e6e2d8] bg-white shadow-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-5 py-4 text-left">
        {icon}
        <span className="text-[15px] font-semibold text-[#1a1a1a] flex-1">{title}</span>
        {open ? <ChevronDown size={16} className="text-[#8a8578]" /> : <ChevronRight size={16} className="text-[#8a8578]" />}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

const DENIAL_MESSAGES: Record<string, { fr: string; en: string }> = {
  invalid: {
    fr: 'Ce lien de migration est invalide. Communiquez avec l\'équipe Lume pour obtenir un nouveau lien.',
    en: 'This migration link is invalid. Contact the Lume team to get a new link.',
  },
  expired: {
    fr: 'Cette invitation a expiré. Communiquez avec l\'équipe Lume pour obtenir un nouveau lien.',
    en: 'This invitation has expired. Contact the Lume team to get a new link.',
  },
  revoked: { fr: 'Cette invitation a été révoquée.', en: 'This invitation has been revoked.' },
  superseded: {
    fr: 'Un nouveau lien a été émis pour cette migration — utilisez le plus récent.',
    en: 'A newer link was issued for this migration — use the most recent one.',
  },
  locked: {
    fr: 'Trop de tentatives. Communiquez avec l\'équipe Lume.',
    en: 'Too many attempts. Contact the Lume team.',
  },
  closed: { fr: 'Cette migration est déjà terminée.', en: 'This migration is already completed.' },
  forbidden: {
    fr: 'Vous n\'avez pas l\'autorisation d\'accéder à cette migration.',
    en: 'You are not authorized to access this migration.',
  },
  role: {
    fr: 'Seul un propriétaire ou administrateur du workspace peut accéder à cette migration.',
    en: 'Only a workspace owner or admin can access this migration.',
  },
  wrong_account: {
    fr: 'Vous devez vous connecter avec le compte autorisé pour cette migration.',
    en: 'You must sign in with the account authorized for this migration.',
  },
};

export default function MigrationPortal() {
  const { token = '' } = useParams<{ token: string }>();
  const { language } = useTranslation();
  const fr = language !== 'en';
  const qc = useQueryClient();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setAuthed(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (mounted) setAuthed(!!session);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const sessionQuery = useQuery({
    queryKey: ['migration-portal-session', token],
    queryFn: () => getPortalSession(token),
    enabled: authed === true && !!token,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!token) return null;

  // ── Écrans d'accès ──────────────────────────────────────────────────
  if (authed === false) {
    return (
      <Frame fr={fr}>
        <AccessCard
          icon={<Lock size={22} className="text-[#8a8578]" />}
          title={fr ? 'Connexion requise' : 'Sign-in required'}
          body={fr
            ? 'Pour ouvrir ce portail de migration, connectez-vous d\'abord à votre compte Lume, puis revenez sur ce lien.'
            : 'To open this migration portal, sign in to your Lume account first, then come back to this link.'}
          action={
            {/* la page de connexion de l'app vit à /auth — bug « /login → 404
                marketing » attrapé par le smoke navigateur du 2026-08-30 */}
            <a href="/auth" className="inline-flex items-center h-10 px-5 bg-[#d8d0c2] text-black hover:bg-[#cabfad] rounded-md text-[14px] font-medium">
              {fr ? 'Se connecter' : 'Sign in'}
            </a>
          }
        />
      </Frame>
    );
  }
  if (authed === null || (sessionQuery.isLoading && !sessionQuery.data)) {
    return (
      <Frame fr={fr}>
        <div className="flex items-center justify-center py-24 text-[#8a8578]">
          <Loader2 size={22} className="animate-spin" />
        </div>
      </Frame>
    );
  }
  if (sessionQuery.isError) {
    const err = sessionQuery.error as unknown;
    const code = err instanceof PortalError ? err.code : 'invalid';
    const msg = DENIAL_MESSAGES[code] ?? DENIAL_MESSAGES.invalid;
    return (
      <Frame fr={fr}>
        <AccessCard
          icon={<AlertCircle size={22} className="text-red-500" />}
          title={fr ? 'Accès impossible' : 'Access denied'}
          body={fr ? msg.fr : msg.en}
          action={code === 'wrong_account' || code === 'auth_required' ? (
            <button
              type="button"
              onClick={async () => { await supabase.auth.signOut(); window.location.reload(); }}
              className="inline-flex items-center h-10 px-5 bg-white border border-[#e6e2d8] text-[#444] hover:bg-[#f4f1ea] rounded-md text-[14px] font-medium"
            >
              {fr ? 'Changer de compte' : 'Switch account'}
            </button>
          ) : null}
        />
      </Frame>
    );
  }

  const session = sessionQuery.data as PortalSession;
  return <PortalBody fr={fr} token={token} session={session} onRefresh={() => qc.invalidateQueries({ queryKey: ['migration-portal-session', token] })} />;
}

function Frame({ fr, children, session }: { fr: boolean; children: React.ReactNode; session?: PortalSession }) {
  return (
    <div className="min-h-screen bg-[#f7f5f0] text-[#1a1a1a]" style={{ colorScheme: 'light' }}>
      <Toaster position="top-center" toastOptions={{ duration: 3500 }} />
      <header className="bg-white border-b border-[#e6e2d8]">
        <div className="max-w-[1100px] mx-auto px-6 h-16 flex items-center gap-4">
          <span className="text-[20px] font-extrabold tracking-tight">Lume</span>
          <span className="text-[14px] text-[#6b675e] font-medium">{fr ? 'Migration des données' : 'Data migration'}</span>
          <span className="inline-flex items-center gap-1.5 px-2.5 h-6 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-semibold">
            <ShieldCheck size={12} /> {fr ? 'Lien sécurisé' : 'Secure link'}
          </span>
          <div className="flex-1" />
          {session && (
            <>
              <span className="hidden sm:inline-flex items-center gap-1.5 text-[12px] text-[#6b675e]">
                <Clock size={13} /> {fr ? 'Expire dans' : 'Expires in'} {remainingLabel(session.expires_at, fr)}
              </span>
              <span className="hidden md:block text-[13px] font-semibold">{session.workspace_name}</span>
              <span className="hidden md:block text-[12px] text-[#8a8578]">{session.user.email}</span>
            </>
          )}
          <button
            type="button"
            onClick={async () => { await supabase.auth.signOut(); window.location.href = '/'; }}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-[#e6e2d8] bg-white text-[12px] text-[#6b675e] hover:bg-[#f4f1ea]"
          >
            <LogOut size={13} /> {fr ? 'Quitter' : 'Exit'}
          </button>
        </div>
      </header>
      <main className="max-w-[1100px] mx-auto px-6 py-8">{children}</main>
      <footer className="max-w-[1100px] mx-auto px-6 pb-10 text-[11px] text-[#a09a8c] space-y-0.5">
        <p>{fr ? 'Données chiffrées en transit et au repos · Accès limité à cette migration · Actions journalisées' : 'Data encrypted in transit and at rest · Access limited to this migration · All actions are logged'}</p>
        <p>{fr ? 'Les fichiers temporaires sont supprimés automatiquement après la migration.' : 'Temporary files are deleted automatically after the migration.'}</p>
      </footer>
    </div>
  );
}

function AccessCard({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="max-w-[480px] mx-auto mt-16 rounded-xl border border-[#e6e2d8] bg-white shadow-sm p-8 text-center space-y-4">
      <div className="mx-auto w-11 h-11 rounded-full bg-[#f4f1ea] flex items-center justify-center">{icon}</div>
      <h1 className="text-[18px] font-bold">{title}</h1>
      <p className="text-[14px] text-[#6b675e] leading-relaxed">{body}</p>
      {action}
    </div>
  );
}

const STEPS_FR = ['Ancien CRM', 'Téléversement', 'Correspondance', 'Validation', 'Aperçu', 'Importation'];
const STEPS_EN = ['Old CRM', 'Upload', 'Mapping', 'Review', 'Preview', 'Import'];

function stepIndexForStatus(status: string): number {
  if (['draft', 'invitation_sent'].includes(status)) return 0;
  if (['waiting_for_files', 'files_uploaded', 'parsing'].includes(status)) return 1;
  if (['mapping'].includes(status)) return 2;
  if (['human_review', 'waiting_for_client', 'ready_for_test', 'testing'].includes(status)) return 3;
  if (['test_review', 'waiting_for_approval'].includes(status)) return 4;
  return 5;
}

function PortalBody({ fr, token, session, onRefresh }: { fr: boolean; token: string; session: PortalSession; onRefresh: () => void }) {
  const qc = useQueryClient();
  const activeStep = stepIndexForStatus(session.status);
  const steps = fr ? STEPS_FR : STEPS_EN;

  const filesQuery = useQuery({
    queryKey: ['migration-portal-files', token],
    queryFn: () => listPortalFiles(token),
    initialData: session.files,
    refetchInterval: (query) => {
      const files = (query.state.data ?? []) as PortalFile[];
      return files.some((f) => f.parse_status === 'parsing' || f.parse_status === 'pending') ? 4000 : false;
    },
    refetchOnWindowFocus: false,
  });
  const files = filesQuery.data ?? [];

  return (
    <Frame fr={fr} session={session}>
      <div className="grid grid-cols-1 lg:grid-cols-[210px_1fr] gap-8">
        {/* Rail des étapes */}
        <nav className="hidden lg:block">
          <ol className="space-y-1 sticky top-8">
            {steps.map((label, i) => (
              <li
                key={label}
                className={`flex items-center gap-2.5 px-3 h-9 rounded-md text-[13px] ${
                  i === activeStep ? 'bg-white border border-[#e6e2d8] font-semibold shadow-sm' : i < activeStep ? 'text-[#6b675e]' : 'text-[#b3ac9d]'
                }`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                  i < activeStep ? 'bg-emerald-100 text-emerald-700' : i === activeStep ? 'bg-[#d8d0c2] text-black' : 'bg-[#eeeae0] text-[#a09a8c]'
                }`}
                >
                  {i < activeStep ? <CheckCircle2 size={13} /> : i + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>
        </nav>

        <div className="space-y-5 min-w-0">
          <SummaryCards fr={fr} session={session} />
          {session.read_only && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-[13px] px-4 py-3">
              {fr
                ? 'La migration est en cours de finalisation — le portail est en lecture seule.'
                : 'The migration is being finalized — the portal is read-only.'}
            </div>
          )}
          <InstructionsSection fr={fr} token={token} session={session} />
          <FilesSection fr={fr} token={token} session={session} files={files} onChanged={() => { qc.invalidateQueries({ queryKey: ['migration-portal-files', token] }); onRefresh(); }} />
          <MappingsSection fr={fr} token={token} session={session} />
          <QuestionsSection fr={fr} token={token} />
          <PreviewSection fr={fr} token={token} session={session} onDecided={onRefresh} />
          {['completed', 'completed_with_warnings', 'rolled_back'].includes(session.status) && <ReportSection fr={fr} token={token} />}
          <MessagesSection fr={fr} token={token} />
        </div>
      </div>
    </Frame>
  );
}

function SummaryCards({ fr, session }: { fr: boolean; session: PortalSession }) {
  const entries = ['client', 'property', 'job', 'visit', 'quote', 'invoice']
    .map((e) => ({ key: e, label: ENTITY_LABELS_FR[e], count: session.detected_counts[e] ?? 0 }));
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {entries.map((e) => (
        <div key={e.key} className="rounded-lg border border-[#e6e2d8] bg-white px-3 py-2.5">
          <div className="text-[18px] font-extrabold leading-tight">{e.count}</div>
          <div className="text-[11px] text-[#8a8578]">{e.label}</div>
        </div>
      ))}
    </div>
  );
}

function InstructionsSection({ fr, token, session }: { fr: boolean; token: string; session: PortalSession }) {
  const q = useQuery({
    queryKey: ['migration-portal-instructions', token],
    queryFn: () => getPortalInstructions(token),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const cfg = q.data;
  return (
    <SectionCard
      title={`${fr ? 'Exporter depuis' : 'Export from'} ${CRM_LABELS[session.source_crm] ?? session.source_crm}`}
      icon={<FileText size={16} className="text-[#8a8578]" />}
      defaultOpen={stepIndexForStatus(session.status) <= 1}
    >
      {!cfg ? (
        <div className="text-[13px] text-[#8a8578]">…</div>
      ) : (
        <div className="space-y-4 text-[13px] text-[#444]">
          <div>
            <div className="font-semibold mb-1.5">{fr ? 'Rapports recommandés' : 'Recommended reports'}</div>
            <ul className="list-disc pl-5 space-y-0.5">
              {cfg.reports.map((r: { fr: string; en: string }, i: number) => <li key={i}>{fr ? r.fr : r.en}</li>)}
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-1.5">{fr ? 'Étapes' : 'Steps'}</div>
            <ol className="list-decimal pl-5 space-y-0.5">
              {cfg.steps.map((s: { fr: string; en: string }, i: number) => <li key={i}>{fr ? s.fr : s.en}</li>)}
            </ol>
          </div>
          {cfg.knownLimitations.length > 0 && (
            <div>
              <div className="font-semibold mb-1.5">{fr ? 'Limites connues' : 'Known limitations'}</div>
              <ul className="list-disc pl-5 space-y-0.5 text-[#6b675e]">
                {cfg.knownLimitations.map((l: { fr: string; en: string }, i: number) => <li key={i}>{fr ? l.fr : l.en}</li>)}
              </ul>
            </div>
          )}
          <div className="text-[12px] text-[#8a8578]">
            {fr
              ? 'Formats acceptés : CSV (données) et PDF (archive de référence). XLSX et ZIP ne sont pas acceptés pour l\'instant.'
              : 'Accepted formats: CSV (data) and PDF (reference archive). XLSX and ZIP are not accepted yet.'}
            {cfg.docsUrl && (
              <>
                {' · '}
                <a href={cfg.docsUrl} target="_blank" rel="noreferrer" className="underline">
                  {fr ? 'Documentation officielle' : 'Official documentation'}
                </a>
              </>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

const FILE_STATUS_LABELS: Record<string, { fr: string; en: string; tone: 'ok' | 'warn' | 'err' | 'busy' }> = {
  pending: { fr: 'En attente', en: 'Pending', tone: 'busy' },
  parsing: { fr: 'Analyse…', en: 'Parsing…', tone: 'busy' },
  parsed: { fr: 'Analysé', en: 'Parsed', tone: 'ok' },
  failed: { fr: 'Échec', en: 'Failed', tone: 'err' },
};

function FilesSection({ fr, token, session, files, onChanged }: {
  fr: boolean; token: string; session: PortalSession; files: PortalFile[]; onChanged: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function handleFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    if (arr.length === 0) return;
    setUploading(true);
    for (const file of arr) {
      try {
        await uploadPortalFile(token, file);
        toast.success(fr ? `${file.name} téléversé` : `${file.name} uploaded`);
      } catch (err: any) {
        toast.error(err?.message ?? (fr ? 'Téléversement impossible' : 'Upload failed'));
      }
    }
    setUploading(false);
    onChanged();
  }

  return (
    <SectionCard title={fr ? 'Téléverser vos fichiers' : 'Upload your files'} icon={<UploadCloud size={16} className="text-[#8a8578]" />}>
      {session.can_upload ? (
        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files) void handleFiles(e.dataTransfer.files); }}
          className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 cursor-pointer transition-colors ${
            dragging ? 'border-[#b9ae99] bg-[#f4f1ea]' : 'border-[#e6e2d8] bg-[#fbfaf7] hover:bg-[#f4f1ea]'
          }`}
        >
          {uploading ? <Loader2 size={20} className="animate-spin text-[#8a8578]" /> : <UploadCloud size={20} className="text-[#8a8578]" />}
          <span className="text-[13px] text-[#6b675e]">
            {fr ? 'Glissez vos fichiers CSV ici, ou cliquez pour choisir' : 'Drag your CSV files here, or click to choose'}
          </span>
          <span className="text-[11px] text-[#a09a8c]">{fr ? 'CSV ou PDF · max 25 Mo par fichier' : 'CSV or PDF · max 25 MB per file'}</span>
          <input
            type="file"
            multiple
            accept=".csv,.pdf"
            className="hidden"
            disabled={uploading}
            onChange={(e) => { if (e.target.files) void handleFiles(e.target.files); e.target.value = ''; }}
          />
        </label>
      ) : (
        <div className="text-[13px] text-[#8a8578]">
          {fr ? 'Le téléversement n\'est pas disponible à cette étape.' : 'Uploading is not available at this stage.'}
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-4 border border-[#e6e2d8] rounded-lg overflow-hidden">
          <div className="grid text-[12px]" style={{ gridTemplateColumns: '1fr 90px 110px 90px 110px 40px' }}>
            {[fr ? 'Fichier' : 'File', fr ? 'Taille' : 'Size', fr ? 'Catégorie' : 'Category', fr ? 'Lignes' : 'Rows', fr ? 'Statut' : 'Status', ''].map((h) => (
              <div key={h} className="px-3 py-2 bg-[#fbfaf7] border-b border-[#e6e2d8] font-semibold text-[#6b675e]">{h}</div>
            ))}
            {files.map((f) => {
              const st = f.security_status === 'rejected'
                ? { fr: 'Rejeté', en: 'Rejected', tone: 'err' as const }
                : FILE_STATUS_LABELS[f.parse_status] ?? FILE_STATUS_LABELS.pending;
              return (
                <FileRow key={f.id} f={f} st={st} fr={fr} canDelete={session.can_upload} onDelete={async () => {
                  try {
                    await deletePortalFile(token, f.id);
                    toast.success(fr ? 'Fichier supprimé' : 'File deleted');
                    onChanged();
                  } catch (err: any) {
                    toast.error(err?.message ?? 'Erreur');
                  }
                }}
                />
              );
            })}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function FileRow({ f, st, fr, canDelete, onDelete }: {
  f: PortalFile; st: { fr: string; en: string; tone: 'ok' | 'warn' | 'err' | 'busy' }; fr: boolean; canDelete: boolean; onDelete: () => void;
}) {
  const toneCls = st.tone === 'ok'
    ? 'text-emerald-700'
    : st.tone === 'err'
      ? 'text-red-600'
      : 'text-[#8a8578]';
  const cell = 'px-3 py-2 border-b border-[#f0ece2] text-[#444] flex items-center min-w-0';
  return (
    <>
      <div className={cell}>
        <span className="truncate font-medium">{f.original_name}</span>
      </div>
      <div className={cell}>{formatBytes(f.size_bytes)}</div>
      <div className={cell}>{f.category_detected ? (ENTITY_LABELS_FR[f.category_detected] ?? f.category_detected) : '—'}</div>
      <div className={cell}>{f.row_count ?? '—'}</div>
      <div className={`${cell} ${toneCls} gap-1.5`}>
        {st.tone === 'busy' && <Loader2 size={12} className="animate-spin" />}
        {fr ? st.fr : st.en}
        {f.parse_error === 'truncated' && <span title={fr ? 'Fichier tronqué (limite de lignes)' : 'File truncated (row cap)'}>⚠</span>}
      </div>
      <div className={`${cell} justify-center`}>
        {canDelete && (
          <button type="button" onClick={onDelete} className="text-[#a09a8c] hover:text-red-600" title={fr ? 'Supprimer' : 'Delete'}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </>
  );
}

function MappingsSection({ fr, token, session }: { fr: boolean; token: string; session: PortalSession }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['migration-portal-mappings', token],
    queryFn: () => getPortalMappings(token),
    enabled: stepIndexForStatus(session.status) >= 2,
    refetchOnWindowFocus: false,
  });
  if (stepIndexForStatus(session.status) < 2 || !q.data) return null;
  const { columns, mappings, can_edit, field_catalog } = q.data;
  if (columns.length === 0) return null;
  const mappingByColumn = new Map(mappings.map((m) => [m.column_id, m]));
  const fileNames = new Map(session.files.map((f) => [f.id, f.original_name]));
  const byFile = new Map<string, typeof columns>();
  for (const c of columns) {
    const arr = byFile.get(c.file_id) ?? [];
    arr.push(c);
    byFile.set(c.file_id, arr);
  }

  return (
    <SectionCard title={fr ? 'Correspondance des colonnes' : 'Column mapping'} icon={<CheckCircle2 size={16} className="text-[#8a8578]" />} defaultOpen={stepIndexForStatus(session.status) === 2}>
      <p className="text-[12px] text-[#8a8578] mb-3">
        {fr
          ? 'Les aperçus sont masqués pour protéger vos données. Les correspondances incertaines sont vérifiées par l\'équipe Lume.'
          : 'Previews are masked to protect your data. Uncertain mappings are verified by the Lume team.'}
      </p>
      <div className="space-y-5">
        {Array.from(byFile.entries()).map(([fileId, cols]) => (
          <div key={fileId}>
            <div className="text-[12px] font-semibold text-[#6b675e] mb-1.5">{fileNames.get(fileId) ?? fileId}</div>
            <div className="border border-[#e6e2d8] rounded-lg overflow-x-auto">
              <div className="grid text-[12px] min-w-[640px]" style={{ gridTemplateColumns: '1.1fr 1.3fr 1.2fr 70px 110px' }}>
                {[fr ? 'Colonne' : 'Column', fr ? 'Aperçu (masqué)' : 'Preview (masked)', fr ? 'Champ Lume' : 'Lume field', fr ? 'Conf.' : 'Conf.', fr ? 'Statut' : 'Status'].map((h) => (
                  <div key={h} className="px-3 py-2 bg-[#fbfaf7] border-b border-[#e6e2d8] font-semibold text-[#6b675e]">{h}</div>
                ))}
                {cols.map((c) => {
                  const m = mappingByColumn.get(c.id);
                  return <MappingRow key={c.id} fr={fr} col={c} mapping={m} canEdit={can_edit} catalog={field_catalog} onCorrect={async (entity, field) => {
                    if (!m) return;
                    try {
                      await correctPortalMapping(token, m.id, { target_entity: entity, target_field: field });
                      toast.success(fr ? 'Correspondance mise à jour' : 'Mapping updated');
                      qc.invalidateQueries({ queryKey: ['migration-portal-mappings', token] });
                    } catch (err: any) {
                      toast.error(err?.message ?? 'Erreur');
                    }
                  }}
                  />;
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

const MAPPING_STATUS_LABELS: Record<string, { fr: string; en: string }> = {
  suggested: { fr: 'Proposé', en: 'Suggested' },
  confirmed: { fr: 'Confirmé', en: 'Confirmed' },
  corrected: { fr: 'Corrigé', en: 'Corrected' },
  rejected: { fr: 'Ignoré', en: 'Ignored' },
  needs_review: { fr: 'À vérifier', en: 'Needs review' },
};

function MappingRow({ fr, col, mapping, canEdit, catalog, onCorrect }: {
  fr: boolean;
  col: { id: string; header: string; detected_type: string; samples_masked: string[] };
  mapping?: { id: string; target_entity: string | null; target_field: string | null; confidence: number; status: string };
  canEdit: boolean;
  catalog: Record<string, { field: string; labelFr: string; labelEn: string }[]>;
  onCorrect: (entity: string | null, field: string | null) => void;
}) {
  const cell = 'px-3 py-2 border-b border-[#f0ece2] text-[#444] flex items-center min-w-0';
  const statusLabel = mapping ? (MAPPING_STATUS_LABELS[mapping.status] ?? MAPPING_STATUS_LABELS.suggested) : null;
  return (
    <>
      <div className={cell}>
        <div className="min-w-0">
          <div className="truncate font-medium">{col.header}</div>
          <div className="text-[10px] text-[#a09a8c]">{col.detected_type}</div>
        </div>
      </div>
      <div className={`${cell} text-[#8a8578]`}>
        <span className="truncate">{col.samples_masked.slice(0, 3).join(' · ') || '—'}</span>
      </div>
      <div className={cell}>
        {canEdit && mapping ? (
          <select
            className="w-full h-8 px-2 text-[12px] bg-white border border-[#e6e2d8] rounded-md"
            value={mapping.target_entity && mapping.target_field ? `${mapping.target_entity}:${mapping.target_field}` : ''}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) onCorrect(null, null);
              else {
                const [entity, field] = v.split(':');
                onCorrect(entity, field);
              }
            }}
          >
            <option value="">{fr ? '— Ne pas importer —' : '— Do not import —'}</option>
            {Object.entries(catalog).map(([entity, fields]) => (
              <optgroup key={entity} label={ENTITY_LABELS_FR[entity] ?? entity}>
                {fields.map((f) => (
                  <option key={`${entity}:${f.field}`} value={`${entity}:${f.field}`}>{fr ? f.labelFr : f.labelEn}</option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : (
          <span className="truncate">
            {mapping?.target_field
              ? `${ENTITY_LABELS_FR[mapping.target_entity ?? ''] ?? mapping.target_entity} · ${mapping.target_field}`
              : (fr ? 'Non associé' : 'Unmapped')}
          </span>
        )}
      </div>
      <div className={cell}>{mapping ? <ConfidenceBadge value={mapping.confidence} /> : '—'}</div>
      <div className={`${cell} text-[#6b675e]`}>{statusLabel ? (fr ? statusLabel.fr : statusLabel.en) : '—'}</div>
    </>
  );
}

function QuestionsSection({ fr, token }: { fr: boolean; token: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['migration-portal-issues', token],
    queryFn: () => listPortalIssues(token),
    refetchOnWindowFocus: false,
  });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const issues = (q.data ?? []).filter((i) => !i.resolved_at);
  if (issues.length === 0) return null;
  return (
    <SectionCard title={fr ? 'Questions de l\'équipe Lume' : 'Questions from the Lume team'} icon={<MessageSquare size={16} className="text-[#8a8578]" />}>
      <div className="space-y-4">
        {issues.map((issue) => (
          <div key={issue.id} className="rounded-lg border border-[#e6e2d8] bg-[#fbfaf7] p-4">
            <div className="text-[13px] font-semibold mb-1">{issue.title}</div>
            {issue.client_answer ? (
              <div className="text-[13px] text-[#444]">
                <span className="text-[#8a8578]">{fr ? 'Votre réponse : ' : 'Your answer: '}</span>
                {issue.client_answer}
              </div>
            ) : (
              <div className="flex gap-2 mt-2">
                <input
                  value={answers[issue.id] ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [issue.id]: e.target.value }))}
                  placeholder={fr ? 'Votre réponse…' : 'Your answer…'}
                  className="flex-1 h-9 px-3 text-[13px] bg-white border border-[#e6e2d8] rounded-md"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const answer = (answers[issue.id] ?? '').trim();
                    if (!answer) return;
                    try {
                      await answerPortalIssue(token, issue.id, answer);
                      toast.success(fr ? 'Réponse envoyée' : 'Answer sent');
                      qc.invalidateQueries({ queryKey: ['migration-portal-issues', token] });
                    } catch (err: any) {
                      toast.error(err?.message ?? 'Erreur');
                    }
                  }}
                  className="h-9 px-4 bg-[#d8d0c2] text-black hover:bg-[#cabfad] rounded-md text-[13px] font-medium"
                >
                  {fr ? 'Envoyer' : 'Send'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function PreviewSection({ fr, token, session, onDecided }: { fr: boolean; token: string; session: PortalSession; onDecided: () => void }) {
  const show = ['test_review', 'waiting_for_approval', 'approved', 'ready_for_final_import', 'importing', 'post_import_validation'].includes(session.status);
  const q = useQuery({
    queryKey: ['migration-portal-preview', token],
    queryFn: () => getPortalPreview(token),
    enabled: show,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [decision, setDecision] = useState<'approved' | 'refused' | 'changes_requested'>('approved');
  const [confirmText, setConfirmText] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  if (!show || !q.data) return null;
  const report = q.data.report ?? {};
  const sentence = fr ? q.data.approval_sentences.fr : q.data.approval_sentences.en;
  const byEntity = report.byEntity ?? {};

  return (
    <SectionCard title={fr ? 'Aperçu de l\'importation test' : 'Test import preview'} icon={<CheckCircle2 size={16} className="text-[#8a8578]" />}>
      <div className="border border-[#e6e2d8] rounded-lg overflow-hidden mb-4">
        <div className="grid text-[12px]" style={{ gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr' }}>
          {[fr ? 'Type' : 'Type', fr ? 'Créés' : 'Created', fr ? 'Fusionnés' : 'Merged', fr ? 'Exclus' : 'Excluded', fr ? 'Erreurs' : 'Errors'].map((h) => (
            <div key={h} className="px-3 py-2 bg-[#fbfaf7] border-b border-[#e6e2d8] font-semibold text-[#6b675e]">{h}</div>
          ))}
          {Object.entries(byEntity).map(([entity, counts]: [string, any]) => (
            <PreviewRow key={entity} label={ENTITY_LABELS_FR[entity] ?? entity} counts={counts} />
          ))}
        </div>
      </div>
      <div className="text-[12px] text-[#6b675e] space-y-1 mb-4">
        {typeof report.totals?.revenueCents === 'number' && (
          <p>{fr ? 'Revenus historiques détectés : ' : 'Historical revenue detected: '}<strong>${(report.totals.revenueCents / 100).toLocaleString('en-CA')}</strong></p>
        )}
        {(report.notes ?? []).map((n: string, i: number) => <p key={i}>· {n}</p>)}
      </div>

      {session.status === 'waiting_for_approval' && (
        <div className="rounded-lg border border-[#e6e2d8] bg-[#fbfaf7] p-4 space-y-3">
          <div className="text-[13px] font-semibold">{fr ? 'Votre décision' : 'Your decision'}</div>
          <div className="flex flex-wrap gap-3 text-[13px]">
            {([['approved', fr ? 'Approuver l\'import final' : 'Approve final import'], ['changes_requested', fr ? 'Demander une correction' : 'Request changes'], ['refused', fr ? 'Refuser' : 'Refuse']] as const).map(([value, label]) => (
              <label key={value} className="inline-flex items-center gap-1.5">
                <input type="radio" name="decision" checked={decision === value} onChange={() => setDecision(value)} />
                {label}
              </label>
            ))}
          </div>
          {decision !== 'approved' && (
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={fr ? 'Expliquez ce qui doit être corrigé…' : 'Explain what needs fixing…'}
              className="w-full h-20 px-3 py-2 text-[13px] bg-white border border-[#e6e2d8] rounded-md"
            />
          )}
          {decision === 'approved' && (
            <div className="space-y-1.5">
              <p className="text-[12px] text-[#6b675e]">
                {fr ? 'Pour confirmer, recopiez exactement la phrase suivante :' : 'To confirm, type the following sentence exactly:'}
              </p>
              <p className="text-[12px] italic text-[#444] bg-white border border-[#e6e2d8] rounded-md px-3 py-2 select-all">{sentence}</p>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={fr ? 'Recopiez la phrase ici' : 'Type the sentence here'}
                className="w-full h-9 px-3 text-[13px] bg-white border border-[#e6e2d8] rounded-md"
              />
            </div>
          )}
          <button
            type="button"
            disabled={submitting || (decision === 'approved' && confirmText.trim() !== sentence)}
            onClick={async () => {
              setSubmitting(true);
              try {
                await submitPortalApproval(token, {
                  decision,
                  confirmed_text: decision === 'approved' ? confirmText.trim() : undefined,
                  comment: comment.trim() || undefined,
                });
                toast.success(fr ? 'Décision enregistrée' : 'Decision recorded');
                onDecided();
              } catch (err: any) {
                toast.error(err?.message ?? 'Erreur');
              } finally {
                setSubmitting(false);
              }
            }}
            className="h-10 px-5 bg-[#d8d0c2] text-black hover:bg-[#cabfad] rounded-md text-[14px] font-medium disabled:opacity-50"
          >
            {submitting ? '…' : fr ? 'Soumettre ma décision' : 'Submit my decision'}
          </button>
        </div>
      )}
      {session.latest_approval && session.status !== 'waiting_for_approval' && (
        <div className="text-[13px] text-[#6b675e]">
          {fr ? 'Décision enregistrée : ' : 'Recorded decision: '}
          <strong>{session.latest_approval.decision}</strong> (v{session.latest_approval.report_version})
        </div>
      )}
    </SectionCard>
  );
}

function PreviewRow({ label, counts }: { label: string; counts: { wouldCreate?: number; wouldMerge?: number; ignored?: number; errors?: number } }) {
  const cell = 'px-3 py-2 border-b border-[#f0ece2] text-[#444]';
  return (
    <>
      <div className={`${cell} font-medium`}>{label}</div>
      <div className={cell}>{counts.wouldCreate ?? 0}</div>
      <div className={cell}>{counts.wouldMerge ?? 0}</div>
      <div className={cell}>{counts.ignored ?? 0}</div>
      <div className={cell}>{counts.errors ?? 0}</div>
    </>
  );
}

function ReportSection({ fr, token }: { fr: boolean; token: string }) {
  const q = useQuery({
    queryKey: ['migration-portal-report', token],
    queryFn: () => getPortalReport(token),
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (!q.data) return null;
  const report = q.data;
  return (
    <SectionCard title={fr ? 'Rapport final' : 'Final report'} icon={<FileText size={16} className="text-[#8a8578]" />}>
      <div className="text-[13px] text-[#444] space-y-1 mb-3">
        <p>
          {fr ? 'Statut : ' : 'Status: '}
          <strong>{report.status}</strong>
          {report.completed_at && ` · ${new Date(report.completed_at).toLocaleString(fr ? 'fr-CA' : 'en-CA')}`}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'rapport-migration-lume.json';
          a.click();
          URL.revokeObjectURL(url);
        }}
        className="h-9 px-4 bg-white border border-[#e6e2d8] text-[#444] hover:bg-[#f4f1ea] rounded-md text-[13px] font-medium"
      >
        {fr ? 'Télécharger le rapport' : 'Download report'}
      </button>
    </SectionCard>
  );
}

function MessagesSection({ fr, token }: { fr: boolean; token: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['migration-portal-messages', token],
    queryFn: () => listPortalMessages(token),
    refetchOnWindowFocus: false,
  });
  const [draft, setDraft] = useState('');
  const messages = q.data ?? [];
  return (
    <SectionCard title={fr ? 'Messages avec l\'équipe Lume' : 'Messages with the Lume team'} icon={<MessageSquare size={16} className="text-[#8a8578]" />} defaultOpen={messages.length > 0}>
      <div className="space-y-2 mb-3 max-h-[280px] overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-[13px] text-[#8a8578]">{fr ? 'Aucun message pour le moment.' : 'No messages yet.'}</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-[13px] ${m.author_kind === 'client' ? 'ml-auto bg-[#eeeae0]' : 'bg-white border border-[#e6e2d8]'}`}>
            <div className="text-[10px] text-[#a09a8c] mb-0.5">
              {m.author_kind === 'client' ? (fr ? 'Vous' : 'You') : 'Lume'} · {new Date(m.created_at).toLocaleString(fr ? 'fr-CA' : 'en-CA')}
            </div>
            {m.body}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={fr ? 'Écrire un message…' : 'Write a message…'}
          className="flex-1 h-9 px-3 text-[13px] bg-white border border-[#e6e2d8] rounded-md"
          onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget.nextElementSibling as HTMLButtonElement)?.click(); }}
        />
        <button
          type="button"
          onClick={async () => {
            const body = draft.trim();
            if (!body) return;
            try {
              await sendPortalMessage(token, body);
              setDraft('');
              qc.invalidateQueries({ queryKey: ['migration-portal-messages', token] });
            } catch (err: any) {
              toast.error(err?.message ?? 'Erreur');
            }
          }}
          className="h-9 w-9 flex items-center justify-center bg-[#d8d0c2] text-black hover:bg-[#cabfad] rounded-md"
        >
          <Send size={14} />
        </button>
      </div>
    </SectionCard>
  );
}
