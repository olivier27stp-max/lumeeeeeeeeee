// Panneau « Synchronisation » de QuickBooks (fenêtre Connexions) : ce qui est
// parti, ce qui attend, ce qui a échoué, et les correspondances comptables.
// Tout choix laissé à « Automatique » est résolu par le worker serveur
// (server/lib/quickbooks/sync.ts).
import React, { useCallback, useEffect, useId, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Clock, History, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  getQboSyncOptions,
  getQboSyncStatus,
  retryQboSync,
  runQboSyncNow,
  saveQboSyncSettings,
  sendQboHistory,
  QboSyncForbidden,
  QboSyncUnavailable,
  type QboMethodKey,
  type QboSyncOptions,
  type QboSyncSettings,
  type QboSyncStatus,
} from '../../lib/quickbooksSyncApi';

const METHODS: { key: QboMethodKey; fr: string; en: string }[] = [
  { key: 'card', fr: 'Carte de crédit', en: 'Credit card' },
  { key: 'e-transfer', fr: 'Virement Interac', en: 'Interac e-transfer' },
  { key: 'cash', fr: 'Comptant', en: 'Cash' },
  { key: 'check', fr: 'Chèque', en: 'Cheque' },
  { key: 'bank', fr: 'Virement bancaire', en: 'Bank transfer' },
  { key: 'paypal', fr: 'PayPal', en: 'PayPal' },
];

function firstOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

