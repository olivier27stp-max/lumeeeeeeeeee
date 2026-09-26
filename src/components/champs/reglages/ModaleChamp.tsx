/**
 * Créer / modifier un champ personnalisé — reproduit l'écran « Create custom
 * field » de GoHighLevel (capture de Rafba, 2026-09-25) : panneau latéral
 * pleine hauteur, bloc « Détails du champ » (Type | Objet, Nom | Dossier,
 * Clé ⓘ, Description), bloc « Valeur par défaut » (texte indicatif ⓘ, valeur
 * pré-remplie, réglages du type), « Aperçu en direct » à droite, Annuler /
 * Créer en bas.
 * En modification, le type ne propose que les conversions sans perte, et la
 * clé est figée (les modèles et automatisations en dépendent).
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { ChevronDown, Copy, GripVertical, Info, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { confirmer } from '../../ui/ConfirmDialog';
import { cn } from '../../../lib/utils';
import {
  creerChamp, creerDossier, modifierChamp, type ChampPerso, type DossierChamp, type EntreeOption, type ObjetChamp, type TypeChamp,
} from '../../../lib/champsPersoApi';
import { OBJETS, TYPES_CHAMP, LIBELLES_OBJET, LIBELLES_TYPE, conversionPermise, variableAffichee, type ConfigChamp, type ValeurChamp } from '../../../lib/champs/types';
import { slugCle } from '../../../lib/champs/valeurs';
import { clesStandard } from '../../../lib/champs/standard';
import { AIDE_TYPE } from '../icones';
import ChampSaisie from '../ChampSaisie';

interface Props {
  open: boolean;
  onClose: () => void;
  onEnregistre: (c: ChampPerso) => void;
  /** Objet proposé par défaut (onglet courant) ; choisi dans la modale à la création. */
  objet: ObjetChamp;
  /** Dossiers de TOUS les objets : la liste suit l'objet choisi. */
  dossiers: DossierChamp[];
  /** Présent = modification. */
  champ?: ChampPerso | null;
  /** Dossier présélectionné à la création. */
  dossierInitial?: string | null;
  fr: boolean;
}

type OptionEdit = EntreeOption & { _cle: string };
const couleurs = ['#64748b', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];
let compteur = 0;
const nouvelleCle = () => `o${++compteur}`;

function LigneOption({ o, fr, onChange, onRetirer, idBase }: {
  o: OptionEdit; fr: boolean; idBase: string; onChange: (p: Partial<OptionEdit>) => void; onRetirer: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: o._cle });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      <button type="button" {...attributes} {...listeners} aria-label={fr ? 'Déplacer l’option' : 'Move option'}
        className="cursor-grab rounded p-1 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <GripVertical size={14} aria-hidden />
      </button>
      <input
        type="color" aria-label={fr ? 'Couleur de l’option' : 'Option color'} value={o.color || '#64748b'}
        onChange={(e) => onChange({ color: e.target.value })}
        className="h-7 w-7 shrink-0 cursor-pointer rounded border border-outline bg-transparent p-0.5"
      />
      <input
        id={`${idBase}-${o._cle}`} aria-label={fr ? 'Libellé de l’option' : 'Option label'} value={o.label} maxLength={100}
        onChange={(e) => onChange({ label: e.target.value })}
        className="glass-input h-8 flex-1 text-[13px]"
      />
      <button type="button" onClick={onRetirer} aria-label={fr ? 'Retirer l’option' : 'Remove option'}
        className="rounded p-1 text-text-tertiary hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <Trash2 size={14} aria-hidden />
      </button>
    </div>
  );
}

