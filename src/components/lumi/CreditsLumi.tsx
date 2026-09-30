/**
 * Crédits Lumi à l'écran (2026-09-30) : le compteur discret de la page Lumi
 * (« 742 / 1 000 crédits Lumi · renouvellement le 12 nov. » + une fine barre)
 * et l'avis à 80 % / 100 %.
 *
 * Règle du propriétaire : AUCUN montant en dollars d'IA au client, nulle
 * part — ni coût par réponse, ni équivalence « 1 crédit = X $ ». Ces
 * composants ne reçoivent que des crédits.
 */
import { AlertTriangle, Sparkles } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { cn } from '../../lib/utils';
import { fmtCredits, fmtDateCredits, majuscule, remplir, type EtatCredits } from '../../lib/lumiCreditsApi';

/** Crédits épuisés : le serveur le dit par le palier ou l'avertissement ; restants = 0 suffit aussi. */
export function creditsEpuises(c: EtatCredits | null | undefined): boolean {
  if (!c || !c.inclus) return false;
  return c.palier === 'epuise' || c.avertissement === '100' || c.restants <= 0;
}

/** Libellés partagés : l'unité (clé i18n unique) et la date de renouvellement lisible. */
export function useTextesCredits(credits: EtatCredits | null | undefined) {
  const { t, language } = useTranslation();
  const c = t.lumiCredits;
  const unit = c.unit;
  const date = fmtDateCredits(credits?.renouvellement_le, language) ?? c.untilRenewal;
  return { c, unit, Unit: majuscule(unit), date, language };
}

/** Compteur discret, style Claude : crédits restants / total, date de renouvellement, barre fine. */
export function CompteurCreditsLumi({ credits, className }: { credits: EtatCredits; className?: string }) {
  const { c, unit, Unit, date, language } = useTextesCredits(credits);
  const restants = Math.max(0, Math.floor(credits.restants));
  const total = Math.max(0, Math.floor(credits.total));
  const pctRestant = total > 0 ? Math.min(100, Math.max(0, Math.round((restants / total) * 100))) : 0;
  const epuise = creditsEpuises(credits);
  const bas = credits.avertissement === '80';
  const valeurs = { restants: fmtCredits(restants, language), total: fmtCredits(total, language), unit, Unit };
  return (
    <div className={cn('inline-flex min-w-[190px] flex-col gap-1', className)}>
      <span className={cn('inline-flex items-center gap-1.5 text-[11.5px] tabular-nums', epuise ? 'text-danger' : 'text-text-secondary')}>
        <Sparkles size={12} className={epuise ? 'text-danger' : 'text-primary'} aria-hidden="true" />
        <span>
          <span className="font-medium text-text-primary">{remplir(c.counter, valeurs)}</span>
          <span className="text-text-tertiary"> · {remplir(c.renews, { date })}</span>
        </span>
      </span>
      <div
        role="progressbar"
        aria-label={majuscule(remplir(c.barLabel, { unit, Unit }))}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={restants}
        aria-valuetext={remplir(c.barValue, valeurs)}
        className="h-1 w-full overflow-hidden rounded-full bg-surface-secondary"
      >
        <div
          className={cn('h-full rounded-full transition-all duration-500', epuise ? 'bg-danger' : bas ? 'bg-warning' : 'bg-primary')}
          style={{ width: `${pctRestant}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Avis de crédits : à 80 % (« Il te reste X crédits Lumi jusqu'au 12 nov. »)
 * et à 100 % (épuisé — le reste de Lume continue). Rien sous 80 %.
 */
export function AvisCreditsLumi({ credits, className }: { credits: EtatCredits | null | undefined; className?: string }) {
  const { c, unit, Unit, date, language } = useTextesCredits(credits);
  if (!credits || !credits.inclus) return null;
  const epuise = creditsEpuises(credits);
  if (!epuise && credits.avertissement !== '80') return null;
  const texte = epuise
    ? remplir(c.exhausted, { unit, Unit, date })
    : remplir(c.warn80, { n: fmtCredits(Math.max(0, Math.floor(credits.restants)), language), unit, Unit, date });
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px]',
        epuise ? 'border-danger/30 bg-danger/10 text-danger' : 'border-warning/30 bg-warning/10 text-text-primary',
        className,
      )}
    >
      <AlertTriangle size={14} className={cn('mt-0.5 shrink-0', epuise ? 'text-danger' : 'text-warning')} aria-hidden="true" />
      <span>{texte}</span>
    </div>
  );
}
