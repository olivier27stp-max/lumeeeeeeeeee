/**
 * « Gérer les champs » des listes — reproduit le panneau « Manage fields » de
 * GoHighLevel (capture 2 de Rafba) : panneau à droite, « Chercher un champ »,
 * « Champs dans le tableau » (poignées, cases, colonne du nom verrouillée),
 * « Ajouter des champs » (groupes repliables : champs standard, puis un groupe
 * par dossier de champs personnalisés), pied « Ajouter un champ personnalisé »
 * / Annuler / Appliquer.
 *
 *   const colonnes = useColonnesTableau('client', STANDARD, fr);
 *   // barre d'outils : {colonnes.bouton}   — panneau : {colonnes.panneau}
 *   // grille : gridTemplateColumns = colonnes.pistes
 *   // en-têtes : colonnes.visibles.map((c) => c.entete)
 *   // cellules : colonnes.visibles.map((c) => c.rendu(ligne, valeurs[ligne.id]))
 *
 * Colonnes retenues PAR UTILISATEUR en base (table_view_preferences) : elles
 * suivent la personne d'un appareil à l'autre, et un collègue a les siennes.
 * Une colonne de champ personnalisé se trie (cf_ordre_ids) : `colonnes.tri`.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronRight, Columns3, GripVertical, Lock, Paperclip, Search, X } from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '../../lib/utils';
import { usePermissions } from '../../hooks/usePermissions';
import { useChampsPersoActifs } from '../../hooks/useChampsPersoActifs';
import { lireFuseau, listerChamps } from '../../lib/champsPersoApi';
import {
  champDeColonne, enregistrerColonnesTableau, idColonneChamp, lireColonnesTableau, type IdColonne,
} from '../../lib/colonnesTableauApi';
import { formaterValeur, nomFichier } from '../../lib/champs/valeurs';
import { ouvrirFichierChamp } from './ChampSaisie';
import { LIBELLES_OBJET, type ChampPerso, type DossierChamp, type ObjetChamp, type ValeurEnregistree } from '../../lib/champs/types';
import ModaleChamp from './reglages/ModaleChamp';

/** Une colonne standard de la liste, décrite par la page. */
export interface ColonneStandard<T> {
  id: string;
  libelle: string;
  /** Piste CSS grid (« 1.4fr », « 200px »). */
  largeur: string;
  /** Toujours affichée, en premier, ni déplaçable ni décochable (le nom). */
  verrouillee?: boolean;
  /** Affichée tant que la personne n'a rien réglé. */
  parDefaut?: boolean;
  /** En-tête (ex. bouton de tri de la page) ; sinon le libellé. */
  entete?: ReactNode;
  cellule: (ligne: T) => ReactNode;
}

export interface ColonneVisible<T> {
  id: IdColonne;
  libelle: string;
  largeur: string;
  entete: ReactNode;
  champ?: ChampPerso;
  rendu: (ligne: T, valeurs: Record<string, ValeurEnregistree> | undefined) => ReactNode;
}

export interface TriChamp { champId: string; asc: boolean }

const LARGEUR_CHAMP = 'minmax(140px, 1fr)';
const AUCUN: ChampPerso[] = [];
const enteteCls = 'py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary';