export default function ModaleChamp({ open, onClose, onEnregistre, objet: objetDefaut, dossiers: tousDossiers, champ, dossierInitial, fr }: Props) {
  const ids = useId();
  const edition = !!champ;
  // « Ajouter à l'objet » : n'importe quel objet, avec ou sans pipeline.
  const [objet, setObjet] = useState<ObjetChamp>(champ?.object_type ?? objetDefaut);
  // Dossiers créés depuis ce panneau (« Créer un dossier ») : la liste du parent ne les a pas encore.
  const [dossiersCrees, setDossiersCrees] = useState<DossierChamp[]>([]);
  const dossiers = [...tousDossiers, ...dossiersCrees.filter((c) => !tousDossiers.some((d) => d.id === c.id))]
    .filter((d) => d.object_type === objet);
  const [nouveauDossier, setNouveauDossier] = useState<string | null>(null);
  const [creationDossier, setCreationDossier] = useState(false);
  const [type, setType] = useState<TypeChamp>(champ?.field_type ?? 'single_line');
  const [label, setLabel] = useState(champ?.label ?? '');
  const [cle, setCle] = useState(champ?.key ?? '');
  const [cleTouchee, setCleTouchee] = useState(false);
  const [dossier, setDossier] = useState<string>(champ?.folder_id ?? dossierInitial ?? '');
  const [placeholder, setPlaceholder] = useState(champ?.placeholder ?? '');
  const [aide, setAide] = useState(champ?.help_text ?? '');
  const [obligatoire, setObligatoire] = useState(champ?.is_required ?? false);
  const [config, setConfig] = useState<ConfigChamp>(champ?.config ?? {});
  const [options, setOptions] = useState<OptionEdit[]>(
    (champ?.options ?? []).filter((o) => !o.archived_at).map((o) => ({ id: o.id, label: o.label, color: o.color, _cle: nouvelleCle() })),
  );
  const [apercu, setApercu] = useState<string | number | string[] | null>(null);
  // Valeur par défaut : pour une liste, stockée en LIBELLÉ(S) d'option (les ids
  // n'existent pas encore à la création) ; saisie ici via les clés locales.
  const [defaut, setDefaut] = useState<ValeurChamp>(() => {
    const v = champ?.default_value;
    if (v === null || v === undefined || typeof v === 'boolean') return null;
    return v;
  });
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setObjet(champ?.object_type ?? objetDefaut);
    setErreur(null);
  }, [open, champ, objetDefaut]);

  // La clé suit le libellé tant qu'on ne l'a pas touchée (création seulement).
  useEffect(() => {
    if (!edition && !cleTouchee) setCle(slugCle(label));
  }, [label, edition, cleTouchee]);

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const avecOptions = type === 'dropdown_single' || type === 'dropdown_multi';
  const cleReservee = !edition && clesStandard(objet).includes(cle);
  const cleInvalide = !edition && !/^[a-z][a-z0-9_]{0,49}$/.test(cle);
  const typesPermis = edition ? TYPES_CHAMP.filter((t) => conversionPermise(champ!.field_type, t)) : TYPES_CHAMP;

  const problemes = useMemo(() => {
    const p: string[] = [];
    if (!label.trim()) p.push(fr ? 'Le nom du champ est obligatoire.' : 'Field name is required.');
    if (cleInvalide) p.push(fr ? 'Clé : lettres minuscules, chiffres et _ (commence par une lettre).' : 'Key: lowercase letters, digits and _ (starts with a letter).');
    if (cleReservee) p.push(fr ? `« ${cle} » est réservé à un champ standard.` : `“${cle}” is reserved for a standard field.`);
    if (avecOptions && options.filter((o) => o.label.trim()).length === 0) p.push(fr ? 'Ajoute au moins une option.' : 'Add at least one option.');
    const libelles = options.map((o) => o.label.trim().toLowerCase()).filter(Boolean);
    if (new Set(libelles).size !== libelles.length) p.push(fr ? 'Deux options portent le même nom.' : 'Two options share the same name.');
    if (type === 'number' && config.min != null && config.max != null && config.min > config.max) p.push(fr ? 'Le minimum dépasse le maximum.' : 'Minimum exceeds maximum.');
    return p;
  }, [label, cleInvalide, cleReservee, cle, avecOptions, options, type, config, fr]);

  // Liste : libellés stockés ⇄ clés locales des options affichées.
  const cleOption = (o: OptionEdit) => o.id ?? o._cle;
  const defautSaisi: ValeurChamp = !avecOptions || defaut === null ? defaut
    : Array.isArray(defaut)
      ? defaut.map((l) => options.find((o) => o.label === l)).filter((o): o is OptionEdit => !!o).map(cleOption)
      : (() => { const o = options.find((x) => x.label === defaut); return o ? cleOption(o) : null; })();
  const surDefaut = (v: ValeurChamp) => {
    if (!avecOptions || v === null) return setDefaut(v);
    const libelle = (k: string) => options.find((o) => cleOption(o) === k)?.label ?? '';
    setDefaut(Array.isArray(v) ? v.map(libelle).filter(Boolean) : libelle(String(v)) || null);
  };
  const defautFinal = (): ValeurChamp => {
    if (defaut === null || defaut === '' || (Array.isArray(defaut) && defaut.length === 0)) return null;
    if (!avecOptions) return defaut;
    const libelles = new Set(options.map((o) => o.label.trim()).filter(Boolean));
    // Une option renommée ou retirée entre-temps ne laisse pas de défaut orphelin.
    return Array.isArray(defaut) ? (defaut.filter((l) => libelles.has(l)).length ? defaut.filter((l) => libelles.has(l)) : null)
      : (libelles.has(String(defaut)) ? defaut : null);
  };

  const ajouterDossier = async () => {
    const nom = (nouveauDossier ?? '').trim();
    if (!nom) return;
    setCreationDossier(true);
    try {
      const id = await creerDossier(objet, nom);
      setDossiersCrees((l) => [...l, { id, object_type: objet, name: nom } as DossierChamp]);
      setDossier(id);
      setNouveauDossier(null);
    } catch (err) {
      console.error('[ModaleChamp] création du dossier', err);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCreationDossier(false);
    }
  };

  const enregistrer = async () => {
    if (problemes.length) { setErreur(problemes[0]); return; }
    setEnvoi(true);
    setErreur(null);
    const opts = avecOptions ? options.filter((o) => o.label.trim()).map(({ _cle, ...o }) => ({ ...o, label: o.label.trim() })) : undefined;
    try {
      const resultat = edition
        ? await modifierChamp(champ!.id, {
          label: label.trim(), placeholder: placeholder || null, help_text: aide || null, is_required: obligatoire,
          folder_id: dossier || null, config, options: opts, default_value: defautFinal(),
          ...(type !== champ!.field_type ? { field_type: type } : {}),
        })
        : await creerChamp(objet, {
          label: label.trim(), field_type: type, key: cle, placeholder: placeholder || null, help_text: aide || null,
          is_required: obligatoire, config, options: opts, folder_id: dossier || null, default_value: defautFinal(),
        });
      toast.success(edition ? (fr ? 'Champ modifié.' : 'Field updated.') : (fr ? 'Champ créé.' : 'Field created.'));
      onEnregistre(resultat);
      onClose();
    } catch (err) {
      console.error('[ModaleChamp] enregistrement', err);
      setErreur(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  };

  const surDrag = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setOptions((liste) => arrayMove(liste,
      liste.findIndex((o) => o._cle === e.active.id), liste.findIndex((o) => o._cle === e.over!.id)));
  };

  const champApercu = {
    label: label || (fr ? 'Nom du champ' : 'Field name'), field_type: type, config, placeholder: placeholder || null,
    options: options.filter((o) => o.label.trim()).map((o, i) => ({ id: o.id ?? o._cle, label: o.label, color: o.color ?? null, position: i, archived_at: null })),
  };
  const variable = variableAffichee(objet, cle || 'cle');

  const [cleEditable, setCleEditable] = useState(false);
  const [detailsOuverts, setDetailsOuverts] = useState(true);
  const [saisieOuverte, setSaisieOuverte] = useState(true);
  const modifie = !!(label || placeholder || aide || defaut !== null || (edition && champ && (label !== champ.label)));
  const fermer = async () => {
    if (modifie && !envoi) {
      const ok = await confirmer({
        title: fr ? 'Modifications non enregistrées' : 'Unsaved changes',
        message: fr ? 'Si tu fermes, tes modifications seront perdues.' : 'If you close, your changes will be lost.',
        confirmLabel: fr ? 'Fermer sans enregistrer' : 'Discard changes',
        danger: true,
      });
      if (!ok) return;
    }
    onClose();
  };
  const choisirType = (t: TypeChamp) => {
    setType(t);
    if ((t === 'dropdown_single' || t === 'dropdown_multi') && options.length === 0) setOptions([{ label: '', color: couleurs[0], _cle: nouvelleCle() }]);
  };

  if (!open) return null;
  const titre = edition ? (fr ? 'Modifier le champ' : 'Edit custom field') : (fr ? 'Créer un champ personnalisé' : 'Create custom field');
  const etiquette = 'mb-1 block text-[13px] font-medium text-text-primary';
  const bulle = (texte: string) => (
    <span className="group relative inline-flex">
      <button type="button" aria-label={texte} className="rounded text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <Info size={13} aria-hidden />
      </button>
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-56 -translate-x-1/2 rounded-md bg-text-primary px-2 py-1.5 text-[11px] font-normal text-surface shadow-lg group-hover:block group-focus-within:block">
        {texte}
      </span>
    </span>
  );

  return createPortal(
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/30" role="presentation" tabIndex={-1} onClick={() => { void fermer(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={`${ids}-titre`} tabIndex={-1}
        className="flex h-full w-full flex-col bg-surface shadow-xl sm:w-[min(1100px,72vw)]" onClick={(e) => e.stopPropagation()}>
        {/* En-tête */}
        <div className="flex items-start justify-between border-b border-outline px-6 py-4">
          <div>
            <h2 id={`${ids}-titre`} className="text-[16px] font-semibold text-text-primary">{titre}</h2>
            <p className="text-[13px] text-text-tertiary">{fr ? 'Personnalise les détails du champ et vois l’aperçu en direct' : 'Customize your field’s details and see live preview'}</p>
          </div>
          <button type="button" onClick={() => { void fermer(); }} aria-label={fr ? 'Fermer' : 'Close'}
            className="rounded p-1 text-text-tertiary hover:bg-surface-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X size={18} /></button>
        </div>

        {/* Corps : formulaire | aperçu */}
        <div className="grid flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            {/* Détails du champ */}
            <section className="rounded-xl border border-outline bg-surface-card">
              <button type="button" aria-expanded={detailsOuverts} onClick={() => setDetailsOuverts((o) => !o)}
                className="flex w-full items-center justify-between px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-xl">
                <span className="text-[14px] font-semibold text-text-primary">{fr ? 'Détails du champ' : 'Field details'}</span>
                <ChevronDown size={16} aria-hidden className={cn('text-text-tertiary transition-transform', !detailsOuverts && '-rotate-90')} />
              </button>
              {detailsOuverts && (
                <div className="space-y-4 border-t border-outline-subtle px-4 pb-4 pt-3">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor={`${ids}-type`} className={etiquette}>{fr ? 'Type de champ' : 'Field type'} <span className="text-red-500">*</span></label>
                      <select id={`${ids}-type`} value={type} disabled={edition && typesPermis.length < 2}
                        onChange={(e) => choisirType(e.target.value as TypeChamp)} className="glass-input h-9 w-full text-[13px]">
                        {typesPermis.map((t) => <option key={t} value={t}>{fr ? LIBELLES_TYPE[t].fr : LIBELLES_TYPE[t].en}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`${ids}-objet`} className={etiquette}>{fr ? 'Ajouter à l’objet' : 'Add to object'} <span className="text-red-500">*</span></label>
                      <select id={`${ids}-objet`} value={objet} disabled={edition}
                        onChange={(e) => { setObjet(e.target.value as ObjetChamp); setDossier(''); }} className="glass-input h-9 w-full text-[13px]">
                        {OBJETS.map((o) => <option key={o} value={o}>{fr ? LIBELLES_OBJET[o].fr : LIBELLES_OBJET[o].en}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`${ids}-label`} className={etiquette}>{fr ? 'Nom du champ' : 'Field name'} <span className="text-red-500">*</span></label>
                      <div className="relative">
                        <input id={`${ids}-label`} value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)}
                          placeholder={fr ? 'Entre un nom' : 'Enter name'} className="glass-input h-9 w-full pr-10 text-[13px]" />
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-text-tertiary">{label.length}</span>
                      </div>
                    </div>
                    <div>
                      <label htmlFor={`${ids}-dossier`} className={etiquette}>{fr ? 'Dossier' : 'Folder name'}</label>
                      {nouveauDossier === null ? (
                        <select id={`${ids}-dossier`} value={dossier}
                          onChange={(e) => { if (e.target.value === '__nouveau__') setNouveauDossier(''); else setDossier(e.target.value); }}
                          className="glass-input h-9 w-full text-[13px]">
                          <option value="">{fr ? 'Sans dossier' : 'No folder'}</option>
                          {dossiers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                          <option value="__nouveau__">{fr ? '+ Créer un dossier' : '+ Create folder'}</option>
                        </select>
                      ) : (
                        <div className="flex gap-2">
                          <input id={`${ids}-dossier`} value={nouveauDossier} maxLength={80} autoFocus
                            onChange={(e) => setNouveauDossier(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void ajouterDossier(); } if (e.key === 'Escape') { e.stopPropagation(); setNouveauDossier(null); } }}
                            placeholder={fr ? 'Nom du dossier' : 'Folder name'} className="glass-input h-9 min-w-0 flex-1 text-[13px]" />
                          <button type="button" onClick={() => { void ajouterDossier(); }} disabled={creationDossier || !nouveauDossier.trim()}
                            className="glass-button-primary inline-flex items-center gap-1 px-3 text-[12px] disabled:opacity-50">
                            {creationDossier && <Loader2 size={12} className="animate-spin" aria-hidden />}{fr ? 'Créer' : 'Create'}
                          </button>
                          <button type="button" onClick={() => setNouveauDossier(null)} aria-label={fr ? 'Annuler la création du dossier' : 'Cancel folder creation'}
                            className="rounded p-1 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X size={14} aria-hidden /></button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <span className={cn(etiquette, 'inline-flex items-center gap-1')}>
                      <label htmlFor={`${ids}-cle`}>{fr ? 'Clé' : 'Key'}</label>
                      {bulle(fr ? 'Une fois créée, elle ne peut plus être renommée. Elle sert à insérer la valeur dans un courriel, un texto ou une automatisation.' : 'Once created, can’t be renamed later. Used to insert the value in an email, a text or an automation.')}
                    </span>
                    {edition || !cleEditable ? (
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-surface-secondary px-2 py-1 text-[12px] text-text-secondary">{variable}</code>
                        {edition ? (
                          <button type="button" aria-label={fr ? 'Copier la clé' : 'Copy key'}
                            onClick={() => { void navigator.clipboard.writeText(variable); toast.success(fr ? 'Clé copiée.' : 'Key copied.'); }}
                            className="rounded p-1 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><Copy size={13} aria-hidden /></button>
                        ) : (
                          <button type="button" aria-label={fr ? 'Modifier la clé' : 'Edit key'} onClick={() => setCleEditable(true)}
                            className="rounded p-1 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><Pencil size={13} aria-hidden /></button>
                        )}
                      </div>
                    ) : (
                      <input id={`${ids}-cle`} value={cle} maxLength={50} autoFocus
                        onChange={(e) => { setCleTouchee(true); setCle(e.target.value.toLowerCase()); }}
                        aria-invalid={cleInvalide || cleReservee}
                        className={cn('glass-input h-9 w-full font-mono text-[12px]', (cleInvalide || cleReservee) && 'border-red-400')} />
                    )}
                  </div>

                  <div>
                    <label htmlFor={`${ids}-aide`} className={etiquette}>{fr ? 'Description' : 'Description'}</label>
                    <div className="relative">
                      <textarea id={`${ids}-aide`} rows={3} value={aide} maxLength={200} onChange={(e) => setAide(e.target.value)}
                        placeholder={fr ? 'Ajoute une courte description pour expliquer ce champ' : 'Add a short description to explain this field'} className="glass-input w-full py-2 text-[13px]" />
                      <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-text-tertiary">{aide.length} / 200</span>
                    </div>
                  </div>

                  <label htmlFor={`${ids}-req`} className="flex items-center gap-2 text-[13px] text-text-primary">
                    <input id={`${ids}-req`} type="checkbox" checked={obligatoire} onChange={(e) => setObligatoire(e.target.checked)} className="h-4 w-4 accent-primary" />
                    {fr ? 'Obligatoire' : 'Required'}
                  </label>
                </div>
              )}
            </section>

            {/* Valeur par défaut : texte indicatif, valeur pré-remplie, réglages du type */}
            <section className="rounded-xl border border-outline bg-surface-card">
              <button type="button" aria-expanded={saisieOuverte} onClick={() => setSaisieOuverte((o) => !o)}
                className="flex w-full items-center justify-between px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-xl">
                <span>
                  <span className="block text-[14px] font-semibold text-text-primary">{fr ? 'Valeur par défaut' : 'Set default value'}</span>
                  <span className="block text-[12px] text-text-tertiary">{fr ? AIDE_TYPE[type].fr : AIDE_TYPE[type].en}</span>
                </span>
                <ChevronDown size={16} aria-hidden className={cn('text-text-tertiary transition-transform', !saisieOuverte && '-rotate-90')} />
              </button>
              {saisieOuverte && (
                <div className="space-y-4 border-t border-outline-subtle px-4 pb-4 pt-3">
                  <div>
                    <span className={cn(etiquette, 'inline-flex items-center gap-1')}>
                      <label htmlFor={`${ids}-ph`}>{fr ? 'Texte indicatif' : 'Placeholder text'}</label>
                      {bulle(fr ? 'Affiché dans la case avant qu’on commence à écrire. Il n’est pas enregistré.' : 'Shown inside the field before the user starts typing.')}
                    </span>
                    <input id={`${ids}-ph`} value={placeholder} maxLength={200} onChange={(e) => setPlaceholder(e.target.value)}
                      placeholder={fr ? 'Un indice pour savoir quelle information fournir' : 'Provide a hint for users to know what kind of information to provide'} className="glass-input h-9 w-full text-[13px]" />
                  </div>

                  {!avecOptions && (
                    <div>
                      <span className={cn(etiquette, 'inline-flex items-center gap-1')}>
                        <label htmlFor={`${ids}-defaut`}>{fr ? 'Valeur par défaut' : 'Default value'}</label>
                        {bulle(fr ? 'Déjà remplie quand on crée une nouvelle fiche ; on peut la changer. Les fiches existantes ne sont pas touchées.' : 'Pre-filled when creating a new record; can be changed. Existing records are not touched.')}
                      </span>
                      <ChampSaisie id={`${ids}-defaut`} champ={{ ...champApercu, placeholder: fr ? 'Aucune' : 'None' }} valeur={defautSaisi} fr={fr} onValider={surDefaut} />
                    </div>
                  )}

                  {(objet === 'quote' || objet === 'invoice') && (
                    <label htmlFor={`${ids}-document`} className="flex items-center gap-2 text-[13px] text-text-primary">
                      <input id={`${ids}-document`} type="checkbox" checked={!!config.show_on_documents}
                        onChange={(e) => setConfig({ ...config, show_on_documents: e.target.checked })} className="h-4 w-4 accent-primary" />
                      {fr ? `Afficher sur ${objet === 'quote' ? 'la soumission' : 'la facture'} du client (PDF et page en ligne)` : `Show on the client's ${objet === 'quote' ? 'quote' : 'invoice'} (PDF and online page)`}
                    </label>
                  )}
                  {type === 'number' && (
                    <div className="grid grid-cols-3 gap-3">
                      {(['decimals', 'min', 'max'] as const).map((k) => (
                        <div key={k}>
                          <label htmlFor={`${ids}-${k}`} className={etiquette}>
                            {k === 'decimals' ? (fr ? 'Décimales' : 'Decimals') : k === 'min' ? 'Minimum' : 'Maximum'}
                          </label>
                          <input id={`${ids}-${k}`} type="number" min={k === 'decimals' ? 0 : undefined} max={k === 'decimals' ? 6 : undefined}
                            value={config[k] ?? ''} onChange={(e) => setConfig({ ...config, [k]: e.target.value === '' ? null : Number(e.target.value) })}
                            className="glass-input h-9 w-full text-[13px]" />
                        </div>
                      ))}
                    </div>
                  )}
                  {type === 'monetary' && (
                    <div className="w-40">
                      <label htmlFor={`${ids}-devise`} className={etiquette}>{fr ? 'Devise' : 'Currency'}</label>
                      <select id={`${ids}-devise`} value={config.currency ?? 'CAD'} onChange={(e) => setConfig({ ...config, currency: e.target.value })} className="glass-input h-9 w-full text-[13px]">
                        {['CAD', 'USD', 'EUR'].map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  )}
                  {type === 'date' && (
                    <label htmlFor={`${ids}-heure`} className="flex items-center gap-2 text-[13px] text-text-primary">
                      <input id={`${ids}-heure`} type="checkbox" checked={!!config.include_time} disabled={edition}
                        onChange={(e) => setConfig({ ...config, include_time: e.target.checked })} className="h-4 w-4 accent-primary" />
                      {fr ? 'Inclure l’heure' : 'Include time'}
                      {edition && <span className="text-[11px] text-text-tertiary">{fr ? '(figé : les valeurs en dépendent)' : '(locked: values depend on it)'}</span>}
                    </label>
                  )}
                  {avecOptions && (
                    <div className="space-y-2">
                      <p className={etiquette}>{fr ? 'Options' : 'Options'}</p>
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={surDrag}>
                        <SortableContext items={options.map((o) => o._cle)} strategy={verticalListSortingStrategy}>
                          {options.map((o, i) => (
                            <LigneOption key={o._cle} o={o} fr={fr} idBase={ids}
                              onChange={(p) => setOptions((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)))}
                              onRetirer={() => setOptions((l) => l.filter((_, j) => j !== i))} />
                          ))}
                        </SortableContext>
                      </DndContext>
                      <button type="button"
                        onClick={() => setOptions((l) => [...l, { label: '', color: couleurs[l.length % couleurs.length], _cle: nouvelleCle() }])}
                        className="inline-flex items-center gap-1 rounded px-1 text-[12px] font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                        <Plus size={13} aria-hidden /> {fr ? 'Ajouter une option' : 'Add option'}
                      </button>
                      {options.some((o) => o.label.trim()) && (
                        <div>
                          <span className={cn(etiquette, 'mt-2 inline-flex items-center gap-1')}>
                            <label htmlFor={`${ids}-defaut`}>{fr ? 'Option par défaut' : 'Default option'}</label>
                            {bulle(fr ? 'Déjà choisie quand on crée une nouvelle fiche ; on peut la changer.' : 'Pre-selected when creating a new record; can be changed.')}
                          </span>
                          <ChampSaisie id={`${ids}-defaut`} champ={{ ...champApercu, placeholder: fr ? 'Aucune' : 'None' }} valeur={defautSaisi} fr={fr} onValider={surDefaut} />
                        </div>
                      )}
                      {edition && (
                        <p className="text-[11px] text-text-tertiary">
                          {fr ? 'Renommer une option ne touche aucune donnée. Une option retirée mais déjà utilisée est archivée : elle reste sur les fiches, et disparaît des choix.'
                            : 'Renaming an option changes no data. A removed option already in use is archived: it stays on records and disappears from the choices.'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>

            {erreur && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-500/10 dark:text-red-300">{erreur}</p>}
          </div>

          {/* Aperçu en direct */}
          <aside aria-label={fr ? 'Aperçu en direct' : 'Live preview'} className="h-fit rounded-xl border border-outline bg-surface-card p-4">
            <p className="mb-3 text-[14px] font-semibold text-text-primary">{fr ? 'Aperçu en direct' : 'Live preview'}</p>
            <label htmlFor={`${ids}-apercu`} className={etiquette}>
              {champApercu.label}{obligatoire && <span className="text-red-500" aria-hidden> *</span>}
            </label>
            <ChampSaisie id={`${ids}-apercu`} champ={{ ...champApercu, placeholder: placeholder || (fr ? 'Texte indicatif' : 'Placeholder text') }} valeur={apercu ?? defautSaisi} fr={fr} onValider={setApercu} />
            {aide && <p className="mt-1 text-[11px] text-text-tertiary">{aide}</p>}
          </aside>
        </div>

        {/* Pied */}
        <div className="flex justify-end gap-2 border-t border-outline px-6 py-3">
          <button type="button" onClick={() => { void fermer(); }} className="glass-button px-4 py-2 text-[13px]">{fr ? 'Annuler' : 'Cancel'}</button>
          <button type="button" onClick={() => { void enregistrer(); }} disabled={envoi || !label.trim()}
            className="glass-button-primary inline-flex items-center gap-2 px-4 py-2 text-[13px] disabled:opacity-50">
            {envoi && <Loader2 size={14} className="animate-spin" aria-hidden />}
            {edition ? (fr ? 'Enregistrer' : 'Save') : (fr ? 'Créer le champ' : 'Create custom field')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
