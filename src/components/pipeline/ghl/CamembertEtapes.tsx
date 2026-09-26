/**
 * « Répartition par étape » — le graphique que pilote l'icône CAMEMBERT de
 * chaque étape (onglet Pipelines). Une étape décochée n'y figure pas.
 *
 * Deals OUVERTS par étape, en anneau. Les teintes suivent le rang de
 * l'étape, comme sur le board (`visuelEtape`), pour qu'une même étape ait
 * la même couleur partout.
 */
import { useQuery } from '@tanstack/react-query';
import { fetchRepartitionEtapes } from '../../../lib/pipelineVentesApi';
import { visuelEtape } from '../../../lib/pipeline/presentation';
import type { MockStage } from '../../../lib/pipeline/mockData';

export default function CamembertEtapes({ fr, pipelineId }: { fr: boolean; pipelineId: string }) {
  const q = useQuery({
    queryKey: ['pipeline-repartition-etapes', pipelineId],
    queryFn: () => fetchRepartitionEtapes(pipelineId),
    staleTime: 60_000,
  });
  const parts = q.data ?? [];
  const total = parts.reduce((s, p) => s + p.deals, 0);

  // Anneau : chaque part est un arc de cercle (stroke-dasharray sur un
  // cercle de circonférence 100, la part s'écrit directement en pourcent).
  const R = 15.915;
  let deja = 0;
  const arcs = parts.filter((p) => p.deals > 0).map((p) => {
    const pct = (p.deals / total) * 100;
    const teinte = visuelEtape({ kind: 'open', position: p.rang } as MockStage, p.rang - 1).teinte;
    const arc = { id: p.stage_id, pct, debut: deja, teinte };
    deja += pct;
    return arc;
  });

  return (
    <section className="mt-4 rounded-xl border border-outline bg-surface-card p-4">
      <h3 className="text-[13px] font-semibold text-text-primary">{fr ? 'Répartition par étape' : 'Stage distribution'}</h3>
      <p className="mt-0.5 text-[11.5px] text-text-tertiary">
        {fr
          ? 'Deals ouverts par étape. Réglable par étape avec l’icône camembert (onglet Pipelines).'
          : 'Open deals by stage. Choose stages with the pie icon (Pipelines tab).'}
      </p>
      {q.isLoading ? (
        <p className="mt-3 text-[12px] text-text-muted">{fr ? 'Chargement…' : 'Loading…'}</p>
      ) : q.isError ? (
        <p className="mt-3 text-[12px] text-red-600">{fr ? 'Répartition indisponible.' : 'Distribution unavailable.'}</p>
      ) : total === 0 ? (
        <p className="mt-3 text-[12px] text-text-muted">{fr ? 'Aucun deal ouvert dans les étapes affichées.' : 'No open deal in the displayed stages.'}</p>
      ) : (
        <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row">
          <svg viewBox="0 0 42 42" className="h-36 w-36 shrink-0" role="img" aria-label={fr ? `${total} deals ouverts répartis par étape` : `${total} open deals by stage`}>
            <circle cx="21" cy="21" r={R} fill="none" stroke="var(--color-surface-secondary, #eee)" strokeWidth="6" />
            {arcs.map((a) => (
              <circle
                key={a.id}
                cx="21" cy="21" r={R} fill="none"
                stroke={a.teinte}
                strokeWidth="6"
                strokeDasharray={`${a.pct} ${100 - a.pct}`}
                strokeDashoffset={25 - a.debut}
              />
            ))}
            <text x="21" y="22.5" textAnchor="middle" fontSize="6" fontWeight="600" fill="currentColor">{total}</text>
          </svg>
          <ul className="grid w-full grid-cols-1 gap-1.5 text-[12.5px] sm:grid-cols-2">
            {parts.map((p) => (
              <li key={p.stage_id} className="flex items-center justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: visuelEtape({ kind: 'open', position: p.rang } as MockStage, p.rang - 1).teinte }} />
                  <span className="truncate text-text-primary">{fr ? p.nom_fr : p.nom_en}</span>
                </span>
                <span className="shrink-0 tabular-nums text-text-secondary">
                  {p.deals} · {total ? Math.round((p.deals / total) * 100) : 0} %
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
