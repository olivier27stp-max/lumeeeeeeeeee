/**
 * Popup « Gagné » — création de job pré-remplie depuis le deal.
 *
 * Règle du chantier : si l'utilisateur annule, le deal RESTE gagné et porte le
 * badge « Job à créer ». Le badge est dérivé (étape de kind `won` + aucune job
 * liée), jamais stocké : annuler ici ne fait donc rien d'autre que fermer.
 *
 * La job est créée par `createJob` de `jobsApi` — c'est lui qui résout l'org,
 * le nom du client, l'adresse et l'horaire. Écrire la ligne `jobs` à la main
 * ici contournerait tout ça.
 */
import { useId, useState } from 'react';
import { toast } from 'sonner';
import Modal from '../ui/Modal';
import { useTranslation } from '../../i18n';
import { nomClient, type Deal } from '../../lib/pipelineVentesApi';
import { createJob } from '../../lib/jobsApi';

export default function GagneJobModal({ deal, onFermer, onCreer }: {
  deal: Deal | null;
  /** Annuler : le deal reste gagné, badge « Job à créer ». */
  onFermer: () => void;
  onCreer: (dealId: string, jobId: string) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const idTitre = useId();
  const idDate = useId();
  const idAdresse = useId();
  const idClient = useId();

  const [titre, setTitre] = useState('');
  const [date, setDate] = useState('');
  const [enCours, setEnCours] = useState(false);

  if (!deal) return null;

  const nom = nomClient(deal);
  const adresse = deal.client?.address ?? '';
  const titreParDefaut = fr ? `Nettoyage — ${nom}` : `Cleaning — ${nom}`;

  async function creer() {
    if (!deal || enCours) return;
    setEnCours(true);
    try {
      const job = await createJob({
        title: titre.trim() || titreParDefaut,
        client_id: deal.client_id,
        status: 'scheduled',
        property_address: adresse || null,
        // La date est facultative : sans elle, la job est créée sans visite.
        scheduled_at: date ? new Date(`${date}T09:00:00`).toISOString() : null,
      });
      onCreer(deal.id, job.id);
    } catch (e) {
      // Échec = la fenêtre reste ouverte : l'utilisateur peut corriger et
      // réessayer sans avoir à rouvrir le deal.
      console.error('[GagneJobModal] création de job échouée', e);
      toast.error(
        fr
          ? `Impossible de créer la job : ${e instanceof Error ? e.message : 'erreur inconnue'}`
          : `Could not create the job: ${e instanceof Error ? e.message : 'unknown error'}`,
      );
    } finally {
      setEnCours(false);
    }
  }

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
            disabled={enCours}
            onClick={() => { void creer(); }}
            className="btn-primary text-[12.5px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {enCours ? (fr ? 'Création…' : 'Creating…') : fr ? 'Créer la job' : 'Create job'}
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
            value={nom}
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
            value={adresse}
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
