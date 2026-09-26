/**
 * « Gérer les champs » d'une fenêtre de création (Nouveau client, job,
 * soumission, facture, carte du pipeline) — le « Customize form » de
 * GoHighLevel, directement DANS la fenêtre (analyse Muse, 2026-09-25) :
 *
 *   · « Champs affichés » : cocher / décocher, glisser ⋮⋮ pour l'ordre,
 *     « Obligatoire » (message explicite à la création, pas un bouton grisé) ;
 *   · « Ajouter des champs » : les autres champs de cet objet, à cocher ;
 *   · recherche ; « + Créer un champ » sans quitter la fenêtre ;
 *   · Annuler / Appliquer.
 *
 * Réglage pour TOUT le compte (comme GHL) : `config.masque_creation`,
 * `is_required` et `position` du champ. L'ordre est celui des fiches aussi.
 * Propriétaire et admin seulement.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GripVertical, Plus, Search, X, Loader2 } from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { modifierChamp, type ChampPerso, type DossierChamp, type ObjetChamp } from '../../lib/champsPersoApi';
import ModaleChamp from './reglages/ModaleChamp';

interface Etat { id: string; affiche: boolean; obligatoire: boolean }

function LigneAffichee({ champ, etat, fr, onChange }: {
  champ: ChampPerso; etat: Etat; fr: boolean; onChange: (e: Partial<Etat>) => void;
}) {
  const id = useId();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: champ.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-surface-secondary">
      <button type="button" {...attributes} {...listeners} aria-label={fr ? `Déplacer ${champ.label}` : `Move ${champ.label}`}
        className="cursor-grab rounded p-0.5 text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <GripVertical size={14} aria-hidden />
      </button>
      <input id={`${id}-aff`} type="checkbox" checked onChange={() => onChange({ affiche: false })} className="h-4 w-4 accent-primary"
        aria-label={fr ? `Retirer ${champ.label}` : `Remove ${champ.label}`} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">{champ.label}</span>
      <label htmlFor={`${id}-req`} className="flex shrink-0 items-center gap-1 text-[11px] text-text-secondary">
        <input id={`${id}-req`} type="checkbox" checked={etat.obligatoire} onChange={(e) => onChange({ obligatoire: e.target.checked })} className="h-3.5 w-3.5 accent-primary" />
        {fr ? 'Obligatoire' : 'Required'}
      </label>
    </div>
  );
}

export default function GererChampsFenetre({ objet, titreFenetre, champs, dossiers, fr, onClose, portee = 'creation' }: {
  objet: ObjetChamp;
  titreFenetre: string;
  /** « creation » : la fenêtre « Nouveau … » ; « fiche » : la fiche d'un élément existant. */
  portee?: 'creation' | 'fiche';
  /** Champs actifs (non archivés) de l'objet, dans l'ordre. */
  champs: ChampPerso[];
  dossiers: DossierChamp[];
  fr: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const cleMasque = portee === 'fiche' ? 'masque_fiche' : 'masque_creation';
  const lieu = portee === 'fiche' ? (fr ? 'la fiche' : 'the record') : (fr ? 'la fenêtre' : 'the window');
  const idRecherche = useId();
  const initial = useMemo(() => champs.map((c) => ({ id: c.id, affiche: !c.config?.[cleMasque], obligatoire: !!c.is_required })), [champs, cleMasque]);
  const [etats, setEtats] = useState<Etat[]>(initial);
  const [ordre, setOrdre] = useState<string[]>(champs.map((c) => c.id));
  const [recherche, setRecherche] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [creation, setCreation] = useState(false);
  useEffect(() => { setEtats(initial); setOrdre(champs.map((c) => c.id)); }, [initial, champs]);

  const parId = useMemo(() => new Map(champs.map((c) => [c.id, c])), [champs]);
  const etat = (id: string) => etats.find((e) => e.id === id)!;
  const poser = (id: string, p: Partial<Etat>) => setEtats((es) => es.map((e) => (e.id === id ? { ...e, ...p } : e)));
  const q = recherche.trim().toLowerCase();
  const correspond = (id: string) => !q || (parId.get(id)?.label ?? '').toLowerCase().includes(q);
  const affiches = ordre.filter((id) => parId.has(id) && etat(id)?.affiche && correspond(id));
  const disponibles = ordre.filter((id) => parId.has(id) && !etat(id)?.affiche && correspond(id));
  const modifie = JSON.stringify(etats) !== JSON.stringify(initial) || ordre.join() !== champs.map((c) => c.id).join();

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const surDrag = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setOrdre((o) => arrayMove(o, o.indexOf(String(e.active.id)), o.indexOf(String(e.over!.id))));
  };

  const appliquer = async () => {
    setEnCours(true);
    try {
      await Promise.all(ordre.map((id, pos) => {
        const c = parId.get(id);
        const e = etat(id);
        if (!c || !e) return null;
        const patch: Parameters<typeof modifierChamp>[1] = {};
        if (e.affiche !== !c.config?.[cleMasque]) patch.config = { [cleMasque]: !e.affiche };
        if (e.obligatoire !== !!c.is_required) patch.is_required = e.obligatoire;
        if ((c.position ?? 0) !== pos) patch.position = pos;
        return Object.keys(patch).length ? modifierChamp(id, patch) : null;
      }));
      await qc.invalidateQueries({ queryKey: ['champs-perso', objet] });
      await qc.invalidateQueries({ queryKey: ['champs-perso-valeurs', objet] });
      toast.success(fr ? `Champs de ${lieu} enregistrés.` : `Fields of ${lieu} saved.`);
      onClose();
    } catch (err) {
      console.error('[GererChampsFenetre] enregistrement', err);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setEnCours(false);
    }
  };

  // Portail vers <body> : rendu DANS une fiche animée (transform), le panneau restait
  // coincé sous le widget « Configuration » et le bouton d'aide, « Appliquer » caché.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/30" role="presentation" tabIndex={-1} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={fr ? 'Gérer les champs' : 'Manage fields'} tabIndex={-1}
        className="flex h-full w-full max-w-sm flex-col bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-outline px-4 py-3">
          <div>
            <h3 className="text-[15px] font-semibold text-text-primary">{fr ? 'Gérer les champs' : 'Manage fields'}</h3>
            <p className="text-[12px] text-text-tertiary">{fr ? `${portee === 'fiche' ? 'Fiche' : 'Fenêtre'} « ${titreFenetre} » — pour tout le compte` : `“${titreFenetre}” ${portee === 'fiche' ? 'record' : 'window'} — for the whole account`}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={fr ? 'Fermer' : 'Close'}
            className="rounded p-1 text-text-tertiary hover:bg-surface-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X size={16} /></button>
        </div>

        <div className="border-b border-outline px-4 py-2.5">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" aria-hidden />
            <input id={idRecherche} value={recherche} onChange={(e) => setRecherche(e.target.value)}
              aria-label={fr ? 'Chercher un champ' : 'Search fields'} placeholder={fr ? 'Chercher un champ' : 'Search fields'}
              className="glass-input h-8 w-full pl-8 text-[13px]" />
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
          <section>
            <p className="mb-1 px-1 text-[12px] font-semibold text-text-secondary">{fr ? `Champs affichés dans ${lieu}` : `Fields shown in ${lieu}`}</p>
            {affiches.length === 0 ? (
              <p className="px-1 text-[12px] text-text-tertiary">{fr ? 'Aucun. Coche un champ plus bas pour l’ajouter.' : 'None. Check a field below to add it.'}</p>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={surDrag}>
                <SortableContext items={affiches} strategy={verticalListSortingStrategy}>
                  {affiches.map((id) => <LigneAffichee key={id} champ={parId.get(id)!} etat={etat(id)} fr={fr} onChange={(p) => poser(id, p)} />)}
                </SortableContext>
              </DndContext>
            )}
          </section>
          <section>
            <p className="mb-1 px-1 text-[12px] font-semibold text-text-secondary">{fr ? 'Ajouter des champs' : 'Add fields'}</p>
            {disponibles.length === 0 ? (
              <p className="px-1 text-[12px] text-text-tertiary">{fr ? `Tous tes champs sont déjà dans ${lieu}.` : `All your fields are already in ${lieu}.`}</p>
            ) : disponibles.map((id) => (
              <label key={id} htmlFor={`${idRecherche}-${id}`} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 pl-6 text-[13px] text-text-primary hover:bg-surface-secondary">
                <input id={`${idRecherche}-${id}`} type="checkbox" checked={false} onChange={() => poser(id, { affiche: true })} className="h-4 w-4 accent-primary" />
                {parId.get(id)!.label}
              </label>
            ))}
          </section>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-outline px-4 py-3">
          <button type="button" onClick={() => setCreation(true)}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded">
            <Plus size={13} aria-hidden />{fr ? 'Créer un champ' : 'Create a field'}
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="glass-button px-3 py-1.5 text-[13px]">{fr ? 'Annuler' : 'Cancel'}</button>
            <button type="button" onClick={appliquer} disabled={!modifie || enCours} className="glass-button-primary flex items-center gap-1.5 px-3 py-1.5 text-[13px] disabled:opacity-50">
              {enCours && <Loader2 size={13} className="animate-spin" aria-hidden />}{fr ? 'Appliquer' : 'Apply'}
            </button>
          </div>
        </div>
      </div>
      {creation && (
        <div role="presentation" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
          <ModaleChamp open onClose={() => setCreation(false)} objet={objet} dossiers={dossiers} fr={fr}
            onEnregistre={() => { void qc.invalidateQueries({ queryKey: ['champs-perso', objet] }); setCreation(false); }} />
        </div>
      )}
    </div>,
    document.body,
  );
}
