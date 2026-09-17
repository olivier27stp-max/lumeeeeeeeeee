import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, ExternalLink, Landmark, Loader2, Plus, Shield, Trash2 } from 'lucide-react';
import { useTranslation } from '../i18n';
import { cn } from '../lib/utils';
import PermissionGate from '../components/PermissionGate';
import ConnectOnboarding from '../components/ConnectOnboarding';
import SmsStepUp from '../components/auth/SmsStepUp';
import { confirmer } from '../components/ui/ConfirmDialog';
import { usePermissions } from '../hooks/usePermissions';
import { getSmsStatus, type SmsStatus } from '../lib/mfaSmsApi';
import {
  getAccountStatus,
  getPaymentSettings,
  updatePaymentSettings,
  getPayoutsOverview,
  createDashboardLink,
  type PaymentSettings as ReglagesPaiement,
  type PaymentSettingsPatch,
} from '../lib/connectApi';
import {
  fetchReminderSettings,
  updateReminderSettings,
  type ReminderSettings,
  type ScheduleEntry,
  type ReminderChannel,
} from '../lib/remindersApi';

function formaterArgent(cents: number, currency: string, fr: boolean) {
  return new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', { style: 'currency', currency: currency || 'CAD' }).format(cents / 100);
}

function formaterDate(iso: string, fr: boolean) {
  return new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short' }).format(new Date(iso));
}

// ── Interrupteur accessible (même patron que BillingAddressSection) ──
function Interrupteur({ actif, onChange, label, disabled }: { actif: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!actif)}
      className={cn(
        'relative w-9 h-5 rounded-full transition-colors flex-shrink-0 disabled:opacity-50',
        actif ? 'bg-primary' : 'bg-surface-tertiary',
      )}
    >
      <span className={cn('absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', actif ? 'translate-x-4' : 'translate-x-0')} />
    </button>
  );
}

