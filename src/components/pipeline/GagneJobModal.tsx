/**
 * Popup « Gagné » — création de job pré-remplie depuis le deal.
 *
 * Règle du chantier : si l'utilisateur annule, le deal RESTE gagné et porte le
 * badge « Job à créer ». Le badge est dérivé (étape de kind `won` + aucune job
 * liée), jamais stocké : annuler ici ne fait donc rien d'autre que fermer.
 */
import { useId, useState } from 'react';
import Modal from '../ui/Modal';
import { useTranslation } from '../../i18n';
import type { MockDeal } from '../../lib/pipeline/mockData';

export default function GagneJobModal({ deal, onFermer, onCreer }: {
  deal: MockDeal | null;
  /** Annuler : le deal reste gagné, badge « Job à créer ». */
  onFermer: () => void;
  onCreer: (dealId: string, titre: string, date: string) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const idTitre = useId();
  const idDate = useId();
  const idAdresse = useId();
  const idClient = useId();

  const [titre, setTitre] = useState('');
  const [date, setDate] = useState('');

  if (!deal) return null;

  const titreParDefaut = fr ? `Nettoyage — ${deal.clientName}` : `Cleaning — ${deal.clientName}`;

  return (
    <Modal
      open
      onClose={onFermer}
      size="md"
      title={fr ? 'Créer la job' : 'Create the job'}
      description={
        fr
          ? 'Le contact et l’adresse viennent du deal. Si tu annules, le deal reste gagné et affiche « Job à créer ».'
          : 'Contact and address come from the deal. If you cancel, the deal stays won and shows “Job to create”.'
      }
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onFermer} className="btn-secondary text-[12.5px]">
            {fr ? 'Annuler' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => onCreer(deal.id, titre.trim() || titreParDefaut, date)}
            className="btn-primary text-[12.5px]"
          >
            {fr ? 'Créer la job' : 'Create job'}
          </button>
        </div>
      }
    >
      <div className="space-y-3.5">
        <div>
          <label htmlFor={idClient} className="block text-[11px] text-text-tertiary mb-1.5">
            {fr ? 'Client' : 'Client'}
          </label>
          <input
            id={idClient}
            readOnly
            value={deal.clientName}
            className="input-field w-full text-[12.5px] opacity-70"
          />
        </div>

        <div>
          <label htmlFor={idAdresse} className="block text-[11px] text-text-tertiary mb-1.5">
            {fr ? 'Adresse' : 'Address'}
          </label>
          <input
            id={idAdresse}
            readOnly
            value={deal.address}
            className="input-field w-full text-[12.5px] opacity-70"
          />
        </div>

        <div>
          <label htmlFor={idTitre} className="block text-[11px] text-text-tertiary mb-1.5">
            {fr ? 'Titre de la job' : 'Job title'}
          </label>
          <input
            id={idTitre}
            value={titre}
            onChange={(e) => setTitre(e.target.value)}
            placeholder={titreParDefaut}
            className="input-field w-full text-[12.5px]"
          />
        </div>

        <div>
          <label htmlFor={idDate} className="block text-[11px] text-text-tertiary mb-1.5">
            {fr ? 'Date prévue (optionnel)' : 'Planned date (optional)'}
          </label>
          <input
            id={idDate}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input-field w-full text-[12.5px]"
          />
        </div>
      </div>
    </Modal>
  );
}
