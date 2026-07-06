import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Inbox, Mail, Phone, MapPin, Building2, ExternalLink, RefreshCw, Clock, Copy, Check, ImageIcon, Archive, ChevronRight } from 'lucide-react';
import { useTranslation } from '../i18n';
import { fetchFormSubmissions, fetchRequestForm } from '../lib/requestFormsApi';
import type { FormSubmission, RequestForm } from '../types';

/** Reserved custom_responses key where the public form stores uploaded photo URLs. */
const PHOTOS_KEY = '__photos';

const photosOf = (s: FormSubmission): string[] => {
  const v = s.custom_responses?.[PHOTOS_KEY];
  return Array.isArray(v) ? v.filter((u) => typeof u === 'string') : [];
};

/** Visible custom answers, excluding reserved (`__`) keys and empties. */
const customEntriesOf = (s: FormSubmission): Array<[string, unknown]> =>
  Object.entries(s.custom_responses || {}).filter(
    ([k, v]) => !k.startsWith('__') && v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0),
  );

const fullAddress = (s: FormSubmission) =>
  [s.street_address, s.unit, s.city, s.region, s.postal_code, s.country].filter(Boolean).join(', ');

const fmtValue = (v: unknown): string =>
  Array.isArray(v) ? v.join(', ') : v === true ? '✓' : v === false ? '' : String(v ?? '');