function LigneReglage({ titre, description, children }: { titre: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 bg-surface-secondary rounded-xl">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-text-primary">{titre}</p>
        <p className="text-xs text-text-tertiary mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  );
}

// ── Réglages : paiement en ligne devis/factures, portefeuilles, pourboires,
//    carte au dossier, courriel au propriétaire, « désactiver les paiements » ──
function ReglagesSection({ admin }: { admin: boolean }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['paymentSettings'], queryFn: getPaymentSettings });
  const [enCours, setEnCours] = React.useState<string | null>(null);

  async function modifier(patch: PaymentSettingsPatch, cle: string) {
    setEnCours(cle);
    try {
      const s = await updatePaymentSettings(patch);
      qc.setQueryData(['paymentSettings'], s);
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Réglage non enregistré.' : 'Setting not saved.'));
    } finally {
      setEnCours(null);
    }
  }

  async function desactiverTout() {
    const ok = await confirmer({
      title: fr ? 'Désactiver les paiements en ligne ?' : 'Disable online payments?',
      message: fr
        ? 'Vos clients ne pourront plus payer leurs factures ni les dépôts de devis en ligne. Les liens déjà envoyés afficheront un message. Vous pourrez réactiver à tout moment.'
        : 'Clients will no longer be able to pay invoices or quote deposits online. Links already sent will show a notice. You can turn it back on anytime.',
      confirmLabel: fr ? 'Désactiver' : 'Disable',
      danger: true,
    });
    if (!ok) return;
    await modifier({ quote_payments_enabled: false, invoice_payments_enabled: false }, 'tout');
  }

  const s: ReglagesPaiement | undefined = q.data;
  if (q.isLoading) {
    return <section className="section-card p-5"><Loader2 size={14} className="animate-spin text-text-tertiary" /></section>;
  }
  if (!s) return null;
  const toutCoupe = !s.quote_payments_enabled && !s.invoice_payments_enabled;

  const ligne = (cle: keyof PaymentSettingsPatch, titre: string, description: string) => (
    <LigneReglage titre={titre} description={description}>
      <Interrupteur
        actif={Boolean(s[cle])}
        label={titre}
        disabled={!admin || enCours !== null}
        onChange={(v) => modifier({ [cle]: v }, cle)}
      />
    </LigneReglage>
  );

  return (
    <section className="section-card p-5 space-y-3">
      <div>
        <h3 className="text-[14px] font-semibold text-text-primary">{fr ? 'Paiements en ligne' : 'Online payments'}</h3>
        {!admin && (
          <p className="text-xs text-text-tertiary mt-0.5">{fr ? 'Seuls les propriétaires et administrateurs peuvent modifier ces réglages.' : 'Only owners and admins can change these settings.'}</p>
        )}
      </div>
      {toutCoupe && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle size={14} />
          {fr ? 'Les paiements en ligne sont désactivés : vos clients ne peuvent pas payer par Lume Payments.' : 'Online payments are disabled: clients cannot pay through Lume Payments.'}
        </div>
      )}
      {ligne('quote_payments_enabled',
        fr ? 'Paiement des devis' : 'Quote payments',
        fr ? 'Le client paie son dépôt en ligne en acceptant le devis.' : 'Clients pay their deposit online when approving a quote.')}
      {ligne('invoice_payments_enabled',
        fr ? 'Paiement des factures' : 'Invoice payments',
        fr ? 'Le client paie sa facture en ligne par le lien de paiement.' : 'Clients pay invoices online through the payment link.')}
      {ligne('wallets_enabled',
        'Apple Pay & Google Pay',
        fr ? 'Proposés sur la page de paiement en plus de la carte. Apple Pay exige que le domaine soit enregistré chez Stripe.' : 'Offered on the payment page alongside cards. Apple Pay requires the domain to be registered with Stripe.')}
      {ligne('tips_enabled',
        fr ? 'Pourboires' : 'Tips',
        fr ? 'Le client peut ajouter un pourboire en payant une facture. Il n’est jamais déduit du solde.' : 'Clients can add a tip when paying an invoice. It never reduces the balance due.')}
      {ligne('require_payment_method_default',
        fr ? 'Carte au dossier exigée par défaut' : 'Payment method on file by default',
        fr ? 'Les nouveaux devis exigent une carte enregistrée à l’acceptation. Modifiable devis par devis.' : 'New quotes require a saved card at approval. Adjustable per quote.')}
      {ligne('notify_owner_email',
        fr ? 'Courriel à chaque paiement reçu' : 'Email me on every payment',
        fr ? 'Envoyé à l’adresse de l’entreprise (Détails de l’entreprise).' : 'Sent to the company email (Company details).')}
      <p className="text-xs text-text-tertiary">
        {fr ? 'Le reçu automatique au client se règle dans ' : 'The automatic client receipt is managed in '}
        <a href="/automations" className="underline">{fr ? 'Automatisations' : 'Automations'}</a>
        {fr ? ' (règle « facture payée »).' : ' (“invoice paid” rule).'}
      </p>
      {admin && !toutCoupe && (
        <div className="flex items-center justify-between gap-4 pt-1">
          <div>
            <p className="text-[13px] font-semibold text-text-primary">{fr ? 'Désactiver les paiements' : 'Disable payments'}</p>
            <p className="text-xs text-text-tertiary">{fr ? 'Coupe le paiement en ligne des devis et des factures d’un coup.' : 'Turns off online quote and invoice payments at once.'}</p>
          </div>
          <button type="button" onClick={desactiverTout} disabled={enCours !== null} className="glass-button text-[12px] text-red-600 dark:text-red-400 whitespace-nowrap">
            {fr ? 'Désactiver' : 'Disable'}
          </button>
        </div>
      )}
    </section>
  );
}