/** Ancien réglage (navigateur seulement) : repris une fois comme point de départ. */
function colonnesNavigateur(objet: ObjetChamp): string[] {
  try {
    const brut = JSON.parse(localStorage.getItem(`lume.champs.colonnes.${objet}`) || '[]');
    return Array.isArray(brut) ? brut.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Colonnes valides, verrouillées d'abord, sans doublon. */
export function normaliserColonnes(ids: IdColonne[], verrouillees: string[], connues: Set<string>): IdColonne[] {
  const vus = new Set<string>();
  const reste = ids.filter((id) => connues.has(id) && !verrouillees.includes(id) && !vus.has(id) && vus.add(id));
  return [...verrouillees, ...reste];
}

export function ValeurCellule({ champ, valeur, fr, fuseau }: {
  champ: ChampPerso; valeur: ValeurEnregistree | undefined; fr: boolean; fuseau?: string;
}) {
  const v = valeur?.value;
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) {
    return <span className="text-[14px] text-text-tertiary">—</span>;
  }
  if (champ.field_type === 'dropdown_single' || champ.field_type === 'dropdown_multi') {
    const choisies = (Array.isArray(v) ? v : [v]).map((id) => champ.options.find((o) => o.id === id)).filter((o): o is NonNullable<typeof o> => !!o);
    return (
      <span className="flex min-w-0 flex-wrap gap-1">
        {choisies.map((o) => (
          <span key={o.id} className="max-w-full truncate rounded-md px-1.5 py-0.5 text-[12px] text-text-primary"
            style={{ backgroundColor: o.color ? `${o.color}26` : 'var(--color-surface-tertiary, rgba(148,163,184,0.15))' }}>{o.label}</span>
        ))}
      </span>
    );
  }
  // Fichier : son nom, ouvert par un lien temporaire (bucket privé).
  if (champ.field_type === 'file' && typeof v === 'string') {
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); void ouvrirFichierChamp(v, fr); }}
        className="inline-flex min-w-0 items-center gap-1 truncate text-[14px] text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" title={nomFichier(v)}>
        <Paperclip size={12} aria-hidden className="shrink-0" /><span className="truncate">{nomFichier(v)}</span>
      </button>
    );
  }
  // URL : cliquable (http(s) seulement, déjà garanti par la base — revérifié avant d'en faire un lien).
  if (champ.field_type === 'url' && typeof v === 'string' && /^https?:\/\//i.test(v)) {
    return (
      <a href={v} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
        className="truncate text-[14px] text-primary hover:underline" title={v}>{v.replace(/^https?:\/\/(www\.)?/i, '')}</a>
    );
  }
  return <span className="truncate text-[14px] text-text-primary" title={formaterValeur(champ, v, fr ? 'fr' : 'en', fuseau)}>{formaterValeur(champ, v, fr ? 'fr' : 'en', fuseau)}</span>;
}

function IconeTri({ etat }: { etat: 'asc' | 'desc' | null }) {
  if (!etat) return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" /></svg>;
  return etat === 'asc'
    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m7 14 5-5 5 5" /></svg>
    : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m7 10 5 5 5-5" /></svg>;
}

