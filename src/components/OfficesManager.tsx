import { useEffect, useState } from 'react';
import { Building2, Minus, Plus, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import { fetchOfficeUsage, setExtraOffices, type OfficeUsage } from '../lib/billingApi';

interface OfficesManagerProps {
  /** Called when office count changes so the parent can refresh billing data */
  onChange?: () => void;
}

/**
 * Shows the org's office allowance (included by plan) and lets an admin buy
 * extra offices. Unlike seats, offices have no usage entity to count — extras
 * are a manual purchase, billed immediately via Stripe proration.
 */
export default function OfficesManager({ onChange }: OfficesManagerProps) {
  const { language } = useTranslation();
  const isFr = language === 'fr';
  const [usage, setUsage] = useState<OfficeUsage | null>(null);
  const [draft, setDraft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchOfficeUsage()
      .then((u) => { setUsage(u); setDraft(u.extras_charged); })
      .catch(() => setUsage(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!usage || usage.included === 0) return null;

  const extraPrice = usage.extra_price_cents / 100;
  const supportsExtra = usage.extra_price_cents > 0;
  const totalOffices = usage.included + draft;
  const monthlyCost = extraPrice * draft;
  const dirty = draft !== usage.extras_charged;

  const officeWord = (n: number) =>
    isFr ? (n === 1 ? 'bureau' : 'bureaux') : (n === 1 ? 'office' : 'offices');

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await setExtraOffices(draft);
      if (result.no_change) {
        toast.success(isFr ? 'Déjà à jour' : 'Already in sync');
      } else if (result.no_stripe) {
        toast.success(isFr ? 'Bureaux mis à jour' : 'Offices updated');
      } else {
        toast.success(
          isFr ? 'Bureaux mis à jour · facturé maintenant' : 'Offices updated · billed now',
          { duration: 5000 },
        );
      }
      const fresh = await fetchOfficeUsage();
      setUsage(fresh);
      setDraft(fresh.extras_charged);
      onChange?.();
    } catch (err: any) {
      toast.error(err.message || (isFr ? 'Échec de la mise à jour' : 'Update failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl p-4 bg-surface-card border border-outline-subtle">
      <div className="flex items-center gap-3">
        <div className="shrink-0 w-9 h-9 rounded-full bg-sky-500/10 flex items-center justify-center">
          <Building2 size={15} className="text-sky-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-text-primary">
            {totalOffices} {officeWord(totalOffices)}
            {draft > 0 && (
              <span className="font-normal text-text-secondary">
                {' '}· {usage.included} {isFr ? 'inclus' : 'included'} + {draft} {isFr ? 'en plus' : 'extra'}
              </span>
            )}
          </p>
          <p className="text-[12px] text-text-secondary mt-0.5">
            {supportsExtra
              ? (isFr
                ? `Bureaux supplémentaires à +$${extraPrice}/mois chacun.`
                : `Extra offices at +$${extraPrice}/mo each.`)
              : (isFr
                ? `${usage.included} ${officeWord(usage.included)} inclus.`
                : `${usage.included} ${officeWord(usage.included)} included.`)}
          </p>
        </div>
      </div>

      {supportsExtra && (
        <div className="mt-4 flex items-center justify-between gap-3">
          {/* Stepper */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDraft((d) => Math.max(0, d - 1))}
              disabled={saving || draft === 0}
              className="w-9 h-9 rounded-full border border-outline-subtle flex items-center justify-center text-text-primary hover:bg-surface-secondary disabled:opacity-40 transition"
              aria-label={isFr ? 'Retirer un bureau' : 'Remove an office'}
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
              aria-label={isFr ? 'Ajouter un bureau' : 'Add an office'}
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
              : (isFr ? 'Mettre à jour' : 'Update')}
          </button>
        </div>
      )}
    </div>
  );
}
