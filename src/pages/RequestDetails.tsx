import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Briefcase,
  Building2,
  CalendarClock,
  CheckCircle2,
  CheckSquare,
  Circle,
  Clock,
  ExternalLink,
  FileText,
  Inbox,
  Loader2,
  MoreHorizontal,
  Printer,
  Square,
  Trash2,
} from 'lucide-react';
import EntityHubHeader from '../components/EntityHubHeader';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import { cn } from '../lib/utils';
import { SignedImg, SignedLink } from '../components/ui/SignedMedia';
import { fetchFormSubmission, fetchRequestForm, updateFormSubmission, deleteFormSubmission } from '../lib/requestFormsApi';
import { listSalespeople } from '../lib/jobsApi';
import { useJobModalController } from '../contexts/JobModalController';
import QuoteCreateModal from '../components/quotes/QuoteCreateModal';
import LeaveFormConfirm from '../components/ui/LeaveFormConfirm';
import { useNavigationGuard } from '../contexts/NavigationGuard';
import type { FormSubmission, RequestForm, FormField } from '../types';

/** Reserved custom_responses key where the public form stores uploaded photo URLs. */
const PHOTOS_KEY = '__photos';

const photosOf = (s: FormSubmission): string[] => {
  const v = s.custom_responses?.[PHOTOS_KEY];
  return Array.isArray(v) ? v.filter((u) => typeof u === 'string') : [];
};

const fullAddress = (s: FormSubmission) =>
  [s.street_address, s.unit, s.city, s.region, s.postal_code, s.country].filter(Boolean).join(', ');

const inputCls = 'glass-input w-full mt-1.5';
const labelCls = 'text-xs font-medium text-text-tertiary block';

