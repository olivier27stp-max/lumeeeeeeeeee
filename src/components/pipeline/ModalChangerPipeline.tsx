/* ══════════════════════════════════════════════════════════════
   Déplacer des deals vers un AUTRE pipeline (Rafba, 2026-09-30).

   Dupliquer un pipeline copie sa structure, pas ses deals (un deal = une
   vente : le copier doublerait les chiffres et les envois). Cette fenêtre
   permet de les DÉPLACER : on choisit le pipeline, puis l'étape d'arrivée.
   Seules les étapes OUVERTES sont proposées — gagner demande une job,
   perdre demande une raison, comme pour « Déplacer vers… ».
   ═════════════════════════════════════════════════════════════ */

import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import Modal from '../ui/Modal';
import { deplacerVersPipeline, fetchStages, type PipelineStage } from '../../lib/pipelineVentesApi';
import { captureClientException } from '../../lib/sentry';

interface Props {
  ouvert: boolean;
  fr: boolean;
  dealIds: string[];
  /** Pipelines vers lesquels l'utilisateur peut déplacer (hors pipeline actuel). */
  pipelines: { id: string; name: string }[];
  onFermer: () => void;
  /** Après un déplacement réussi : le parent recharge. */
  onDeplace: (pipelineId: string, nombre: number) => void;
}

export default function ModalChangerPipeline({ ouvert, fr, dealIds, pipelines, onFermer, onDeplace }: Props) {
  const ids = useId();
  const [pipelineId, setPipelineId] = useState('');
  const [etapes, setEtapes] = useState<PipelineStage[] | null>(null);
  const [etapeId, setEtapeId] = useState('');
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (ouvert) setPipelineId(pipelines[0]?.id ?? '');
  }, [ouvert, pipelines]);

  useEffect(() => {
    if (!pipelineId) { setEtapes(null); return; }
    let vivant = true;
    setEtapes(null);
    fetchStages(pipelineId)
      .then((e) => {
        if (!vivant) return;
        const ouvertes = e.filter((x) => x.kind === 'open' && !x.archived_at);
        setEtapes(ouvertes);
        setEtapeId(ouvertes[0]?.id ?? '');
      })
      .catch((err: unknown) => {
        console.error('[ModalChangerPipeline] étapes', err);
        captureClientException(err, { contexte: 'ModalChangerPipeline.etapes' });
        if (vivant) setEtapes([]);
      });
    return () => { vivant = false; };
  }, [pipelineId]);

  const deplacer = async () => {
    if (!pipelineId || !etapeId || envoi) return;
    setEnvoi(true);
    try {
      const n = await deplacerVersPipeline(dealIds, pipelineId, etapeId);
      if (n < dealIds.length) {
        toast.error(fr
          ? `${n} deal(s) déplacé(s) sur ${dealIds.length} — votre rôle ne permet pas de modifier les autres.`
          : `${n} of ${dealIds.length} deal(s) moved — your role cannot edit the others.`);
      } else {
        const nom = pipelines.find((p) => p.id === pipelineId)?.name ?? '';
        toast.success(fr ? `${n} deal(s) déplacé(s) vers « ${nom} ».` : `${n} deal(s) moved to “${nom}”.`);
      }
      onDeplace(pipelineId, n);
    } catch (err: unknown) {
      console.error('[ModalChangerPipeline] déplacement', err);
      captureClientException(err, { contexte: 'ModalChangerPipeline.deplacer' });
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modal
      open={ouvert}
      onClose={onFermer}
      size="md"
      title={fr ? 'Déplacer vers une autre pipeline' : 'Move to another pipeline'}
      description={fr
        ? `${dealIds.length} deal(s). Chaque deal garde son client, son historique, ses étiquettes, son titre, son devis et sa job.`
        : `${dealIds.length} deal(s). Each deal keeps its client, history, tags, title, quote and job.`}
      footer={(
        <>
          <button type="button" onClick={onFermer} disabled={envoi} className="btn-secondary text-[13px]">
            {fr ? 'Annuler' : 'Cancel'}
          </button>
          <button type="button" onClick={() => { void deplacer(); }} disabled={envoi || !etapeId} className="btn-primary text-[13px] disabled:opacity-50">
            {envoi ? (fr ? 'Déplacement…' : 'Moving…') : (fr ? 'Déplacer' : 'Move')}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div>
          <label htmlFor={`${ids}-pipeline`} className="mb-1 block text-[12px] font-medium text-text-secondary">
            {fr ? 'Pipeline' : 'Pipeline'}
          </label>
          <select id={`${ids}-pipeline`} value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} className="glass-input w-full">
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-etape`} className="mb-1 block text-[12px] font-medium text-text-secondary">
            {fr ? 'Étape d’arrivée' : 'Arrival stage'}
          </label>
          <select id={`${ids}-etape`} value={etapeId} onChange={(e) => setEtapeId(e.target.value)} disabled={!etapes || etapes.length === 0}
            className="glass-input w-full">
            {etapes === null && <option value="">{fr ? 'Chargement…' : 'Loading…'}</option>}
            {etapes?.length === 0 && <option value="">{fr ? 'Aucune étape ouverte' : 'No open stage'}</option>}
            {etapes?.map((e) => <option key={e.id} value={e.id}>{fr ? e.name_fr : e.name_en}</option>)}
          </select>
          <p className="mt-1 text-[12px] text-text-tertiary">
            {fr
              ? 'Gagné et Perdu ne sont pas proposés : gagner demande une job, perdre demande une raison.'
              : 'Won and Lost are not offered: winning needs a job, losing needs a reason.'}
          </p>
        </div>
      </div>
    </Modal>
  );
}
