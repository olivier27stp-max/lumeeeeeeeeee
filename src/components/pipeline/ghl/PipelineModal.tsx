/**
 * Modal « Créer un pipeline » / « Modifier le pipeline » — calqué sur
 * GoHighLevel (capture 1 de la mission du 2026-09-25).
 *
 * Un seul modal pour les deux gestes : le menu ⋮ → « Modifier » rouvre
 * exactement l'écran de création, pré-rempli.
 *
 * Gagné et Perdu sont affichés, VERROUILLÉS (cadenas) : la création de job
 * s'accroche à l'étape « Gagné » (`kind = 'won'`), un pipeline sans elle ne
 * pourrait plus rien convertir.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import {
  DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Lock, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import Modal from '../../ui/Modal';
import {
  enregistrerPipeline, fetchStages, type EtapeEditee, type ModeCouleur, type PipelineResume,
} from '../../../lib/pipelineVentesApi';
import { CarteCouleurs, CarteProbabilite, IconesRapports, etapesParDefaut, lireProbabilite } from './ReglagesCommuns';

interface Ligne extends Omit<EtapeEditee, 'probability'> {
  cle: string;
  /** Texte tant qu'on tape ; converti à l'envoi. */
  proba: string;
}

let compteur = 0;
const nouvelleCle = () => `l${++compteur}`;

function versLigne(e: EtapeEditee): Ligne {
  return { ...e, cle: e.id ?? nouvelleCle(), proba: e.probability == null ? '' : String(e.probability) };
}

