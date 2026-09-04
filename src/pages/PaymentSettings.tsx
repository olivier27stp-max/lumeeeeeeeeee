import React from 'react';
import { Check, Loader2, Shield } from 'lucide-react';
import { useTranslation } from '../i18n';
import PermissionGate from '../components/PermissionGate';
import ConnectOnboarding from '../components/ConnectOnboarding';
import SmsStepUp from '../components/auth/SmsStepUp';
import { getSmsStatus, type SmsStatus } from '../lib/mfaSmsApi';

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

  return (
    // settings.read: matches the /settings/payments route gate — the page used
    // to demand payments.create and showed "Access Restricted" to users the
    // route itself let in. (Connect activation stays admin-gated server-side.)
    <PermissionGate permission="settings.read">
      <div className="max-w-2xl space-y-6">
        <PaymentsHero language={language} />

        <ConnectOnboarding />

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
        </section>
      </div>
    </PermissionGate>
  );
}
