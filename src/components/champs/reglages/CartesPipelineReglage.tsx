/**
 * Quels champs d'opportunité s'affichent sur les CARTES d'un pipeline, et
 * dans quel ordre (6 au plus — une carte reste une carte). Réglage par
 * pipeline : un pipeline « Résidentiel » ne montre pas les mêmes choses
 * qu'un pipeline « Commercial ».
 */
import { useEffect, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, LayoutGrid, Loader2 } from 'lucide-react';
import { fetchPipelines } from '../../../lib/pipelineVentesApi';
import { lireCartesPipeline, majCartesPipeline, type ChampPerso } from '../../../lib/champsPersoApi';

const MAX = 6;
// Défauts STABLES : un `= []` dans la déstructuration crée un tableau à chaque
// rendu, et l'effet qui recopie `choisis` bouclait à l'infini (vu à l'écran).
const AUCUN: string[] = [];
const AUCUN_PIPELINE: Awaited<ReturnType<typeof fetchPipelines>> = [];

export default function CartesPipelineReglage({ champs, fr }: { champs: ChampPerso[]; fr: boolean }) {
  const ids = useId();
  const qc = useQueryClient();
  const { data: pipelines = AUCUN_PIPELINE } = useQuery({ queryKey: ['pipelines-ventes', 'liste'], queryFn: fetchPipelines, staleTime: 60_000 });
  const [pipelineId, setPipelineId] = useState('');
  useEffect(() => { if (!pipelineId && pipelines[0]) setPipelineId(pipelines[0].id); }, [pipelines, pipelineId]);
  const { data: choisis = AUCUN, isLoading } = useQuery({
    queryKey: ['champs-perso', 'cartes', pipelineId],
    queryFn: () => lireCartesPipeline(pipelineId),
    enabled: !!pipelineId,
  });
  const [liste, setListe] = useState<string[]>([]);
  useEffect(() => { setListe(choisis); }, [choisis]);
  const [envoi, setEnvoi] = useState(false);

  if (champs.length === 0 || pipelines.length === 0) return null;
  const modifie = JSON.stringify(liste) !== JSON.stringify(choisis);

  const enregistrer = async () => {
    setEnvoi(true);
    try {
      await majCartesPipeline(pipelineId, liste);
      await qc.invalidateQueries({ queryKey: ['champs-perso', 'cartes'] });
      toast.success(fr ? 'Affichage des cartes enregistré.' : 'Card display saved.');
    } catch (err) {
      console.error('[CartesPipelineReglage]', err);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  };

  const bouger = (i: number, d: -1 | 1) => setListe((l) => {
    const n = [...l]; const j = i + d;
    if (j < 0 || j >= n.length) return l;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  return (
    <section className="rounded-xl border border-outline bg-surface-card p-4" aria-labelledby={`${ids}-titre`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id={`${ids}-titre`} className="flex items-center gap-2 text-[14px] font-semibold text-text-primary">
            <LayoutGrid size={15} aria-hidden /> {fr ? 'Champs affichés sur les cartes du pipeline' : 'Fields shown on pipeline cards'}
          </h3>
          <p className="text-[12px] text-text-tertiary">{fr ? `Jusqu’à ${MAX} champs d’opportunité, dans l’ordre choisi. Les listes s’affichent en pastilles de couleur.` : `Up to ${MAX} opportunity fields, in the chosen order. Dropdowns show as colored badges.`}</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={`${ids}-pipeline`} className="text-[12px] text-text-secondary">Pipeline</label>
          <select id={`${ids}-pipeline`} value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} className="glass-input h-9 text-[13px]">
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      {isLoading ? (
        <Loader2 size={14} className="animate-spin text-text-tertiary" aria-label={fr ? 'Chargement' : 'Loading'} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-text-secondary">{fr ? 'Champs disponibles' : 'Available fields'}</p>
            <ul className="space-y-1">
              {champs.map((c) => (
                <li key={c.id}>
                  <label htmlFor={`${ids}-${c.id}`} className="flex items-center gap-2 text-[13px] text-text-primary">
                    <input id={`${ids}-${c.id}`} type="checkbox" className="h-4 w-4 accent-primary" checked={liste.includes(c.id)}
                      disabled={!liste.includes(c.id) && liste.length >= MAX}
                      onChange={(e) => setListe((l) => (e.target.checked ? [...l, c.id] : l.filter((x) => x !== c.id)))} />
                    {c.label}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-text-secondary">{fr ? 'Ordre sur la carte' : 'Order on the card'}</p>
            {liste.length === 0 && <p className="text-[12px] text-text-tertiary">{fr ? 'Aucun champ sur les cartes.' : 'No field on cards.'}</p>}
            <ol className="space-y-1">
              {liste.map((id, i) => {
                const c = champs.find((x) => x.id === id);
                return (
                  <li key={id} className="flex items-center gap-2 rounded-md bg-surface-secondary/60 px-2 py-1 text-[13px]">
                    <span className="w-4 text-[11px] text-text-tertiary">{i + 1}</span>
                    <span className="flex-1 truncate">{c?.label ?? '—'}</span>
                    <button type="button" aria-label={fr ? 'Monter' : 'Move up'} disabled={i === 0} onClick={() => bouger(i, -1)}
                      className="rounded p-0.5 text-text-tertiary hover:text-text-primary disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><ArrowUp size={13} aria-hidden /></button>
                    <button type="button" aria-label={fr ? 'Descendre' : 'Move down'} disabled={i === liste.length - 1} onClick={() => bouger(i, 1)}
                      className="rounded p-0.5 text-text-tertiary hover:text-text-primary disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><ArrowDown size={13} aria-hidden /></button>
                  </li>
                );
              })}
            </ol>
            {modifie && (
              <button type="button" disabled={envoi} onClick={() => { void enregistrer(); }} className="glass-button-primary mt-3 inline-flex items-center gap-2">
                {envoi && <Loader2 size={14} className="animate-spin" aria-hidden />}{fr ? 'Enregistrer l’affichage' : 'Save display'}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
