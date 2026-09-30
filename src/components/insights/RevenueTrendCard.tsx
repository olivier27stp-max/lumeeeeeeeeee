/**
 * Revenu (encaissé) — courbe sur la période : total, variation vs période précédente,
 * infobulle au cent, clic sur un point → détail de ce mois (les paiements qui le font).
 * Affichage seulement : les données viennent de la page (statistiquesApi.serieRevenus).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from '../../i18n';
import type { PointRevenu } from '../../lib/statistiquesApi';
import type { InsightsRange } from '../../lib/insightsPeriod';
import type { CleFiltre } from '../../lib/statsFiltres';
import EnteteCarte, { PastilleVariation } from './EnteteCarte';
import ErreurCarte from './ErreurCarte';

const W = 1000;
const H = 320;
const TOP = 16;

function niceMax(m: number): number {
  if (m <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(m)));
  const f = m / e;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return n * e;
}

export default function RevenueTrendCard({ points, granularite, chargement, erreur, onRetry, variation, onDetail, nonAppliques }: {
  points: PointRevenu[];
  granularite: InsightsRange['granularity'];
  chargement: boolean;
  erreur: boolean;
  onRetry: () => void;
  variation?: { texte: string; sens: 'hausse' | 'baisse' | 'stable' } | null;
  /** debut = début du point (mois « YYYY-MM » en granularité mensuelle), null = toute la période. */
  onDetail: (mois: string | null, libelle?: string) => void;
  nonAppliques?: CleFiltre[];
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const locale = fr ? 'fr-CA' : 'en-CA';
  const [hover, setHover] = useState<number | null>(null);

  const money = (cents: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 }).format((cents || 0) / 100);
  // Au cent près, comme les factures.
  const moneyFull = (cents: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((cents || 0) / 100);

  const model = useMemo(() => {
    const vals = points.map((p) => p.encaisseCents);
    const total = vals.reduce((a, b) => a + b, 0);
    const max = niceMax(Math.max(1, ...vals));
    const n = vals.length;
    const co = vals.map((v, i) => ({ x: n > 1 ? (i / (n - 1)) * W : W / 2, y: TOP + (H - TOP) * (1 - v / max) }));
    const line = co.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area = co.length ? `${line} L${co[co.length - 1].x.toFixed(1)},${H} L${co[0].x.toFixed(1)},${H} Z` : '';
    // bucket_start est une DATE : lue à midi local (minuit UTC = la veille au soir à Montréal).
    const labels = points.map((p) => {
      const d = new Date(`${p.debut}T12:00:00`);
      return granularite === 'month' ? new Intl.DateTimeFormat(locale, { month: 'short' }).format(d)
        : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(d);
    });
    const labelsLongs = points.map((p) => {
      const d = new Date(`${p.debut}T12:00:00`);
      return granularite === 'month' ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(d)
        : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    });
    return { vals, total, max, co, line, area, labels, labelsLongs, n };
  }, [points, granularite, locale]);

  const grid = [0, 1, 2, 3].map((s) => TOP + (H - TOP) * (s / 3));
  const hIdx = hover != null && hover >= 0 && hover < model.n ? hover : null;
  const detailPoint = (i: number) => {
    const p = points[i];
    if (!p) return;
    onDetail(granularite === 'month' ? p.debut.slice(0, 7) : null, model.labelsLongs[i]);
  };

  return (
    <div className="flex flex-col">
      <EnteteCarte titre={fr ? 'Revenu' : 'Revenue'} nonAppliques={nonAppliques} onDetail={() => onDetail(null)}
        definition={fr ? 'Argent encaissé, taxes incluses, net des remboursements, sans pourboires' : 'Money collected, taxes included, net of refunds, tips excluded'} />
      <div className="flex items-baseline gap-3 px-6 mt-3">
        <span className="text-[34px] font-bold tracking-tight leading-none tabular-nums text-text-primary" title={moneyFull(model.total)} data-cents={model.total}>
          {erreur ? '—' : money(model.total)}
        </span>
        <PastilleVariation v={variation} />
      </div>

      {erreur ? (
        <ErreurCarte hauteur={250} onRetry={onRetry} />
      ) : chargement ? (
        <div className="h-[250px] mx-6 mt-4 rounded-lg bg-surface-secondary/40 animate-pulse" />
      ) : model.n === 0 ? (
        <div className="h-[250px] flex items-center justify-center text-[12.5px] text-text-tertiary">{fr ? 'Aucune donnée sur la période' : 'No data for this period'}</div>
      ) : (
        <div className="flex gap-3 px-6 pt-4 pb-1">
          <div className="flex flex-col justify-between text-right min-w-[42px] h-[230px] pb-[22px]">
            {[4, 3, 2, 1, 0].map((s) => (
              <span key={s} className="text-[10px] font-semibold text-text-tertiary leading-none tabular-nums">{money((model.max * s) / 4)}</span>
            ))}
          </div>
          <div className="relative flex-1 h-[230px]">
            <div className="absolute inset-x-0 top-0 bottom-[22px]">
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full block overflow-visible" aria-hidden="true">
                {grid.map((y, i) => (
                  <line key={i} x1={0} y1={y} x2={W} y2={y} stroke={i === 3 ? 'var(--color-border)' : 'var(--color-border-light)'} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                ))}
                <defs>
                  <linearGradient id="revfill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-text-primary)" stopOpacity="0.14" />
                    <stop offset="100%" stopColor="var(--color-text-primary)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {model.area && <path d={model.area} fill="url(#revfill)" />}
                <path d={model.line} fill="none" stroke="var(--color-text-primary)" strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>

            {hIdx != null && (
              <>
                <div className="absolute top-0 bottom-[22px] w-px bg-border" style={{ left: `${(model.co[hIdx].x / W) * 100}%` }} />
                <div className="absolute w-[9px] h-[9px] rounded-full -translate-x-1/2 -translate-y-1/2 border-2 border-surface-card"
                  style={{ left: `${(model.co[hIdx].x / W) * 100}%`, top: `${(model.co[hIdx].y / H) * 100}%`, background: 'var(--color-text-primary)' }} />
                <div className="absolute z-10 -translate-x-1/2 -translate-y-full -mt-3.5 rounded-xl border border-border bg-surface-card shadow-xl px-3 py-2.5 pointer-events-none whitespace-nowrap"
                  style={{ left: `${Math.min(86, Math.max(14, (model.co[hIdx].x / W) * 100))}%`, top: `${(model.co[hIdx].y / H) * 100}%` }}>
                  <div className="text-[9.5px] uppercase tracking-wide text-text-tertiary font-bold mb-1.5">{model.labels[hIdx]}</div>
                  <div className="flex items-center gap-2 text-[12px] text-text-secondary">
                    <span className="w-3 h-[2.5px] rounded" style={{ background: 'var(--color-text-primary)' }} />
                    {fr ? 'Encaissé' : 'Collected'}
                    <b className="ml-5 text-text-primary tabular-nums">{moneyFull(model.vals[hIdx])}</b>
                  </div>
                  {granularite === 'month' && <div className="mt-1 text-[10.5px] text-text-tertiary">{fr ? 'Cliquer pour le détail' : 'Click for details'}</div>}
                </div>
              </>
            )}

            <div className="absolute inset-x-0 bottom-0 flex justify-between text-[10px] font-semibold text-text-tertiary">
              {model.labels.map((l, i) => {
                const step = Math.ceil(model.n / 7);
                return <span key={i} className="flex-1 text-center" style={{ visibility: i % step ? 'hidden' : 'visible' }}>{l}</span>;
              })}
            </div>

            <div
              role="button"
              tabIndex={0}
              aria-label={fr ? 'Graphique du revenu : flèches pour parcourir, Entrée pour le détail' : 'Revenue chart: arrows to browse, Enter for details'}
              className="absolute inset-x-0 top-0 bottom-[22px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-tertiary rounded"
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
                setHover(Math.round(frac * (model.n - 1)));
              }}
              onMouseLeave={() => setHover(null)}
              onClick={() => { if (hIdx != null) detailPoint(hIdx); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') { e.preventDefault(); setHover((h) => Math.min(model.n - 1, (h ?? -1) + 1)); }
                else if (e.key === 'ArrowLeft') { e.preventDefault(); setHover((h) => Math.max(0, (h ?? model.n) - 1)); }
                else if ((e.key === 'Enter' || e.key === ' ') && hIdx != null) { e.preventDefault(); detailPoint(hIdx); }
              }}
              onBlur={() => setHover(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
