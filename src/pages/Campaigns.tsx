/* ═══════════════════════════════════════════════════════════════
   Page — Email Marketing Campaigns

   Bulk email sends to client segments (newsletters, promotions,
   reminders). V1: native send via SMTP, batches of 50 + 1s sleep,
   max 500 recipients per send. Mailchimp = CSV export.
   ═══════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Send, Mail, Users, Clock, CheckCircle, XCircle, Loader2,
  Plus, Eye, Trash2, Download, AlertTriangle, Calendar,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import {
  listCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  previewRecipients,
  sendCampaign,
  scheduleCampaign,
  downloadMailchimpCsv,
  type EmailCampaign,
  type CampaignSegment,
  type PreviewResult,
} from '../lib/campaignsApi';

const SEGMENT_LABELS: Record<CampaignSegment, { en: string; fr: string }> = {
  all_clients: { en: 'All clients', fr: 'Tous les clients' },
  recent_clients: { en: 'Recent clients (90 days)', fr: 'Clients récents (90 jours)' },
  overdue_clients: { en: 'Overdue clients', fr: 'Clients en retard' },
  custom_query: { en: 'Custom selection', fr: 'Sélection personnalisée' },
};

function statusBadge(status: EmailCampaign['status']) {
  const map: Record<EmailCampaign['status'], string> = {
    draft: 'bg-gray-100 text-gray-700',
    scheduled: 'bg-blue-100 text-blue-700',
    sending: 'bg-amber-100 text-amber-700',
    sent: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-rose-100 text-rose-700',
  };
  return map[status] || 'bg-gray-100 text-gray-700';
}

export default function Campaigns() {
  const { t, language } = useTranslation();
  const lang = (language === 'fr' ? 'fr' : 'en') as 'en' | 'fr';
  const tc = (t as any).campaigns || {};

  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<EmailCampaign | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCampaigns(await listCampaigns());
    } catch (e: any) {
      toast.error(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing(null); setShowModal(true); };
  const openEdit = (c: EmailCampaign) => { setEditing(c); setShowModal(true); };

  const handleDelete = async (c: EmailCampaign) => {
    if (!window.confirm(lang === 'fr' ? 'Supprimer cette campagne ?' : 'Delete this campaign?')) return;
    try {
      await deleteCampaign(c.id);
      toast.success(lang === 'fr' ? 'Supprimée' : 'Deleted');
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleExport = async () => {
    try {
      await downloadMailchimpCsv();
      toast.success(lang === 'fr' ? 'Export téléchargé' : 'Export downloaded');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="px-8 py-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Mail className="w-6 h-6 text-blue-600" />
            {tc.title || (lang === 'fr' ? 'Campagnes courriel' : 'Email Campaigns')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {tc.subtitle || (lang === 'fr'
              ? 'Envoyez des courriels en masse à vos clients'
              : 'Send bulk emails to your clients')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Download className="w-4 h-4" />
            {tc.exportMailchimp || (lang === 'fr' ? 'Exporter Mailchimp' : 'Export to Mailchimp')}
          </button>
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            {tc.newCampaign || (lang === 'fr' ? 'Nouvelle campagne' : 'New campaign')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-lg">
          <Mail className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 mb-4">
            {tc.empty || (lang === 'fr' ? 'Aucune campagne pour le moment' : 'No campaigns yet')}
          </p>
          <button onClick={openNew} className="text-blue-600 hover:underline text-sm font-medium">
            {tc.createFirst || (lang === 'fr' ? 'Créer la première' : 'Create your first one')}
          </button>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
            <div className="col-span-4">{tc.name || 'Name'}</div>
            <div className="col-span-2">{tc.status || 'Status'}</div>
            <div className="col-span-2">{tc.recipients || 'Recipients'}</div>
            <div className="col-span-2">{tc.sent || 'Sent'}</div>
            <div className="col-span-2 text-right">{tc.actions || 'Actions'}</div>
          </div>
          {campaigns.map((c) => (
            <div key={c.id} className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-gray-100 items-center hover:bg-gray-50">
              <div className="col-span-4">
                <button onClick={() => openEdit(c)} className="text-left hover:underline">
                  <div className="font-medium text-gray-900">{c.name}</div>
                  <div className="text-xs text-gray-500 truncate">{c.subject}</div>
                </button>
              </div>
              <div className="col-span-2">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusBadge(c.status)}`}>
                  {c.status}
                </span>
              </div>
              <div className="col-span-2 text-sm text-gray-700">{c.total_recipients || 0}</div>
              <div className="col-span-2 text-sm text-gray-700">
                {c.total_sent || 0}
                {c.total_failed > 0 && <span className="text-rose-600 ml-1">/ {c.total_failed} failed</span>}
                {c.sent_at && (
                  <div className="text-xs text-gray-400">{new Date(c.sent_at).toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-CA')}</div>
                )}
              </div>
              <div className="col-span-2 flex items-center justify-end gap-2">
                {c.status === 'draft' && (
                  <button onClick={() => handleDelete(c)} className="p-1 text-gray-400 hover:text-rose-600" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <CampaignModal
          campaign={editing}
          lang={lang}
          tc={tc}
          onClose={() => { setShowModal(false); load(); }}
        />
      )}
    </div>
  );
}

// ── Campaign editor modal ─────────────────────────────────

function CampaignModal({
  campaign, lang, tc, onClose,
}: {
  campaign: EmailCampaign | null;
  lang: 'en' | 'fr';
  tc: any;
  onClose: () => void;
}) {
  const isEdit = !!campaign;
  const canEdit = !campaign || campaign.status === 'draft' || campaign.status === 'scheduled';

  const [name, setName] = useState(campaign?.name || '');
  const [subject, setSubject] = useState(campaign?.subject || '');
  const [bodyHtml, setBodyHtml] = useState(campaign?.body_html || '');
  const [bodyText, setBodyText] = useState(campaign?.body_text || '');
  const [segment, setSegment] = useState<CampaignSegment>(campaign?.segment || 'all_clients');
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [scheduleAt, setScheduleAt] = useState('');

  const saveDraft = async (): Promise<EmailCampaign | null> => {
    if (!name.trim() || !subject.trim() || !bodyHtml.trim()) {
      toast.error(lang === 'fr' ? 'Nom, objet et corps sont requis' : 'Name, subject and body are required');
      return null;
    }
    setSaving(true);
    try {
      const input = {
        name: name.trim(),
        subject: subject.trim(),
        body_html: bodyHtml,
        body_text: bodyText || null,
        segment,
      };
      const result = campaign
        ? await updateCampaign(campaign.id, input)
        : await createCampaign(input);
      toast.success(lang === 'fr' ? 'Brouillon enregistré' : 'Draft saved');
      return result;
    } catch (e: any) {
      toast.error(e.message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    const saved = await saveDraft();
    if (!saved) return;
    try {
      const result = await previewRecipients(saved.id);
      setPreview(result);
      setShowPreview(true);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleSendNow = async () => {
    const saved = await saveDraft();
    if (!saved) return;
    if (!window.confirm(lang === 'fr'
      ? `Envoyer la campagne maintenant à tous les destinataires (sauf désabonnés) ?`
      : `Send campaign now to all recipients (excluding opt-outs)?`
    )) return;

    setSending(true);
    try {
      const result = await sendCampaign(saved.id);
      toast.success(lang === 'fr'
        ? `Envoyé : ${result.sent}/${result.recipients} (${result.failed} échecs)`
        : `Sent: ${result.sent}/${result.recipients} (${result.failed} failed)`
      );
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSending(false);
    }
  };

  const handleSchedule = async () => {
    if (!scheduleAt) {
      toast.error(lang === 'fr' ? 'Choisissez une date' : 'Pick a date');
      return;
    }
    const saved = await saveDraft();
    if (!saved) return;
    try {
      await scheduleCampaign(saved.id, new Date(scheduleAt).toISOString());
      toast.success(lang === 'fr' ? 'Planifiée' : 'Scheduled');
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold">
            {isEdit
              ? (lang === 'fr' ? 'Modifier la campagne' : 'Edit campaign')
              : (lang === 'fr' ? 'Nouvelle campagne' : 'New campaign')}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {lang === 'fr' ? 'Nom de la campagne' : 'Campaign name'}
            </label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              placeholder={lang === 'fr' ? 'Promo de printemps' : 'Spring promo'}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {lang === 'fr' ? 'Objet' : 'Subject'}
            </label>
            <input
              type="text" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!canEdit}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              placeholder={lang === 'fr' ? 'Offre spéciale, {{first_name}} !' : 'Special offer, {{first_name}}!'}
            />
            <p className="text-xs text-gray-500 mt-1">
              {lang === 'fr'
                ? 'Variables : {{first_name}}, {{last_name}}'
                : 'Variables: {{first_name}}, {{last_name}}'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {lang === 'fr' ? 'Corps (HTML)' : 'Body (HTML)'}
            </label>
            <textarea
              value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} disabled={!canEdit}
              rows={10}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
              placeholder="<p>Hello {{first_name}}, ...</p>"
            />
            <p className="text-xs text-gray-500 mt-1">
              {lang === 'fr'
                ? 'Un lien de désabonnement est automatiquement ajouté (CASL/CAN-SPAM).'
                : 'An unsubscribe link is automatically appended (CASL/CAN-SPAM compliance).'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {lang === 'fr' ? 'Texte brut (optionnel)' : 'Plain text fallback (optional)'}
            </label>
            <textarea
              value={bodyText || ''} onChange={(e) => setBodyText(e.target.value)} disabled={!canEdit}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {lang === 'fr' ? 'Segment' : 'Segment'}
            </label>
            <select
              value={segment} onChange={(e) => setSegment(e.target.value as CampaignSegment)} disabled={!canEdit}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              {(Object.keys(SEGMENT_LABELS) as CampaignSegment[]).map((s) => (
                <option key={s} value={s}>{SEGMENT_LABELS[s][lang]}</option>
              ))}
            </select>
          </div>

          {showPreview && preview && (
            <div className="border border-gray-200 rounded-md p-3 bg-gray-50">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-gray-600" />
                <span className="text-sm font-medium">
                  {preview.total} {lang === 'fr' ? 'destinataires' : 'recipients'}
                </span>
                {preview.over_limit && (
                  <span className="text-xs text-rose-600 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {lang === 'fr'
                      ? `Limite V1 : ${preview.max_per_send}. Utilisez l'export Mailchimp.`
                      : `V1 limit: ${preview.max_per_send}. Use Mailchimp export.`}
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-600 space-y-1">
                {preview.sample.map((r, i) => (
                  <div key={i}>• {r.email}{r.name ? ` (${r.name})` : ''}</div>
                ))}
                {preview.total > preview.sample.length && (
                  <div className="text-gray-400">+ {preview.total - preview.sample.length} more...</div>
                )}
              </div>
            </div>
          )}

          {canEdit && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                {lang === 'fr' ? 'Planifier (optionnel)' : 'Schedule (optional)'}
              </label>
              <input
                type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between gap-2 sticky bottom-0 bg-white">
          <div>
            <button
              onClick={handlePreview} disabled={saving || !canEdit}
              className="inline-flex items-center gap-1 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
            >
              <Eye className="w-4 h-4" />
              {lang === 'fr' ? 'Aperçu destinataires' : 'Preview recipients'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md">
              {lang === 'fr' ? 'Fermer' : 'Close'}
            </button>
            {canEdit && (
              <>
                <button
                  onClick={async () => { await saveDraft(); onClose(); }}
                  disabled={saving || sending}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (lang === 'fr' ? 'Enregistrer' : 'Save draft')}
                </button>
                {scheduleAt && (
                  <button
                    onClick={handleSchedule}
                    disabled={saving || sending}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    {lang === 'fr' ? 'Planifier' : 'Schedule'}
                  </button>
                )}
                <button
                  onClick={handleSendNow}
                  disabled={saving || sending}
                  className="inline-flex items-center gap-1 px-4 py-2 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {lang === 'fr' ? 'Envoyer maintenant' : 'Send now'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
