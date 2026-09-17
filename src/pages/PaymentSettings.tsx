import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, ChevronRight, CreditCard, ExternalLink, Landmark, Loader2, Plus, Shield, Trash2 } from 'lucide-react';
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
  type PayoutsOverview,
} from '../lib/connectApi';
import {
  fetchReminderSettings,
  updateReminderSettings,
  type ReminderSettings,
  type ScheduleEntry,
  type ReminderChannel,
} from '../lib/remindersApi';

/*
 * Page Réglages → Lume Payments.
 *
 * Mise en page calquée sur « Jobber Payments » (2026-09-17) : une colonne
 * principale de cartes aux lignes plates séparées par un filet (titre,
 * description, interrupteur à droite), et une colonne de droite pour ce qui
 * se lit d'un coup d'œil — versements, versements instantanés, litiges, taux.
 * Pas de boîtes grises imbriquées, une seule hiérarchie visuelle.
 */

function formaterArgent(cents: number, currency: string, fr: boolean) {
  return new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', { style: 'currency', currency: currency || 'CAD' }).format(cents / 100);
}

function formaterDate(iso: string, fr: boolean) {
  return new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short' }).format(new Date(iso));
}

// ── Briques de mise en page ──

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
        'relative w-10 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50',
        actif ? 'bg-green-600' : 'bg-surface-tertiary',
      )}
    >
      <span className={cn('absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform', actif ? 'translate-x-4' : 'translate-x-0')} />
    </button>
  );
}

