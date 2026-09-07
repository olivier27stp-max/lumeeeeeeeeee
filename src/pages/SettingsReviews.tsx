/* ═══════════════════════════════════════════════════════════════
   SettingsReviews — Réglages « Avis clients » (/settings/reviews)

   Workflow : job terminée → sondage d'étoiles envoyé tout de suite
     • 4-5 étoiles → redirection Google / Facebook + message d'invitation
     • 1-3 étoiles → formulaire de commentaires interne + tâche de suivi

   Cette page possède les liens de redirection, le message d'invitation et
   l'interrupteur principal (colonnes de company_settings). Les délais et
   textes des automatisations restent dans Réglages → Messagerie SMS.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Star,
  Check,
  Loader2,
  ExternalLink,
  MessageSquareText,
  Send,
  ThumbsUp,
  ThumbsDown,
  Zap,
  Facebook,
  Globe,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { cn } from '../lib/utils';
import { PageHeader } from '../components/ui';
import { useTranslation } from '../i18n';
import { getAutomationRules, toggleAutomationRule, type AutomationRule } from '../lib/automationRulesApi';

// Miroir de server/lib/reviews.ts (texte par défaut affiché au client).
const DEFAULT_INVITE_FR =
  'Merci beaucoup ! Votre avis compte énormément pour une petite entreprise comme la nôtre. '
  + 'Prendriez-vous 30 secondes pour partager votre expérience ? Ça nous aide vraiment.';
const DEFAULT_INVITE_EN =
  'Thank you so much! Your review means the world to a small business like ours. '
  + 'Would you take 30 seconds to share your experience? It truly helps us.';

const REVIEW_PRESET_KEYS = ['google_review', 'review_reminder_7d'];

interface ReviewSettings {
  id?: string;
  review_enabled: boolean;
  google_review_url: string;
  facebook_review_url: string;
  review_invite_message: string;
}

const EMPTY: ReviewSettings = {
  review_enabled: false,
  google_review_url: '',
  facebook_review_url: '',
  review_invite_message: '',
};

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isValidUrl(url: string): boolean {
  return /^https:\/\/[^\s.]+\.\S{2,}$/i.test(url);
}

function humanDelay(seconds: number, isFr: boolean): string {
  if (seconds === 0) return isFr ? 'immédiatement' : 'immediately';
  if (seconds >= 86400) {
    const d = Math.round(seconds / 86400);
    return isFr ? `${d} jour${d > 1 ? 's' : ''} après` : `${d} day${d > 1 ? 's' : ''} after`;
  }
  const h = Math.round(seconds / 3600);
  return isFr ? `${h} h après` : `${h} h after`;
}

export default function SettingsReviews() {
  const { language } = useTranslation();
  const isFr = language === 'fr';

  const [form, setForm] = useState<ReviewSettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const update = <K extends keyof ReviewSettings>(key: K, value: ReviewSettings[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaved(false);
  };

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const orgId = await getCurrentOrgIdOrThrow();
      const [{ data, error }, allRules] = await Promise.all([
        supabase
          .from('company_settings')
          .select('id, review_enabled, google_review_url, facebook_review_url, review_invite_message')
          .eq('org_id', orgId)
          .limit(1)
          .maybeSingle(),
        getAutomationRules().catch(() => [] as AutomationRule[]),
      ]);
      if (error) throw error;
      if (data) {
        setForm({
          id: data.id,
          review_enabled: data.review_enabled ?? false,
          google_review_url: data.google_review_url || '',
          facebook_review_url: data.facebook_review_url || '',
          review_invite_message: data.review_invite_message || '',
        });
      }
      setRules(allRules.filter((r) => r.preset_key && REVIEW_PRESET_KEYS.includes(r.preset_key)));
      setDirty(false);
    } catch (e: any) {
      setLoadFailed(true);
      toast.error(e?.message || (isFr ? 'Échec du chargement des réglages d’avis.' : 'Failed to load review settings.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const google = normalizeUrl(form.google_review_url);
  const facebook = normalizeUrl(form.facebook_review_url);
  const hasDestination = Boolean(google || facebook);

  async function handleSave() {
    if (google && !isValidUrl(google)) {
      toast.error(isFr ? 'Lien Google invalide (doit commencer par https://).' : 'Invalid Google link (must start with https://).');
      return;
    }
    if (facebook && !isValidUrl(facebook)) {
      toast.error(isFr ? 'Lien Facebook invalide (doit commencer par https://).' : 'Invalid Facebook link (must start with https://).');
      return;
    }
    if (form.review_enabled && !hasDestination) {
      toast.error(isFr
        ? 'Ajoutez au moins un lien (Google ou Facebook) avant d’activer les demandes d’avis.'
        : 'Add at least one link (Google or Facebook) before enabling review requests.');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const orgId = await getCurrentOrgIdOrThrow();

      const payload = {
        review_enabled: form.review_enabled,
        google_review_url: google,
        facebook_review_url: facebook,
        review_invite_message: form.review_invite_message.trim() || null,
        updated_at: new Date().toISOString(),
      };

      if (form.id) {
        const { error } = await supabase.from('company_settings').update(payload).eq('id', form.id);
        if (error) throw error;
      } else {
        // Upsert sur org_id : jamais de 2e ligne company_settings pour une org.
        const { data, error } = await supabase
          .from('company_settings')
          .upsert({ ...payload, org_id: orgId, created_by: user.id }, { onConflict: 'org_id' })
          .select('id')
          .single();
        if (error) throw error;
        if (data) setForm((prev) => ({ ...prev, id: data.id }));
      }

      setForm((prev) => ({ ...prev, google_review_url: google, facebook_review_url: facebook }));
      setSaved(true);
      setDirty(false);
      toast.success(isFr ? 'Réglages d’avis enregistrés.' : 'Review settings saved.');
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      toast.error(e?.message || (isFr ? 'Erreur lors de l’enregistrement.' : 'Failed to save.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleRule(rule: AutomationRule) {
    setTogglingId(rule.id);
    try {
      await toggleAutomationRule(rule.id, !rule.is_active);
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_active: !r.is_active } : r)));
    } catch (e: any) {
      toast.error(e?.message || (isFr ? 'Impossible de modifier l’automatisation.' : 'Could not update automation.'));
    } finally {
      setTogglingId(null);
    }
  }

  const inviteDefault = isFr ? DEFAULT_INVITE_FR : DEFAULT_INVITE_EN;
  const invitePreview = form.review_invite_message.trim() || inviteDefault;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title={isFr ? 'Avis clients' : 'Customer reviews'}
        subtitle={isFr
          ? 'Sondage d’étoiles envoyé dès la fin de la job, puis redirection vers vos pages d’avis.'
          : 'Star survey sent as soon as the job is done, then redirect to your review pages.'}
        icon={Star}
        iconColor="amber"
      />

      {/* ── Comment ça marche ── */}
      <div className="section-card p-6 space-y-4">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
          <Zap size={12} /> {isFr ? 'Comment ça marche' : 'How it works'}
        </h3>
        <ol className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[13px]">
          <li className="rounded-xl border border-outline bg-surface-subtle p-4 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-text-primary">
              <span className="h-6 w-6 rounded-full bg-primary text-white text-[12px] flex items-center justify-center">1</span>
              <Send size={14} />
              {isFr ? 'Job terminée' : 'Job completed'}
            </div>
            <p className="text-text-secondary">
              {isFr
                ? 'Le client reçoit tout de suite, par courriel et SMS, un lien pour noter de 1 à 5 étoiles.'
                : 'The client immediately gets an email and SMS link to rate from 1 to 5 stars.'}
            </p>
          </li>
          <li className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/20 p-4 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-text-primary">
              <span className="h-6 w-6 rounded-full bg-emerald-600 text-white text-[12px] flex items-center justify-center">2</span>
              <ThumbsUp size={14} />
              {isFr ? '4 ou 5 étoiles' : '4 or 5 stars'}
            </div>
            <p className="text-text-secondary">
              {isFr
                ? 'Votre message d’invitation s’affiche, puis le client est redirigé vers Google ou Facebook pour laisser son avis.'
                : 'Your invite message shows, then the client is redirected to Google or Facebook to leave a review.'}
            </p>
          </li>
          <li className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/20 p-4 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-text-primary">
              <span className="h-6 w-6 rounded-full bg-amber-500 text-white text-[12px] flex items-center justify-center">3</span>
              <ThumbsDown size={14} />
              {isFr ? '3 étoiles ou moins' : '3 stars or less'}
            </div>
            <p className="text-text-secondary">
              {isFr
                ? 'Aucune redirection publique : un formulaire de commentaires interne s’ouvre et une tâche de suivi est créée pour vous.'
                : 'No public redirect: an internal feedback form opens and a follow-up task is created for you.'}
            </p>
          </li>
        </ol>
      </div>

      {/* ── Activation ── */}
      <div className="section-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-text-primary">
              {isFr ? 'Demander un avis à la fin de chaque job' : 'Ask for a review after every job'}
            </p>
            <p className="text-[12px] text-text-tertiary">
              {isFr
                ? 'Interrupteur principal. Désactivé, aucun sondage ni rappel d’avis ne part.'
                : 'Master switch. When off, no survey or review reminder is sent.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.review_enabled}
            onClick={() => {
              if (!form.review_enabled && !hasDestination) {
                toast.error(isFr ? 'Ajoutez d’abord un lien Google ou Facebook.' : 'Add a Google or Facebook link first.');
                return;
              }
              update('review_enabled', !form.review_enabled);
            }}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
              form.review_enabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600',
            )}
          >
            <span className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-surface-card transition-transform',
              form.review_enabled ? 'translate-x-6' : 'translate-x-1',
            )} />
          </button>
        </div>
        {!hasDestination && (
          <div className="mt-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">
            <p className="text-[12px] text-amber-700 dark:text-amber-300">
              {isFr
                ? 'Aucun lien configuré : les clients satisfaits n’auront nulle part où laisser leur avis. Ajoutez Google, Facebook ou les deux ci-dessous.'
                : 'No link configured: happy clients will have nowhere to leave a review. Add Google, Facebook or both below.'}
            </p>
          </div>
        )}
      </div>

      {/* ── Liens de redirection ── */}
      <div className="section-card p-6 space-y-5">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
          <ExternalLink size={12} /> {isFr ? 'Pages d’avis (4-5 étoiles)' : 'Review pages (4-5 stars)'}
        </h3>

        <div>
          <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
            <Globe size={10} /> {isFr ? 'Fiche Google (Google Business Profile)' : 'Google Business Profile'}
          </label>
          <input
            type="url"
            value={form.google_review_url}
            onChange={(e) => update('google_review_url', e.target.value)}
            className="glass-input w-full mt-1"
            placeholder="https://g.page/r/XXXXXXXX/review"
          />
          <p className="text-[12px] text-text-tertiary mt-1">
            {isFr
              ? 'Dans votre fiche Google Business → « Demander des avis » → copiez le lien court.'
              : 'In your Google Business Profile → “Ask for reviews” → copy the short link.'}
          </p>
        </div>

        <div>
          <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
            <Facebook size={10} /> {isFr ? 'Page Facebook (onglet Avis)' : 'Facebook page (Reviews tab)'}
          </label>
          <input
            type="url"
            value={form.facebook_review_url}
            onChange={(e) => update('facebook_review_url', e.target.value)}
            className="glass-input w-full mt-1"
            placeholder="https://www.facebook.com/votre-page/reviews"
          />
          <p className="text-[12px] text-text-tertiary mt-1">
            {isFr
              ? 'L’adresse de votre page suivie de /reviews. Les avis doivent être activés sur la page.'
              : 'Your page address followed by /reviews. Reviews must be enabled on the page.'}
          </p>
        </div>

        <p className="text-[12px] text-text-secondary rounded-lg bg-surface-subtle border border-outline px-3 py-2">
          {google && facebook
            ? (isFr
              ? 'Deux liens configurés : le client choisit la plateforme (Google proposé en premier).'
              : 'Two links configured: the client picks the platform (Google offered first).')
            : (isFr
              ? 'Un seul lien configuré : le client y est redirigé automatiquement après votre message.'
              : 'One link configured: the client is redirected there automatically after your message.')}
        </p>
      </div>

      {/* ── Message d'invitation ── */}
      <div className="section-card p-6 space-y-4">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
          <MessageSquareText size={12} /> {isFr ? 'Message d’invitation (4-5 étoiles)' : 'Invite message (4-5 stars)'}
        </h3>
        <textarea
          value={form.review_invite_message}
          onChange={(e) => update('review_invite_message', e.target.value)}
          rows={3}
          maxLength={400}
          placeholder={inviteDefault}
          className="glass-input w-full resize-none"
        />
        <div className="flex items-center justify-between text-[12px] text-text-tertiary">
          <span>{isFr ? 'Vide = texte par défaut ci-dessus.' : 'Empty = default text above.'}</span>
          <span>{form.review_invite_message.length}/400</span>
        </div>

        {/* Aperçu côté client */}
        <div className="rounded-2xl border border-outline bg-surface-subtle p-5 text-center space-y-3">
          <p className="text-[11px] uppercase tracking-wider text-text-tertiary">{isFr ? 'Aperçu client' : 'Client preview'}</p>
          <div className="flex justify-center gap-0.5">
            {[1, 2, 3, 4, 5].map((s) => <Star key={s} size={18} className="text-yellow-400 fill-yellow-400" />)}
          </div>
          <p className="text-sm text-text-primary">{invitePreview}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {google && (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-neutral-900 text-white text-[12px] font-semibold px-4 py-2">
                <Globe size={13} /> {isFr ? 'Laisser un avis Google' : 'Leave a Google review'}
              </span>
            )}
            {facebook && (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-[#1877F2] text-white text-[12px] font-semibold px-4 py-2">
                <Facebook size={13} /> {isFr ? 'Laisser un avis Facebook' : 'Leave a Facebook review'}
              </span>
            )}
            {!hasDestination && (
              <span className="text-[12px] text-text-tertiary italic">{isFr ? '(aucun bouton : aucun lien configuré)' : '(no button: no link configured)'}</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Automatisations liées ── */}
      <div className="section-card p-6 space-y-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
          <Zap size={12} /> {isFr ? 'Automatisations liées' : 'Related automations'}
        </h3>
        {rules.length === 0 ? (
          <p className="text-[13px] text-text-tertiary">
            {isFr ? 'Aucune automatisation d’avis trouvée pour cette entreprise.' : 'No review automation found for this company.'}
          </p>
        ) : (
          <ul className="divide-y divide-outline">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    {rule.preset_key === 'google_review'
                      ? (isFr ? 'Sondage d’étoiles' : 'Star survey')
                      : (isFr ? 'Rappel d’avis' : 'Review reminder')}
                  </p>
                  <p className="text-[12px] text-text-tertiary">
                    {rule.preset_key === 'google_review'
                      ? (isFr ? 'Courriel + SMS, ' : 'Email + SMS, ')
                      : (isFr ? 'SMS avec le lien de votre page d’avis, ' : 'SMS with your review page link, ')}
                    {humanDelay(rule.delay_seconds, isFr)} {isFr ? 'la fin de la job' : 'job completion'}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={rule.is_active}
                  disabled={togglingId === rule.id}
                  onClick={() => handleToggleRule(rule)}
                  className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
                    rule.is_active ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600',
                  )}
                >
                  <span className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-surface-card transition-transform',
                    rule.is_active ? 'translate-x-6' : 'translate-x-1',
                  )} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[12px] text-text-tertiary">
          {isFr ? 'Textes des SMS et délais : ' : 'SMS wording and delays: '}
          <Link to="/settings/messaging" className="text-primary hover:underline">
            {isFr ? 'Réglages → Messagerie SMS' : 'Settings → SMS Messaging'}
          </Link>
        </p>
      </div>

      {/* ── Save bar ── */}
      <div className={cn(
        'sticky bottom-4 z-30 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 backdrop-blur',
        dirty
          ? 'border-amber-300 bg-amber-50/95 dark:border-amber-700 dark:bg-amber-900/40'
          : 'border-outline bg-surface-card/90',
      )}>
        <span className="text-[13px] text-text-secondary">
          {loadFailed
            ? (isFr ? 'Chargement échoué — sauvegarde bloquée pour protéger vos données' : 'Load failed — saving is blocked to protect your data')
            : dirty
              ? (isFr ? 'Modifications non sauvegardées' : 'Unsaved changes')
              : (isFr ? 'Tout est à jour' : 'All changes saved')}
        </span>
        {loadFailed && (
          <button onClick={() => { void load(); }} className="glass-button text-[12px]">
            {isFr ? 'Réessayer' : 'Retry'}
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving || !dirty || loadFailed}
          className={cn(
            'glass-button inline-flex items-center gap-1.5',
            saved && '!bg-success !text-white !border-success',
            dirty && !saving && !saved && '!bg-primary !text-white !border-primary',
          )}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : null}
          {saving ? (isFr ? 'Enregistrement…' : 'Saving…') : saved ? (isFr ? 'Enregistré' : 'Saved') : (isFr ? 'Enregistrer' : 'Save')}
        </button>
      </div>
    </div>
  );
}