export default function Requests() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();

  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [form, setForm] = useState<RequestForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Form config is best-effort — never block the submissions list on it
      const [data, formCfg] = await Promise.all([
        fetchFormSubmissions(),
        fetchRequestForm().catch(() => null),
      ]);
      setSubmissions(data);
      setForm(formCfg);
    } catch (err: any) {
      setError(err.message || (fr ? 'Impossible de charger les demandes.' : 'Unable to load requests.'));
    } finally {
      setLoading(false);
    }
  }, [fr]);

  const formUrl = form?.api_key ? `${window.location.origin}/form/${form.api_key}` : null;
  const copyUrl = () => {
    if (!formUrl) return;
    navigator.clipboard.writeText(formUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => { load(); }, [load]);

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString(fr ? 'fr-CA' : 'en-CA', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

  /** Map a custom_responses key to its human label using the form config. */
  const labelFor = (key: string) => form?.custom_fields.find((f) => f.id === key)?.label || key;

  const archivedCount = useMemo(() => submissions.filter((s) => s.archived_at).length, [submissions]);
  const visible = useMemo(
    () => (showArchived ? submissions : submissions.filter((s) => !s.archived_at)),
    [submissions, showArchived],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-bold text-text-primary leading-tight">{fr ? 'Demandes' : 'Requests'}{!loading && <span className="ml-2 text-[15px] font-normal text-text-tertiary tabular-nums">{visible.length}</span>}</h1>
        </div>
        <div className="flex items-center gap-2">
          {archivedCount > 0 && (
            <button
              onClick={() => setShowArchived((p) => !p)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${showArchived ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border-subtle text-text-secondary hover:bg-surface-elevated'}`}
            >
              <Archive className="h-3.5 w-3.5" /> {fr ? 'Archivées' : 'Archived'} ({archivedCount})
            </button>
          )}
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-elevated"
          >
            <RefreshCw className="h-3.5 w-3.5" /> {fr ? 'Actualiser' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* States */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Inbox className="h-10 w-10 text-text-muted/30" />
          <p className="mt-3 text-sm font-medium text-text-secondary">{error}</p>
        </div>
      ) : submissions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Inbox className="h-10 w-10 text-text-muted/30" />
          <p className="mt-3 text-sm font-medium text-text-secondary">{fr ? 'Aucune demande' : 'No requests yet'}</p>
          {formUrl ? (
            <>
              <p className="mt-1 max-w-sm text-xs text-text-muted">
                {fr
                  ? 'Les demandes apparaîtront ici dès qu’un prospect remplira votre formulaire. Partagez ce lien ou intégrez-le à votre site :'
                  : 'Requests will appear here as soon as a prospect fills out your form. Share this link or embed it on your site:'}
              </p>
              <div className="mt-3 flex w-full max-w-md items-center gap-2">
                <code className="flex-1 truncate rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-left text-[11px] font-mono text-text-secondary">
                  {formUrl}
                </code>
                <button
                  onClick={copyUrl}
                  className="flex items-center gap-1 rounded-lg border border-border-subtle px-2.5 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-elevated"
                  title={fr ? 'Copier' : 'Copy'}
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                <a
                  href={formUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-lg border border-border-subtle px-2.5 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-elevated"
                  title={fr ? 'Ouvrir' : 'Open'}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
              {form && !form.enabled && (
                <p className="mt-3 text-xs font-medium text-amber-600">
                  {fr ? '⚠️ Ce formulaire est actuellement désactivé.' : '⚠️ This form is currently disabled.'}
                </p>
              )}
              <Link to="/settings/request-form" className="mt-4 text-xs font-semibold text-primary hover:underline">
                {fr ? 'Modifier le formulaire' : 'Edit form'}
              </Link>
            </>
          ) : (
            <>
              <p className="mt-1 max-w-sm text-xs text-text-muted">
                {fr
                  ? 'Les demandes apparaîtront ici dès qu’un prospect remplira votre formulaire. Configurez-le dans Réglages → Formulaire de demande.'
                  : 'Requests will appear here as soon as a prospect fills out your form. Configure it in Settings → Request Form.'}
              </p>
              <Link to="/settings/request-form" className="mt-4 text-xs font-semibold text-primary hover:underline">
                {fr ? 'Configurer le formulaire' : 'Configure form'}
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((s) => {
            const addr = fullAddress(s);
            const customEntries = customEntriesOf(s);
            const photos = photosOf(s);
            return (
              <div
                key={s.id}
                onClick={() => navigate(`/requests/${s.id}`)}
                className="group cursor-pointer overflow-hidden rounded-xl border border-border-subtle bg-surface transition-colors hover:border-primary/40 hover:bg-surface-elevated"
              >
                {/* Headbar — name · photo count · date */}
                <div className="flex items-center justify-between gap-3 bg-[#d8d0c2] px-4 py-2.5">
                  <p className="min-w-0 truncate text-sm font-semibold text-[#000]">
                    {s.first_name} {s.last_name}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    {s.archived_at && (
                      <span className="flex items-center gap-1 rounded-full bg-black/10 px-2 py-0.5 text-[11px] font-medium text-[#000]">
                        <Archive className="h-3 w-3" /> {fr ? 'Archivée' : 'Archived'}
                      </span>
                    )}
                    {photos.length > 0 && (
                      <span className="flex items-center gap-1 rounded-full bg-black/10 px-2 py-0.5 text-[11px] font-medium text-[#000]">
                        <ImageIcon className="h-3 w-3" /> {photos.length}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-[11px] text-black/70">
                      <Clock className="h-3 w-3" /> {fmtDate(s.created_at)}
                    </span>
                    <ChevronRight className="h-4 w-4 text-black/50 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>

                <div className="space-y-3 p-4">
                  {s.company && (
                    <p className="flex items-center gap-1 text-xs text-text-tertiary">
                      <Building2 className="h-3 w-3" /> {s.company}
                    </p>
                  )}

                  {/* Contact */}
                  <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-text-secondary">
                    {s.email && (
                      <a href={`mailto:${s.email}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 hover:text-text-primary">
                        <Mail className="h-3.5 w-3.5 text-text-muted" /> {s.email}
                      </a>
                    )}
                    {s.phone && (
                      <>
                        <a href={`tel:${s.phone}`} onClick={(e) => e.stopPropagation()} className="md:hidden flex items-center gap-1.5 hover:text-text-primary">
                          <Phone className="h-3.5 w-3.5 text-text-muted" /> {s.phone}
                        </a>
                        <span className="hidden md:flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5 text-text-muted" /> {s.phone}
                        </span>
                      </>
                    )}
                    {addr && (
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-text-muted" /> {addr}
                      </span>
                    )}
                  </div>

                  {/* Photo thumbnails preview */}
                  {photos.length > 0 && (
                    <div className="flex gap-2">
                      {photos.slice(0, 4).map((url) => (
                        <div key={url} className="h-14 w-14 overflow-hidden rounded-lg border border-border-subtle">
                          <img src={url} alt="" className="h-full w-full object-cover" />
                        </div>
                      ))}
                      {photos.length > 4 && (
                        <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-border-subtle bg-surface text-xs font-medium text-text-tertiary">
                          +{photos.length - 4}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Custom responses (labeled) */}
                  {customEntries.length > 0 && (
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {customEntries.map(([k, v]) => (
                        <div key={k} className="rounded-lg bg-surface px-2.5 py-1.5">
                          <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted">{labelFor(k)}</p>
                          <p className="text-xs text-text-primary">{fmtValue(v)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
