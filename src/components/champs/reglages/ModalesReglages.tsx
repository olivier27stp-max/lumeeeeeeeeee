/**
 * Modales secondaires de Réglages → Champs personnalisés :
 *   · ModaleDossier      — un dossier + plusieurs champs, en UNE requête (tout ou rien)
 *   · ModaleCherchables  — quels champs la recherche globale lit
 *   · ModaleUniques      — quels champs refusent les doublons (bloqué s'il y en a déjà)
 *   · ModaleSuppression  — archivage, ou purge avec le rapport d'impact
 */
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Lock, Plus, Trash2 } from 'lucide-react';
import Modal from '../../ui/Modal';
import {
  archiverChamp, creerDossier, impactChamp, majCherchables, majUnique, purgerChamp,
  type ChampPerso, type Doublon, type ImpactChamp, type ObjetChamp, type TypeChamp,
} from '../../../lib/champsPersoApi';
import { LIBELLES_TYPE, TYPES_CHAMP, TYPES_CHERCHABLES, TYPES_UNIQUES } from '../../../lib/champs/types';
import type { ChampStandard } from '../../../lib/champs/standard';

// ── Dossier + champs en lot ─────────────────────────────────────

interface LigneLot { label: string; field_type: TypeChamp; options: string }

export function ModaleDossier({ open, onClose, onCree, objet, fr }: {
  open: boolean; onClose: () => void; onCree: () => void; objet: ObjetChamp; fr: boolean;
}) {
  const ids = useId();
  const [nom, setNom] = useState('');
  const [lignes, setLignes] = useState<LigneLot[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => { if (open) { setNom(''); setLignes([]); setErreur(null); } }, [open]);

  const creer = async () => {
    if (!nom.trim()) { setErreur(fr ? 'Donne un nom au dossier.' : 'Name the folder.'); return; }
    for (const l of lignes) {
      if (!l.label.trim()) { setErreur(fr ? 'Chaque champ a besoin d’un nom.' : 'Each field needs a name.'); return; }
      if (l.field_type.startsWith('dropdown') && !l.options.trim()) { setErreur(fr ? `« ${l.label} » : ajoute des options (séparées par des virgules).` : `“${l.label}”: add options (comma separated).`); return; }
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await creerDossier(objet, nom.trim(), lignes.map((l) => ({
        label: l.label.trim(), field_type: l.field_type,
        options: l.field_type.startsWith('dropdown')
          ? l.options.split(',').map((x) => x.trim()).filter(Boolean).map((label) => ({ label })) : undefined,
      })));
      toast.success(fr ? 'Dossier créé.' : 'Folder created.');
      onCree();
      onClose();
    } catch (err) {
      console.error('[ModaleDossier] création', err);
      // Tout ou rien : si un champ échoue, rien n'a été créé.
      setErreur(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={fr ? 'Nouveau dossier' : 'New folder'}
      description={fr ? 'Regroupe plusieurs champs d’un coup. Tout est créé ensemble, ou rien.' : 'Group several fields at once. Everything is created together, or nothing.'}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="glass-button">{fr ? 'Annuler' : 'Cancel'}</button>
          <button type="button" disabled={envoi} onClick={() => { void creer(); }} className="glass-button-primary inline-flex items-center gap-2">
            {envoi && <Loader2 size={14} className="animate-spin" aria-hidden />}{fr ? 'Créer le dossier' : 'Create folder'}
          </button>
        </div>
      )}>
      <div className="space-y-4">
        <div>
          <label htmlFor={`${ids}-nom`} className="mb-1 block text-[12px] font-medium text-text-secondary">{fr ? 'Nom du dossier' : 'Folder name'} *</label>
          <input id={`${ids}-nom`} value={nom} maxLength={100} onChange={(e) => setNom(e.target.value)} className="glass-input h-9 w-full text-[13px]"
            placeholder={fr ? 'Ex. : Détails du terrain' : 'e.g. Lot details'} />
        </div>
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-text-secondary">{fr ? 'Champs du dossier' : 'Fields in this folder'}</p>
          {lignes.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_170px_auto] items-start gap-2 rounded-lg bg-surface-secondary/60 p-2">
              <div className="space-y-1.5">
                <input aria-label={fr ? 'Nom du champ' : 'Field name'} value={l.label} maxLength={100}
                  onChange={(e) => setLignes((ls) => ls.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  placeholder={fr ? 'Nom du champ' : 'Field name'} className="glass-input h-8 w-full text-[13px]" />
                {l.field_type.startsWith('dropdown') && (
                  <input aria-label={fr ? 'Options séparées par des virgules' : 'Comma-separated options'} value={l.options}
                    onChange={(e) => setLignes((ls) => ls.map((x, j) => (j === i ? { ...x, options: e.target.value } : x)))}
                    placeholder={fr ? 'Options : Asphalte, Pavé, Gravier' : 'Options: Asphalt, Pavers, Gravel'} className="glass-input h-8 w-full text-[12px]" />
                )}
              </div>
              <select aria-label={fr ? 'Type' : 'Type'} value={l.field_type}
                onChange={(e) => setLignes((ls) => ls.map((x, j) => (j === i ? { ...x, field_type: e.target.value as TypeChamp } : x)))}
                className="glass-input h-8 text-[12px]">
                {TYPES_CHAMP.map((t) => <option key={t} value={t}>{fr ? LIBELLES_TYPE[t].fr : LIBELLES_TYPE[t].en}</option>)}
              </select>
              <button type="button" aria-label={fr ? 'Retirer ce champ' : 'Remove this field'} onClick={() => setLignes((ls) => ls.filter((_, j) => j !== i))}
                className="rounded p-1.5 text-text-tertiary hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <Trash2 size={14} aria-hidden />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setLignes((ls) => [...ls, { label: '', field_type: 'single_line', options: '' }])}
            className="inline-flex items-center gap-1 rounded px-1 text-[12px] font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <Plus size={13} aria-hidden /> {fr ? 'Ajouter un champ' : 'Add a field'}
          </button>
        </div>
        {erreur && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-500/10 dark:text-red-300">{erreur}</p>}
      </div>
    </Modal>
  );
}

// ── Champs cherchables ──────────────────────────────────────────

export function ModaleCherchables({ open, onClose, onEnregistre, objet, champs, standard, fr }: {
  open: boolean; onClose: () => void; onEnregistre: () => void; objet: ObjetChamp;
  champs: ChampPerso[]; standard: ChampStandard[]; fr: boolean;
}) {
  const ids = useId();
  const compatibles = champs.filter((c) => !c.archived_at && TYPES_CHERCHABLES.includes(c.field_type));
  const [choix, setChoix] = useState<Set<string>>(new Set());
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => { if (open) setChoix(new Set(compatibles.filter((c) => c.is_searchable).map((c) => c.id))); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const enregistrer = async () => {
    setEnvoi(true);
    try {
      await majCherchables(objet, [...choix]);
      toast.success(fr ? 'Recherche mise à jour.' : 'Search updated.');
      onEnregistre();
      onClose();
    } catch (err) {
      console.error('[ModaleCherchables]', err);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={fr ? 'Champs cherchables' : 'Searchable fields'}
      description={fr ? 'La recherche globale (barre du haut) trouve aussi une fiche par ces champs.' : 'Global search (top bar) also finds a record by these fields.'}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="glass-button">{fr ? 'Annuler' : 'Cancel'}</button>
          <button type="button" disabled={envoi} onClick={() => { void enregistrer(); }} className="glass-button-primary">{fr ? 'Enregistrer' : 'Save'}</button>
        </div>
      )}>
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-[12px] font-semibold text-text-secondary">{fr ? 'Champs standard' : 'Standard fields'}</p>
          <ul className="space-y-1">
            {standard.filter((s) => s.cherchable).map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-[13px] text-text-secondary">
                <Lock size={12} aria-hidden /> {fr ? s.label.fr : s.label.en}
                <span className="text-[11px] text-text-tertiary">— {fr ? 'toujours cherchable' : 'always searchable'}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-[12px] font-semibold text-text-secondary">{fr ? 'Champs personnalisés' : 'Custom fields'}</p>
          {compatibles.length === 0 && <p className="text-[12px] text-text-tertiary">{fr ? 'Aucun champ de texte, de nombre, de courriel ou de téléphone.' : 'No text, number, email or phone field.'}</p>}
          <ul className="space-y-1.5">
            {compatibles.map((c) => (
              <li key={c.id}>
                <label htmlFor={`${ids}-${c.id}`} className="flex items-center gap-2 text-[13px] text-text-primary">
                  <input id={`${ids}-${c.id}`} type="checkbox" className="h-4 w-4 accent-primary" checked={choix.has(c.id)}
                    onChange={(e) => setChoix((s) => { const n = new Set(s); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} />
                  {c.label}
                  <span className="text-[11px] text-text-tertiary">{fr ? LIBELLES_TYPE[c.field_type].fr : LIBELLES_TYPE[c.field_type].en}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

// ── Champs uniques ──────────────────────────────────────────────

export function ModaleUniques({ open, onClose, onEnregistre, champs, fr }: {
  open: boolean; onClose: () => void; onEnregistre: () => void; champs: ChampPerso[]; fr: boolean;
}) {
  const ids = useId();
  const compatibles = champs.filter((c) => !c.archived_at && TYPES_UNIQUES.includes(c.field_type));
  const [enCours, setEnCours] = useState<string | null>(null);
  const [blocages, setBlocages] = useState<Record<string, Doublon[]>>({});
  useEffect(() => { if (open) setBlocages({}); }, [open]);

  const basculer = async (c: ChampPerso, actif: boolean) => {
    setEnCours(c.id);
    try {
      const doublons = await majUnique(c.id, actif);
      if (doublons.length) {
        setBlocages((b) => ({ ...b, [c.id]: doublons }));
      } else {
        setBlocages((b) => { const { [c.id]: _x, ...r } = b; return r; });
        toast.success(actif ? (fr ? `« ${c.label} » est maintenant unique.` : `“${c.label}” is now unique.`) : (fr ? 'Unicité retirée.' : 'Uniqueness removed.'));
        onEnregistre();
      }
    } catch (err) {
      console.error('[ModaleUniques]', err);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setEnCours(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={fr ? 'Champs uniques' : 'Unique fields'}
      description={fr ? 'Un champ unique refuse la même valeur sur deux fiches. Courriels et téléphones sont comparés normalisés (casse, format).' : 'A unique field refuses the same value on two records. Emails and phones are compared normalized (case, format).'}
      footer={<div className="flex justify-end"><button type="button" onClick={onClose} className="glass-button">{fr ? 'Fermer' : 'Close'}</button></div>}>
      <p className="mb-3 text-[12px] text-text-tertiary">
        {fr ? 'Seuls les champs une ligne, courriel, téléphone et nombre peuvent être uniques. Les doublons de clients (courriel, téléphone) sont déjà détectés par Lume.'
          : 'Only single line, email, phone and number fields can be unique. Client duplicates (email, phone) are already detected by Lume.'}
      </p>
      {compatibles.length === 0 && <p className="text-[12px] text-text-tertiary">{fr ? 'Aucun champ compatible.' : 'No compatible field.'}</p>}
      <ul className="space-y-2">
        {compatibles.map((c) => (
          <li key={c.id} className="rounded-lg border border-outline-subtle p-2.5">
            <label htmlFor={`${ids}-${c.id}`} className="flex items-center gap-2 text-[13px] text-text-primary">
              <input id={`${ids}-${c.id}`} type="checkbox" className="h-4 w-4 accent-primary" checked={c.is_unique} disabled={enCours === c.id}
                onChange={(e) => { void basculer(c, e.target.checked); }} />
              {c.label}
              {enCours === c.id && <Loader2 size={12} className="animate-spin text-text-tertiary" aria-hidden />}
            </label>
            {blocages[c.id] && (
              <div role="alert" className="mt-2 rounded-md bg-amber-50 p-2 text-[12px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                <p className="flex items-center gap-1 font-semibold"><AlertTriangle size={12} aria-hidden />
                  {fr ? 'Impossible : ces valeurs sont déjà en double.' : 'Not possible: these values are already duplicated.'}</p>
                <ul className="mt-1 list-disc pl-5">
                  {blocages[c.id].map((d) => (
                    <li key={d.value_normalized}>« {d.value_normalized} » — {d.nb} {fr ? 'fiches' : 'records'}</li>
                  ))}
                </ul>
                <p className="mt-1">{fr ? 'Corrige ces fiches, puis réessaie.' : 'Fix these records, then try again.'}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// ── Archiver / supprimer ────────────────────────────────────────

export function ModaleSuppression({ open, onClose, onFait, champ, fr }: {
  open: boolean; onClose: () => void; onFait: () => void; champ: ChampPerso | null; fr: boolean;
}) {
  const ids = useId();
  const [impact, setImpact] = useState<ImpactChamp | null>(null);
  const [charge, setCharge] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!open || !champ) return;
    setImpact(null); setConfirmation(''); setCharge(true);
    impactChamp(champ.id).then(setImpact)
      .catch((err) => { console.error('[ModaleSuppression] impact', err); toast.error(err instanceof Error ? err.message : String(err)); })
      .finally(() => setCharge(false));
  }, [open, champ]);

  if (!champ) return null;
  const bloque = (impact?.automatisations?.length ?? 0) > 0;

  const archiver = async () => {
    setEnvoi(true);
    try {
      await archiverChamp(champ.id, true);
      toast.success(fr ? 'Champ archivé : ses valeurs sont conservées.' : 'Field archived: its values are kept.');
      onFait(); onClose();
    } catch (err) {
      console.error('[ModaleSuppression] archivage', err);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally { setEnvoi(false); }
  };

  const purger = async () => {
    if (!impact) return;
    setEnvoi(true);
    try {
      await purgerChamp(champ.id, impact.valeurs);
      toast.success(fr ? 'Champ supprimé définitivement.' : 'Field permanently deleted.');
      onFait(); onClose();
    } catch (err) {
      console.error('[ModaleSuppression] purge', err);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally { setEnvoi(false); }
  };

  const Liste = ({ titre, items }: { titre: string; items: { id: string; name: string }[] }) =>
    items.length ? (
      <div>
        <p className="text-[12px] font-semibold text-text-secondary">{titre} ({items.length})</p>
        <ul className="list-disc pl-5 text-[12px] text-text-secondary">{items.map((x) => <li key={x.id}>{x.name}</li>)}</ul>
      </div>
    ) : null;

  return (
    <Modal open={open} onClose={onClose} title={fr ? `Retirer « ${champ.label} »` : `Remove “${champ.label}”`}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="glass-button">{fr ? 'Annuler' : 'Cancel'}</button>
          <button type="button" disabled={envoi || !!champ.archived_at} onClick={() => { void archiver(); }} className="glass-button">
            {fr ? 'Archiver (recommandé)' : 'Archive (recommended)'}
          </button>
          <button type="button" disabled={envoi || !impact || bloque || confirmation.trim() !== champ.key} onClick={() => { void purger(); }}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-2 text-[13px] font-medium text-white hover:bg-red-700 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
            <Trash2 size={13} aria-hidden /> {fr ? 'Supprimer définitivement' : 'Delete permanently'}
          </button>
        </div>
      )}>
      {charge || !impact ? (
        <div className="flex items-center gap-2 text-[12px] text-text-tertiary"><Loader2 size={14} className="animate-spin" aria-hidden /> {fr ? 'Mesure de l’impact…' : 'Measuring impact…'}</div>
      ) : (
        <div className="space-y-3 text-[13px] text-text-primary">
          <p>
            {fr ? 'Archiver le retire des fiches et des choix, sans rien perdre ; il se restaure en un clic. Supprimer définitivement efface ' : 'Archiving hides it from records and choices without losing anything; it restores in one click. Permanent deletion erases '}
            <strong>{impact.valeurs} {fr ? (impact.valeurs > 1 ? 'valeurs' : 'valeur') : (impact.valeurs === 1 ? 'value' : 'values')}</strong>.
          </p>
          <Liste titre={fr ? 'Automatisations qui l’utilisent' : 'Automations using it'} items={impact.automatisations} />
          <Liste titre={fr ? 'Modèles de courriel qui le citent' : 'Email templates citing it'} items={impact.modeles} />
          <Liste titre={fr ? 'Pipelines qui l’affichent sur les cartes' : 'Pipelines showing it on cards'} items={impact.pipelines} />
          <Liste titre={fr ? 'Formulaires de demande qui le remplissent' : 'Request forms filling it'} items={impact.formulaires} />
          {bloque ? (
            <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              {fr ? 'Suppression définitive bloquée : retire d’abord le champ des automatisations ci-dessus.' : 'Permanent deletion blocked: first remove the field from the automations above.'}
            </p>
          ) : (
            <div>
              <label htmlFor={`${ids}-conf`} className="mb-1 block text-[12px] text-text-secondary">
                {fr ? 'Pour supprimer définitivement, tape la clé ' : 'To delete permanently, type the key '}<code>{champ.key}</code>
              </label>
              <input id={`${ids}-conf`} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="glass-input h-9 w-full font-mono text-[12px]" />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
