/**
 * Créer / modifier un champ personnalisé (écran 2 de GoHighLevel).
 *
 * Création en deux temps : 1) la grille des types, 2) la configuration,
 * avec l'aperçu en direct à droite. En modification, le type ne propose
 * que les conversions sans perte, et la clé est figée (les modèles et
 * automatisations en dépendent).
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Copy, GripVertical, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Modal from '../../ui/Modal';
import { cn } from '../../../lib/utils';
import {
  creerChamp, modifierChamp, type ChampPerso, type DossierChamp, type EntreeOption, type ObjetChamp, type TypeChamp,
} from '../../../lib/champsPersoApi';
import { OBJETS, TYPES_CHAMP, LIBELLES_OBJET, LIBELLES_TYPE, conversionPermise, variableModele, type ConfigChamp } from '../../../lib/champs/types';
import { slugCle } from '../../../lib/champs/valeurs';
import { clesStandard } from '../../../lib/champs/standard';
import { ICONE_TYPE, AIDE_TYPE } from '../icones';
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
  const dossiers = tousDossiers.filter((d) => d.object_type === objet);
  const [etape, setEtape] = useState<'type' | 'config'>(edition ? 'config' : 'type');
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
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setEtape(champ ? 'config' : 'type');
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

  const enregistrer = async () => {
    if (problemes.length) { setErreur(problemes[0]); return; }
    setEnvoi(true);
    setErreur(null);
    const opts = avecOptions ? options.filter((o) => o.label.trim()).map(({ _cle, ...o }) => ({ ...o, label: o.label.trim() })) : undefined;
    try {
      const resultat = edition
        ? await modifierChamp(champ!.id, {
          label: label.trim(), placeholder: placeholder || null, help_text: aide || null, is_required: obligatoire,
          folder_id: dossier || null, config, options: opts, ...(type !== champ!.field_type ? { field_type: type } : {}),
        })
        : await creerChamp(objet, {
          label: label.trim(), field_type: type, key: cle, placeholder: placeholder || null, help_text: aide || null,
          is_required: obligatoire, config, options: opts, folder_id: dossier || null,
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
  const variable = `{${variableModele(objet, cle || 'cle')}}`;

  const titre = edition
    ? (fr ? 'Modifier le champ' : 'Edit field')
    : (fr ? 'Nouveau champ personnalisé' : 'Create custom field');

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      title={titre}
      description={fr ? 'Configure le champ et vois l’aperçu en direct.' : 'Customize your field and see a live preview.'}
      footer={etape === 'config' ? (
        <div className="flex w-full items-center justify-between gap-3">
          {!edition ? (
            <button type="button" onClick={() => setEtape('type')} className="inline-flex items-center gap-1 text-[13px] text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded">
              <ArrowLeft size={14} aria-hidden /> {fr ? 'Changer de type' : 'Change type'}
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="glass-button">{fr ? 'Annuler' : 'Cancel'}</button>
            <button type="button" onClick={() => { void enregistrer(); }} disabled={envoi} className="glass-button-primary inline-flex items-center gap-2">
              {envoi && <Loader2 size={14} className="animate-spin" aria-hidden />}
              {edition ? (fr ? 'Enregistrer' : 'Save') : (fr ? 'Créer le champ' : 'Create custom field')}
            </button>
          </div>
        </div>
      ) : undefined}
    >
      {etape === 'type' ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TYPES_CHAMP.map((t) => {
            const Icone = ICONE_TYPE[t];
            return (
              <button
                key={t} type="button"
                onClick={() => { setType(t); setEtape('config'); if ((t === 'dropdown_single' || t === 'dropdown_multi') && options.length === 0) setOptions([{ label: '', color: couleurs[0], _cle: nouvelleCle() }]); }}
                className="flex items-start gap-3 rounded-xl border border-outline-subtle bg-surface-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-surface-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icone size={16} aria-hidden /></span>
                <span>
                  <span className="block text-[13px] font-semibold text-text-primary">{fr ? LIBELLES_TYPE[t].fr : LIBELLES_TYPE[t].en}</span>
                  <span className="block text-[11px] text-text-tertiary">{fr ? AIDE_TYPE[t].fr : AIDE_TYPE[t].en}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-[1fr_230px]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor={`${ids}-objet`} className="mb-1 block text-[12px] font-medium text-text-secondary">{fr ? 'Ajouter à l’objet' : 'Add to object'} *</label>
                <select id={`${ids}-objet`} value={objet} disabled={edition}
                  onChange={(e) => { setObjet(e.target.value as ObjetChamp); setDossier(''); }} className="glass-input h-9 w-full text-[13px]">
                  {OBJETS.map((o) => <option key={o} value={o}>{fr ? LIBELLES_OBJET[o].fr : LIBELLES_OBJET[o].en}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`${ids}-type`} className="mb-1 block text-[12px] font-medium text-text-secondary">{fr ? 'Type de champ' : 'Field type'}</label>
                <select id={`${ids}-type`} value={type} disabled={!edition || typesPermis.length < 2}
                  onChange={(e) => setType(e.target.value as TypeChamp)} className="glass-input h-9 w-full text-[13px]">
                  {typesPermis.map((t) => <option key={t} value={t}>{fr ? LIBELLES_TYPE[t].fr : LIBELLES_TYPE[t].en}</option>)}
                </select>
                {edition && typesPermis.length < 2 && (
                  <p className="mt-1 text-[11px] text-text-tertiary">{fr ? 'Aucune conversion sans perte pour ce type.' : 'No lossless conversion for this type.'}</p>
                )}
              </div>
              <div>
                <label htmlFor={`${ids}-dossier`} className="mb-1 block text-[12px] font-medium text-text-secondary">{fr ? 'Dossier' : 'Folder'}</label>
                <select id={`${ids}-dossier`} value={dossier} onChange={(e) => setDossier(e.target.value)} className="glass-input h-9 w-full text-[13px]">
                  <option value="">{fr ? 'Sans dossier' : 'No folder'}</option>
                  {dossiers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor={`${ids}-label`} className="mb-1 block text-[12px] font-medium text-text-secondary">{fr ? 'Nom du champ' : 'Field name'} *</label>
              <input id={`${ids}-label`} value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)}
                placeholder={fr ? 'Ex. : Superficie du terrain' : 'e.g. Lot size'} className="glass-input h-9 w-full text-[13px]" />
            </div>

            <div>
              <label htmlFor={`${ids}-cle`} className="mb-1 block text-[12px] font-medium text-text-secondary">
                {fr ? 'Clé' : 'Key'} <span className="font-normal text-text-tertiary">— {fr ? 'utilisée dans les modèles et automatisations' : 'used in templates and automations'}</span>
              </label>
              {edition ? (
                <div className="flex items-center gap-2">
                  <code className="rounded bg-surface-secondary px-2 py-1 text-[12px] text-text-secondary">{variable}</code>
                  <button type="button" aria-label={fr ? 'Copier la variable' : 'Copy variable'}
                    onClick={() => { void navigator.clipboard.writeText(variable); toast.success(fr ? 'Variable copiée.' : 'Variable copied.'); }}
                    className="rounded p-1 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                    <Copy size={13} aria-hidden />
                  </button>
                  <span className="text-[11px] text-text-tertiary">{fr ? 'Figée après la création.' : 'Locked after creation.'}</span>
                </div>
              ) : (
                <>
                  <input id={`${ids}-cle`} value={cle} maxLength={50}
                    onChange={(e) => { setCleTouchee(true); setCle(e.target.value.toLowerCase()); }}
                    aria-invalid={cleInvalide || cleReservee}
                    className={cn('glass-input h-9 w-full font-mono text-[12px]', (cleInvalide || cleReservee) && 'border-red-400')} />
                  <p className="mt-1 text-[11px] text-text-tertiary">
                    {fr ? 'Variable : ' : 'Variable: '}<code>{variable}</code>{fr ? ' — ne pourra plus changer ensuite.' : ' — cannot change afterwards.'}
                  </p>
                </>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${ids}-ph`} className="mb-1 block text-[12px] font-medium text-text-secondary">{fr ? 'Texte indicatif' : 'Placeholder text'}</label>
                <input id={`${ids}-ph`} value={placeholder} maxLength={200} onChange={(e) => setPlaceholder(e.target.value)} className="glass-input h-9 w-full text-[13px]" />
              </div>
              <div className="flex items-end">
                <label htmlFor={`${ids}-req`} className="flex items-center gap-2 text-[13px] text-text-primary">
                  <input id={`${ids}-req`} type="checkbox" checked={obligatoire} onChange={(e) => setObligatoire(e.target.checked)} className="h-4 w-4 accent-primary" />
                  {fr ? 'Obligatoire' : 'Required'}
                </label>
              </div>
            </div>

            <div>
              <label htmlFor={`${ids}-aide`} className="mb-1 block text-[12px] font-medium text-text-secondary">{fr ? 'Description' : 'Description'}</label>
              <textarea id={`${ids}-aide`} rows={2} value={aide} maxLength={200} onChange={(e) => setAide(e.target.value)}
                placeholder={fr ? 'Une phrase pour expliquer ce champ' : 'A short description to explain this field'} className="glass-input w-full py-2 text-[13px]" />
              <p className="mt-0.5 text-right text-[11px] text-text-tertiary">{aide.length} / 200</p>
            </div>

            {/* Réglages propres au type */}
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
                    <label htmlFor={`${ids}-${k}`} className="mb-1 block text-[12px] font-medium text-text-secondary">
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
                <label htmlFor={`${ids}-devise`} className="mb-1 block text-[12px] font-medium text-text-secondary">{fr ? 'Devise' : 'Currency'}</label>
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
                <p className="text-[12px] font-medium text-text-secondary">{fr ? 'Options' : 'Options'}</p>
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
                {edition && (
                  <p className="text-[11px] text-text-tertiary">
                    {fr ? 'Renommer une option ne touche aucune donnée. Une option retirée mais déjà utilisée est archivée : elle reste sur les fiches, et disparaît des choix.'
                      : 'Renaming an option changes no data. A removed option already in use is archived: it stays on records and disappears from the choices.'}
                  </p>
                )}
              </div>
            )}

            {erreur && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-500/10 dark:text-red-300">{erreur}</p>}
          </div>

          {/* Aperçu en direct */}
          <aside aria-label={fr ? 'Aperçu en direct' : 'Live preview'} className="rounded-xl border border-outline-subtle bg-surface-secondary/50 p-4">
            <p className="mb-3 text-[12px] font-semibold text-text-secondary">{fr ? 'Aperçu en direct' : 'Live preview'}</p>
            <label htmlFor={`${ids}-apercu`} className="mb-1 block text-[12px] font-medium text-text-primary">
              {champApercu.label}{obligatoire && <span className="text-red-500" aria-hidden> *</span>}
            </label>
            <ChampSaisie id={`${ids}-apercu`} champ={champApercu} valeur={apercu} fr={fr} onValider={setApercu} />
            {aide && <p className="mt-1 text-[11px] text-text-tertiary">{aide}</p>}
          </aside>
        </div>
      )}
    </Modal>
  );
}
