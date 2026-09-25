/**
 * Carte « Envoyer depuis mon adresse » (Paramètres → Paramètres entreprise).
 *
 * Trois états :
 *   vide      → champ Domaine + Activer
 *   pending   → les enregistrements DNS à coller (Type / Nom / Valeur, Copier
 *               par ligne) + Vérifier + statut
 *   verified  → « Vos courriels partent de facturation@domaine » + Retirer
 *
 * Tout passe par src/lib/sendingDomainApi.ts ; la logique et l'API Resend
 * vivent côté serveur.
 */
import React, { useCallback, useEffect, useId, useState } from 'react';
import { AtSign, Check, Copy, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';
import { cn } from '../../lib/utils';
import { confirmer } from '../ui/ConfirmDialog';
import { captureClientException } from '../../lib/sentry';
import {
  adresseExpedition,
  demanderDomaineEnvoi,
  lireDomaineEnvoi,
  retirerDomaineEnvoi,
  verifierDomaineEnvoi,
  type DomaineEnvoi,
} from '../../lib/sendingDomainApi';

export default function SendingDomainCard() {
  const { t, language } = useTranslation();
  const id = useId();
  const tc = t.companySettings;
  const [chargement, setChargement] = useState(true);
  const [fournisseurOk, setFournisseurOk] = useState(true);
  const [domaine, setDomaine] = useState<DomaineEnvoi | null>(null);
  const [saisie, setSaisie] = useState('');
  const [occupe, setOccupe] = useState<null | 'activer' | 'verifier' | 'retirer'>(null);
  const [copie, setCopie] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const etat = await lireDomaineEnvoi();
      setDomaine(etat.domain);
      setFournisseurOk(etat.providerConfigured);
    } catch (err: unknown) {
      console.error('[SendingDomainCard] chargement', err);
      captureClientException(err, { kind: 'sending_domain_load' });
      toast.error(tc.sendingDomainLoadFailed);
    } finally {
      setChargement(false);
    }
  }, [tc.sendingDomainLoadFailed]);

  useEffect(() => { void charger(); }, [charger]);

  async function activer(e: React.FormEvent) {
    e.preventDefault();
    if (!saisie.trim() || occupe) return;
    setOccupe('activer');
    try {
      const { domain } = await demanderDomaineEnvoi(saisie.trim());
      setDomaine(domain);
      setSaisie('');
      toast.success(tc.sendingDomainAdded);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : tc.sendingDomainError);
    } finally {
      setOccupe(null);
    }
  }

  async function verifier() {
    if (occupe) return;
    setOccupe('verifier');
    try {
      const { domain } = await verifierDomaineEnvoi();
      setDomaine(domain);
      if (domain.status === 'verified') toast.success(tc.sendingDomainVerifiedToast);
      else if (domain.status === 'failed') toast.error(tc.sendingDomainStatusFailed);
      else toast.info(tc.sendingDomainStillPending);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : tc.sendingDomainError);
    } finally {
      setOccupe(null);
    }
  }

  async function retirer() {
    if (occupe) return;
    if (!(await confirmer({ message: tc.sendingDomainRemoveConfirm, danger: true }))) return;
    setOccupe('retirer');
    try {
      await retirerDomaineEnvoi();
      setDomaine(null);
      toast.success(tc.sendingDomainRemoved);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : tc.sendingDomainError);
    } finally {
      setOccupe(null);
    }
  }

  async function copier(texte: string, cle: string) {
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(cle);
      setTimeout(() => setCopie((c) => (c === cle ? null : c)), 1500);
    } catch (err: unknown) {
      console.error('[SendingDomainCard] copie', err);
      toast.error(tc.sendingDomainCopyFailed);
    }
  }

  const statutLibelle = domaine?.status === 'verified'
    ? tc.sendingDomainStatusVerified
    : domaine?.status === 'failed'
      ? tc.sendingDomainStatusFailed
      : tc.sendingDomainStatusPending;

  return (
    <div className="section-card p-6 space-y-4">
      <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
        <AtSign size={12} /> {tc.sendingDomainTitle}
      </h3>

      {chargement ? (
        <div className="flex items-center gap-2 text-[13px] text-text-tertiary">
          <Loader2 size={14} className="animate-spin" /> {t.common.loading}
        </div>
      ) : !domaine ? (
        <form onSubmit={activer} className="space-y-3">
          <p className="text-[13px] text-text-secondary">{tc.sendingDomainIntro}</p>
          {!fournisseurOk && (
            <p className="text-[12px] text-amber-700 dark:text-amber-400">{tc.sendingDomainNotConfigured}</p>
          )}
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1">
              <label htmlFor={`${id}-domain`} className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                {tc.sendingDomainLabel}
              </label>
              <input
                id={`${id}-domain`}
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={saisie}
                onChange={(e) => setSaisie(e.target.value)}
                className="glass-input w-full mt-1"
                placeholder={tc.sendingDomainPlaceholder}
                disabled={!fournisseurOk}
              />
            </div>
            <button
              type="submit"
              disabled={!fournisseurOk || !saisie.trim() || occupe !== null}
              className="glass-button inline-flex items-center justify-center gap-1.5 !bg-primary !text-white !border-primary disabled:opacity-60"
            >
              {occupe === 'activer' ? <Loader2 size={13} className="animate-spin" /> : null}
              {occupe === 'activer' ? tc.sendingDomainActivating : tc.sendingDomainActivate}
            </button>
          </div>
        </form>
      ) : domaine.status === 'verified' ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 dark:border-emerald-800 dark:bg-emerald-900/30">
            <Check size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-text-primary break-all">
                {tc.sendingDomainVerifiedText.replace('{address}', adresseExpedition(domaine))}
              </p>
              <p className="text-[12px] text-text-tertiary">{tc.sendingDomainVerifiedHelp}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[12px] text-text-tertiary">
              {domaine.verified_at
                ? `${tc.sendingDomainStatusVerified} · ${new Date(domaine.verified_at).toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-CA')}`
                : tc.sendingDomainStatusVerified}
            </span>
            <button
              type="button"
              onClick={() => { void retirer(); }}
              disabled={occupe !== null}
              className="glass-button inline-flex items-center gap-1.5 text-[12px] text-red-600 dark:text-red-400"
            >
              {occupe === 'retirer' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              {tc.sendingDomainRemove}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-text-primary break-all">{domaine.domain}</p>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                domaine.status === 'failed'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
              )}
            >
              {statutLibelle}
            </span>
          </div>
          <p className="text-[13px] font-medium text-text-primary">{tc.sendingDomainPendingTitle}</p>
          <p className="text-[12px] text-text-tertiary">{tc.sendingDomainPendingHelp}</p>

          <div className="overflow-x-auto rounded-lg border border-outline">
            <table className="w-full text-[12px]">
              <thead className="bg-surface-muted/60 text-left text-text-tertiary">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">{tc.sendingDomainColType}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{tc.sendingDomainColName}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{tc.sendingDomainColValue}</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">{tc.sendingDomainCopy}</span></th>
                </tr>
              </thead>
              <tbody>
                {domaine.dns_records.map((r, i) => {
                  const cleNom = `${i}-name`;
                  const cleValeur = `${i}-value`;
                  return (
                    <tr key={`${r.type}-${r.name}-${i}`} className="border-t border-outline align-top">
                      <td className="px-3 py-2 font-mono whitespace-nowrap">
                        {r.type}
                        {r.priority != null ? <span className="ml-1 text-text-tertiary">({r.priority})</span> : null}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-start gap-1.5">
                          <code className="break-all">{r.name}</code>
                          <button
                            type="button"
                            onClick={() => { void copier(r.name, cleNom); }}
                            aria-label={`${tc.sendingDomainCopy} ${tc.sendingDomainColName} ${r.type}`}
                            className="shrink-0 rounded p-0.5 text-text-tertiary hover:text-text-primary"
                          >
                            {copie === cleNom ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-start gap-1.5">
                          <code className="break-all">{r.value}</code>
                          <button
                            type="button"
                            onClick={() => { void copier(r.value, cleValeur); }}
                            aria-label={`${tc.sendingDomainCopy} ${tc.sendingDomainColValue} ${r.type}`}
                            className="shrink-0 rounded p-0.5 text-text-tertiary hover:text-text-primary"
                          >
                            {copie === cleValeur ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-text-tertiary">
                        {r.status && r.status !== 'not_started' ? r.status : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[12px] text-text-tertiary">
              {domaine.last_checked_at
                ? `${tc.sendingDomainLastChecked} : ${new Date(domaine.last_checked_at).toLocaleString(language === 'fr' ? 'fr-CA' : 'en-CA')}`
                : ''}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { void retirer(); }}
                disabled={occupe !== null}
                className="glass-button inline-flex items-center gap-1.5 text-[12px]"
              >
                {occupe === 'retirer' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                {tc.sendingDomainRemove}
              </button>
              <button
                type="button"
                onClick={() => { void verifier(); }}
                disabled={occupe !== null}
                className="glass-button inline-flex items-center gap-1.5 text-[12px] !bg-primary !text-white !border-primary disabled:opacity-60"
              >
                {occupe === 'verifier' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {occupe === 'verifier' ? tc.sendingDomainVerifying : tc.sendingDomainVerify}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
