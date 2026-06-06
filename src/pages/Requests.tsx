import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Inbox, Mail, Phone, MapPin, Building2, ExternalLink, RefreshCw, Clock, Copy, Check } from 'lucide-react';
import { useTranslation } from '../i18n';
import { fetchFormSubmissions, fetchRequestForm } from '../lib/requestFormsApi';
import type { FormSubmission, RequestForm } from '../types';

export default function Requests() {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [form, setForm] = useState<RequestForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const fullAddress = (s: FormSubmission) =>
    [s.street_address, s.unit, s.city, s.region, s.postal_code, s.country].filter(Boolean).join(', ');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{fr ? 'Demandes' : 'Requests'}</h2>
          <p className="mt-1 text-sm text-text-tertiary">
            {fr ? 'Soumissions reçues via votre formulaire de demande' : 'Submissions received through your request form'}
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-elevated"
        >
          <RefreshCw className="h-3.5 w-3.5" /> {fr ? 'Actualiser' : 'Refresh'}
        </button>
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
          {submissions.map((s) => {
            const addr = fullAddress(s);
            const customEntries = Object.entries(s.custom_responses || {}).filter(
              ([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0),
            );
            return (
              <div key={s.id} className="rounded-xl border border-border-subtle bg-surface p-4">
                {/* Top row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary">
                      {s.first_name} {s.last_name}
                    </p>
                    {s.company && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-text-tertiary">
                        <Building2 className="h-3 w-3" /> {s.company}
                      </p>
                    )}
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-text-muted">
                    <Clock className="h-3 w-3" /> {fmtDate(s.created_at)}
                  </span>
                </div>

                {/* Contact */}
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-text-secondary">
                  {s.email && (
                    <a href={`mailto:${s.email}`} className="flex items-center gap-1.5 hover:text-text-primary">
                      <Mail className="h-3.5 w-3.5 text-text-muted" /> {s.email}
                    </a>
                  )}
                  {s.phone && (
                    <a href={`tel:${s.phone}`} className="flex items-center gap-1.5 hover:text-text-primary">
                      <Phone className="h-3.5 w-3.5 text-text-muted" /> {s.phone}
                    </a>
                  )}
                  {addr && (
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-text-muted" /> {addr}
                    </span>
                  )}
                </div>

                {/* Custom responses */}
                {customEntries.length > 0 && (
                  <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {customEntries.map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-surface-elevated px-2.5 py-1.5">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted">{k}</p>
                        <p className="text-xs text-text-primary">{Array.isArray(v) ? v.join(', ') : String(v)}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Notes */}
                {s.notes && (
                  <p className="mt-3 whitespace-pre-wrap rounded-lg bg-surface-elevated px-3 py-2 text-xs text-text-secondary">
                    {s.notes}
                  </p>
                )}

                {/* Linked client */}
                {s.client_id && (
                  <Link
                    to={`/clients/${s.client_id}`}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                  >
                    {fr ? 'Voir le client' : 'View client'} <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
