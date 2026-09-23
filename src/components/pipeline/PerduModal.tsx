/**
 * Modal « Perdu » — raison de perte en texte libre.
 *
 * L'étape d'où le deal a été perdu est enregistrée séparément
 * (`lost_from_stage_id`) : c'est ce qui permet de dire PLUS TARD à quelle étape on
 * perd le plus, sans jamais se fier au nom de l'étape.
 */
import { useId, useState } from 'react';
import Modal from '../ui/Modal';
import { useTranslation } from '../../i18n';
import type { Deal } from '../../lib/pipelineVentesApi';

/** Raisons courantes — cliquables, mais le champ reste libre. */
const SUGGESTIONS_FR = ['Prix trop élevé', 'A choisi un concurrent', 'Ne répond plus', 'Hors territoire'];
const SUGGESTIONS_EN = ['Price too high', 'Chose a competitor', 'Stopped responding', 'Outside service area'];

export default function PerduModal({ deal, onFermer, onConfirmer }: {
  deal: Deal | null;
  onFermer: () => void;
  onConfirmer: (dealId: string, raison: string) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const idRaison = useId();
  const [raison, setRaison] = useState('');

  if (!deal) return null;

  const suggestions = fr ? SUGGESTIONS_FR : SUGGESTIONS_EN;

  return (
    <Modal
      open
      onClose={onFermer}
      size="md"
      title={fr ? 'Marquer comme perdu' : 'Mark as lost'}
      description={
        fr
          ? 'La vraie raison vaut mieux que « pas intéressé » : c’est elle qui ajuste les prix et les relances.'
          : 'A real reason beats “not interested” — it’s what tunes pricing and follow-ups.'
      }
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onFermer} className="btn-secondary text-[12.5px]">
            {fr ? 'Annuler' : 'Cancel'}
          </button>
          <button
            type="button"
            disabled={raison.trim().length === 0}
            onClick={() => onConfirmer(deal.id, raison.trim())}
            className="btn-primary text-[12.5px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {fr ? 'Confirmer' : 'Confirm'}
          </button>
        </div>
      }
    >
      <div>
        <label htmlFor={idRaison} className="block text-[11px] text-text-tertiary mb-1.5">
          {fr ? 'Raison de la perte' : 'Loss reason'}
        </label>
        <textarea
          id={idRaison}
          rows={3}
          value={raison}
          onChange={(e) => setRaison(e.target.value)}
          placeholder={fr ? 'Ex. : a choisi un concurrent 15 % moins cher' : 'e.g. chose a competitor 15% cheaper'}
          className="input-field w-full text-[12.5px] resize-none"
        />

        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setRaison(s)}
              className="text-[11px] px-2 py-1 rounded-full border border-outline text-text-secondary hover:bg-surface-secondary transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