function LigneEtape({ ligne, fr, onChange, onRetirer }: {
  ligne: Ligne;
  fr: boolean;
  onChange: (l: Ligne) => void;
  onRetirer: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ligne.cle });
  const verrouillee = ligne.kind !== 'open';
  const idNom = `etape-nom-${ligne.cle}`;
  const idProba = `etape-proba-${ligne.cle}`;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`grid grid-cols-[20px_minmax(0,1fr)_104px_96px_28px] items-center gap-2 py-1 ${isDragging ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={fr ? `Déplacer « ${ligne.nom_fr} »` : `Move “${ligne.nom_fr}”`}
        className="cursor-grab touch-none rounded text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
      >
        <GripVertical size={14} aria-hidden="true" />
      </button>
      <div>
        <label htmlFor={idNom} className="sr-only">{fr ? 'Nom de l’étape' : 'Stage name'}</label>
        <input
          id={idNom}
          type="text"
          value={ligne.nom_fr}
          onChange={(e) => onChange({ ...ligne, nom_fr: e.target.value })}
          className="input-field w-full text-[12.5px]"
        />
      </div>
      <IconesRapports
        fr={fr}
        nomEtape={ligne.nom_fr || '…'}
        entonnoir={ligne.show_in_reports}
        camembert={ligne.show_in_pie}
        onEntonnoir={(v) => onChange({ ...ligne, show_in_reports: v })}
        onCamembert={(v) => onChange({ ...ligne, show_in_pie: v })}
      />
      <div className="flex items-center gap-1">
        <label htmlFor={idProba} className="sr-only">{fr ? 'Probabilité (%)' : 'Probability (%)'}</label>
        <input
          id={idProba}
          type="text"
          inputMode="decimal"
          value={ligne.proba}
          disabled={verrouillee}
          placeholder={fr ? 'auto' : 'auto'}
          onChange={(e) => onChange({ ...ligne, proba: e.target.value })}
          className="input-field w-full text-[12.5px] tabular-nums disabled:opacity-60"
        />
        <span aria-hidden="true" className="text-[12px] text-text-tertiary">%</span>
      </div>
      {verrouillee ? (
        <span
          title={fr ? 'Étape système : ne peut pas être supprimée' : 'System stage: cannot be deleted'}
          className="flex justify-center text-text-muted"
        >
          <Lock size={13} aria-label={fr ? 'Verrouillée' : 'Locked'} />
        </span>
      ) : (
        <button
          type="button"
          onClick={onRetirer}
          aria-label={fr ? `Supprimer l’étape « ${ligne.nom_fr} »` : `Delete stage “${ligne.nom_fr}”`}
          className="flex justify-center rounded p-1 text-text-muted hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default function PipelineModal({ ouvert, fr, pipeline, onFermer, onEnregistre }: {
  ouvert: boolean;
  fr: boolean;
  /** Absent = création. Présent = « Modifier le pipeline ». */
  pipeline?: PipelineResume | null;
  onFermer: () => void;
  onEnregistre: (pipelineId: string) => void;
}) {
  const idNom = useId();
  const idAide = useId();
  const modification = !!pipeline;
  const [nom, setNom] = useState('');
  const [probaParDeal, setProbaParDeal] = useState(false);
  const [couleur, setCouleur] = useState<ModeCouleur>('none');
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [chargement, setChargement] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  // (Ré)initialise à chaque ouverture : un modal rouvert ne doit pas montrer
  // la saisie abandonnée d'un autre pipeline.
  useEffect(() => {
    if (!ouvert) return;
    if (!pipeline) {
      setNom('');
      setProbaParDeal(false);
      setCouleur('none');
      setLignes(etapesParDefaut().map(versLigne));
      return;
    }
    setNom(pipeline.name);
    setProbaParDeal(!!pipeline.use_deal_probability);
    setCouleur(pipeline.color_mode ?? 'none');
    setChargement(true);
    let annule = false;
    fetchStages(pipeline.id)
      .then((etapes) => {
        if (annule) return;
        setLignes(etapes
          .filter((e) => e.archived_at === null)
          .sort((a, b) => a.position - b.position)
          .map((e) => versLigne({
            id: e.id, nom_fr: e.name_fr, nom_en: e.name_en, kind: e.kind,
            probability: e.probability, show_in_reports: e.show_in_reports, show_in_pie: e.show_in_pie,
          })));
      })
      .catch((e: unknown) => {
        console.error('[pipelines] lecture des étapes', e);
        toast.error(fr ? 'Impossible de charger les étapes.' : 'Could not load stages.');
      })
      .finally(() => { if (!annule) setChargement(false); });
    return () => { annule = true; };
  }, [ouvert, pipeline, fr]);

  const capteurs = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const nbOuvertes = lignes.filter((l) => l.kind === 'open').length;
  const nomVide = nom.trim() === '';
  const raisonBloque = nomVide
    ? (fr ? 'Donnez un nom au pipeline' : 'Name the pipeline')
    : nbOuvertes === 0
      ? (fr ? 'Ajoutez au moins une étape' : 'Add at least one stage')
      : null;

  const ids = useMemo(() => lignes.map((l) => l.cle), [lignes]);

  function glisser(ev: DragEndEvent) {
    if (!ev.over || ev.active.id === ev.over.id) return;
    setLignes((ls) => {
      const de = ls.findIndex((l) => l.cle === ev.active.id);
      const vers = ls.findIndex((l) => l.cle === ev.over!.id); // over vérifié juste au-dessus
      return arrayMove(ls, de, vers);
    });
  }

  function ajouter() {
    // Une nouvelle étape se glisse AVANT Gagné/Perdu : c'est là qu'on la veut
    // neuf fois sur dix, et elle se déplace ensuite.
    setLignes((ls) => {
      const avantFin = ls.findIndex((l) => l.kind !== 'open');
      const neuve: Ligne = {
        cle: nouvelleCle(), nom_fr: '', nom_en: '', kind: 'open', proba: '',
        show_in_reports: true, show_in_pie: true,
      };
      if (avantFin < 0) return [...ls, neuve];
      return [...ls.slice(0, avantFin), neuve, ...ls.slice(avantFin)];
    });
  }

  async function soumettre() {
    if (raisonBloque) { toast.error(raisonBloque); return; }
    if (lignes.some((l) => l.nom_fr.trim() === '')) {
      toast.error(fr ? 'Chaque étape doit avoir un nom.' : 'Every stage needs a name.');
      return;
    }
    const probas = lignes.map((l) => lireProbabilite(l.proba));
    if (probas.some((p) => p !== null && (Number.isNaN(p) || p < 0 || p > 100))) {
      toast.error(fr ? 'La probabilité doit être comprise entre 0 et 100.' : 'Probability must be between 0 and 100.');
      return;
    }
    setEnvoi(true);
    try {
      const id = await enregistrerPipeline(pipeline?.id ?? null, {
        nom,
        color_mode: couleur,
        use_deal_probability: probaParDeal,
        etapes: lignes.map((l, i) => ({
          id: l.id, nom_fr: l.nom_fr, nom_en: l.nom_en, kind: l.kind,
          probability: probas[i] ?? null, show_in_reports: l.show_in_reports, show_in_pie: l.show_in_pie,
        })),
      });
      toast.success(modification
        ? (fr ? 'Pipeline enregistré.' : 'Pipeline saved.')
        : (fr ? `« ${nom.trim()} » créé.` : `“${nom.trim()}” created.`));
      onEnregistre(id);
    } catch (e) {
      console.error('[pipelines] enregistrement', e);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open={ouvert}
      onClose={onFermer}
      size="xl"
      title={modification ? (fr ? 'Modifier le pipeline' : 'Edit pipeline') : (fr ? 'Créer un pipeline' : 'Create pipeline')}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onFermer} className="btn-secondary text-[13px] px-4 py-1.5">
            {fr ? 'Annuler' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => void soumettre()}
            disabled={envoi || chargement || !!raisonBloque}
            title={raisonBloque ?? undefined}
            className="btn-primary text-[13px] px-4 py-1.5 disabled:opacity-50"
          >
            {envoi
              ? (fr ? 'Enregistrement…' : 'Saving…')
              : modification ? (fr ? 'Enregistrer' : 'Save') : (fr ? 'Créer' : 'Create')}
          </button>
        </div>
      )}
    >
      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor={idNom} className="mb-1 block text-[12.5px] font-medium text-text-primary">
            {fr ? 'Nom du pipeline' : 'Pipeline name'} <span className="text-red-600" aria-hidden="true">*</span>
          </label>
          <input
            id={idNom}
            type="text"
            autoFocus
            required
            aria-describedby={idAide}
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder={fr ? 'Pipeline marketing' : 'Marketing pipeline'}
            className="input-field w-full text-[13px]"
          />
          <p id={idAide} className="mt-1 text-[11.5px] text-text-tertiary">
            {fr
              ? 'Utilisez un nom unique et descriptif pour retrouver ce pipeline facilement'
              : 'Use a unique, descriptive name so you can find this pipeline later'}
          </p>
        </div>

        <CarteProbabilite fr={fr} actif={probaParDeal} onChange={setProbaParDeal} />
        <CarteCouleurs fr={fr} valeur={couleur} onChange={setCouleur} compact />

        <div className="flex items-center justify-between pt-1">
          <h3 className="text-[13.5px] font-semibold text-text-primary">
            {fr ? `Étapes du pipeline (${lignes.length})` : `Pipeline stages (${lignes.length})`}
          </h3>
          <button
            type="button"
            onClick={ajouter}
            className="inline-flex items-center gap-1 rounded text-[12.5px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
          >
            <Plus size={13} aria-hidden="true" />
            {fr ? 'Ajouter une étape' : 'Add stage'}
          </button>
        </div>

        <div className="rounded-lg border border-outline px-3 py-2">
          <div className="grid grid-cols-[20px_minmax(0,1fr)_104px_96px_28px] gap-2 pb-1 text-[11.5px] font-medium text-text-tertiary">
            <span />
            <span>{fr ? 'Nom de l’étape' : 'Stage name'}</span>
            <span>{fr ? 'Afficher dans les rapports' : 'Show in reports'}</span>
            <span>{fr ? 'Probabilité (%)' : 'Probability (%)'}</span>
            <span />
          </div>
          {chargement ? (
            <p className="py-6 text-center text-[12px] text-text-muted">{fr ? 'Chargement…' : 'Loading…'}</p>
          ) : (
            <DndContext sensors={capteurs} collisionDetection={closestCenter} onDragEnd={glisser}>
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                {lignes.map((l) => (
                  <LigneEtape
                    key={l.cle}
                    ligne={l}
                    fr={fr}
                    onChange={(n) => setLignes((ls) => ls.map((x) => (x.cle === l.cle ? n : x)))}
                    onRetirer={() => setLignes((ls) => ls.filter((x) => x.cle !== l.cle))}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
          {modification && (
            <p className="pt-2 text-[11px] text-text-muted">
              {fr
                ? 'Une étape qui contient des deals se supprime depuis la page du pipeline : on vous demandera où les déplacer.'
                : 'A stage that holds deals is deleted from the pipeline page: you’ll be asked where to move them.'}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
