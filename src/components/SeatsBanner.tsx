import { useEffect, useState } from 'react';
import { Users, AlertTriangle, Check, Loader2, Minus, Plus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { fetchSeatUsage, setExtraSeats, type SeatUsage } from '../lib/billingApi';

interface SeatsBannerProps {
  /** Called when seats state changes so parent can refresh billing data */
  onChange?: () => void;
}

/**
 * Seat usage + self-serve extra-seat purchase for the billing page.
 * Mirrors OfficesManager: a stepper lets an admin buy (or drop) extra seats
 * at any time — not only once the org is already over its limit. Billing goes
 * through POST /billing/seats (immediate Stripe proration when the sub is
 * linked; DB-only fallback otherwise).
 */
export default function SeatsBanner({ onChange }: SeatsBannerProps) {
  const { language } = useTranslation();
  const isFr = language === 'fr';
  const navigate = useNavigate();
  const [usage, setUsage] = useState<SeatUsage | null>(null);
  const [draft, setDraft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSeatUsage()
      .then((u) => {
        setUsage(u);
        // Pre-select what's actually needed when usage already exceeds what's
        // billed, so "Mettre à jour" fixes the gap in one click.
        setDraft(Math.max(u.extras_charged, u.used - u.included));
      })
      .catch(() => setUsage(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!usage || usage.included === 0) return null;

  const extraPrice = usage.extra_price_cents / 100;
  const supportsExtra = usage.extra_price_cents > 0;
  const capacity = usage.included + usage.extras_charged;
  const needed = Math.max(0, usage.used - usage.included);
  const billingMismatch = needed > usage.extras_charged;
  // Never let the stepper strand members already over the included limit.
  const minDraft = needed;
  const monthlyCost = extraPrice * draft;
  const dirty = draft !== usage.extras_charged;
  const utilization = capacity > 0 ? Math.round((usage.used / capacity) * 100) : 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await setExtraSeats(draft);
      if (result.no_change) {
        toast.success(isFr ? 'Déjà à jour' : 'Already in sync');
      } else if (result.no_stripe) {
        toast.success(
          isFr
            ? 'Sièges mis à jour — aucun abonnement Stripe lié, rien n\'a été facturé.'
            : 'Seats updated — no Stripe subscription linked, nothing was billed.',
          { duration: 6000 },
        );
      } else {
        toast.success(
          isFr
            ? 'Sièges mis à jour · facturé maintenant via Stripe'
            : 'Seats updated · billed now via Stripe',
          { duration: 5000 },
        );
      }
      const fresh = await fetchSeatUsage();
      setUsage(fresh);
      setDraft(Math.max(fresh.extras_charged, fresh.used - fresh.included));
      onChange?.();
    } catch (err: any) {
      toast.error(err.message || (isFr ? 'Échec de la mise à jour' : 'Update failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={
        billingMismatch
          ? 'rounded-2xl p-4 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border-2 border-amber-500/30'
          : 'rounded-2xl p-4 bg-surface-card border border-outline-subtle'
      }
    >
      <div className="flex items-center gap-3">
        <div
          className={
            'shrink-0 w-9 h-9 rounded-full flex items-center justify-center ' +
            (billingMismatch ? 'bg-amber-500/20' : 'bg-emerald-500/10')
          }
        >
          {billingMismatch
            ? <AlertTriangle size={15} className="text-amber-600" />
            : <Users size={15} className="text-emerald-600" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-semibold text-text-primary">
              {usage.used} / {capacity} {isFr ? 'sièges utilisés' : 'seats used'}
              {usage.extras_charged > 0 && (
                <span className="font-normal text-text-secondary">
                  {' '}· {usage.included} {isFr ? 'inclus' : 'included'} + {usage.extras_charged} {isFr ? 'en plus' : 'extra'}
                </span>
              )}
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
          {supportsExtra && (
            <p className="text-[12px] text-text-secondary mt-0.5">
              {isFr
                ? `Sièges supplémentaires à +$${extraPrice}/mois chacun, facturés immédiatement.`
                : `Extra seats at +$${extraPrice}/mo each, billed immediately.`}
            </p>
          )}
          {billingMismatch && (
            <p className="text-[12px] text-amber-600 font-medium mt-0.5">
              {isFr
                ? `${needed - usage.extras_charged} siège${needed - usage.extras_charged === 1 ? '' : 's'} utilisé${needed - usage.extras_charged === 1 ? '' : 's'} au-delà de ce qui est facturé.`
                : `${needed - usage.extras_charged} seat${needed - usage.extras_charged === 1 ? '' : 's'} in use beyond what's billed.`}
            </p>
          )}
          <div className="mt-1.5 h-1.5 bg-surface-secondary rounded-full overflow-hidden">
            <div
              className={
                'h-full rounded-full transition-all ' +
                (billingMismatch ? 'bg-amber-500' : 'bg-emerald-500')
              }
              style={{ width: `${Math.min(100, utilization)}%` }}
            />
          </div>
        </div>
        <span className="text-[11px] font-bold text-text-tertiary tabular-nums self-start">{utilization}%</span>
      </div>

      {supportsExtra && (
        <div className="mt-4 flex items-center justify-between gap-3">
          {/* Stepper */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDraft((d) => Math.max(minDraft, d - 1))}
              disabled={saving || draft <= minDraft}
              className="w-9 h-9 rounded-full border border-outline-subtle flex items-center justify-center text-text-primary hover:bg-surface-secondary disabled:opacity-40 transition"
              aria-label={isFr ? 'Retirer un siège' : 'Remove a seat'}
            >
              <Minus size={15} />
            </button>
            <span className="min-w-[2.5rem] text-center text-lg font-extrabold tabular-nums text-text-primary">
              {draft}
            </span>
            <button
              type="button"
              onClick={() => setDraft((d) => Math.min(1000, d + 1))}
              disabled={saving}
              className="w-9 h-9 rounded-full border border-outline-subtle flex items-center justify-center text-text-primary hover:bg-surface-secondary disabled:opacity-40 transition"
              aria-label={isFr ? 'Ajouter un siège' : 'Add a seat'}
            >
              <Plus size={15} />
            </button>
            {draft > 0 && (
              <span className="text-[12px] font-semibold text-text-secondary tabular-nums">
                +${monthlyCost.toFixed(0)}/{isFr ? 'mois' : 'mo'}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-extrabold bg-text-primary text-surface hover:bg-text-primary/90 active:scale-[0.98] transition-all shadow-md disabled:opacity-40"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving
              ? (isFr ? 'Mise à jour...' : 'Updating...')
              : dirty && draft > usage.extras_charged
                ? (isFr ? 'Facturer maintenant' : 'Bill now')
                : (isFr ? 'Mettre à jour' : 'Update')}
          </button>
        </div>
      )}
    </div>
  );
}
