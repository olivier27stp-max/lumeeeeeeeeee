/**
 * Raisons de perte — la liste proposée quand on marque un deal perdu.
 * Réglage d'ORGANISATION (pas d'un pipeline) : il vit sous la liste
 * « Pipelines ». Repris tel quel de l'ancien écran de réglages.
 */
import { useId, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { confirmer } from '../../ui/ConfirmDialog';
import { X } from 'lucide-react';
import { ajouterRaisonProposee, archiverRaisonProposee, fetchRaisonsProposees } from '../../../lib/pipelineVentesApi';

/**
 * La liste des motifs de perte.
 *
 * Un motif n'est jamais SUPPRIMÉ, seulement archivé : les deals perdus le
 * citent encore, et l'historique ne doit pas changer parce qu'on a nettoyé
 * une liste. Il cesse simplement d'être proposé à la saisie.
 */
export default function ListeRaisonsPerte({ fr }: { fr: boolean }) {
  const idNouveau = useId();
  const [nouveau, setNouveau] = useState('');
  const [enCours, setEnCours] = useState(false);
  const { data: raisons = [], refetch, isLoading } = useQuery({
    queryKey: ['pipeline-raisons-proposees'],
    queryFn: fetchRaisonsProposees,
    staleTime: 600_000,
  });

  async function ajouter(e: FormEvent) {
    e.preventDefault();
    const libelle = nouveau.trim();
    if (!libelle || enCours) return;
    setEnCours(true);
    try {
      await ajouterRaisonProposee(libelle);
      setNouveau('');
      await refetch();
      toast.success(fr ? 'Motif ajouté.' : 'Reason added.');
    } catch (err) {
      console.error('[PipelineReglages] ajout de motif', err);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setEnCours(false);
    }
  }

  async function retirer(id: string, libelle: string) {
    const ok = await confirmer({
      title: fr ? `Retirer « ${libelle} » ?` : `Remove “${libelle}”?`,
      message: fr
        ? "Le motif ne sera plus proposé. Les deals qui le citent déjà ne changent pas."
        : 'The reason will no longer be offered. Deals already citing it are unchanged.',
      confirmLabel: fr ? 'Retirer' : 'Remove',
    });
    if (!ok) return;
    try {
      await archiverRaisonProposee(id);
      await refetch();
      toast.success(fr ? 'Motif retiré.' : 'Reason removed.');
    } catch (err) {
      console.error('[PipelineReglages] archivage de motif', err);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-3">
      {isLoading && <p className="text-[12px] text-text-muted">{fr ? 'Chargement…' : 'Loading…'}</p>}

      {!isLoading && raisons.length === 0 && (
        <p className="text-[12px] text-text-muted">
          {fr
            ? 'Aucun motif. Les vendeurs écriront du texte libre.'
            : 'No reason yet. Reps will type free text.'}
        </p>
      )}

      {raisons.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {raisons.map((r) => (
            <li
              key={r.id}
              className="inline-flex items-center gap-1 rounded-full border border-outline bg-surface-card py-1 pl-3 pr-1.5 text-[12px] text-text-primary"
            >
              {r.libelle}
              <button
                type="button"
                onClick={() => { void retirer(r.id, r.libelle); }}
                aria-label={fr ? `Retirer ${r.libelle}` : `Remove ${r.libelle}`}
                className="rounded-full p-0.5 text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => { void ajouter(e); }} className="flex items-center gap-2">
        <label htmlFor={idNouveau} className="sr-only">
          {fr ? 'Nouveau motif' : 'New reason'}
        </label>
        <input
          id={idNouveau}
          value={nouveau}
          maxLength={80}
          onChange={(e) => setNouveau(e.target.value)}
          placeholder={fr ? 'Ajouter un motif…' : 'Add a reason…'}
          className="input-field w-full max-w-xs text-[12.5px]"
        />
        <button
          type="submit"
          disabled={!nouveau.trim() || enCours}
          className="btn-secondary whitespace-nowrap text-[12px] disabled:opacity-50"
        >
          {fr ? 'Ajouter' : 'Add'}
        </button>
      </form>
    </div>
  );
}