export function useColonnesTableau<T>(objet: ObjetChamp, standard: ColonneStandard<T>[], fr: boolean, controle?: {
  /** Tri tenu par la page (qui en a besoin AVANT d'appeler ce hook pour charger ses lignes). */
  tri: TriChamp | null; setTri: (t: TriChamp | null) => void;
}) {
  const { isEnabled } = useChampsPersoActifs();
  const qc = useQueryClient();
  const { data: donnees } = useQuery({
    queryKey: ['champs-perso', objet], queryFn: () => listerChamps(objet), enabled: isEnabled, staleTime: 60_000,
  });
  const { data: fuseau = 'America/Toronto' } = useQuery({ queryKey: ['champs-perso', 'fuseau'], queryFn: lireFuseau, staleTime: 3_600_000, enabled: isEnabled });
  const champs = useMemo(() => (donnees?.fields ?? AUCUN).filter((c) => !c.archived_at), [donnees]);
  const cleReglage = ['colonnes-tableau', objet];
  const { data: reglage, isError } = useQuery({
    queryKey: cleReglage, queryFn: () => lireColonnesTableau(objet), staleTime: 300_000, retry: 1,
  });
  useEffect(() => { if (isError) console.error('[colonnes] lecture du réglage impossible : colonnes par défaut'); }, [isError]);

  const verrouillees = useMemo(() => standard.filter((c) => c.verrouillee).map((c) => c.id), [standard]);
  const connues = useMemo(() => new Set([...standard.map((c) => c.id), ...champs.map((c) => idColonneChamp(c.id))]), [standard, champs]);
  const parDefaut = useMemo(
    () => [...standard.filter((c) => c.parDefaut || c.verrouillee).map((c) => c.id), ...colonnesNavigateur(objet).map(idColonneChamp)],
    [standard, objet],
  );
  const ids = useMemo(() => normaliserColonnes(reglage ?? parDefaut, verrouillees, connues), [reglage, parDefaut, verrouillees, connues]);

  const [triInterne, setTriInterne] = useState<TriChamp | null>(null);
  const tri = controle ? controle.tri : triInterne;
  const setTri = controle ? controle.setTri : setTriInterne;
  // Un champ retiré des colonnes (ou archivé) ne trie plus la liste — une fois les champs connus.
  const champsCharges = !!donnees;
  useEffect(() => { if (champsCharges && tri && !ids.includes(idColonneChamp(tri.champId))) setTri(null); }, [ids, tri, champsCharges]); // eslint-disable-line react-hooks/exhaustive-deps
  const trierPar = (champId: string) => setTri(tri?.champId === champId ? { champId, asc: !tri.asc } : { champId, asc: true });

  const appliquer = async (nouvelles: IdColonne[]) => {
    const avant = qc.getQueryData<IdColonne[] | null>(cleReglage);
    qc.setQueryData(cleReglage, nouvelles);
    try {
      await enregistrerColonnesTableau(objet, nouvelles);
    } catch (err) {
      console.error('[colonnes] enregistrement', err);
      qc.setQueryData(cleReglage, avant ?? null);
      toast.error(fr ? 'Tes colonnes n’ont pas pu être enregistrées. Réessaie.' : 'Your columns could not be saved. Try again.');
      throw err;
    }
  };

  const parIdStandard = new Map(standard.map((c) => [c.id, c]));
  const parIdChamp = new Map(champs.map((c) => [c.id, c]));
  const visibles: ColonneVisible<T>[] = ids.flatMap((id): ColonneVisible<T>[] => {
    const s = parIdStandard.get(id);
    if (s) {
      return [{
        id, libelle: s.libelle, largeur: s.largeur,
        entete: <div key={id} className={enteteCls}>{s.entete ?? s.libelle}</div>,
        rendu: (ligne) => s.cellule(ligne),
      }];
    }
    const champ = parIdChamp.get(champDeColonne(id) ?? '');
    if (!champ) return [];
    const etat = tri?.champId === champ.id ? (tri.asc ? 'asc' : 'desc') : null;
    return [{
      id, libelle: champ.label, largeur: LARGEUR_CHAMP, champ,
      entete: (
        <div key={id} className={enteteCls}>
          <button type="button" onClick={() => trierPar(champ.id)}
            aria-sort={etat === 'asc' ? 'ascending' : etat === 'desc' ? 'descending' : 'none'}
            className="-mx-1 inline-flex min-w-0 items-center gap-1 rounded px-1 transition-colors hover:bg-surface-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <span className="truncate">{champ.label}</span> <IconeTri etat={etat} />
          </button>
        </div>
      ),
      rendu: (_ligne, valeurs) => <ValeurCellule champ={champ} valeur={valeurs?.[champ.id]} fr={fr} fuseau={fuseau} />,
    }];
  });

  const [ouvert, setOuvert] = useState(false);
  const bouton = (
    <button type="button" onClick={() => setOuvert(true)} aria-haspopup="dialog"
      className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-outline bg-surface-card px-3 text-[14px] text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      <Columns3 size={14} aria-hidden />{fr ? 'Gérer les champs' : 'Manage fields'}
    </button>
  );
  const panneau = ouvert ? (
    <PanneauGererChamps
      objet={objet} fr={fr} standard={standard} champs={champs} dossiers={donnees?.folders ?? []}
      colonnes={ids} verrouillees={verrouillees}
      onAppliquer={async (n) => { await appliquer(n); setOuvert(false); }}
      onChampCree={() => { void qc.invalidateQueries({ queryKey: ['champs-perso', objet] }); }}
      onClose={() => setOuvert(false)}
    />
  ) : null;

  return {
    visibles,
    pistes: visibles.map((c) => c.largeur).join(' '),
    /** Au moins une colonne de champ : charger les valeurs de la page. */
    avecChamps: visibles.some((c) => !!c.champ),
    tri, trierPar, effacerTri: () => setTri(null),
    bouton, panneau,
  };
}

