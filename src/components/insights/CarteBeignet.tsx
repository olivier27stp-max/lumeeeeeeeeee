/**
 * Beignet de répartition (revenu par service, modes de paiement) : une encre à opacité
 * décroissante, légende cliquable (→ détail de la part), survol → le centre montre la part.
 * Beignet et légende s'empilent sous 640 px (côte à côte, les noms disparaissaient).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from '../../i18n';
import type { Part } from '../../lib/statistiquesApi';
import EnteteCarte, { PastilleVariation } from './EnteteCarte';
import ErreurCarte from './ErreurCarte';
import type { CleFiltre } from '../../lib/statsFiltres';

const R = 15.9;
const C = 2 * Math.PI * R;
const GAP = 1.2;
const OPACITY = [1, 0.58, 0.36, 0.2];

export default function CarteBeignet({ titre, definition, parts, libelle, chargement, erreur, onRetry, onDetail, variation, nonAppliques, vide }: {
  titre: string;
  definition?: string;
  parts: Part[];
  libelle: (cle: string) => string;
  chargement: boolean;
  erreur: boolean;
  onRetry: () => void;
  onDetail: (cle: string | null) => void;
  variation?: { texte: string; sens: 'hausse' | 'baisse' | 'stable' } | null;
  nonAppliques?: CleFiltre[];
  vide: string;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [actif, setActif] = useState<number | null>(null);
  const money = (cents: number) => new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 }).format((cents || 0) / 100);
  const moneyFull = (cents: number) => new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format((cents || 0) / 100);

  const { segs, total } = useMemo(() => {
    const tot = parts.reduce((a, s) => a + (s.valeur || 0), 0);
    let acc = 0;
    const segs = parts.map((s, i) => {
      const pct = tot > 0 ? (s.valeur / tot) * 100 : 0;
      const seg = Math.max(0, (pct / 100) * C - GAP);
      const off = -(acc / 100) * C;
      acc += pct;
      return { cle: s.cle, nom: libelle(s.cle), valeur: s.valeur, op: OPACITY[i] ?? 0.2, pct, dash: seg, off };
    });
    return { segs, total: tot };
  }, [parts, libelle]);
  const detail = actif != null && segs[actif] ? segs[actif] : null;

  return (
    <div className="flex flex-col">
      <EnteteCarte titre={titre} definition={definition} nonAppliques={nonAppliques} onDetail={() => onDetail(null)} droite={<PastilleVariation v={variation} />} />
      {erreur ? <ErreurCarte hauteur={200} onRetry={onRetry} /> : chargement ? (
        <div className="h-[200px] mx-6 mt-4 rounded-lg bg-surface-secondary/40 animate-pulse" />
      ) : segs.length === 0 ? (
        <div className="h-[200px] flex items-center justify-center text-[12.5px] text-text-tertiary">{vide}</div>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-6 px-6 pt-4 pb-6">
          <div className="relative w-[168px] h-[168px] shrink-0">
            <svg width="168" height="168" viewBox="0 0 42 42" className="-rotate-90" aria-hidden="true">
              <circle cx="21" cy="21" r={R} fill="none" stroke="var(--color-surface-tertiary, #ededea)" strokeWidth={5} />
              {segs.map((s, i) => (
                <circle key={s.cle} cx="21" cy="21" r={R} fill="none" stroke="var(--color-text-primary)"
                  strokeOpacity={actif == null || actif === i ? s.op : s.op * 0.3} strokeWidth={5} strokeLinecap="round"
                  strokeDasharray={`${s.dash.toFixed(2)} ${(C - s.dash).toFixed(2)}`} strokeDashoffset={s.off.toFixed(2)}
                  className="transition-opacity duration-150" onMouseEnter={() => setActif(i)} onMouseLeave={() => setActif(null)} />
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-5 pointer-events-none">
              {detail ? (
                <>
                  <div className="text-[11px] font-semibold text-text-secondary mb-1.5 max-w-full truncate">{detail.nom}</div>
                  <div className="text-[23px] font-bold tracking-tight leading-none tabular-nums text-text-primary">{money(detail.valeur)}</div>
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-tertiary mt-1.5">{Math.round(detail.pct)}% {fr ? 'du total' : 'of total'}</div>
                </>
              ) : (
                <>
                  <div className="text-[23px] font-bold tracking-tight leading-none tabular-nums text-text-primary" title={moneyFull(total)} data-cents={total}>{money(total)}</div>
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-tertiary mt-1.5">Total</div>
                </>
              )}
            </div>
          </div>
          <ul className="w-full sm:flex-1 flex flex-col min-w-0">
            {segs.map((s, i) => (
              <li key={s.cle}>
                <button type="button" onClick={() => onDetail(s.cle)} onMouseEnter={() => setActif(i)} onMouseLeave={() => setActif(null)} onFocus={() => setActif(i)} onBlur={() => setActif(null)}
                  title={moneyFull(s.valeur)}
                  className="flex w-full items-center gap-3 py-2.5 border-b border-border-light rounded-md -mx-2 px-2 text-left hover:bg-surface-secondary transition-colors focus-visible:outline-none focus-visible:bg-surface-secondary">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: 'var(--color-text-primary)', opacity: s.op }} />
                  <span className="text-[13px] font-semibold text-text-primary truncate">{s.nom}</span>
                  <span className="ml-auto text-[13px] font-bold text-text-primary tabular-nums">{money(s.valeur)}</span>
                  <span className="text-[12px] text-text-tertiary font-semibold tabular-nums w-9 text-right">{Math.round(s.pct)}%</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