/** ISO timestamp → {date: 'YYYY-MM-DD', time: 'HH:MM'} in local time. */
function splitIso(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Local date + time strings → ISO timestamp (null when no date picked). */
function joinIso(date: string, time: string): string | null {
  if (!date) return null;
  const d = new Date(`${date}T${time || '09:00'}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export default function RequestDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const { openJobModal } = useJobModalController();

  const [submission, setSubmission] = useState<FormSubmission | null>(null);
  const [form, setForm] = useState<RequestForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const assessmentRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      // Form config is best-effort — never block the submission on it
      const [sub, formCfg] = await Promise.all([
        fetchFormSubmission(id),
        fetchRequestForm().catch(() => null),
      ]);
      setSubmission(sub);
      setForm(formCfg);
    } catch (err: any) {
      // Un identifiant mal formé (vieux lien, faute de frappe) remonte le
      // message brut de la base — « Invalid input format », « invalid input
      // syntax for type uuid ». L'utilisateur n'y comprend rien : c'est un
      // lien invalide, pas une panne.
      const brut = String(err?.message || '');
      const lienInvalide = /invalid input (syntax|format)|uuid|22P02/i.test(brut);
      setError(
        lienInvalide
          ? (fr ? 'Demande introuvable — le lien est peut-être rompu.' : 'Request not found — the link may be broken.')
          : brut || (fr ? 'Impossible de charger la demande.' : 'Unable to load request.'),
      );
    } finally {
      setLoading(false);
    }
  }, [id, fr]);

  useEffect(() => { load(); }, [load]);

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString(fr ? 'fr-CA' : 'en-CA', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

  const scrollToAssessment = () => {
    assessmentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    assessmentRef.current?.querySelector('input')?.focus({ preventScroll: true });
  };

  const handleArchiveToggle = async () => {
    if (!submission) return;
    setIsArchiving(true);
    try {
      const updated = await updateFormSubmission(submission.id, { archived: !submission.archived_at });
      setSubmission(updated);
      toast.success(updated.archived_at
        ? (fr ? 'Demande archivée' : 'Request archived')
        : (fr ? 'Demande désarchivée' : 'Request unarchived'));
    } catch (err: any) {
      toast.error(err.message || (fr ? 'Échec de l’archivage.' : 'Archive failed.'));
    } finally {
      setIsArchiving(false);
      setMoreOpen(false);
    }
  };

  const handleDelete = async () => {
    if (!submission) return;
    const msg = fr ? 'Supprimer cette demande ?' : 'Delete this request?';
    if (!window.confirm(msg)) return;
    setIsDeleting(true);
    try {
      await deleteFormSubmission(submission.id);
      toast.success(fr ? 'Demande supprimée' : 'Request deleted');
      navigate('/requests');
    } catch (err: any) {
      toast.error(err.message || (fr ? 'Échec de la suppression.' : 'Delete failed.'));
      setIsDeleting(false);
    }
  };

  const handleConvertToJob = () => {
    if (!submission) return;
    setMoreOpen(false);
    const name = `${submission.first_name} ${submission.last_name}`.trim();
    openJobModal({
      initialValues: {
        title: name || (fr ? 'Nouveau job' : 'New job'),
        client_id: submission.client_id || null,
        lead_id: submission.lead_id || null,
        property_address: fullAddress(submission) || null,
        description: submission.notes || null,
      },
      sourceContext: { type: 'requests' },
    });
  };

  const handlePrint = () => {
    setMoreOpen(false);
    window.print();
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-5 w-32 bg-surface-secondary rounded animate-pulse" />
        <div className="h-8 w-64 bg-surface-secondary rounded animate-pulse" />
        <div className="h-64 bg-surface-secondary rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error || !submission) {
    return (
      <div className="space-y-5">
        <button onClick={() => navigate('/requests')} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-secondary hover:text-text-primary transition-colors">
          <ArrowLeft size={14} /> {fr ? 'Retour aux demandes' : 'Back to requests'}
        </button>
        <div className="section-card p-12 text-center">
          <p className="text-[15px] text-text-secondary">{error || (fr ? 'Demande introuvable.' : 'Request not found.')}</p>
        </div>
      </div>
    );
  }

  const s = submission;
  const name = `${s.first_name} ${s.last_name}`.trim();
  const photos = photosOf(s);
  const fields = form?.custom_fields || [];

  return (
    <div className="space-y-6 print:space-y-4">
      {/* ═══ BREADCRUMB ═══ */}
      <nav className="flex items-center gap-1.5 text-[12px] print:hidden">
        <button onClick={() => navigate('/requests')} className="text-text-tertiary hover:text-text-primary transition-colors">
          {fr ? 'Demandes' : 'Requests'}
        </button>
        <span className="text-text-tertiary">/</span>
        <span className="text-text-primary font-medium">{name}</span>
      </nav>

      {/* ═══ HUB HEADER ═══ */}
      <EntityHubHeader
        icon={<Inbox size={18} strokeWidth={2} />}
        iconTileClass="text-entity-request"
        status={s.archived_at ? 'archived' : 'new'}
        title={name ? (fr ? `Demande de ${name}` : `Request from ${name}`) : (fr ? 'Demande' : 'Request')}
        client={{ id: s.client_id, name: name || s.company || '' }}
        address={fullAddress(s) || null}
        phone={s.phone}
        email={s.email}
        meta={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {s.company && (
              <span className="flex items-center gap-1.5">
                <Building2 size={12} className="text-text-muted" /> {s.company}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Clock size={12} className="text-text-muted" />
              {fr ? 'Demande reçue le' : 'Request received'} {fmtDate(s.created_at)}
            </span>
          </span>
        }
        actions={
          <>
            <button onClick={scrollToAssessment} className="glass-button-primary inline-flex items-center gap-1.5">
              <CalendarClock size={14} /> {fr ? 'Planifier une évaluation' : 'Schedule assessment'}
            </button>

            {/* More dropdown */}
            <div className="relative">
              <button onClick={() => setMoreOpen((p) => !p)} className="glass-button inline-flex items-center gap-1.5">
                <MoreHorizontal size={14} /> {fr ? 'Plus' : 'More'}
              </button>
              {moreOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-outline bg-surface shadow-lg py-1">
                    <DropdownItem
                      icon={<FileText size={13} className="text-entity-quote" />}
                      label={fr ? 'Convertir en devis' : 'Convert to quote'}
                      onClick={() => { setMoreOpen(false); setQuoteModalOpen(true); }}
                    />
                    <DropdownItem
                      icon={<Briefcase size={13} className="text-entity-job" />}
                      label={fr ? 'Convertir en job' : 'Convert to job'}
                      onClick={handleConvertToJob}
                    />
                    <div className="border-t border-border my-1" />
                    <DropdownItem
                      icon={s.archived_at ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                      label={isArchiving
                        ? (fr ? 'En cours…' : 'Working…')
                        : s.archived_at ? (fr ? 'Désarchiver' : 'Unarchive') : (fr ? 'Archiver' : 'Archive')}
                      onClick={handleArchiveToggle}
                      disabled={isArchiving}
                    />
                    <DropdownItem
                      icon={<Printer size={13} />}
                      label={fr ? 'Imprimer' : 'Print'}
                      onClick={handlePrint}
                    />
                    <div className="border-t border-border my-1" />
                    <DropdownItem
                      icon={<Trash2 size={13} />}
                      label={isDeleting ? (fr ? 'Suppression…' : 'Deleting…') : (fr ? 'Supprimer' : 'Delete')}
                      onClick={handleDelete}
                      disabled={isDeleting}
                      danger
                    />
                  </div>
                </>
              )}
            </div>
          </>
        }
      />

      {/* ═══ FORM ANSWERS ═══ */}
      {fields.length > 0 && (
        <div className="section-card p-6">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-4">
            {fr ? 'Réponses du formulaire' : 'Form answers'}
          </h2>
          <div className="divide-y divide-border-subtle/60 rounded-xl border border-border-subtle">
            {fields.map((f) => (
              <CustomAnswer key={f.id} field={f} value={s.custom_responses?.[f.id]} fr={fr} />
            ))}
          </div>
        </div>
      )}

      {/* ═══ NOTES ═══ */}
      {s.notes && (
        <div className="section-card p-6">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-3">
            {fr ? 'Notes additionnelles' : 'Additional notes'}
          </h2>
          <p className="whitespace-pre-wrap text-sm text-text-primary">{s.notes}</p>
        </div>
      )}

      {/* ═══ PHOTOS ═══ */}
      {photos.length > 0 && (
        <div className="section-card p-6">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-4">
            {fr ? 'Photos' : 'Photos'} ({photos.length})
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {photos.map((url) => (
              <SignedLink
                key={url}
                url={url}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative aspect-square overflow-hidden rounded-lg border border-border-subtle"
              >
                <SignedImg url={url} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:bg-black/30 group-hover:opacity-100">
                  <ExternalLink size={15} className="text-white" />
                </span>
              </SignedLink>
            ))}
          </div>
        </div>
      )}

      {/* ═══ ON-SITE ASSESSMENT ═══ */}
      <div ref={assessmentRef} id="onsite-assessment" className="scroll-mt-6">
        <AssessmentSection submission={s} fr={fr} onSaved={setSubmission} />
      </div>

      {/* Convert to quote */}
      {quoteModalOpen && (
        <QuoteCreateModal
          isOpen={quoteModalOpen}
          onClose={() => setQuoteModalOpen(false)}
          lead={{
            id: '',
            first_name: s.first_name,
            last_name: s.last_name,
            email: s.email,
            phone: s.phone,
            company: s.company,
            client_id: s.client_id,
          } as any}
          onCreated={(detail) => {
            setQuoteModalOpen(false);
            navigate(`/quotes/${detail.quote.id}`);
          }}
        />
      )}
    </div>
  );
}

// ── On-site assessment — schedule a visit for this request ──
function AssessmentSection({
  submission: s,
  fr,
  onSaved,
}: {
  submission: FormSubmission;
  fr: boolean;
  onSaved: (updated: FormSubmission) => void;
}) {
  const start = splitIso(s.assessment_start_at);
  const end = splitIso(s.assessment_end_at);

  const [startDate, setStartDate] = useState(start.date);
  const [startTime, setStartTime] = useState(start.time || '09:00');
  const [endDate, setEndDate] = useState(end.date);
  const [endTime, setEndTime] = useState(end.time || '10:00');
  // Single-day visit by default; the checkbox reveals separate start/end dates.
  const [multiDay, setMultiDay] = useState(!!end.date && end.date !== start.date);
  const [userId, setUserId] = useState(s.assessment_user_id || '');
  const [instructions, setInstructions] = useState(s.assessment_instructions || '');
  const [members, setMembers] = useState<Array<{ id: string; label: string }>>([]);
  const [saving, setSaving] = useState(false);

  // Leave-without-saving guard — dirty is flipped only by genuine user input
  // (see the section root's onInput/onChange).
  const [dirty, setDirty] = useState(false);
  const guard = useNavigationGuard(dirty);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  useEffect(() => {
    listSalespeople().then(setMembers).catch(() => setMembers([]));
  }, []);

  const handleSave = async () => {
    const startIso = joinIso(startDate, startTime);
    // Single-day visit: the end shares the start date, only the time differs.
    const endIso = multiDay ? joinIso(endDate || startDate, endTime) : joinIso(startDate, endTime);
    if (!startIso) {
      toast.error(fr ? 'Choisissez une date de début.' : 'Pick a start date.');
      return;
    }
    if (endIso && startIso > endIso) {
      toast.error(fr ? 'La fin doit être après le début.' : 'End must be after start.');
      return;
    }
    setSaving(true);
    try {
      const updated = await updateFormSubmission(s.id, {
        assessment_start_at: startIso,
        assessment_end_at: endIso,
        assessment_user_id: userId || null,
        assessment_instructions: instructions.trim() || null,
      });
      setDirty(false);
      guard.release();
      onSaved(updated);
      toast.success(fr ? 'Évaluation planifiée' : 'Assessment scheduled');
    } catch (err: any) {
      toast.error(err.message || (fr ? 'Échec de la sauvegarde.' : 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  const scheduled = !!s.assessment_start_at;

  return (
    <div
      className="section-card relative p-6"
      onInput={(e) => { if (e.nativeEvent.isTrusted) setDirty(true); }}
      onChange={(e) => { if (e.nativeEvent.isTrusted) setDirty(true); }}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock size={16} className="text-text-secondary" />
          <h2 className="text-[15px] font-bold text-text-primary">
            {fr ? 'Évaluation sur place' : 'On-site assessment'}
          </h2>
        </div>
        {scheduled && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-1 text-[11px] font-semibold text-green-600">
            <CheckCircle2 size={12} /> {fr ? 'Planifiée' : 'Scheduled'}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {!multiDay ? (
          <>
            <div>
              <label className={labelCls}>{fr ? 'Date' : 'Date'}</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{fr ? 'Horaire' : 'Time'}</label>
              <div className="flex items-center gap-2">
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} />
                <span className="mt-1.5 text-text-muted">–</span>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} />
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={labelCls}>{fr ? 'Début' : 'Start'}</label>
              <div className="flex gap-2">
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={cn(inputCls, 'max-w-[130px]')} />
              </div>
            </div>
            <div>
              <label className={labelCls}>{fr ? 'Fin' : 'End'}</label>
              <div className="flex gap-2">
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={cn(inputCls, 'max-w-[130px]')} />
              </div>
            </div>
          </>
        )}

        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none sm:col-span-2">
          <input
            type="checkbox"
            checked={multiDay}
            onChange={(e) => {
              setMultiDay(e.target.checked);
              if (e.target.checked && !endDate) setEndDate(startDate);
            }}
            className="h-4 w-4 rounded"
          />
          {fr ? 'Visite sur plusieurs jours' : 'Multi-day visit'}
        </label>

        <div>
          <label className={labelCls}>{fr ? 'Membre de l’équipe' : 'Team member'}</label>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className={inputCls}>
            <option value="">{fr ? '— Aucun membre —' : '— No member —'}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Instructions box */}
      <div className="mt-4">
        <label className={labelCls}>{fr ? 'Instructions' : 'Instructions'}</label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={4}
          placeholder={fr
            ? 'Détails pour la personne qui fera la visite (accès, stationnement, particularités…)'
            : 'Details for whoever does the visit (access, parking, specifics…)'}
          className={cn(inputCls, 'resize-y')}
        />
      </div>

      <div className="mt-4 flex justify-end print:hidden">
        <button
          onClick={handleSave}
          disabled={saving}
          className="glass-button-primary inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          {saving && <Loader2 size={13} className="animate-spin" />}
          {scheduled
            ? (fr ? 'Mettre à jour l’évaluation' : 'Update assessment')
            : (fr ? 'Planifier l’évaluation' : 'Schedule assessment')}
        </button>
      </div>

      {/* Leave-without-saving confirmation (unsaved assessment) */}
      <LeaveFormConfirm open={guard.active} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
    </div>
  );
}

function DropdownItem({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-[13px] transition-colors text-left hover:bg-surface-secondary',
        danger ? 'text-red-600' : 'text-text-primary',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Renders one custom field answer; choice fields list every option with selection marks. */
function CustomAnswer({ field, value, fr }: { field: FormField; value: unknown; fr: boolean }) {
  const opts = field.options || [];
  const isChoiceGroup =
    field.type === 'multiselect' || (field.type === 'checkbox' && opts.length > 0) || (field.type === 'dropdown' && opts.length > 0);

  // Choice field with a list of options → show all options, mark the selected ones.
  if (isChoiceGroup) {
    const isMulti = field.type === 'multiselect' || field.type === 'checkbox';
    const selected = Array.isArray(value)
      ? (value as unknown[]).map(String)
      : value !== null && value !== undefined && value !== ''
      ? [String(value)]
      : [];
    return (
      <div className="px-3 py-2.5">
        <p className="text-sm text-text-tertiary">{field.label}</p>
        <div className="mt-1.5 space-y-1.5">
          {opts.map((o) => {
            const on = selected.includes(o);
            const OnIcon = isMulti ? CheckSquare : CheckCircle2;
            const OffIcon = isMulti ? Square : Circle;
            return (
              <div key={o} className="flex items-center gap-2 text-sm">
                {on ? <OnIcon className="h-4 w-4 shrink-0 text-primary" /> : <OffIcon className="h-4 w-4 shrink-0 text-text-muted/40" />}
                <span className={on ? 'font-medium text-text-primary' : 'text-text-tertiary'}>{o}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Single yes/no checkbox (no options) → show as checked/unchecked.
  if (field.type === 'checkbox') {
    const on = value === true;
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 text-sm">
        {on ? <CheckSquare className="h-4 w-4 shrink-0 text-primary" /> : <Square className="h-4 w-4 shrink-0 text-text-muted/40" />}
        <span className={on ? 'font-medium text-text-primary' : 'text-text-tertiary'}>{field.label}</span>
        <span className="ml-auto text-xs text-text-muted">{on ? (fr ? 'Oui' : 'Yes') : (fr ? 'Non' : 'No')}</span>
      </div>
    );
  }

  // Text / number / paragraph → label + value.
  const text = value === null || value === undefined ? '' : String(value);
  return (
    <div className="px-3 py-2.5">
      <p className="text-sm text-text-tertiary">{field.label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-sm font-medium text-text-primary">
        {text || <span className="font-normal text-text-muted">—</span>}
      </p>
    </div>
  );
}