export default function QuickBooksSyncPanel({ isFr }: { isFr: boolean }) {
  const idActive = useId();
  const [status, setStatus] = useState<QboSyncStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const loadedOnce = React.useRef(false);
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<QboSyncOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [historyFrom, setHistoryFrom] = useState(firstOfYear());

  const load = useCallback(async () => {
    try {
      setStatus(await getQboSyncStatus());
      setUnavailable(false);
    } catch (err) {
      if (err instanceof QboSyncUnavailable) setUnavailable(true);
      else if (err instanceof QboSyncForbidden) setForbidden(true);
      // Rafraîchissement toutes les 15 s : on ne répète pas la même erreur.
      else if (!loadedOnce.current) toast.error(err instanceof Error ? err.message : 'Erreur');
    } finally {
      loadedOnce.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (forbidden) return;
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load, forbidden]);

  useEffect(() => {
    if (!showSettings || options) return;
    getQboSyncOptions()
      .then((o) => {
        setOptions(o);
        setOptionsError(null);
      })
      .catch((err) => setOptionsError(err instanceof Error ? err.message : 'Erreur'));
  }, [showSettings, options]);

  const save = async (patch: Partial<QboSyncSettings>) => {
    setBusy('save');
    try {
      const { settings } = await saveQboSyncSettings(patch);
      setStatus((s) => (s ? { ...s, settings } : s));
      toast.success(isFr ? 'Réglage enregistré' : 'Setting saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(null);
    }
  };

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      toast.success(await fn());
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-text-tertiary">
        <Loader2 size={12} className="animate-spin" /> {isFr ? 'Chargement de la synchronisation…' : 'Loading sync…'}
      </div>
    );
  }

  if (forbidden) {
    return (
      <p className="text-[12px] text-text-tertiary">
        {isFr
          ? 'Les factures et paiements sont synchronisés automatiquement. Seuls le propriétaire et les administrateurs voient le détail et les réglages.'
          : 'Invoices and payments sync automatically. Only the owner and admins can see details and settings.'}
      </p>
    );
  }

  if (unavailable || !status) {
    return (
      <div className="p-3 rounded-xl border border-warning/20 bg-warning/5 text-[12px] text-text-secondary">
        {isFr
          ? 'La synchronisation des factures et paiements est en cours d’activation sur le serveur. Votre connexion est enregistrée ; les envois démarreront dès l’activation.'
          : 'Invoice and payment sync is being enabled on the server. Your connection is saved; syncing starts as soon as it is enabled.'}
      </div>
    );
  }

  const { settings, counts, recent } = status;
  const errors = recent.filter((r) => r.status === 'error');
  const selectCls = 'glass-input w-full !text-[12px] !py-1.5';

  const pick = (list: { id: string; name: string }[] | undefined, id: string) => list?.find((o) => o.id === id)?.name ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">
          {isFr ? 'Synchronisation' : 'Sync'}
        </p>
        <label htmlFor={idActive} className="flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer">
          <input
            id={idActive}
            type="checkbox"
            checked={settings.enabled}
            disabled={busy === 'save'}
            onChange={(e) => save({ enabled: e.target.checked })}
          />
          {isFr ? 'Active' : 'Enabled'}
        </label>
      </div>

      <p className="text-[12px] text-text-secondary leading-relaxed">
        {isFr
          ? 'Chaque facture envoyée est créée dans QuickBooks avec son client. Chaque paiement y est enregistré avec son moyen de paiement et lié à la facture : elle passe « Payée » dans QuickBooks en même temps que dans Lume.'
          : 'Every sent invoice is created in QuickBooks with its customer. Every payment is recorded there with its payment method and linked to the invoice, so it turns “Paid” in QuickBooks at the same time as in Lume.'}
        {settings.sync_from && (
          <span className="text-text-tertiary">
            {' '}
            {isFr ? 'Depuis le ' : 'Since '}
            {new Date(settings.sync_from).toLocaleDateString(isFr ? 'fr-CA' : 'en-CA')}.
          </span>
        )}
      </p>

      <div className="grid grid-cols-3 gap-2">
        <div className="p-2.5 rounded-xl border border-outline-subtle/60">
          <p className="text-[18px] font-bold text-text-primary">{counts.done24h}</p>
          <p className="text-[11px] text-text-tertiary flex items-center gap-1">
            <Check size={10} className="text-success" /> {isFr ? 'Envoyés (24 h)' : 'Sent (24h)'}
          </p>
        </div>
        <div className="p-2.5 rounded-xl border border-outline-subtle/60">
          <p className="text-[18px] font-bold text-text-primary">{counts.pending}</p>
          <p className="text-[11px] text-text-tertiary flex items-center gap-1">
            <Clock size={10} /> {isFr ? 'En attente' : 'Pending'}
          </p>
        </div>
        <div className={`p-2.5 rounded-xl border ${counts.errors ? 'border-danger/30 bg-danger/5' : 'border-outline-subtle/60'}`}>
          <p className={`text-[18px] font-bold ${counts.errors ? 'text-danger' : 'text-text-primary'}`}>{counts.errors}</p>
          <p className="text-[11px] text-text-tertiary flex items-center gap-1">
            <AlertTriangle size={10} /> {isFr ? 'Erreurs' : 'Errors'}
          </p>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="space-y-1.5">
          {errors.slice(0, 8).map((r) => (
            <div key={r.id} className="flex items-start gap-2 p-2 rounded-lg bg-danger/5 border border-danger/15">
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-text-primary truncate">{r.label || r.entity_type}</p>
                <p className="text-[11px] text-text-tertiary break-words">{r.last_error}</p>
              </div>
              <button
                onClick={() => act(`retry-${r.id}`, async () => {
                  await retryQboSync(r.id);
                  return isFr ? 'Relancé' : 'Retried';
                })}
                disabled={!!busy}
                className="glass-button !text-[11px] !px-2 !py-1 shrink-0"
              >
                {busy === `retry-${r.id}` ? <Loader2 size={11} className="animate-spin" /> : isFr ? 'Réessayer' : 'Retry'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => act('run', async () => {
            const r = await runQboSyncNow();
            return isFr ? `${r.processed} envoi(s) traité(s)` : `${r.processed} item(s) processed`;
          })}
          disabled={!!busy}
          className="glass-button !text-[12px] inline-flex items-center gap-1.5"
        >
          {busy === 'run' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {isFr ? 'Synchroniser maintenant' : 'Sync now'}
        </button>
        {counts.errors > 0 && (
          <button
            onClick={() => act('retry-all', async () => {
              const r = await retryQboSync();
              return isFr ? `${r.retried} envoi(s) relancé(s)` : `${r.retried} item(s) retried`;
            })}
            disabled={!!busy}
            className="glass-button !text-[12px] inline-flex items-center gap-1.5"
          >
            {busy === 'retry-all' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {isFr ? 'Tout réessayer' : 'Retry all'}
          </button>
        )}
      </div>

      <div className="p-3 rounded-xl border border-outline-subtle/60 space-y-2">
        <p className="text-[12px] font-semibold text-text-primary flex items-center gap-1.5">
          <History size={12} /> {isFr ? 'Envoyer l’historique' : 'Send history'}
        </p>
        <p className="text-[11px] text-text-tertiary">
          {isFr
            ? 'Les factures antérieures au branchement ne partent pas d’office. Choisissez une date de départ : les factures (et leurs paiements) déjà présentes dans QuickBooks avec le même numéro et le même client sont reprises, pas dupliquées.'
            : 'Invoices older than the connection are not sent automatically. Pick a start date: invoices (and their payments) already in QuickBooks with the same number and customer are matched, not duplicated.'}
        </p>
        <div className="flex items-center gap-2">
          <input
            type="date"
            aria-label={isFr ? 'Date de départ de l’historique' : 'History start date'}
            value={historyFrom}
            onChange={(e) => setHistoryFrom(e.target.value)}
            className="glass-input !text-[12px] !py-1.5"
          />
          <button
            onClick={() => act('history', async () => {
              const r = await sendQboHistory(historyFrom);
              return isFr ? `${r.queued} facture(s) mise(s) en file` : `${r.queued} invoice(s) queued`;
            })}
            disabled={!!busy || !historyFrom}
            className="glass-button !text-[12px] inline-flex items-center gap-1.5"
          >
            {busy === 'history' ? <Loader2 size={12} className="animate-spin" /> : null}
            {isFr ? 'Envoyer' : 'Send'}
          </button>
        </div>
      </div>

      <div>
        <button
          onClick={() => setShowSettings((v) => !v)}
          className="flex items-center gap-1 text-[12px] font-semibold text-text-secondary hover:text-text-primary"
        >
          {showSettings ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {isFr ? 'Correspondances comptables' : 'Accounting mapping'}
        </button>

        {showSettings && (
          <div className="mt-3 space-y-3">
            {!options && !optionsError && (
              <div className="flex items-center gap-2 text-[12px] text-text-tertiary">
                <Loader2 size={12} className="animate-spin" /> {isFr ? 'Lecture de QuickBooks…' : 'Reading QuickBooks…'}
              </div>
            )}
            {optionsError && <p className="text-[12px] text-danger">{optionsError}</p>}
            {options && (
              <>
                <Field label={isFr ? 'Produit/service des lignes' : 'Line product/service'}>
                  <select
                    aria-label={isFr ? 'Produit/service des lignes' : 'Line product/service'}
                    className={selectCls}
                    value={settings.item_id || ''}
                    disabled={busy === 'save'}
                    onChange={(e) => save({ item_id: e.target.value || null, item_name: pick(options.items, e.target.value) })}
                  >
                    <option value="">{isFr ? 'Automatique (« Services »)' : 'Automatic (“Services”)'}</option>
                    {options.items.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </Field>

                <Field label={isFr ? 'Dépôt des paiements manuels' : 'Deposit for manual payments'}>
                  <select
                    aria-label={isFr ? 'Dépôt des paiements manuels' : 'Deposit for manual payments'}
                    className={selectCls}
                    value={settings.deposit_account_id || ''}
                    disabled={busy === 'save'}
                    onChange={(e) => save({ deposit_account_id: e.target.value || null, deposit_account_name: pick(options.depositAccounts, e.target.value) })}
                  >
                    <option value="">{isFr ? 'Fonds non déposés (par défaut)' : 'Undeposited Funds (default)'}</option>
                    {options.depositAccounts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </Field>

                <Field label={isFr ? 'Dépôt des paiements en ligne (Stripe, PayPal)' : 'Deposit for online payments (Stripe, PayPal)'}>
                  <select
                    aria-label={isFr ? 'Dépôt des paiements en ligne (Stripe, PayPal)' : 'Deposit for online payments (Stripe, PayPal)'}
                    className={selectCls}
                    value={settings.deposit_account_online_id || ''}
                    disabled={busy === 'save'}
                    onChange={(e) => save({ deposit_account_online_id: e.target.value || null, deposit_account_online_name: pick(options.depositAccounts, e.target.value) })}
                  >
                    <option value="">{isFr ? 'Même compte que les manuels' : 'Same as manual payments'}</option>
                    {options.depositAccounts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </Field>

                {options.taxCodes.length > 0 && (
                  <>
                    <Field label={isFr ? 'Code de taxe des factures taxables' : 'Tax code for taxable invoices'}>
                      <select
                        aria-label={isFr ? 'Code de taxe des factures taxables' : 'Tax code for taxable invoices'}
                        className={selectCls}
                        value={settings.tax_code_taxable_id || ''}
                        disabled={busy === 'save'}
                        onChange={(e) => save({ tax_code_taxable_id: e.target.value || null })}
                      >
                        <option value="">{isFr ? 'Automatique (même taux que la facture)' : 'Automatic (same rate as the invoice)'}</option>
                        {options.taxCodes.map((o) => <option key={o.id} value={o.id}>{o.name} — {o.rate} %</option>)}
                      </select>
                    </Field>
                    <Field label={isFr ? 'Code de taxe des factures sans taxe' : 'Tax code for untaxed invoices'}>
                      <select
                        aria-label={isFr ? 'Code de taxe des factures sans taxe' : 'Tax code for untaxed invoices'}
                        className={selectCls}
                        value={settings.tax_code_exempt_id || ''}
                        disabled={busy === 'save'}
                        onChange={(e) => save({ tax_code_exempt_id: e.target.value || null })}
                      >
                        <option value="">{isFr ? 'Automatique (« Exonéré »)' : 'Automatic (“Exempt”)'}</option>
                        {options.taxCodes.map((o) => <option key={o.id} value={o.id}>{o.name} — {o.rate} %</option>)}
                      </select>
                    </Field>
                  </>
                )}

                <div>
                  <p className="text-[11px] font-semibold text-text-secondary mb-1.5">
                    {isFr ? 'Moyens de paiement' : 'Payment methods'}
                  </p>
                  <div className="space-y-1.5">
                    {METHODS.map((m) => (
                      <div key={m.key} className="flex items-center gap-2">
                        <span className="text-[12px] text-text-secondary w-36 shrink-0">{isFr ? m.fr : m.en}</span>
                        <select
                          aria-label={isFr ? m.fr : m.en}
                          className={selectCls}
                          value={settings.payment_methods?.[m.key]?.id || ''}
                          disabled={busy === 'save'}
                          onChange={(e) => {
                            const next = { ...(settings.payment_methods || {}) };
                            const name = pick(options.paymentMethods, e.target.value);
                            if (e.target.value && name) next[m.key] = { id: e.target.value, name };
                            else delete next[m.key];
                            void save({ payment_methods: next });
                          }}
                        >
                          <option value="">{isFr ? 'Automatique (créé au besoin)' : 'Automatic (created if missing)'}</option>
                          {options.paymentMethods.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Une étiquette RELIÉE à son champ (htmlFor + id), comme l'exige l'accessibilité. */
function Field({ label, children }: { label: string; children: React.ReactElement<{ id?: string }> }) {
  const id = useId();
  return (
    <div className="block">
      <label htmlFor={id} className="text-[11px] font-semibold text-text-secondary">{label}</label>
      <div className="mt-1">{React.cloneElement(children, { id })}</div>
    </div>
  );
}
