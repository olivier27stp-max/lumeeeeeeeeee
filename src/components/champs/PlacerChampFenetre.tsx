/**
 * « Placer dans le formulaire » — demande de Rafba (2026-09-28) : quand on ajoute
 * une custom key, le formulaire (ex. Nouveau client) s'ouvre, lui propose une place
 * (surlignée), on la glisse entre les champs de base, puis « Sauvegarder ».
 *
 * Les champs de base (rangées grises, cadenas) ne bougent pas ; seules les custom
 * keys se glissent. La place s'enregistre pour tout le compte : dossier (section),
 * `config.apres` (la rangée suivie) et `position` — règle de src/lib/champs/placement.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GripVertical, Lock, X, Loader2 } from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { enregistrerPlan, modifierChamp, type ChampPerso, type DossierChamp, type ObjetChamp } from '../../lib/champsPersoApi';
import ApercuVraiFormulaire, { OBJETS_VRAI_FORMULAIRE, type PlaceFormulaire } from './ApercuVraiFormulaire';
import ChampSaisie from './ChampSaisie';
import { TITRE_FORMULAIRE, planFormulaire, type ElementPlan } from '../../lib/champs/placement';
import { cn } from '../../lib/utils';

function Element({ e, cible, fr }: { e: ElementPlan; cible: string; fr: boolean }) {
  const mobile = e.type === 'champ';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: e.id, disabled: !mobile });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  if (e.type === 'entete') {
    return (
      <li ref={setNodeRef} style={style} className="px-1 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary first:pt-1">
        {e.titre}
      </li>
    );
  }
  if (e.type === 'rangee') {
    return (
      <li ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-md border border-outline bg-surface-secondary/60 px-3 py-2 text-[13px] text-text-secondary">
        <span className="min-w-0 flex-1 truncate">{e.libelle}</span>
        <Lock size={12} className="shrink-0 text-text-tertiary" aria-label={fr ? 'Champ de base' : 'Base field'} />
      </li>
    );
  }
  const estCible = e.champ.id === cible;
  return (
    <li ref={setNodeRef} style={style} data-cible={estCible || undefined}
      className={cn('flex items-center gap-2 rounded-md border bg-surface px-2 py-2 text-[13px] text-text-primary shadow-sm',
        estCible ? 'border-primary ring-2 ring-primary/30' : 'border-outline')}>
      <button type="button" {...attributes} {...listeners} aria-label={fr ? `Déplacer ${e.champ.label}` : `Move ${e.champ.label}`}
        className="cursor-grab rounded p-0.5 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <GripVertical size={14} aria-hidden />
      </button>
      <span className="min-w-0 flex-1 truncate font-medium">{e.champ.label}</span>
      {estCible && <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{fr ? 'À placer' : 'To place'}</span>}
    </li>
  );
}

export default function PlacerChampFenetre({ objet, champ, champs, dossiers, fr, onClose, onSauvegarde }: {
  objet: ObjetChamp;
  /** La custom key à placer (surlignée). */
  champ: ChampPerso;
  /** Custom keys actives de l'objet (la cible incluse ou non). */
  champs: ChampPerso[];
  dossiers: DossierChamp[];
  fr: boolean;
  onClose: () => void;
  onSauvegarde?: () => void;
}) {
  const qc = useQueryClient();
  const idTitre = useId();
  const tous = useMemo(() => {
    const actifs = champs.filter((c) => c.object_type === objet && !c.archived_at && !c.config?.masque_creation);
    return actifs.some((c) => c.id === champ.id) ? actifs : [...actifs, champ];
  }, [champs, champ, objet]);
  const initial = useMemo(() => planFormulaire(objet, tous, dossiers, fr), [objet, tous, dossiers, fr]);
  const [plan, setPlan] = useState<ElementPlan[]>(initial);
  const [envoi, setEnvoi] = useState(false);
  const liste = useRef<HTMLUListElement>(null);
  const corps = useRef<HTMLDivElement>(null);
  // Client, devis, job : le VRAI formulaire, et on y dépose le champ (Rafba, 2026-09-28).
  const vrai = OBJETS_VRAI_FORMULAIRE.includes(objet);
  const placeInitiale: PlaceFormulaire = { folder_id: champ.folder_id ?? null, apres: champ.config?.apres ?? null };
  const [place, setPlace] = useState<PlaceFormulaire>(placeInitiale);
  const deplace = place.folder_id !== placeInitiale.folder_id || place.apres !== placeInitiale.apres;
  const cibleVraie = {
    ...champ, folder_id: place.folder_id, config: { ...champ.config, apres: place.apres },
    // Déplacé : à la fin de sa nouvelle place.
    position: deplace ? 1_000_000 : champ.position,
  } as ChampPerso;
  const idCible = useId();
  const rendreCible = () => (
    <>
      <label htmlFor={idCible} className="mb-1 block text-[12px] font-medium text-text-secondary">
        {champ.label}{champ.is_required && <span className="text-red-500" aria-hidden> *</span>}
      </label>
      <ChampSaisie id={idCible} champ={champ} valeur={null} fr={fr} onValider={() => {}} disabled />
    </>
  );

  // La place proposée : visible dès l'ouverture (le vrai formulaire se charge un peu après).
  useEffect(() => {
    liste.current?.querySelector('[data-cible]')?.scrollIntoView({ block: 'center' });
    if (!vrai) return;
    const t = setTimeout(() => corps.current?.querySelector('[data-cible-apercu]')?.scrollIntoView({ block: 'center' }), 1500);
    return () => clearTimeout(t);
  }, [vrai]);
  useEffect(() => {
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', echap);
    return () => document.removeEventListener('keydown', echap);
  }, [onClose]);

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const surDrag = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setPlan((p) => {
      const a = p.findIndex((x) => x.id === e.active.id);
      const b = p.findIndex((x) => x.id === e.over!.id);
      // Jamais au-dessus du 1er en-tête : le formulaire commence par une section.
      return a < 0 || b < 0 ? p : arrayMove(p, a, Math.max(1, b));
    });
  };

  const sauvegarder = async () => {
    setEnvoi(true);
    try {
      if (vrai) {
        if (deplace) {
          await modifierChamp(champ.id, {
            folder_id: place.folder_id, config: { apres: place.apres },
            position: Math.max(0, ...tous.map((c) => c.position ?? 0)) + 1,
          });
        }
      } else {
        await enregistrerPlan(objet, plan, tous);
      }
      await qc.invalidateQueries({ queryKey: ['champs-perso'] });
      toast.success(fr ? `« ${champ.label} » est placé dans le formulaire.` : `“${champ.label}” is placed in the form.`);
      onSauvegarde?.();
      onClose();
    } catch (err) {
      console.error('[PlacerChampFenetre] enregistrement', err);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  };

  const titre = fr ? TITRE_FORMULAIRE[objet].fr : TITRE_FORMULAIRE[objet].en;
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4" role="presentation" tabIndex={-1} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={idTitre} tabIndex={-1} onClick={(e) => e.stopPropagation()}
        className={cn('flex w-full flex-col rounded-xl bg-surface shadow-2xl', vrai ? 'h-[94vh] max-w-6xl' : 'max-h-[90vh] max-w-lg')}>
        <div className="flex items-start justify-between border-b border-outline px-5 py-4">
          <div className="min-w-0">
            <h2 id={idTitre} className="text-[16px] font-semibold text-text-primary">
              {fr ? `Placer « ${champ.label} »` : `Place “${champ.label}”`}
            </h2>
            <p className="mt-0.5 text-[12px] text-text-tertiary">
              {fr
                ? (vrai
                  ? `Le vrai formulaire « ${titre} » — attrape le champ par sa poignée ⋮⋮ et dépose-le dans une zone « Déposer ici », puis Sauvegarder.`
                  : `Formulaire « ${titre} » — glisse le champ à la place voulue, puis Sauvegarder. Les champs de base (cadenas) ne bougent pas.`)
                : (vrai
                  ? `The real “${titre}” form — grab the field by its ⋮⋮ handle and drop it on a “Drop here” zone, then Save.`
                  : `“${titre}” form — drag the field where you want it, then Save. Base fields (lock) stay put.`)}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={fr ? 'Fermer' : 'Close'}
            className="rounded p-1 text-text-tertiary hover:bg-surface-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X size={16} /></button>
        </div>
        {vrai ? (
          <div ref={corps} className="flex-1 overflow-y-auto bg-surface-secondary/40 p-4">
            <ApercuVraiFormulaire objet={objet} cible={cibleVraie} rendreCible={rendreCible} dossiers={dossiers} fr={fr} onPlace={setPlace} />
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={surDrag}
          // Défilement automatique seulement tout près du bord : sinon, déposer sur une
          // rangée du haut fait défiler jusqu'en haut pendant qu'on vise.
          autoScroll={{ threshold: { x: 0, y: 0.08 } }}
            accessibility={{ screenReaderInstructions: { draggable: fr
              ? 'Pour déplacer un champ, appuie sur Espace, puis sur les flèches ; Espace pour le déposer, Échap pour annuler.'
              : 'To move a field, press Space, then the arrow keys; Space to drop it, Escape to cancel.' } }}>
            <SortableContext items={plan.map((e) => e.id)} strategy={verticalListSortingStrategy}>
              <ul ref={liste} className="space-y-1.5">
                {plan.map((e) => <Element key={e.id} e={e} cible={champ.id} fr={fr} />)}
              </ul>
            </SortableContext>
          </DndContext>
        </div>
        )}
        <div className="flex justify-end gap-2 border-t border-outline px-5 py-3">
          <button type="button" onClick={onClose} className="glass-button px-4 py-2 text-[13px]">{fr ? 'Annuler' : 'Cancel'}</button>
          <button type="button" onClick={() => { void sauvegarder(); }} disabled={envoi || (vrai && !deplace)}
            className="glass-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-[13px] disabled:opacity-50">
            {envoi && <Loader2 size={13} className="animate-spin" aria-hidden />}{fr ? 'Sauvegarder' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