function LigneTableau({ id, libelle, verrouillee, fr, onRetirer }: {
  id: string; libelle: string; verrouillee: boolean; fr: boolean; onRetirer: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: verrouillee });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-surface-secondary">
      {verrouillee ? (
        <span className="p-0.5 text-text-tertiary/40" aria-hidden><GripVertical size={14} /></span>
      ) : (
        <button type="button" {...attributes} {...listeners} aria-label={fr ? `Déplacer ${libelle}` : `Move ${libelle}`}
          className="cursor-grab rounded p-0.5 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <GripVertical size={14} aria-hidden />
        </button>
      )}
      <input type="checkbox" checked disabled={verrouillee} onChange={onRetirer} className="h-4 w-4 accent-primary disabled:opacity-40"
        aria-label={verrouillee ? (fr ? `${libelle} (toujours affichée)` : `${libelle} (always shown)`) : (fr ? `Retirer ${libelle} du tableau` : `Remove ${libelle} from the table`)} />
      <span className="min-w-0 flex-1 truncate text-[14px] text-text-primary">{libelle}</span>
      {verrouillee && <span className="text-text-secondary" title={fr ? 'Toujours affichée' : 'Always shown'}><Lock size={14} aria-hidden /></span>}
    </li>
  );
}

interface Groupe { cle: string; titre: string; elements: Array<{ id: IdColonne; libelle: string }> }

