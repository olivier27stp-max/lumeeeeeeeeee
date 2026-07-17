import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CreditCard, ExternalLink, CheckCircle2, AlertTriangle, Loader2, RefreshCw, Shield, Landmark } from 'lucide-react';
import { getAccountStatus, createConnectedAccount, createOnboardingLink, refreshOnboardingLink, createDashboardLink } from '../lib/connectApi';
import { useTranslation } from '../i18n';
import type { ConnectedAccount } from '../types';

export default function ConnectOnboarding() {
  const queryClient = useQueryClient();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [creating, setCreating] = useState(false);
  const [openingDashboard, setOpeningDashboard] = useState(false);
  const [, setOnboardingUrl] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const statusQuery = useQuery({
    queryKey: ['connectAccountStatus'],
    queryFn: getAccountStatus,
    refetchInterval: 30_000,
  });

  // Retour de l'onboarding Stripe (?onboarding=complete|refresh) : refetch
  // immédiat + feedback, puis on nettoie l'URL. Sans ça, l'utilisateur
  // retombait sur un statut périmé jusqu'au refetch de 30s.
  React.useEffect(() => {
    const flag = searchParams.get('onboarding');
    if (!flag) return;
    queryClient.invalidateQueries({ queryKey: ['connectAccountStatus'] });
    if (flag === 'complete') {
      toast.success(fr
        ? 'Configuration Stripe terminée — mise à jour du statut…'
        : 'Stripe setup finished — refreshing status…');
    } else if (flag === 'refresh') {
      toast.info(fr
        ? 'Le lien Stripe a expiré. Cliquez sur « Continuer la configuration » pour en obtenir un nouveau.'
        : 'The Stripe link expired. Click "Continue setup" to get a fresh one.');
    }
    searchParams.delete('onboarding');
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const account = statusQuery.data?.account;
  const isConnected = statusQuery.data?.connected;

  async function handleActivate() {
    setCreating(true);
    try {
      await createConnectedAccount();
      const link = await createOnboardingLink();
      setOnboardingUrl(link.url);
      window.open(link.url, '_blank');
      queryClient.invalidateQueries({ queryKey: ['connectAccountStatus'] });
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Échec de l\'activation des paiements.' : 'Failed to activate payments.'));
    } finally {
      setCreating(false);
    }
  }

  async function handleContinueOnboarding() {
    try {
      const link = await refreshOnboardingLink();
      setOnboardingUrl(link.url);
      window.open(link.url, '_blank');
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Impossible d\'obtenir le lien de configuration.' : 'Failed to get onboarding link.'));
    }
  }

  async function handleOpenDashboard() {
    setOpeningDashboard(true);
    try {
      const { url } = await createDashboardLink();
      window.open(url, '_blank');
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Impossible d\'ouvrir le tableau de bord des versements.' : 'Failed to open the payouts dashboard.'));
    } finally {
      setOpeningDashboard(false);
    }
  }

  async function handleRefreshStatus() {
    await queryClient.invalidateQueries({ queryKey: ['connectAccountStatus'] });
    toast.success(fr ? 'Statut actualisé.' : 'Status refreshed.');
  }

  // ── Not connected — show activation ──
  if (!isConnected) {
    return (
      <div className="section-card p-6">
        <div className="flex items-start gap-4">
          <div className="icon-tile icon-tile-blue">
            <CreditCard size={18} />
          </div>
          <div className="flex-1">
            <h3 className="text-[15px] font-bold text-text-primary">Lume Payments</h3>
            <p className="mt-1 text-[13px] text-text-secondary">
              {fr
                ? 'Acceptez les paiements en ligne de vos clients. Lume s\'associe à Stripe pour traiter les paiements par carte en toute sécurité et déposer les fonds directement dans votre compte bancaire.'
                : 'Accept online payments from your clients. Lume partners with Stripe to securely process card payments and deposit funds directly to your bank account.'}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="glass-button bg-primary text-white hover:bg-neutral-800 inline-flex items-center gap-2"
                onClick={handleActivate}
                disabled={creating || statusQuery.isLoading}
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
                {creating
                  ? (fr ? 'Préparation…' : 'Setting up...')
                  : (fr ? 'Activer Lume Payments' : 'Activate Lume Payments')}
              </button>
            </div>

            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-text-tertiary">
              <Shield size={11} />
              <span>
                {fr
                  ? 'Propulsé par Stripe. Vos données financières sont chiffrées et sécurisées.'
                  : 'Powered by Stripe. Your financial data is encrypted and secure.'}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Connected but onboarding incomplete ──
  if (!account?.onboarding_complete || !account?.charges_enabled) {
    return (
      <div className="section-card border-amber-200 dark:border-amber-800 p-6">
        <div className="flex items-start gap-4">
          <div className="icon-tile icon-tile-amber">
            <AlertTriangle size={18} />
          </div>
          <div className="flex-1">
            <h3 className="text-[15px] font-bold text-text-primary">
              {fr ? 'Terminez votre configuration' : 'Complete Your Setup'}
            </h3>
            <p className="mt-1 text-[13px] text-text-secondary">
              {fr
                ? 'Votre compte de paiement a été créé, mais la configuration n\'est pas terminée. Complétez-la pour commencer à accepter les paiements.'
                : 'Your payment account has been created but onboarding is not yet complete. Please finish setting up your account to start accepting payments.'}
            </p>

            <OnboardingChecklist account={account!} fr={fr} />

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="glass-button bg-amber-600 text-white hover:bg-amber-700 inline-flex items-center gap-2"
                onClick={handleContinueOnboarding}
              >
                <ExternalLink size={14} />
                {fr ? 'Continuer la configuration' : 'Continue Setup'}
              </button>
              <button
                type="button"
                className="glass-button inline-flex items-center gap-1.5 text-[12px]"
                onClick={handleRefreshStatus}
              >
                <RefreshCw size={12} />
                {fr ? 'Actualiser le statut' : 'Refresh Status'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Fully connected and ready ──
  return (
    <div className="section-card border-green-200 dark:border-green-800 p-6">
      <div className="flex items-start gap-4">
        <div className="icon-tile icon-tile-green">
          <CheckCircle2 size={18} />
        </div>
        <div className="flex-1">
          <h3 className="text-[15px] font-bold text-text-primary">
            {fr ? 'Lume Payments actif' : 'Lume Payments Active'}
          </h3>
          <p className="mt-1 text-[13px] text-text-secondary">
            {fr
              ? 'Votre compte de paiement est prêt. Vous pouvez maintenant envoyer des demandes de paiement à vos clients.'
              : 'Your payment account is fully set up. You can now send payment requests to your clients.'}
          </p>

          <OnboardingChecklist account={account!} fr={fr} />

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="glass-button bg-primary text-white hover:bg-neutral-800 inline-flex items-center gap-2 text-[12px]"
              onClick={handleOpenDashboard}
              disabled={openingDashboard}
            >
              {openingDashboard ? <Loader2 size={13} className="animate-spin" /> : <Landmark size={13} />}
              {openingDashboard
                ? (fr ? 'Ouverture…' : 'Opening…')
                : (fr ? 'Versements & compte bancaire' : 'Payouts & bank account')}
            </button>
            <button
              type="button"
              className="glass-button inline-flex items-center gap-1.5 text-[12px]"
              onClick={handleRefreshStatus}
            >
              <RefreshCw size={12} />
              {fr ? 'Actualiser le statut' : 'Refresh Status'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OnboardingChecklist({ account, fr }: { account: ConnectedAccount; fr: boolean }) {
  const items = [
    { label: fr ? 'Compte créé' : 'Account created', done: true },
    { label: fr ? 'Informations soumises' : 'Details submitted', done: account.details_submitted },
    { label: fr ? 'Paiements activés' : 'Charges enabled', done: account.charges_enabled },
    { label: fr ? 'Versements activés' : 'Payouts enabled', done: account.payouts_enabled },
  ];

  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2 text-[12px]">
          {item.done ? (
            <CheckCircle2 size={13} className="text-green-500 shrink-0" />
          ) : (
            <div className="w-[13px] h-[13px] rounded-full border-2 border-neutral-300 dark:border-neutral-600 shrink-0" />
          )}
          <span className={item.done ? 'text-text-primary' : 'text-text-tertiary'}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
