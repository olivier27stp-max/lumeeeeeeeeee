/**
 * Paramètres › Facturation — section « Crédits Lumi » (2026-09-30).
 *
 * Crédits restants / total, date de renouvellement (propre à l'entreprise),
 * consommation des 30 derniers jours et, pour qui a external_agent.admin
 * (le serveur renvoie alors `par_utilisateur`), la consommation par
 * utilisateur. EN CRÉDITS SEULEMENT : aucun montant en dollars d'IA.
 */
import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  chargerCreditsLumi, chargerHistoriqueCreditsLumi, fmtCredits, fmtDateCredits, remplir,
  type EtatCredits, type HistoriqueCredits,
} from '../../lib/lumiCreditsApi';
import { AvisCreditsLumi, creditsEpuises, useTextesCredits } from './CreditsLumi';

export default function SectionCreditsLumi() {
  const [credits, setCredits] = useState<EtatCredits | null>(null);
  const [historique, setHistorique] = useState<HistoriqueCredits | null>(null);
  const [historiqueEnErreur, setHistoriqueEnErreur] = useState(false);

  useEffect(() => {
    let actif = true;
    chargerCreditsLumi()
      .then((c) => { if (actif) setCredits(c); })
      .catch((err) => { console.error('[crédits Lumi] état', err); });
    chargerHistoriqueCreditsLumi(30)
      .then((h) => { if (actif) setHistorique(h); })
      .catch((err) => { console.error('[crédits Lumi] historique', err); if (actif) setHistoriqueEnErreur(true); });
    return () => { actif = false; };
  }, []);

  const { c, unit, Unit, language } = useTextesCredits(credits);

  // Forfait sans Lumi (ou état inconnu) : la section ne s'affiche pas.
  if (!credits || !credits.inclus) return null;

  const restants = Math.max(0, Math.floor(credits.restants));
  const total = Math.max(0, Math.floor(credits.total));
  const pctRestant = total > 0 ? Math.min(100, Math.max(0, Math.round((restants / total) * 100))) : 0;
  const epuise = creditsEpuises(credits);
  const dateLongue = fmtDateCredits(credits.renouvellement_le, language, true) ?? c.untilRenewal;
  const valeurs = { restants: fmtCredits(restants, language), total: fmtCredits(total, language), unit, Unit };

  const jours = historique?.par_jour ?? [];
  const maxJour = Math.max(0, ...jours.map((j) => j.credits));
  const utilisateurs = historique?.par_utilisateur ?? null;

  return (
    <section className="section-card rounded-2xl p-6 space-y-4" aria-labelledby="credits-lumi-titre">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id="credits-lumi-titre" className="inline-flex items-center gap-2 text-base font-bold text-text-primary">
            <Sparkles size={15} className="text-primary" aria-hidden="true" /> {Unit}
          </h3>
          <p className="text-[12px] text-text-tertiary mt-0.5">{remplir(c.renewsOn, { date: dateLongue })}</p>
        </div>
        <p className="text-right tabular-nums">
          <span className={cn('text-2xl font-extrabold', epuise ? 'text-danger' : 'text-text-primary')}>{valeurs.restants}</span>
          <span className="text-[12px] text-text-tertiary"> {c.left} · {remplir(c.ofTotal, { total: valeurs.total })}</span>
        </p>
      </div>

      <div
        role="progressbar"
        aria-label={remplir(c.barLabel, { unit, Unit })}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={restants}
        aria-valuetext={remplir(c.barValue, valeurs)}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-secondary"
      >
        <div
          className={cn('h-full rounded-full transition-all duration-500', epuise ? 'bg-danger' : credits.avertissement === '80' ? 'bg-warning' : 'bg-primary')}
          style={{ width: `${pctRestant}%` }}
        />
      </div>

      <AvisCreditsLumi credits={credits} />
      <p className="text-[11.5px] text-text-tertiary">{remplir(c.noRollover, { unit, Unit })}</p>

      {/* ── Consommation par jour (30 derniers jours) ── */}
      <div>
        <p className="text-[11px] uppercase tracking-wider font-semibold text-text-tertiary mb-2">{c.historyTitle}</p>
        {historiqueEnErreur ? (
          <p className="text-[12px] text-text-tertiary">{c.historyError}</p>
        ) : jours.length === 0 || maxJour <= 0 ? (
          historique && <p className="text-[12px] text-text-tertiary">{c.historyEmpty}</p>
        ) : (
          <ul className="flex h-16 items-end gap-[2px]" aria-label={c.historyTitle} data-testid="credits-par-jour">
            {jours.map((j) => {
              const libelle = remplir(c.dayUsage, { jour: fmtDateCredits(j.jour, language) ?? j.jour, n: fmtCredits(j.credits, language, 1), unit, Unit });
              const hauteur = j.credits > 0 ? Math.max(6, Math.round((j.credits / maxJour) * 100)) : 0;
              return (
                <li key={j.jour} className="flex h-full flex-1 items-end" title={libelle}>
                  <span className="sr-only">{libelle}</span>
                  <span aria-hidden="true" className="block w-full rounded-t-[3px] bg-primary/70" style={{ height: `${hauteur}%` }} />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Par utilisateur : seulement si le serveur le fournit (external_agent.admin) ── */}
      {utilisateurs && utilisateurs.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-text-tertiary mb-2">{c.byUser}</p>
          <ul className="divide-y divide-outline-subtle" data-testid="credits-par-utilisateur">
            {utilisateurs.map((u) => (
              <li key={u.user_id} className="flex items-center justify-between py-1.5 text-[13px]">
                <span className="text-text-primary truncate">{u.nom}</span>
                <span className="tabular-nums text-text-secondary">{fmtCredits(u.credits, language, 1)} {unit}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
