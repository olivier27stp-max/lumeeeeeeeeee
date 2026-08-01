import React, { useEffect, useState } from 'react';
import { Users, AlertTriangle, Check, Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { fetchSeatUsage, setExtraSeats, type SeatUsage } from '../lib/billingApi';

interface SeatsBannerProps {
  /** Called when seats state changes so parent can refresh billing data */
  onChange?: () => void;
}

/**
 * Shows the org's seat usage vs the plan limit.
 * If the org is over its included seats, surfaces an inline action to
 * sync the extra-seats billing (charged immediately via Stripe proration).
 */
export default function SeatsBanner({ onChange }: SeatsBannerProps) {
  const { language } = useTranslation();
  const isFr = language === 'fr';
  const navigate = useNavigate();
  const [usage, setUsage] = useState<SeatUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchSeatUsage()
      .then(setUsage)
      .catch(() => setUsage(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!usage || usage.included === 0) return null;

  const needed = Math.max(0, usage.used - usage.included);
  const isOverLimit = needed > 0;
  const billingMismatch = needed !== usage.extras_charged;
  const extraPrice = usage.extra_price_cents / 100;
  const monthlyCost = extraPrice * needed;

  // Within limit — show a discreet usage indicator
  if (!isOverLimit) {
    const utilization = Math.round((usage.used / usage.included) * 100);
    return (
      <div className="rounded-2xl p-4 bg-surface-card border border-outline-subtle">
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <Users size={15} className="text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-semibold text-text-primary">
                {usage.used} / {usage.included} {isFr ? 'sièges utilisés' : 'seats used'}
              </p>
              <button
                type="button"
                onClick={() => navigate('/settings/team')}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                <UserPlus size={11} />
                {isFr ? 'Inviter un membre' : 'Invite a member'}
              </button>
            </div>
            <div className="mt-1.5 h-1.5 bg-surface-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, utilization)}%` }}
              />
            </div>
          </div>
          <span className="text-[11px] font-bold text-text-tertiary tabular-nums">{utilization}%</span>
        </div>
      </div>
    );
  }

  // Over limit but already billed correctly — informational
  if (!billingMismatch) {
    return (
      <div className="rounded-2xl p-4 bg-amber-500/5 border border-amber-500/20">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center mt-0.5">
            <Users size={15} className="text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[13px] font-semibold text-text-primary">
                {usage.used} / {usage.included} {isFr ? 'sièges' : 'seats'} · +{needed} {isFr ? 'supplémentaires facturés' : 'extra billed'}
              </p>
              <button
                type="button"
                onClick={() => navigate('/settings/team')}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                <UserPlus size={11} />
                {isFr ? 'Inviter un membre' : 'Invite a member'}
              </button>
            </div>
            <p className="text-[12px] text-text-secondary mt-0.5">
              {isFr
                ? `Vous payez $${monthlyCost.toFixed(0)}/mois supplémentaire pour vos sièges en plus.`
                : `You're paying $${monthlyCost.toFixed(0)}/mo extra for the additional seats.`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Over limit and billing not synced — actionable
  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await setExtraSeats(needed);
      if (result.no_change) {
        toast.success(isFr ? 'Déjà synchronisé' : 'Already in sync');
      } else if (result.no_stripe) {
        toast.success(isFr ? 'Sièges mis à jour' : 'Seats updated');
      } else {
        toast.success(
          isFr
            ? `+${needed} sièges activés · facturé maintenant`
            : `+${needed} extra seats added · billed now`,
          { duration: 5000 },
        );
      }
      const fresh = await fetchSeatUsage();
      setUsage(fresh);
      onChange?.();
    } catch (err: any) {
      toast.error(err.message || (isFr ? 'Échec de la synchronisation' : 'Sync failed'));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="rounded-2xl p-5 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border-2 border-amber-500/30">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center mt-0.5">
          <AlertTriangle size={18} className="text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold text-text-primary">
            {isFr
              ? `${needed} ${needed === 1 ? 'siège' : 'sièges'} au-delà de votre limite`
              : `${needed} ${needed === 1 ? 'seat' : 'seats'} over your plan limit`}
          </p>
          <p className="text-[12px] text-text-secondary mt-1 leading-relaxed">
            {isFr
              ? `Votre plan inclut ${usage.included} sièges. Vous utilisez actuellement ${usage.used}. Activez la facturation des sièges supplémentaires pour ${needed} membre${needed === 1 ? '' : 's'} à +$${extraPrice}/${isFr ? 'mois' : 'mo'} chacun.`
              : `Your plan includes ${usage.included} seats. You're currently using ${usage.used}. Enable extra-seat billing for ${needed} member${needed === 1 ? '' : 's'} at +$${extraPrice}/mo each.`}
          </p>

          {/* Price summary */}
          <div className="mt-3 p-3 rounded-xl bg-surface-card border border-outline-subtle">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider font-bold text-text-tertiary">
                  {isFr ? 'Coût supplémentaire' : 'Additional cost'}
                </p>
                <p className="text-xl font-extrabold text-text-primary tabular-nums mt-0.5">
                  +${monthlyCost.toFixed(0)}<span className="text-xs font-normal text-text-tertiary">/{isFr ? 'mois' : 'mo'}</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider font-bold text-text-tertiary">
                  {isFr ? 'Détail' : 'Detail'}
                </p>
                <p className="text-[11px] text-text-secondary tabular-nums">
                  {needed} × ${extraPrice}/{isFr ? 'mois' : 'mo'}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-col-reverse sm:flex-row gap-2">
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-extrabold bg-text-primary text-surface hover:bg-text-primary/90 active:scale-[0.98] transition-all shadow-md disabled:opacity-60"
            >
              {syncing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
              {syncing
                ? (isFr ? 'Activation...' : 'Activating...')
                : (isFr ? `Activer & facturer maintenant` : `Activate & bill now`)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