function Carte({ titre, sousTitre, action, children, className }: { titre?: string; sousTitre?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('section-card', className)}>
      {titre && (
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-1">
          <div>
            <h3 className="text-[15px] font-semibold text-text-primary">{titre}</h3>
            {sousTitre && <p className="text-[12px] text-text-tertiary mt-0.5">{sousTitre}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Ligne plate : titre + description à gauche, contrôle à droite, filet entre les lignes. */
function Ligne({ titre, description, children, retrait, icone }: { titre: string; description?: React.ReactNode; children?: React.ReactNode; retrait?: boolean; icone?: React.ReactNode }) {
  return (
    <div className={cn('flex items-center justify-between gap-4 px-5 py-3.5 border-t border-outline first:border-t-0', retrait && 'py-2.5 bg-surface-secondary/40')}>
      <div className={cn('min-w-0 flex items-start gap-3', retrait && 'pl-1')}>
        {icone && <span className="mt-0.5 text-text-tertiary shrink-0">{icone}</span>}
        <div className="min-w-0">
          <p className={cn('text-text-primary', retrait ? 'text-[13px] font-medium' : 'text-[14px] font-semibold')}>{titre}</p>
          {description && <p className="text-[12.5px] text-text-tertiary mt-0.5 leading-snug">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function SousTitre({ children }: { children: React.ReactNode }) {
  return <p className="px-5 pt-4 pb-1 text-[13px] font-semibold text-text-primary border-t border-outline">{children}</p>;
}

// ── Réglages (interrupteurs) ──

function useReglages() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['paymentSettings'], queryFn: getPaymentSettings });
  const [enCours, setEnCours] = React.useState<string | null>(null);
  const { language } = useTranslation();
  const fr = language === 'fr';

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
  return { s: q.data, chargement: q.isLoading, enCours, modifier };
}

type ReglagesCtl = ReturnType<typeof useReglages>;

function Bascule({ ctl, cle, label, admin }: { ctl: ReglagesCtl; cle: keyof PaymentSettingsPatch; label: string; admin: boolean }) {
  if (!ctl.s) return <Loader2 size={14} className="animate-spin text-text-tertiary" />;
  return (
    <Interrupteur
      actif={Boolean(ctl.s[cle])}
      label={label}
      disabled={!admin || ctl.enCours !== null}
      onChange={(v) => ctl.modifier({ [cle]: v }, cle)}
    />
  );
}

function CartePortailClient({ ctl, admin }: { ctl: ReglagesCtl; admin: boolean }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const s = ctl.s;
  const toutCoupe = !!s && !s.quote_payments_enabled && !s.invoice_payments_enabled;
  const moyens = fr ? 'Cartes de crédit ou débit' : 'Credit or debit cards';
  const portefeuilles = s?.wallets_enabled ? ', Apple Pay, Google Pay' : '';

  return (
    <Carte
      titre={fr ? 'Paiements du portail client' : 'Client portal payments'}
      sousTitre={!admin ? (fr ? 'Seuls les propriétaires et administrateurs peuvent modifier ces réglages.' : 'Only owners and admins can change these settings.') : undefined}
    >
      {toutCoupe && (
        <div className="mx-5 my-3 flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-[12.5px] text-amber-800 dark:text-amber-200">
          <AlertTriangle size={14} className="shrink-0" />
          {fr ? 'Les paiements en ligne sont désactivés : vos clients ne peuvent pas payer par Lume Payments.' : 'Online payments are disabled: clients cannot pay through Lume Payments.'}
        </div>
      )}
      <div className="pt-1">
        <Ligne titre={fr ? 'Paiement des devis' : 'Quote payments'} description={fr ? 'Le client paie son dépôt en ligne en acceptant le devis.' : 'Let clients pay deposits online when viewing quotes.'}>
          <Bascule ctl={ctl} cle="quote_payments_enabled" label={fr ? 'Paiement des devis' : 'Quote payments'} admin={admin} />
        </Ligne>
        <Ligne retrait icone={<CreditCard size={16} />} titre={fr ? 'Paiements par carte' : 'Card payments'} description={`${moyens}${portefeuilles}`} />
        <Ligne titre={fr ? 'Paiement des factures' : 'Invoice payments'} description={fr ? 'Le client paie sa facture en ligne par le lien de paiement.' : 'Let clients pay online when viewing invoices.'}>
          <Bascule ctl={ctl} cle="invoice_payments_enabled" label={fr ? 'Paiement des factures' : 'Invoice payments'} admin={admin} />
        </Ligne>
        <Ligne retrait icone={<CreditCard size={16} />} titre={fr ? 'Paiements par carte' : 'Card payments'} description={`${moyens}${portefeuilles}`} />
      </div>

      <SousTitre>{fr ? 'Réglages avancés' : 'Advanced settings'}</SousTitre>
      <div className="pb-1">
        <Ligne titre="Apple Pay & Google Pay" description={fr ? 'Proposés sur la page de paiement en plus de la carte.' : 'Offered on the payment page alongside cards.'}>
          <Bascule ctl={ctl} cle="wallets_enabled" label="Apple Pay & Google Pay" admin={admin} />
        </Ligne>
        <Ligne titre={fr ? 'Carte au dossier' : 'Payment method on file'} description={fr ? 'Exiger une carte enregistrée quand le client accepte un devis.' : 'Require clients to save a payment method when approving a quote.'}>
          <Bascule ctl={ctl} cle="require_payment_method_default" label={fr ? 'Carte au dossier' : 'Payment method on file'} admin={admin} />
        </Ligne>
        <Ligne titre={fr ? 'Pourboires' : 'Tips'} description={fr ? 'Accepter un pourboire sur les factures payées en ligne.' : 'Accept tips on invoices paid online.'}>
          <Bascule ctl={ctl} cle="tips_enabled" label={fr ? 'Pourboires' : 'Tips'} admin={admin} />
        </Ligne>
      </div>
    </Carte>
  );
}

function CarteNotifications({ ctl, admin }: { ctl: ReglagesCtl; admin: boolean }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  return (
    <Carte titre="Notifications">
      <div className="pt-1 pb-1">
        <Ligne titre={fr ? 'Être avisé de chaque paiement par courriel' : 'Get notified of payments by email'} description={fr ? 'Envoyé à l’adresse de l’entreprise.' : 'Sent to the company email.'}>
          <Bascule ctl={ctl} cle="notify_owner_email" label={fr ? 'Courriel à chaque paiement reçu' : 'Email me on every payment'} admin={admin} />
        </Ligne>
        <Ligne titre={fr ? 'Reçu automatique au client' : 'Automatically email receipts to clients'} description={fr ? 'Règle « facture payée » des automatisations.' : '“Invoice paid” automation rule.'}>
          <a href="/automations" className="inline-flex items-center gap-1 text-[13px] font-medium text-text-primary hover:underline whitespace-nowrap">
            {fr ? 'Automatisations' : 'Automations'} <ChevronRight size={14} />
          </a>
        </Ligne>
      </div>
    </Carte>
  );
}

function CarteDesactiver({ ctl, admin }: { ctl: ReglagesCtl; admin: boolean }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const s = ctl.s;
  if (!admin || !s || (!s.quote_payments_enabled && !s.invoice_payments_enabled)) return null;

  async function desactiverTout() {
    const ok = await confirmer({
      title: fr ? 'Désactiver les paiements en ligne ?' : 'Disable online payments?',
      message: fr
        ? 'Vos clients ne pourront plus payer leurs factures ni les dépôts de devis en ligne. Vous pourrez réactiver à tout moment.'
        : 'Clients will no longer be able to pay invoices or quote deposits online. You can turn it back on anytime.',
      confirmLabel: fr ? 'Désactiver' : 'Disable',
      danger: true,
    });
    if (!ok) return;
    await ctl.modifier({ quote_payments_enabled: false, invoice_payments_enabled: false }, 'tout');
  }

  return (
    <Carte>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 px-5 py-4">
        <div>
          <h3 className="text-[15px] font-semibold text-text-primary">{fr ? 'Désactiver les paiements' : 'Disable payments'}</h3>
          <p className="text-[12.5px] text-text-tertiary mt-0.5">{fr ? 'Vos clients ne pourront plus payer devis ni factures en ligne.' : 'Clients can’t pay outstanding or new quotes and invoices online.'}</p>
        </div>
        <button type="button" onClick={desactiverTout} disabled={ctl.enCours !== null} className="glass-button text-[13px] font-medium text-red-600 dark:text-red-400 whitespace-nowrap self-start sm:self-auto">
          {fr ? 'Désactiver' : 'Disable payments'}
        </button>
      </div>
    </Carte>
  );
}

// ── Colonne de droite : versements, instantanés, litiges, taux ──

function ColonneVersements({ connecte, admin }: { connecte: boolean; admin: boolean }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [ouverture, setOuverture] = React.useState(false);
  const q = useQuery({ queryKey: ['payoutsOverview'], queryFn: getPayoutsOverview, retry: false, staleTime: 60_000, enabled: connecte && admin });
  const o: PayoutsOverview | undefined = q.data;
  const cur = o?.currency || 'CAD';

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

  const bouton = (label: string, variante: 'plein' | 'ligne' = 'ligne') => (
    <button
      type="button"
      onClick={ouvrirDashboard}
      disabled={!connecte || !admin || ouverture}
      className={cn('text-[12.5px] font-medium whitespace-nowrap', variante === 'plein' ? 'glass-button bg-primary text-white' : 'glass-button')}
    >
      {ouverture ? <Loader2 size={12} className="animate-spin" /> : label}
    </button>
  );

  const vide = !connecte
    ? (fr ? 'Disponible dès que Lume Payments sera activé.' : 'Available once Lume Payments is active.')
    : !admin
      ? (fr ? 'Réservé aux propriétaires et administrateurs.' : 'Owners and admins only.')
      : null;

  return (
    <div className="space-y-4">
      <Carte titre={fr ? 'Versements' : 'Standard payouts'}>
        <div className="px-5 pb-4 pt-1">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[12.5px] text-text-tertiary">{fr ? 'Prochain versement' : 'Upcoming payouts'}</p>
              <p className="text-[22px] font-bold text-text-primary leading-tight mt-0.5">
                {q.isLoading ? '…' : formaterArgent(o?.next_payout?.amount_cents ?? 0, cur, fr)}
              </p>
              {o?.next_payout && <p className="text-[12px] text-text-tertiary">{fr ? 'Arrivée le' : 'Arrives'} {formaterDate(o.next_payout.arrival_date, fr)}</p>}
            </div>
            {bouton(fr ? 'Voir' : 'View payouts')}
          </div>
          {o && (
            <p className="text-[12px] text-text-tertiary mt-2">
              {fr ? 'En attente' : 'Pending'} {formaterArgent(o.pending_cents, cur, fr)} · {fr ? 'disponible' : 'available'} {formaterArgent(o.available_cents, cur, fr)}
            </p>
          )}
          {vide && <p className="text-[12px] text-text-tertiary mt-1">{vide}</p>}
        </div>
        <div className="border-t border-outline px-5 py-3.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text-primary">{fr ? 'Versé vers' : 'Payout to'}</p>
            {o?.bank ? (
              <>
                <p className="text-[12.5px] text-text-secondary flex items-center gap-1.5 mt-0.5 truncate">
                  <Landmark size={12} className="shrink-0" /> <span className="truncate">{o.bank.label.toUpperCase()}</span>
                </p>
                <p className="text-[12px] text-text-tertiary">{fr ? 'Se terminant par' : 'Ending in'} {o.bank.last4}</p>
              </>
            ) : (
              <p className="text-[12.5px] text-text-tertiary mt-0.5">{connecte ? (fr ? 'Aucun compte de dépôt' : 'No payout account') : '—'}</p>
            )}
          </div>
          {connecte && admin && (
            <button type="button" onClick={ouvrirDashboard} disabled={ouverture} aria-label={fr ? 'Gérer le compte de dépôt' : 'Manage payout account'} className="glass-button !px-2.5 text-text-secondary">
              <ExternalLink size={13} />
            </button>
          )}
        </div>
      </Carte>

      <Carte titre={fr ? 'Versements instantanés' : 'Instant payouts'}>
        <div className="px-5 pb-4 pt-1 flex items-center justify-between gap-3">
          <p className="text-[12.5px] text-text-tertiary">
            {o?.instant_payouts_available
              ? (fr ? 'Disponibles depuis votre tableau de bord Stripe. Frais Stripe applicables.' : 'Available from your Stripe dashboard. Stripe fees apply.')
              : (fr ? 'Ajoutez une carte de débit pour être versé en minutes.' : 'Add a debit card to get paid in minutes.')}
          </p>
          {bouton(o?.instant_payouts_available ? (fr ? 'Verser' : 'Pay out') : (fr ? 'Configurer' : 'Set Up'))}
        </div>
      </Carte>

      <Carte titre={fr ? 'Litiges' : 'Disputes'}>
        <div className="px-5 pb-4 pt-1 flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-text-primary">
              {o && o.disputes.open_count > 0
                ? (fr ? 'Réponse requise' : 'Action required')
                : (fr ? 'Aucune action requise' : 'No action required')}
            </p>
            <p className="text-[12.5px] text-text-tertiary mt-0.5">
              {o ? `${o.disputes.open_count} ${fr ? 'litige(s)' : 'dispute(s)'}` : (fr ? '0 litige' : '0 disputes')}
            </p>
          </div>
          {bouton(fr ? 'Voir' : 'View Disputes')}
        </div>
      </Carte>

      <Carte titre={fr ? 'Taux de traitement' : 'Processing rates'}>
        <div className="px-5 pb-4 pt-1">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-text-secondary">{fr ? 'Cartes de crédit / débit' : 'Credit / Debit cards'}</span>
            <span className="font-semibold text-text-primary">2,9 % + 30 ¢</span>
          </div>
          <ul className="flex flex-wrap gap-1.5 mt-3" aria-label={fr ? 'Moyens de paiement acceptés' : 'Accepted payment methods'}>
            {['VISA', 'Mastercard', 'AMEX', 'Apple Pay', 'Google Pay'].map((m) => (
              <li key={m} className="rounded border border-outline bg-surface-secondary px-1.5 py-0.5 text-[10.5px] font-bold tracking-wide text-text-secondary">{m}</li>
            ))}
          </ul>
          <p className="text-[11.5px] text-text-tertiary mt-3">{fr ? 'Aucun frais mensuel. Vous payez seulement quand vous êtes payé.' : 'No monthly fees. You only pay when you get paid.'}</p>
        </div>
      </Carte>
    </div>
  );
}

// ── Rappels de paiement ──

function CarteRappels({ admin }: { admin: boolean }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const baseId = React.useId();
  const [reglages, setReglages] = React.useState<ReminderSettings | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    fetchReminderSettings().then(setReglages).catch((err: any) => console.error('[PaymentSettings] rappels non chargés :', err?.message));
  }, []);

  function majSchedule(next: ScheduleEntry[]) {
    if (!reglages) return;
    setReglages({ ...reglages, schedule: next });
    setDirty(true);
  }

  async function basculer(enabled: boolean) {
    if (!reglages) return;
    setSaving(true);
    try { setReglages(await updateReminderSettings({ enabled })); }
    catch (err: any) { toast.error(err?.message || (fr ? 'Réglage non enregistré.' : 'Setting not saved.')); }
    finally { setSaving(false); }
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
    } finally { setSaving(false); }
  }

  const canaux: Array<{ v: ReminderChannel; l: string }> = [
    { v: 'email', l: fr ? 'Courriel' : 'Email' },
    { v: 'sms', l: 'SMS' },
    { v: 'both', l: fr ? 'Courriel + SMS' : 'Email + SMS' },
  ];
  const champ = 'rounded-md border border-outline bg-surface-card px-2 py-1 text-[13px] text-text-primary';

  return (
    <Carte
      titre={fr ? 'Rappels de paiement' : 'Payment reminders'}
      sousTitre={fr ? 'Relances automatiques des factures en retard, avec le lien de paiement.' : 'Automatic follow-ups on overdue invoices, with the payment link.'}
      action={reglages ? <Interrupteur actif={reglages.enabled} label={fr ? 'Rappels de paiement' : 'Payment reminders'} disabled={!admin || saving} onChange={basculer} /> : undefined}
    >
      {reglages && (
        <div className="pt-2">
          {reglages.schedule.map((e, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 px-5 py-2.5 border-t border-outline text-[13px]">
              <label htmlFor={`${baseId}-jours-${i}`} className="text-text-secondary">{fr ? 'Après' : 'After'}</label>
              <input id={`${baseId}-jours-${i}`} type="number" min={0} max={365} disabled={!admin || saving} value={e.days_after_due}
                onChange={(ev) => majSchedule(reglages.schedule.map((x, j) => j === i ? { ...x, days_after_due: Number(ev.target.value) } : x))}
                className={cn(champ, 'w-16')} />
              <span className="text-text-secondary">{fr ? 'jour(s) de retard, par' : 'day(s) overdue, via'}</span>
              <select aria-label={fr ? 'Canal du rappel' : 'Reminder channel'} disabled={!admin || saving} value={e.channel}
                onChange={(ev) => majSchedule(reglages.schedule.map((x, j) => j === i ? { ...x, channel: ev.target.value as ReminderChannel } : x))}
                className={champ}>
                {canaux.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
              {admin && (
                <button type="button" aria-label={fr ? 'Retirer ce rappel' : 'Remove this reminder'} disabled={saving}
                  onClick={() => majSchedule(reglages.schedule.filter((_, j) => j !== i))}
                  className="ml-auto text-text-tertiary hover:text-red-600">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          {admin && (
            <div className="flex items-center gap-3 px-5 py-3 border-t border-outline">
              <button type="button" disabled={saving || reglages.schedule.length >= 20}
                onClick={() => majSchedule([...reglages.schedule, { days_after_due: 7, channel: 'email' }])}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-primary hover:underline">
                <Plus size={13} /> {fr ? 'Ajouter un rappel' : 'Add a reminder'}
              </button>
              {dirty && (
                <button type="button" disabled={saving} onClick={enregistrer} className="ml-auto glass-button bg-primary text-white text-[12.5px]">
                  {saving ? (fr ? 'Enregistrement…' : 'Saving…') : (fr ? 'Enregistrer' : 'Save')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Carte>
  );
}

// ── SMS 2FA — sécurité des actions de paiement ──
// Risk-based, payments-scoped: owners verify a mobile number; sensitive payment
// actions on a new device then require an SMS code (device trusted 30 days).
function CarteSecurite() {
  const { language } = useTranslation();
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
      <Carte className="p-5">
        <SmsStepUp mode="enroll" onDone={() => { setShowStepUp(false); load(); }} onCancel={() => setShowStepUp(false)} />
      </Carte>
    );
  }

  const enrolled = !!status?.enrolled;
  const smsOff = !!status && !status.sms_configured;

  return (
    <Carte titre={fr ? 'Sécurité' : 'Security'}>
      <div className="pt-1 pb-1">
        <Ligne
          icone={<Shield size={16} className={enrolled ? 'text-green-600' : undefined} />}
          titre={fr ? 'Vérification par SMS' : 'SMS verification'}
          description={<>
            {fr ? 'Requise pour les actions de paiement sur un nouvel appareil.' : 'Required for payment actions on a new device.'}
            {enrolled && status?.phone_hint ? ` · •••• ${status.phone_hint}` : ''}
          </>}
        >
          {status === null && statusFailed ? (
            <span className="text-[12px] text-text-tertiary">—</span>
          ) : status === null ? (
            <Loader2 size={14} className="animate-spin text-text-tertiary" />
          ) : smsOff ? (
            <span className="text-[12px] text-text-tertiary">{fr ? 'SMS non configuré' : 'SMS not configured'}</span>
          ) : enrolled ? (
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-green-700 bg-green-100 rounded-full px-2.5 py-1"><Check size={10} /> {fr ? 'Actif' : 'Active'}</span>
              <button onClick={() => setShowStepUp(true)} className="text-[12.5px] font-medium text-text-secondary hover:underline">{fr ? 'Changer' : 'Change'}</button>
            </div>
          ) : (
            <button onClick={() => setShowStepUp(true)} className="glass-button text-[12.5px] font-medium">{fr ? 'Configurer' : 'Set up'}</button>
          )}
        </Ligne>
      </div>
    </Carte>
  );
}

// ── En-tête ──

function EnTete({ connecte, fr }: { connecte: boolean; fr: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div>
          <h1 className="text-[22px] font-bold text-text-primary tracking-tight leading-tight">Lume Payments</h1>
          <p className="text-[13px] text-text-tertiary">{fr ? 'Acceptez les paiements en ligne de vos clients.' : 'Accept online payments from your clients.'}</p>
        </div>
      </div>
      {connecte && (
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-300 rounded-full px-3 py-1 whitespace-nowrap">
          <Check size={12} /> {fr ? 'Actif' : 'Active'}
        </span>
      )}
    </div>
  );
}

export default function PaymentSettings() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const { role } = usePermissions();
  const admin = role === 'owner' || role === 'admin';
  // Même clé que ConnectOnboarding : une seule requête partagée.
  const statut = useQuery({ queryKey: ['connectAccountStatus'], queryFn: getAccountStatus, refetchInterval: 30_000 });
  const connecte = Boolean(statut.data?.connected && statut.data?.account?.charges_enabled);
  const ctl = useReglages();

  return (
    // settings.read: matches the /settings/payments route gate. (Connect
    // activation and every write stay admin-gated server-side.)
    <PermissionGate permission="settings.read">
      <div className="max-w-5xl space-y-5">
        <EnTete connecte={connecte} fr={fr} />

        {/* Activation / configuration Stripe : pleine largeur tant que le compte n'accepte pas les paiements. */}
        {!connecte && <ConnectOnboarding />}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_290px] gap-5 items-start">
          <div className="space-y-5 min-w-0">
            <CartePortailClient ctl={ctl} admin={admin} />
            <CarteNotifications ctl={ctl} admin={admin} />
            <CarteRappels admin={admin} />
            <CarteSecurite />
            <CarteDesactiver ctl={ctl} admin={admin} />
          </div>
          <ColonneVersements connecte={connecte} admin={admin} />
        </div>
      </div>
    </PermissionGate>
  );
}