export function PanneauGererChamps<T>({ objet, fr, standard, champs, dossiers, colonnes, verrouillees, onAppliquer, onChampCree, onClose }: {
  objet: ObjetChamp; fr: boolean; standard: ColonneStandard<T>[]; champs: ChampPerso[]; dossiers: DossierChamp[];
  colonnes: IdColonne[]; verrouillees: string[];
  onAppliquer: (ids: IdColonne[]) => Promise<void>; onChampCree: (c: ChampPerso) => void; onClose: () => void;
}) {
  const ids = useId();
  const [brouillon, setBrouillon] = useState<IdColonne[]>(colonnes);
  const [recherche, setRecherche] = useState('');
  // Comme GHL : groupes repliés à l'ouverture ; une recherche les déplie tous.
  const [ouverts, setOuverts] = useState<Set<string>>(new Set());
  const [creation, setCreation] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  // Un champ créé ici n'est pas encore dans `champs` (la liste se recharge) : gardé à part.
  const [crees, setCrees] = useState<ChampPerso[]>([]);
  const { role } = usePermissions();
  const peutCreer = role === 'owner' || role === 'admin';
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => {
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape' && !creation) onClose(); };
    document.addEventListener('keydown', echap);
    return () => document.removeEventListener('keydown', echap);
  }, [creation, onClose]);

  const tousChamps = [...champs, ...crees.filter((c) => !champs.some((x) => x.id === c.id))];
  const libelle = (id: IdColonne): string => {
    const cid = champDeColonne(id);
    if (cid) return tousChamps.find((c) => c.id === cid)?.label ?? '';
    return standard.find((c) => c.id === id)?.libelle ?? '';
  };
  const q = recherche.trim().toLowerCase();
  const correspond = (texte: string) => !q || texte.toLowerCase().includes(q);
  const dansTableau = brouillon.filter((id) => correspond(libelle(id)));

  const nomObjet = fr ? LIBELLES_OBJET[objet].fr : LIBELLES_OBJET[objet].en;
  const groupes: Groupe[] = [];
  const standardsLibres = standard.filter((c) => !brouillon.includes(c.id) && correspond(c.libelle));
  if (standardsLibres.length) groupes.push({ cle: 'standard', titre: nomObjet, elements: standardsLibres.map((c) => ({ id: c.id, libelle: c.libelle })) });
  const libres = tousChamps.filter((c) => !brouillon.includes(idColonneChamp(c.id)) && correspond(c.label));
  const parDossier = new Map<string, ChampPerso[]>();
  for (const c of libres) parDossier.set(c.folder_id ?? '', [...(parDossier.get(c.folder_id ?? '') ?? []), c]);
  for (const d of dossiers.filter((x) => x.object_type === objet)) {
    const liste = parDossier.get(d.id);
    if (liste?.length) groupes.push({ cle: d.id, titre: d.name, elements: liste.map((c) => ({ id: idColonneChamp(c.id), libelle: c.label })) });
  }
  const sansDossier = [...parDossier.entries()].filter(([k]) => !k || !dossiers.some((d) => d.id === k)).flatMap(([, l]) => l);
  if (sansDossier.length) groupes.push({ cle: 'sans', titre: fr ? 'Champs personnalisés' : 'Custom fields', elements: sansDossier.map((c) => ({ id: idColonneChamp(c.id), libelle: c.label })) });

  const mobiles = brouillon.filter((id) => !verrouillees.includes(id));
  const surDrag = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const a = mobiles.indexOf(String(e.active.id)); const b = mobiles.indexOf(String(e.over.id));
    if (a < 0 || b < 0) return;
    setBrouillon([...verrouillees.filter((v) => brouillon.includes(v)), ...arrayMove(mobiles, a, b)]);
  };
  const change = JSON.stringify(brouillon) !== JSON.stringify(colonnes);
  const appliquer = async () => {
    setEnvoi(true);
    try { await onAppliquer(brouillon); } catch { /* signalé par le hook (toast), le panneau reste ouvert */ } finally { setEnvoi(false); }
  };
  const basculer = (cle: string) => setOuverts((r) => { const n = new Set(r); if (n.has(cle)) n.delete(cle); else n.add(cle); return n; });

  // La fenêtre de création est une SŒUR du panneau, pas un enfant : un clic sur
  // son fond ne doit pas remonter jusqu'au fond du panneau et le fermer aussi.
  return createPortal(
    <>
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/30" role="presentation" tabIndex={-1} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={`${ids}-titre`} tabIndex={-1} onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col bg-surface shadow-xl sm:w-[460px]">
        <div className="flex items-center justify-between border-b border-outline px-5 py-4">
          <h2 id={`${ids}-titre`} className="text-[18px] font-semibold text-text-primary">{fr ? 'Gérer les champs' : 'Manage fields'}</h2>
          <button type="button" onClick={onClose} aria-label={fr ? 'Fermer' : 'Close'}
            className="rounded p-1 text-text-tertiary hover:bg-surface-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X size={18} aria-hidden /></button>
        </div>

        <div className="border-b border-outline px-5 py-3">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" aria-hidden />
            <input id={`${ids}-recherche`} value={recherche} onChange={(e) => setRecherche(e.target.value)}
              aria-label={fr ? 'Chercher un champ' : 'Search fields'} placeholder={fr ? 'Chercher un champ' : 'Search fields'}
              className="glass-input h-9 w-full pl-8 text-[13px]" />
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto py-4">
          <section aria-labelledby={`${ids}-tableau`} className="px-3">
            <h3 id={`${ids}-tableau`} className="mb-2 px-2 text-[15px] font-semibold text-text-primary">
              {fr ? 'Champs dans le tableau' : 'Fields in table'}
            </h3>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={surDrag}
              accessibility={{ screenReaderInstructions: { draggable: fr
                ? 'Pour déplacer une colonne, appuie sur Espace, puis sur les flèches ; Espace pour la déposer, Échap pour annuler.'
                : 'To move a column, press Space, then the arrow keys; Space to drop it, Escape to cancel.' } }}>
              <SortableContext items={mobiles} strategy={verticalListSortingStrategy}>
                <ul>
                  {dansTableau.map((id) => (
                    <LigneTableau key={id} id={id} libelle={libelle(id)} verrouillee={verrouillees.includes(id)} fr={fr}
                      onRetirer={() => setBrouillon((b) => b.filter((x) => x !== id))} />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
            {dansTableau.length === 0 && <p className="px-2 text-[13px] text-text-tertiary">{fr ? 'Aucun champ ne correspond.' : 'No matching field.'}</p>}
          </section>

          <section aria-labelledby={`${ids}-ajouter`}>
            <h3 id={`${ids}-ajouter`} className="mb-2 px-5 text-[15px] font-semibold text-text-primary">
              {fr ? 'Ajouter des champs' : 'Add fields'}
            </h3>
            {groupes.length === 0 && (
              <p className="px-5 text-[13px] text-text-tertiary">
                {q ? (fr ? 'Aucun champ ne correspond.' : 'No matching field.') : (fr ? 'Tous les champs sont déjà dans le tableau.' : 'Every field is already in the table.')}
              </p>
            )}
            {groupes.map((g) => {
              const replie = !q && !ouverts.has(g.cle);
              return (
                <div key={g.cle} className="border-b border-outline first-of-type:border-t">
                  <button type="button" aria-expanded={!replie} onClick={() => basculer(g.cle)}
                    className="flex w-full items-center gap-2 bg-surface-secondary/60 px-5 py-3.5 text-left text-[14px] text-text-primary hover:bg-surface-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
                    <ChevronRight size={15} aria-hidden className={cn('text-text-secondary transition-transform', !replie && 'rotate-90')} />
                    <span>{g.titre}</span>
                  </button>
                  {!replie && (
                    <ul className="py-1">
                      {g.elements.map((e) => (
                        <li key={e.id}>
                          <label htmlFor={`${ids}-${e.id}`} className="flex items-center gap-2.5 py-2 pl-11 pr-5 text-[14px] text-text-primary hover:bg-surface-secondary">
                            <input id={`${ids}-${e.id}`} type="checkbox" checked={false} className="h-4 w-4 accent-primary"
                              onChange={() => setBrouillon((b) => [...b, e.id])} />
                            <span className="truncate">{e.libelle}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-outline px-5 py-3">
          {peutCreer ? (
            <button type="button" onClick={() => setCreation(true)}
              className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap rounded text-[13px] font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {fr ? 'Ajouter un champ personnalisé' : 'Add custom field'}
            </button>
          ) : <span />}
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} className="glass-button px-4 py-2 text-[13px]">{fr ? 'Annuler' : 'Cancel'}</button>
            <button type="button" onClick={() => { void appliquer(); }} disabled={!change || envoi}
              className="glass-button-primary px-4 py-2 text-[13px] disabled:opacity-50">{fr ? 'Appliquer' : 'Apply'}</button>
          </div>
        </div>
      </div>
    </div>
      {creation && (
        <ModaleChamp open objet={objet} dossiers={dossiers} fr={fr} onClose={() => setCreation(false)}
          onEnregistre={(c) => {
            // Revient avec le nouveau champ coché, s'il est bien de cet objet.
            if (c.object_type === objet) {
              setCrees((l) => [...l, c]);
              setBrouillon((b) => (b.includes(idColonneChamp(c.id)) ? b : [...b, idColonneChamp(c.id)]));
            }
            onChampCree(c);
          }} />
      )}
    </>,
    document.body,
  );
}