// ── Versements : solde, prochain versement, banque, instantanés, litiges ──
function VersementsSection() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [ouverture, setOuverture] = React.useState(false);
  const q = useQuery({ queryKey: ['payoutsOverview'], queryFn: getPayoutsOverview, retry: false, staleTime: 60_000 });

  async function ouvrirDashboard() {
    setOuverture(true);
    try {
      const { url } = await createDashboardLink();
      window.open(url, '_blank', 'noopener');
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Impossible d’ouvrir le tableau de bord Stripe.' : 'Could not open the Stripe dashboard.'));
    } finally {
      setOuverture(false);
    }
  }

  if (q.isLoading) {
    return <section className="section-card p-5"><Loader2 size={14} className="animate-spin text-text-tertiary" /></section>;
  }
  const o = q.data;
  if (!o) return null;
  const cur = o.currency;

  return (
    <section className="section-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-text-primary">{fr ? 'Versements' : 'Payouts'}</h3>
        <button type="button" onClick={ouvrirDashboard} disabled={ouverture} className="glass-button inline-flex items-center gap-1.5 text-[12px]">
          {ouverture ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
          {fr ? 'Voir les versements' : 'View payouts'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 bg-surface-secondary rounded-xl">
          <p className="text-xs text-text-tertiary">{fr ? 'Prochain versement' : 'Upcoming payout'}</p>
          <p className="text-[20px] font-bold text-text-primary mt-1">{formaterArgent(o.next_payout?.amount_cents ?? 0, cur, fr)}</p>
          <p className="text-xs text-text-tertiary">{o.next_payout ? (fr ? `Arrivée le ${formaterDate(o.next_payout.arrival_date, fr)}` : `Arrives ${formaterDate(o.next_payout.arrival_date, fr)}`) : (fr ? 'Aucun versement en route' : 'No payout in transit')}</p>
        </div>
        <div className="p-4 bg-surface-secondary rounded-xl">
          <p className="text-xs text-text-tertiary">{fr ? 'En attente chez Stripe' : 'Pending at Stripe'}</p>
          <p className="text-[20px] font-bold text-text-primary mt-1">{formaterArgent(o.pending_cents, cur, fr)}</p>
          <p className="text-xs text-text-tertiary">{fr ? `Disponible : ${formaterArgent(o.available_cents, cur, fr)}` : `Available: ${formaterArgent(o.available_cents, cur, fr)}`}</p>
        </div>
        <div className="p-4 bg-surface-secondary rounded-xl">
          <p className="text-xs text-text-tertiary">{fr ? 'Versé vers' : 'Payout to'}</p>
          {o.bank ? (
            <>
              <p className="text-[13px] font-semibold text-text-primary mt-1 flex items-center gap-1.5"><Landmark size={13} /> {o.bank.label}</p>
              <p className="text-xs text-text-tertiary">{fr ? 'Se terminant par' : 'Ending in'} {o.bank.last4}{o.payout_schedule ? ` · ${o.payout_schedule.interval}` : ''}</p>
            </>
          ) : (
            <p className="text-xs text-text-tertiary mt-1">{fr ? 'Aucun compte de dépôt' : 'No payout account'}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <LigneReglage
          titre={fr ? 'Versements instantanés' : 'Instant payouts'}
          description={o.instant_payouts_available
            ? (fr ? 'Disponibles depuis votre tableau de bord Stripe (frais Stripe applicables).' : 'Available from your Stripe dashboard (Stripe fees apply).')
            : (fr ? 'Ajoutez une carte de débit dans votre tableau de bord Stripe pour y accéder.' : 'Add a debit card in your Stripe dashboard to unlock them.')}
        >
          <button type="button" onClick={ouvrirDashboard} disabled={ouverture} className="glass-button-secondary text-[11px] !py-2 !px-3 whitespace-nowrap">
            {o.instant_payouts_available ? (fr ? 'Verser' : 'Pay out') : (fr ? 'Configurer' : 'Set up')}
          </button>
        </LigneReglage>
        <LigneReglage
          titre={fr ? 'Litiges' : 'Disputes'}
          description={o.disputes.open_count > 0
            ? (fr ? `${o.disputes.open_count} litige(s) en attente de réponse.` : `${o.disputes.open_count} dispute(s) awaiting a response.`)
            : (fr ? 'Aucun litige ouvert.' : 'No open disputes.')}
        >
          {o.disputes.open_count > 0 ? (
            <button type="button" onClick={ouvrirDashboard} disabled={ouverture} className="glass-button-secondary text-[11px] !py-2 !px-3 whitespace-nowrap text-red-600 dark:text-red-400">
              {fr ? 'Répondre' : 'Respond'}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-100 rounded-full px-3 py-1"><Check size={9} /> {fr ? 'À jour' : 'Clear'}</span>
          )}
        </LigneReglage>
      </div>
    </section>
  );
}

// ── Rappels de paiement (l'ancienne page /settings/reminders redirige ici) ──
function RappelsSection({ admin }: { admin: boolean }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const baseId = React.useId();
  const [reglages, setReglages] = React.useState<ReminderSettings | null>(null);
  const [echec, setEchec] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    fetchReminderSettings().then(setReglages).catch((err: any) => {
      console.error('[PaymentSettings] rappels non chargés :', err?.message);
      setEchec(true);
    });
  }, []);

  function majSchedule(next: ScheduleEntry[]) {
    if (!reglages) return;
    setReglages({ ...reglages, schedule: next });
    setDirty(true);
  }

  async function basculer(enabled: boolean) {
    if (!reglages) return;
    setSaving(true);
    try {
      setReglages(await updateReminderSettings({ enabled }));
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Réglage non enregistré.' : 'Setting not saved.'));
    } finally {
      setSaving(false);
    }
  }

  async function enregistrer() {
    if (!reglages) return;
    setSaving(true);
    try {
      const propre = reglages.schedule
        .map((e) => ({ days_after_due: Math.max(0, Math.min(365, Math.floor(Number(e.days_after_due) || 0))), channel: e.channel }))
        .sort((a, b) => a.days_after_due - b.days_after_due);
      setReglages(await updateReminderSettings({ schedule: propre }));
      setDirty(false);
      toast.success(fr ? 'Rappels enregistrés.' : 'Reminders saved.');
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Rappels non enregistrés.' : 'Reminders not saved.'));
    } finally {
      setSaving(false);
    }
  }

  const canaux: Array<{ v: ReminderChannel; l: string }> = [
    { v: 'email', l: fr ? 'Courriel' : 'Email' },
    { v: 'sms', l: 'SMS' },
    { v: 'both', l: fr ? 'Courriel + SMS' : 'Email + SMS' },
  ];

  return (
    <section className="section-card p-5 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-[14px] font-semibold text-text-primary">{fr ? 'Rappels de paiement' : 'Payment reminders'}</h3>
          <p className="text-xs text-text-tertiary mt-0.5">{fr ? 'Relances automatiques des factures en retard, avec le lien de paiement.' : 'Automatic follow-ups on overdue invoices, with the payment link.'}</p>
        </div>
        {reglages && (
          <Interrupteur actif={reglages.enabled} label={fr ? 'Rappels de paiement' : 'Payment reminders'} disabled={!admin || saving} onChange={basculer} />
        )}
      </div>
      {echec && <p className="text-xs text-text-tertiary">—</p>}
      {reglages && (
        <div className="space-y-2">
          {reglages.schedule.map((e, i) => {
            const idJours = `${baseId}-jours-${i}`;
            const idCanal = `${baseId}-canal-${i}`;
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 p-3 bg-surface-secondary rounded-xl text-[13px]">
                <label htmlFor={idJours} className="text-text-secondary">{fr ? 'Après' : 'After'}</label>
                <input
                  id={idJours}
                  type="number"
                  min={0}
                  max={365}
                  disabled={!admin || saving}
                  value={e.days_after_due}
                  onChange={(ev) => majSchedule(reglages.schedule.map((x, j) => j === i ? { ...x, days_after_due: Number(ev.target.value) } : x))}
                  className="w-16 rounded-md border border-outline bg-surface-card px-2 py-1 text-[13px] text-text-primary"
                />
                <span className="text-text-secondary">{fr ? 'jour(s) de retard, par' : 'day(s) overdue, via'}</span>
                <select
                  id={idCanal}
                  aria-label={fr ? 'Canal du rappel' : 'Reminder channel'}
                  disabled={!admin || saving}
                  value={e.channel}
                  onChange={(ev) => majSchedule(reglages.schedule.map((x, j) => j === i ? { ...x, channel: ev.target.value as ReminderChannel } : x))}
                  className="rounded-md border border-outline bg-surface-card px-2 py-1 text-[13px] text-text-primary"
                >
                  {canaux.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
                </select>
                {admin && (
                  <button
                    type="button"
                    aria-label={fr ? 'Retirer ce rappel' : 'Remove this reminder'}
                    disabled={saving}
                    onClick={() => majSchedule(reglages.schedule.filter((_, j) => j !== i))}
                    className="ml-auto text-text-tertiary hover:text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
          {admin && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={saving || reglages.schedule.length >= 20}
                onClick={() => majSchedule([...reglages.schedule, { days_after_due: 7, channel: 'email' }])}
                className="glass-button inline-flex items-center gap-1.5 text-[12px]"
              >
                <Plus size={12} /> {fr ? 'Ajouter un rappel' : 'Add a reminder'}
              </button>
              {dirty && (
                <button type="button" disabled={saving} onClick={enregistrer} className="glass-button bg-primary text-white text-[12px]">
                  {saving ? (fr ? 'Enregistrement…' : 'Saving…') : (fr ? 'Enregistrer' : 'Save')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// Illustration d'en-tête (fournie par le propriétaire). Elle porte déjà le
// titre « LUME Payments » : on la met en bandeau et on n'ajoute qu'un
// sous-titre lisible sur un voile. Repli texte propre si le fichier est absent.
const HERO_URL = '/lume-payments-hero.webp';

function PaymentsHero({ language }: { language: string }) {
  const fr = language === 'fr';
  const [hasImg, setHasImg] = React.useState(false);
  React.useEffect(() => {
    const img = new Image();
    img.onload = () => setHasImg(true);
    img.src = HERO_URL;
  }, []);

  const subtitle = fr
    ? 'Acceptez les paiements en ligne de vos clients via Lume Payments.'
    : 'Accept online payments from your clients via Lume Payments.';

  if (hasImg) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-outline bg-surface-card">
        <img
          src={HERO_URL}
          alt={fr ? 'Lume Payments' : 'Lume Payments'}
          className="w-full block dark:brightness-95"
        />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-surface-card via-surface-card/85 to-transparent" aria-hidden />
        <div className="absolute inset-x-0 bottom-0 px-6 pb-5 pt-8 text-center">
          <p className="text-sm text-text-secondary max-w-md mx-auto leading-relaxed">{subtitle}</p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-xl font-bold text-text-primary tracking-tight">Lume Payments</h1>
      <p className="text-[12px] text-text-tertiary mt-0.5">{subtitle}</p>
    </div>
  );
}

// ── SMS 2FA — payment-security section ──
// Risk-based, payments-scoped: owners verify a mobile number; sensitive payment
// actions on a new device then require an SMS code (device trusted 30 days).
// Lives here (not on the profile page) because it protects payment actions.
function MfaSection() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const [status, setStatus] = React.useState<SmsStatus | null>(null);
  const [statusFailed, setStatusFailed] = React.useState(false);
  const [showStepUp, setShowStepUp] = React.useState(false);

  const load = React.useCallback(async () => {
    setStatusFailed(false);
    try { setStatus(await getSmsStatus()); } catch { setStatus(null); setStatusFailed(true); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  if (showStepUp) {
    return (
      <section className="section-card p-5">
        <SmsStepUp
          mode="enroll"
          onDone={() => { setShowStepUp(false); load(); }}
          onCancel={() => setShowStepUp(false)}
        />
      </section>
    );
  }

  const enrolled = !!status?.enrolled;
  const smsOff = !!status && !status.sms_configured;

  return (
    <section className="section-card p-5 space-y-4">
      <h3 className="text-[14px] font-semibold text-text-primary">{t.settings.security}</h3>
      <div className="flex items-center justify-between p-4 bg-surface-secondary rounded-xl">
        <div className="flex items-center gap-3.5">
          <Shield size={18} className={enrolled ? 'text-green-600' : 'text-text-tertiary'} />
          <div>
            <p className="text-[13px] font-semibold text-text-primary">
              {fr ? 'Vérification par SMS' : 'SMS verification'}
            </p>
            <p className="text-xs text-text-tertiary">
              {fr
                ? 'Requise pour les actions de paiement sur un nouvel appareil.'
                : 'Required for payment actions on a new device.'}
              {enrolled && status?.phone_hint ? `  ·  •••• ${status.phone_hint}` : ''}
            </p>
          </div>
        </div>
        {status === null && statusFailed ? (
          // Fetch failed — show a dash instead of spinning forever.
          <span className="text-[10px] text-text-tertiary">—</span>
        ) : status === null ? (
          <Loader2 size={14} className="animate-spin text-text-tertiary" />
        ) : smsOff ? (
          <span className="text-[10px] text-text-tertiary">{fr ? 'SMS non configuré' : 'SMS not configured'}</span>
        ) : enrolled ? (
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-100 rounded-full px-3 py-1">
              <Check size={9} /> {fr ? 'Actif' : 'Active'}
            </span>
            <button onClick={() => setShowStepUp(true)} className="glass-button-ghost text-[10px] font-medium">
              {fr ? 'Changer le numéro' : 'Change number'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowStepUp(true)}
            className="glass-button-secondary text-[11px] !py-2 !px-4"
          >
            {fr ? 'Configurer' : 'Set up'}
          </button>
        )}
      </div>
    </section>
  );
}

export default function PaymentSettings() {
  const { t, language } = useTranslation();
  const { role } = usePermissions();
  const admin = role === 'owner' || role === 'admin';
  // Même clé que ConnectOnboarding : une seule requête partagée.
  const statut = useQuery({ queryKey: ['connectAccountStatus'], queryFn: getAccountStatus, refetchInterval: 30_000 });
  const connecte = Boolean(statut.data?.connected && statut.data?.account?.charges_enabled);

  return (
    // settings.read: matches the /settings/payments route gate — the page used
    // to demand payments.create and showed "Access Restricted" to users the
    // route itself let in. (Connect activation stays admin-gated server-side.)
    <PermissionGate permission="settings.read">
      <div className="max-w-2xl space-y-6">
        <PaymentsHero language={language} />

        <ConnectOnboarding />

        {connecte && admin && <VersementsSection />}

        {/* Toujours visibles, même avant l'activation Stripe : les choix sont
            enregistrés dès maintenant et s'appliquent au premier paiement.
            Vérifié en prod le 2026-09-17 : une org en cours d'onboarding ne
            voyait aucun réglage, la page semblait inchangée. */}
        <ReglagesSection admin={admin} />

        {!connecte && (
          <p className="text-xs text-text-tertiary -mt-3 px-1">
            {language === 'fr'
              ? 'Ces réglages prendront effet dès que Lume Payments sera activé. Le solde, les versements et les litiges apparaîtront ici à ce moment.'
              : 'These settings take effect as soon as Lume Payments is active. Balance, payouts and disputes will appear here at that point.'}
          </p>
        )}

        <section className="section-card p-5 space-y-3">
          <h3 className="text-[14px] font-semibold text-text-primary">
            {t.paymentSettings.howItWorks}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[11px] font-bold text-text-primary dark:text-neutral-400">1</span>
                <span className="text-[13px] font-medium text-text-primary">
                  {t.paymentSettings.activatePayments}
                </span>
              </div>
              <p className="text-[12px] text-text-tertiary pl-8">
                {language === 'fr'
                  ? 'Connectez votre compte bancaire via Stripe en quelques minutes.'
                  : 'Connect your bank account via Stripe in minutes.'}
              </p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[11px] font-bold text-text-primary dark:text-neutral-400">2</span>
                <span className="text-[13px] font-medium text-text-primary">
                  {t.paymentSettings.sendPaymentRequests}
                </span>
              </div>
              <p className="text-[12px] text-text-tertiary pl-8">
                {language === 'fr'
                  ? 'Depuis une facture, envoyez un lien de paiement par email ou SMS.'
                  : 'From any invoice, send a payment link via email or SMS.'}
              </p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[11px] font-bold text-text-primary dark:text-neutral-400">3</span>
                <span className="text-[13px] font-medium text-text-primary">
                  {t.paymentSettings.getPaid}
                </span>
              </div>
              <p className="text-[12px] text-text-tertiary pl-8">
                {language === 'fr'
                  ? 'Les paiements sont déposés directement dans votre compte bancaire.'
                  : 'Payments are deposited directly into your bank account.'}
              </p>
            </div>
          </div>
        </section>

        <MfaSection />

        <RappelsSection admin={admin} />

        <section className="section-card p-5 space-y-2">
          <h3 className="text-[14px] font-semibold text-text-primary">
            {t.paymentSettings.fees}
          </h3>
          <div className="flex items-baseline gap-1">
            <span className="text-[24px] font-bold text-text-primary">2.9%</span>
            <span className="text-[13px] text-text-secondary">+ 30&cent;</span>
            <span className="text-[13px] text-text-tertiary ml-2">
              {t.paymentSettings.perSuccessfulTransaction}
            </span>
          </div>
          <p className="text-[12px] text-text-tertiary">
            {language === 'fr'
              ? 'Aucun frais mensuel. Aucun frais caché. Payez seulement quand vous êtes payé.'
              : 'No monthly fees. No hidden charges. Only pay when you get paid.'}
          </p>
          <ul className="flex flex-wrap gap-1.5 pt-1" aria-label={language === 'fr' ? 'Moyens de paiement acceptés' : 'Accepted payment methods'}>
            {['Visa', 'Mastercard', 'Amex', 'Apple Pay', 'Google Pay'].map((m) => (
              <li key={m} className="rounded-md border border-outline bg-surface-secondary px-2 py-0.5 text-[11px] font-semibold text-text-secondary">{m}</li>
            ))}
          </ul>
        </section>
      </div>
    </PermissionGate>
  );
}
