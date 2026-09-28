/**
 * Réglages → Champs personnalisés (modèle GoHighLevel, écran 1).
 *
 * Un seul gestionnaire pour tous les objets — client, opportunité (pipeline),
 * job, devis, facture — avec :
 *   · sélecteur d'objet (et « Tous ») avec compteurs ;
 *   · vue Champs / Dossiers ;
 *   · filtres Type, Source (standard / personnalisé), Créé le (tous les
 *     opérateurs de date, calculés dans le fuseau de l'entreprise) ;
 *   · table groupée par dossier (repliable), clé copiable au format variable ;
 *   · « ⋯ » : champs cherchables, champs uniques, afficher les archivés ;
 *   · pour les opportunités : les champs affichés sur les cartes, par pipeline.
 *
 * Les champs standard sont listés en lecture seule (cadenas).
 * Derrière le drapeau `custom_fields_v2`.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Archive, ArrowDown, ArrowUp, Briefcase, Columns3, Copy, FileText, FolderOpen, FolderPlus, GitBranch, Home, Lock, MoreHorizontal, MoreVertical,
  Pencil, Plus, Receipt, RotateCcw, Search, Trash2, Layers, Sparkles, Users, X, type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import { FilterPill } from '../../components/ui';
import EmptyState from '../../components/ui/EmptyState';
import DatePickerInput from '../../components/ui/DatePickerInput';
import { confirmer } from '../../components/ui/ConfirmDialog';
import { useChampsPersoActifs } from '../../hooks/useChampsPersoActifs';
import {
  archiverChamp, listerChamps, lireFuseau, renommerDossier, supprimerDossier, modifierChamp,
  type ChampPerso, type ObjetChamp,
} from '../../lib/champsPersoApi';
import { OBJETS, LIBELLES_OBJET, LIBELLES_TYPE, TYPES_CHAMP, variableAffichee, type TypeChamp } from '../../lib/champs/types';
import {
  evaluerCondition, LIBELLES_OPERATEUR, OPERATEURS_DUREE, OPERATEURS_PAR_FAMILLE,
  type Operateur, type UniteDuree,
} from '../../lib/champs/filtres';
import type { ChampStandard } from '../../lib/champs/standard';
import { ICONE_TYPE } from '../../components/champs/icones';
import ModaleChamp from '../../components/champs/reglages/ModaleChamp';
import { ModaleCherchables, ModaleDossier, ModaleSuppression, ModaleUniques } from '../../components/champs/reglages/ModalesReglages';
import CartesPipelineReglage from '../../components/champs/reglages/CartesPipelineReglage';
import ModaleSuggestions, { nomIndustrie, useIndustrie } from '../../components/champs/reglages/ModaleSuggestions';

type Onglet = 'tous' | ObjetChamp;
type Source = 'all' | 'standard' | 'custom';
/** Colonnes qu'on peut masquer (« 6/7 colonnes » de GHL) ; le nom et les actions restent. */
type ColonneOpt = 'type' | 'dossier' | 'cle' | 'source' | 'cree';
const COLONNES_OPT: ColonneOpt[] = ['type', 'dossier', 'cle', 'source', 'cree'];
const LARGEURS: Record<ColonneOpt, string> = {
  type: 'minmax(130px,1fr)', dossier: 'minmax(130px,1fr)', cle: 'minmax(180px,1.4fr)', source: 'minmax(100px,0.8fr)', cree: 'minmax(180px,1.1fr)',
};
const PAR_PAGE = [10, 20, 50, 100];
const CLE_PAR_PAGE = 'lume.champs.reglages.parPage';
const CLE_COLONNES = 'lume.champs.reglages.colonnesMasquees';
const ICONE_OBJET: Record<Onglet, LucideIcon> = {
  tous: Layers, client: Users, deal: GitBranch, job: Briefcase, quote: FileText, invoice: Receipt, property: Home,
};

function lireLocal<T>(cle: string, defaut: T, valide: (v: unknown) => v is T): T {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(cle) ?? 'null');
    return valide(v) ? v : defaut;
  } catch {
    return defaut;
  }
}
function ecrireLocal(cle: string, v: unknown) {
  try { localStorage.setItem(cle, JSON.stringify(v)); } catch (err) { console.error('[ChampsPerso] réglage local', err); }
}

/** Une ligne de la table : un champ personnalisé OU un champ standard. */
type Ligne =
  | { sorte: 'custom'; id: string; objet: ObjetChamp; champ: ChampPerso }
  | { sorte: 'standard'; id: string; objet: ObjetChamp; std: ChampStandard };

export default function ChampsPersoSettings() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const ids = useId();
  const qc = useQueryClient();
  const { isEnabled } = useChampsPersoActifs();

  const [onglet, setOnglet] = useState<Onglet>('tous');
  const [vue, setVue] = useState<'champs' | 'dossiers'>('champs');
  const [recherche, setRecherche] = useState('');
  const [filtreType, setFiltreType] = useState<'all' | TypeChamp>('all');
  const [source, setSource] = useState<Source>('all');
  const [creeOp, setCreeOp] = useState<'all' | Operateur>('all');
  const [creeN, setCreeN] = useState(7);
  const [creeUnite, setCreeUnite] = useState<UniteDuree>('days');
  const [creeA, setCreeA] = useState('');
  const [creeB, setCreeB] = useState('');
  const [archives, setArchives] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [menuGlobal, setMenuGlobal] = useState(false);
  const [menuColonnes, setMenuColonnes] = useState(false);
  // Comme GHL : liste à plat, la plus récente d'abord ; tri au clic sur « Nom » ou « Créé le ».
  const [tri, setTri] = useState<{ col: 'nom' | 'cree'; asc: boolean }>({ col: 'cree', asc: false });
  const [page, setPage] = useState(0);
  const [parPage, setParPage] = useState<number>(() => lireLocal(CLE_PAR_PAGE, 20, (v): v is number => PAR_PAGE.includes(v as number)));
  const [masquees, setMasquees] = useState<ColonneOpt[]>(() => lireLocal(CLE_COLONNES, ['source'] as ColonneOpt[],
    (v): v is ColonneOpt[] => Array.isArray(v) && v.every((x) => COLONNES_OPT.includes(x as ColonneOpt))));
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [lotEnCours, setLotEnCours] = useState(false);

  const [modaleChamp, setModaleChamp] = useState<{ champ: ChampPerso | null; dossier?: string | null } | null>(null);
  const [modaleDossier, setModaleDossier] = useState(false);
  const [modaleCherchables, setModaleCherchables] = useState(false);
  const [modaleUniques, setModaleUniques] = useState(false);
  const [modaleSuggestions, setModaleSuggestions] = useState(false);
  const [aSupprimer, setASupprimer] = useState<ChampPerso | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['champs-perso', 'reglages', archives],
    queryFn: () => listerChamps(undefined, archives),
    enabled: isEnabled,
  });
  const { data: fuseau = 'America/Toronto' } = useQuery({ queryKey: ['champs-perso', 'fuseau'], queryFn: lireFuseau, staleTime: 3_600_000 });
  const recharger = () => qc.invalidateQueries({ queryKey: ['champs-perso'] });
  const { data: industrie } = useIndustrie(isEnabled);
  const aucunChampPerso = !!data && data.fields.every((c) => c.archived_at);

  useEffect(() => {
    const fermer = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) { setMenu(null); setMenuGlobal(false); setMenuColonnes(false); } };
    document.addEventListener('mousedown', fermer);
    return () => document.removeEventListener('mousedown', fermer);
  }, []);

  const objetCourant: ObjetChamp = onglet === 'tous' ? 'client' : onglet;

  const toutesLignes = useMemo<Ligne[]>(() => {
    if (!data) return [];
    const custom: Ligne[] = data.fields.map((c) => ({ sorte: 'custom', id: c.id, objet: c.object_type, champ: c }));
    const standard: Ligne[] = OBJETS.flatMap((o) => (data.standard[o] ?? []).map((s) => ({ sorte: 'standard' as const, id: `std-${o}-${s.key}`, objet: o, std: s })));
    return [...custom, ...standard];
  }, [data]);

  // Comme GHL (« All 35 ») : les champs standard comptent aussi.
  const compte = (o: Onglet) => toutesLignes.filter((l) => o === 'tous' || l.objet === o).length;

  const lignes = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return toutesLignes.filter((l) => {
      if (onglet !== 'tous' && l.objet !== onglet) return false;
      if (source !== 'all' && l.sorte !== source) return false;
      const type = l.sorte === 'custom' ? l.champ.field_type : l.std.field_type;
      if (filtreType !== 'all' && type !== filtreType) return false;
      const nom = l.sorte === 'custom' ? l.champ.label : (fr ? l.std.label.fr : l.std.label.en);
      const cle = l.sorte === 'custom' ? l.champ.key : l.std.key;
      if (q && !nom.toLowerCase().includes(q) && !cle.includes(q)) return false;
      if (creeOp !== 'all') {
        // Les champs standard n'ont pas de date de création : exclus d'un filtre de date.
        if (l.sorte === 'standard') return false;
        try {
          if (!evaluerCondition('date', l.champ.created_at, {
            field_id: l.id, op: creeOp, n: creeN, unit: creeUnite, value: creeA || null, value2: creeB || null,
          }, { fuseau, avecHeure: true })) return false;
        } catch { return true; } // date manquante : le filtre n'est pas encore complet
      }
      return true;
    });
  }, [toutesLignes, onglet, source, filtreType, recherche, creeOp, creeN, creeUnite, creeA, creeB, fuseau, fr]);

  const dossiers = data?.folders ?? [];
  const triees = useMemo(() => {
    const nomDe = (l: Ligne) => (l.sorte === 'custom' ? l.champ.label : (fr ? l.std.label.fr : l.std.label.en));
    const sens = tri.asc ? 1 : -1;
    return [...lignes].sort((a, b) => {
      if (tri.col === 'nom') return sens * nomDe(a).localeCompare(nomDe(b), fr ? 'fr' : 'en', { sensitivity: 'base' });
      // Les champs standard n'ont pas de date : toujours après les champs personnalisés.
      if (a.sorte !== b.sorte) return a.sorte === 'custom' ? -1 : 1;
      if (a.sorte === 'custom' && b.sorte === 'custom') return sens * a.champ.created_at.localeCompare(b.champ.created_at);
      return 0;
    });
  }, [lignes, tri, fr]);
  const nbPages = Math.max(1, Math.ceil(triees.length / parPage));
  const pageCourante = Math.min(page, nbPages - 1);
  const lignesPage = triees.slice(pageCourante * parPage, (pageCourante + 1) * parPage);
  // Un filtre qui change ramène à la première page et vide la sélection.
  useEffect(() => { setPage(0); setSelection(new Set()); }, [onglet, source, filtreType, recherche, creeOp, creeN, creeUnite, creeA, creeB, archives]);

  const selectionnables = lignesPage.filter((l) => l.sorte === 'custom').map((l) => l.id);
  const toutCoche = selectionnables.length > 0 && selectionnables.every((id) => selection.has(id));
  const champsSelectionnes = (data?.fields ?? []).filter((c) => selection.has(c.id));
  const objetsSelection = new Set(champsSelectionnes.map((c) => c.object_type));
  const basculerSelection = (id: string) => setSelection((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const deplacerLot = async (dossierId: string | null) => {
    setLotEnCours(true);
    try {
      await Promise.all(champsSelectionnes.map((c) => modifierChamp(c.id, { folder_id: dossierId })));
      toast.success(fr ? `${champsSelectionnes.length} champ(s) déplacé(s).` : `${champsSelectionnes.length} field(s) moved.`);
      setSelection(new Set());
      await recharger();
    } catch (err) {
      console.error('[ChampsPerso] déplacement groupé', err);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLotEnCours(false);
    }
  };
  const archiverLot = async () => {
    const actifs = champsSelectionnes.filter((c) => !c.archived_at);
    if (!actifs.length) return;
    const ok = await confirmer({
      title: fr ? `Archiver ${actifs.length} champ(s) ?` : `Archive ${actifs.length} field(s)?`,
      message: fr ? 'Les valeurs déjà saisies sont gardées ; les champs disparaissent des fiches et des formulaires. Tu peux les restaurer.'
        : 'Values already entered are kept; the fields disappear from records and forms. You can restore them.',
      confirmLabel: fr ? 'Archiver' : 'Archive', danger: true,
    });
    if (!ok) return;
    setLotEnCours(true);
    try {
      await Promise.all(actifs.map((c) => archiverChamp(c.id, true)));
      toast.success(fr ? `${actifs.length} champ(s) archivé(s).` : `${actifs.length} field(s) archived.`);
      setSelection(new Set());
      await recharger();
    } catch (err) {
      console.error('[ChampsPerso] archivage groupé', err);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLotEnCours(false);
    }
  };

  const copier = (texte: string) => {
    void navigator.clipboard.writeText(texte).then(
      () => toast.success(fr ? 'Variable copiée.' : 'Variable copied.'),
      (err) => { console.error('[ChampsPerso] copie', err); toast.error(fr ? 'Copie impossible.' : 'Copy failed.'); },
    );
  };

  const deplacer = async (c: ChampPerso, dossierId: string | null) => {
    setMenu(null);
    try {
      await modifierChamp(c.id, { folder_id: dossierId });
      await recharger();
    } catch (err) {
      console.error('[ChampsPerso] déplacement', err);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  // Ordre d'affichage (fiches, fenêtres de création) : parmi les champs du même
  // objet et du même dossier. Les positions sont renumérotées 0..n pour rester nettes.
  const voisins = (c: ChampPerso) => (data?.fields ?? [])
    .filter((x) => x.object_type === c.object_type && (x.folder_id ?? null) === (c.folder_id ?? null) && !x.archived_at)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.created_at.localeCompare(b.created_at));
  const bouger = async (c: ChampPerso, sens: -1 | 1) => {
    setMenu(null);
    const liste = voisins(c);
    const i = liste.findIndex((x) => x.id === c.id);
    const j = i + sens;
    if (i < 0 || j < 0 || j >= liste.length) return;
    [liste[i], liste[j]] = [liste[j], liste[i]];
    try {
      await Promise.all(liste.map((x, pos) => (x.position === pos ? null : modifierChamp(x.id, { position: pos }))));
      await recharger();
    } catch (err) {
      console.error('[ChampsPerso] ordre', err);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const restaurer = async (c: ChampPerso) => {
    setMenu(null);
    try {
      await archiverChamp(c.id, false);
      toast.success(fr ? 'Champ restauré.' : 'Field restored.');
      await recharger();
    } catch (err) {
      console.error('[ChampsPerso] restauration', err);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  if (!isEnabled) {
    return (
      <div className="max-w-2xl">
        <EmptyState icon={Layers} title={fr ? 'Champs personnalisés' : 'Custom fields'}
          description={fr ? 'Cette fonctionnalité n’est pas encore activée pour votre entreprise.' : 'This feature is not enabled for your company yet.'} />
      </div>
    );
  }

  const fmtDate = (iso: string) => new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: fuseau }).format(new Date(iso));
  const visibles = COLONNES_OPT.filter((c) => !masquees.includes(c));
  const colonnes = ['44px', 'minmax(200px,1.6fr)', ...visibles.map((c) => LARGEURS[c]), '72px'].join(' ');
  const nbColonnes = visibles.length + 3;
  const LIBELLE_COLONNE: Record<ColonneOpt, string> = {
    type: fr ? 'Type de champ' : 'Field type', dossier: fr ? 'Dossier' : 'Folder name', cle: fr ? 'Clé' : 'Key',
    source: 'Source', cree: fr ? 'Créé le' : 'Created',
  };
  const basculerColonne = (c: ColonneOpt) => setMasquees((m) => {
    const n = m.includes(c) ? m.filter((x) => x !== c) : [...m, c];
    ecrireLocal(CLE_COLONNES, n);
    return n;
  });
  const changerParPage = (n: number) => { setParPage(n); setPage(0); ecrireLocal(CLE_PAR_PAGE, n); };
  const trierPar = (col: 'nom' | 'cree') => setTri((t) => (t.col === col ? { col, asc: !t.asc } : { col, asc: col === 'nom' }));
  const flecheTri = (col: 'nom' | 'cree') => (tri.col === col ? (tri.asc ? <ArrowUp size={13} aria-hidden /> : <ArrowDown size={13} aria-hidden />) : null);
  const enteteCls = 'flex items-center border-b border-outline bg-surface-card px-3 py-2.5 text-[13px] font-medium text-text-primary';
  const dossiersLot = objetsSelection.size === 1 ? dossiers.filter((d) => d.object_type === [...objetsSelection][0]) : [];

  return (
    <div className="space-y-4" ref={menuRef}>
      {/* ── En-tête (GHL : titre seul, les boutons sont dans la carte) ── */}
      <div>
        <h2 className="text-[20px] font-semibold tracking-tight text-text-primary">{fr ? 'Champs personnalisés' : 'Custom fields'}</h2>
        <p className="mt-0.5 text-[12px] text-text-tertiary">
          {fr ? 'Crée et gère les champs de tes objets pour capter et organiser tes données.' : 'Create and manage custom fields for your objects to capture and organize data.'}
        </p>
      </div>

      {/* ── Aucun champ encore : on propose ceux du métier ── */}
      {aucunChampPerso && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-text-primary">
              {fr ? 'Commence avec les champs de ton métier' : 'Start with the fields for your trade'}
              {industrie && industrie !== 'other' && <span className="font-normal text-text-secondary"> · {nomIndustrie(industrie, fr)}</span>}
            </p>
            <p className="mt-0.5 text-[12px] text-text-secondary">
              {fr ? 'Des champs prêts à l’emploi, que tu peux renommer ou retirer ensuite.' : 'Ready-made fields you can rename or remove later.'}
            </p>
          </div>
          <button type="button" onClick={() => setModaleSuggestions(true)} className="glass-button-primary inline-flex items-center gap-2 whitespace-nowrap">
            <Sparkles size={14} aria-hidden /> {fr ? 'Voir les champs suggérés' : 'See suggested fields'}
          </button>
        </div>
      )}

      {/* ── Objets (cartes avec icône et compteur, comme GHL) ── */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={fr ? 'Objet' : 'Object'}>
        {(['tous', ...OBJETS] as Onglet[]).map((o) => {
          const Icone = ICONE_OBJET[o];
          return (
            <button key={o} role="tab" type="button" aria-selected={onglet === o} onClick={() => setOnglet(o)}
              className={cn('inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                onglet === o ? 'border-primary/50 bg-primary/5 text-text-primary' : 'border-outline-subtle bg-surface-card text-text-secondary hover:text-text-primary')}>
              <Icone size={15} aria-hidden />
              {o === 'tous' ? (fr ? 'Tous' : 'All') : (fr ? LIBELLES_OBJET[o].fr : LIBELLES_OBJET[o].en)}
              <span className="rounded-full bg-surface-secondary px-1.5 text-[11px] tabular-nums text-text-tertiary">{compte(o)}</span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-outline bg-surface-card p-3">
        {/* ── Vue + actions (GHL : Fields | Folders à gauche ; Create folder, Create field, ⋮ à droite) ── */}
        <div className="relative mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg bg-surface-secondary/80 p-1" role="tablist" aria-label={fr ? 'Vue' : 'View'}>
            {(['champs', 'dossiers'] as const).map((v) => (
              <button key={v} role="tab" type="button" aria-selected={vue === v} onClick={() => setVue(v)}
                className={cn('rounded-md px-3 py-1 text-[13px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  vue === v ? 'bg-surface-card text-text-primary shadow-sm' : 'text-text-tertiary')}>
                {v === 'champs' ? (fr ? 'Champs' : 'Fields') : (fr ? 'Dossiers' : 'Folders')}
                <span className="ml-1.5 text-[11px] text-text-tertiary">
                  {v === 'champs' ? lignes.length : dossiers.filter((d) => onglet === 'tous' || d.object_type === onglet).length}
                </span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setModaleDossier(true)} className="glass-button inline-flex items-center gap-2 whitespace-nowrap">
              <FolderPlus size={14} aria-hidden /> {fr ? 'Créer un dossier' : 'Create folder'}
            </button>
            <button type="button" onClick={() => setModaleChamp({ champ: null })} className="glass-button-primary inline-flex items-center gap-2 whitespace-nowrap">
              <Plus size={14} aria-hidden /> {fr ? 'Créer un champ' : 'Create field'}
            </button>
            <button type="button" aria-label={fr ? 'Plus d’options' : 'More options'} aria-haspopup="menu" aria-expanded={menuGlobal}
              onClick={() => { setMenuGlobal((v) => !v); setMenuColonnes(false); }}
              className="rounded-md border border-outline p-2 text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <MoreVertical size={16} aria-hidden />
            </button>
          </div>
          {menuGlobal && (
            <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-outline bg-surface-elevated py-1 shadow-dropdown">
              <button role="menuitem" type="button" onClick={() => { setMenuGlobal(false); setModaleSuggestions(true); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-text-primary hover:bg-surface-secondary">
                <Sparkles size={13} aria-hidden /> {fr ? 'Champs suggérés pour ton métier' : 'Suggested fields for your trade'}
              </button>
              <button role="menuitem" type="button" onClick={() => { setMenuGlobal(false); setModaleCherchables(true); }} className="block w-full px-3 py-2 text-left text-[13px] text-text-primary hover:bg-surface-secondary">
                {fr ? 'Modifier les champs cherchables' : 'Edit searchable fields'}
              </button>
              <button role="menuitem" type="button" onClick={() => { setMenuGlobal(false); setModaleUniques(true); }} className="block w-full px-3 py-2 text-left text-[13px] text-text-primary hover:bg-surface-secondary">
                {fr ? 'Modifier les champs uniques' : 'Edit unique fields'}
              </button>
              <button role="menuitemcheckbox" aria-checked={archives} type="button" onClick={() => { setMenuGlobal(false); setArchives((v) => !v); }} className="block w-full px-3 py-2 text-left text-[13px] text-text-primary hover:bg-surface-secondary">
                {archives ? (fr ? 'Masquer les champs archivés' : 'Hide archived fields') : (fr ? 'Afficher les champs archivés' : 'Show archived fields')}
              </button>
            </div>
          )}
        </div>

        {vue === 'champs' ? (
          <>
            {/* ── Filtres (GHL : Type, Créé, Source, chacun avec ×) · colonnes · recherche ── */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <FilterPill label={fr ? 'Type de champ' : 'Field type'} value={filtreType} onChange={(v) => setFiltreType(v as 'all' | TypeChamp)}
                onClear={() => setFiltreType('all')} clearLabel={fr ? 'Effacer le filtre Type' : 'Clear type filter'}
                options={[{ value: 'all', label: fr ? 'Tous' : 'All' }, ...TYPES_CHAMP.map((t) => ({ value: t, label: fr ? LIBELLES_TYPE[t].fr : LIBELLES_TYPE[t].en }))]} />
              <FilterPill label={fr ? 'Créé le' : 'Created'} value={creeOp} onChange={(v) => setCreeOp(v as 'all' | Operateur)}
                onClear={() => setCreeOp('all')} clearLabel={fr ? 'Effacer le filtre Créé le' : 'Clear created filter'}
                options={[{ value: 'all', label: fr ? 'Tous' : 'All' }, ...OPERATEURS_PAR_FAMILLE.date.filter((o) => o !== 'is_empty' && o !== 'is_not_empty')
                  .map((o) => ({ value: o, label: fr ? LIBELLES_OPERATEUR[o].fr : LIBELLES_OPERATEUR[o].en }))]} />
              {creeOp !== 'all' && OPERATEURS_DUREE.includes(creeOp) && (
                <span className="inline-flex items-center gap-1">
                  <input aria-label={fr ? 'Nombre' : 'Number'} type="number" min={1} value={creeN} onChange={(e) => setCreeN(Math.max(1, Number(e.target.value) || 1))}
                    className="h-9 w-16 rounded-md border border-outline bg-surface-card px-2 text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
                  <label htmlFor={`${ids}-unite`} className="sr-only">{fr ? 'Unité' : 'Unit'}</label>
                  <select id={`${ids}-unite`} value={creeUnite} onChange={(e) => setCreeUnite(e.target.value as UniteDuree)}
                    className="h-9 rounded-md border border-outline bg-surface-card px-2 text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                    <option value="days">{fr ? 'jours' : 'days'}</option><option value="weeks">{fr ? 'semaines' : 'weeks'}</option><option value="months">{fr ? 'mois' : 'months'}</option>
                  </select>
                </span>
              )}
              {(creeOp === 'before' || creeOp === 'after' || creeOp === 'between') && (
                <span className="inline-flex items-center gap-1">
                  <span className="w-36"><DatePickerInput value={creeA} onChange={setCreeA} language={fr ? 'fr' : 'en'} /></span>
                  {creeOp === 'between' && <><span className="text-[12px] text-text-tertiary">{fr ? 'et' : 'and'}</span><span className="w-36"><DatePickerInput value={creeB} onChange={setCreeB} language={fr ? 'fr' : 'en'} /></span></>}
                </span>
              )}
              <FilterPill label="Source" value={source} onChange={(v) => setSource(v as Source)}
                onClear={() => setSource('all')} clearLabel={fr ? 'Effacer le filtre Source' : 'Clear source filter'}
                options={[{ value: 'all', label: fr ? 'Toutes' : 'All' }, { value: 'standard', label: 'Standard' }, { value: 'custom', label: fr ? 'Personnalisé' : 'Custom' }]} />
              <div className="relative ml-auto flex items-center gap-2">
                <button type="button" aria-haspopup="menu" aria-expanded={menuColonnes} onClick={() => { setMenuColonnes((v) => !v); setMenuGlobal(false); }}
                  className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md border border-outline bg-surface-card px-3 text-[13px] text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                  <Columns3 size={14} aria-hidden />{visibles.length + 2}/{COLONNES_OPT.length + 2} {fr ? 'colonnes' : 'columns'}
                </button>
                {menuColonnes && (
                  <div role="menu" className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border border-outline bg-surface-elevated py-1 shadow-dropdown">
                    {[{ id: 'nom', libelle: fr ? 'Nom du champ' : 'Field name' }, ...COLONNES_OPT.map((c) => ({ id: c, libelle: LIBELLE_COLONNE[c] })), { id: 'actions', libelle: 'Actions' }].map((c) => {
                      const fixe = c.id === 'nom' || c.id === 'actions';
                      const coche = fixe || !masquees.includes(c.id as ColonneOpt);
                      return (
                        <button key={c.id} role="menuitemcheckbox" aria-checked={coche} type="button" disabled={fixe}
                          onClick={() => basculerColonne(c.id as ColonneOpt)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-text-primary hover:bg-surface-secondary disabled:cursor-default disabled:opacity-60">
                          <span aria-hidden className={cn('flex h-3.5 w-3.5 items-center justify-center rounded-sm border', coche ? 'border-primary bg-primary text-white' : 'border-outline')}>
                            {coche && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>}
                          </span>
                          {c.libelle}{fixe && <Lock size={11} aria-hidden className="ml-auto text-text-tertiary" />}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="relative">
                  <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input value={recherche} onChange={(e) => setRecherche(e.target.value)} aria-label={fr ? 'Chercher un champ' : 'Search fields'}
                    placeholder={fr ? 'Chercher un champ' : 'Search fields'}
                    className="h-9 w-[220px] rounded-md border border-outline bg-surface-card pl-8 pr-3 text-[14px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
                </div>
              </div>
            </div>

            {/* ── Actions groupées (cases cochées) ── */}
            {selection.size > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-[13px]">
                <span className="font-medium text-text-primary">{fr ? `${selection.size} sélectionné(s)` : `${selection.size} selected`}</span>
                <label htmlFor={`${ids}-lot-dossier`} className="sr-only">{fr ? 'Déplacer vers un dossier' : 'Move to folder'}</label>
                <select id={`${ids}-lot-dossier`} value="" disabled={lotEnCours || objetsSelection.size !== 1}
                  title={objetsSelection.size !== 1 ? (fr ? 'Choisis des champs d’un même objet pour les déplacer.' : 'Pick fields of the same object to move them.') : undefined}
                  onChange={(e) => { if (e.target.value) void deplacerLot(e.target.value === '__aucun' ? null : e.target.value); }}
                  className="h-8 rounded-md border border-outline bg-surface-card px-2 text-[13px] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                  <option value="">{fr ? 'Déplacer vers…' : 'Move to…'}</option>
                  <option value="__aucun">{fr ? 'Sans dossier' : 'No folder'}</option>
                  {dossiersLot.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <button type="button" disabled={lotEnCours || !champsSelectionnes.some((c) => !c.archived_at)} onClick={() => { void archiverLot(); }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-outline bg-surface-card px-2.5 py-1 text-[13px] text-red-600 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                  <Archive size={13} aria-hidden />{fr ? 'Archiver' : 'Archive'}
                </button>
                <button type="button" onClick={() => setSelection(new Set())} aria-label={fr ? 'Désélectionner' : 'Clear selection'}
                  className="ml-auto rounded p-1 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X size={14} aria-hidden /></button>
              </div>
            )}

            {/* ── Table ── */}
            <div className="overflow-x-auto rounded-md border border-outline">
              <div className="grid min-w-[900px]" style={{ gridTemplateColumns: colonnes }}>
                <div className={cn(enteteCls, 'justify-center')}>
                  <input type="checkbox" checked={toutCoche} disabled={selectionnables.length === 0}
                    onChange={() => setSelection((s) => { const n = new Set(s); selectionnables.forEach((id) => (toutCoche ? n.delete(id) : n.add(id))); return n; })}
                    aria-label={fr ? 'Tout sélectionner sur cette page' : 'Select all on this page'} className="h-4 w-4 accent-primary disabled:opacity-40" />
                </div>
                <div className={enteteCls}>
                  <button type="button" onClick={() => trierPar('nom')} aria-sort={tri.col === 'nom' ? (tri.asc ? 'ascending' : 'descending') : 'none'}
                    className="inline-flex items-center gap-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{fr ? 'Nom du champ' : 'Field name'} {flecheTri('nom')}</button>
                </div>
                {visibles.map((c) => (
                  <div key={c} className={enteteCls}>
                    {c === 'cree' ? (
                      <button type="button" onClick={() => trierPar('cree')} aria-sort={tri.col === 'cree' ? (tri.asc ? 'ascending' : 'descending') : 'none'}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                        <span className="text-text-primary">{LIBELLE_COLONNE.cree}</span> {flecheTri('cree')}
                      </button>
                    ) : LIBELLE_COLONNE[c]}
                  </div>
                ))}
                <div className={cn(enteteCls, 'justify-center')}>Actions</div>

                {isLoading && Array.from({ length: 6 }).map((_, i) => (
                  <React.Fragment key={`sk-${i}`}>
                    {Array.from({ length: nbColonnes }).map((__, j) => (
                      <div key={j} className="border-b border-outline/30 px-3 py-3"><div className="h-4 w-20 animate-pulse rounded bg-surface-tertiary" /></div>
                    ))}
                  </React.Fragment>
                ))}

                {!isLoading && error && (
                  <div className="py-12 text-center text-[13px] text-red-600" style={{ gridColumn: '1 / -1' }}>{fr ? 'Impossible de charger les champs.' : 'Could not load fields.'}</div>
                )}

                {!isLoading && !error && lignes.length === 0 && (
                  <div className="py-14" style={{ gridColumn: '1 / -1' }}>
                    <EmptyState icon={Layers} title={fr ? 'Aucun champ' : 'No fields'}
                      description={fr ? 'Crée ton premier champ : superficie, type de surface, nombre de fenêtres…' : 'Create your first field: area, surface type, number of windows…'}
                      action={<button type="button" onClick={() => setModaleChamp({ champ: null })} className="glass-button-primary inline-flex items-center gap-2"><Plus size={14} aria-hidden />{fr ? 'Créer un champ' : 'Create field'}</button>} />
                  </div>
                )}

                {!isLoading && !error && lignesPage.map((l) => {
                  const type = l.sorte === 'custom' ? l.champ.field_type : l.std.field_type;
                  const Icone = ICONE_TYPE[type];
                  const nom = l.sorte === 'custom' ? l.champ.label : (fr ? l.std.label.fr : l.std.label.en);
                  const variable = l.sorte === 'custom' ? variableAffichee(l.objet, l.champ.key) : `${l.objet}.${l.std.key}`;
                  const dossier = l.sorte === 'custom' ? dossiers.find((d) => d.id === l.champ.folder_id)?.name : null;
                  const cell = cn('flex items-center border-b border-outline/30 px-3 py-2.5 text-[13px] text-text-primary min-w-0', l.sorte === 'custom' && l.champ.archived_at && 'opacity-60');
                  const pastille = (texte: string) => <span className="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-outline-subtle px-1.5 py-0.5 text-[12px]"><FolderOpen size={11} aria-hidden className="shrink-0" /><span className="truncate">{texte}</span></span>;
                  const contenu: Record<ColonneOpt, React.ReactNode> = {
                    type: <><Icone size={13} aria-hidden className="shrink-0" /><span className="truncate">{fr ? LIBELLES_TYPE[type].fr : LIBELLES_TYPE[type].en}</span></>,
                    dossier: l.sorte === 'custom'
                      ? (dossier ? pastille(dossier) : <span className="text-text-tertiary">—</span>)
                      : pastille(fr ? `Infos ${LIBELLES_OBJET[l.objet].fr.toLowerCase()}` : `${LIBELLES_OBJET[l.objet].en} info`),
                    cle: <>
                      <code className="truncate font-mono text-[12px] text-text-secondary" title={l.sorte === 'standard' ? (fr ? 'Champ standard : pas une variable de courriel' : 'Standard field: not an email variable') : variable}>{variable}</code>
                      {l.sorte === 'custom' && (
                        <button type="button" aria-label={`${fr ? 'Copier' : 'Copy'} ${variable}`} onClick={() => copier(variable)}
                          className="shrink-0 rounded p-0.5 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><Copy size={12} aria-hidden /></button>
                      )}
                    </>,
                    source: <>{l.sorte === 'custom' ? (fr ? 'Personnalisé' : 'Custom') : 'Standard'}</>,
                    cree: <span className="whitespace-nowrap">{l.sorte === 'custom' ? fmtDate(l.champ.created_at) : '—'}</span>,
                  };
                  return (
                    <React.Fragment key={l.id}>
                      <div className={cn(cell, 'justify-center')}>
                        <input type="checkbox" checked={selection.has(l.id)} disabled={l.sorte === 'standard'} onChange={() => basculerSelection(l.id)}
                          aria-label={fr ? `Sélectionner ${nom}` : `Select ${nom}`} className="h-4 w-4 accent-primary disabled:opacity-40" />
                      </div>
                      <div className={cn(cell, 'gap-1.5')}>
                        {l.sorte === 'custom' && !l.champ.archived_at ? (
                          <button type="button" onClick={() => setModaleChamp({ champ: l.champ })}
                            className="truncate rounded text-left font-medium hover:text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{nom}</button>
                        ) : <span className="truncate font-medium">{nom}</span>}
                        {l.sorte === 'standard' && <Lock size={12} className="shrink-0 text-text-tertiary" aria-label={fr ? 'Champ standard, lecture seule' : 'Standard field, read-only'} />}
                        {l.sorte === 'custom' && l.champ.is_required && <span className="text-red-500" title={fr ? 'Obligatoire' : 'Required'}>*</span>}
                        {((l.sorte === 'custom' && l.champ.is_searchable) || (l.sorte === 'standard' && l.std.cherchable)) && <Search size={11} className="shrink-0 text-text-tertiary" aria-label={fr ? 'Cherchable' : 'Searchable'} />}
                        {l.sorte === 'custom' && l.champ.is_unique && <span className="rounded bg-surface-secondary px-1 text-[10px] text-text-tertiary">unique</span>}
                        {l.sorte === 'custom' && l.champ.archived_at && <span className="rounded bg-surface-secondary px-1 text-[10px] text-text-tertiary">{fr ? 'archivé' : 'archived'}</span>}
                      </div>
                      {visibles.map((c) => (
                        <div key={c} className={cn(cell, 'gap-1.5', c !== 'cle' && 'text-text-secondary', c === 'cree' && 'tabular-nums')}>{contenu[c]}</div>
                      ))}
                      <div className={cn(cell, 'relative justify-center')}>
                        {l.sorte === 'custom' && (
                          <>
                            <button type="button" aria-label={`${fr ? 'Actions pour' : 'Actions for'} ${nom}`} aria-haspopup="menu" aria-expanded={menu === l.id}
                              onClick={() => setMenu(menu === l.id ? null : l.id)}
                              className="rounded p-1 text-text-tertiary hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                              <MoreHorizontal size={15} aria-hidden />
                            </button>
                            {menu === l.id && (
                              <div role="menu" className="absolute right-2 top-full z-50 mt-1 w-56 rounded-md border border-outline bg-surface-elevated py-1 shadow-dropdown">
                                {!l.champ.archived_at && (
                                  <button role="menuitem" type="button" onClick={() => { setMenu(null); setModaleChamp({ champ: l.champ }); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-secondary">
                                    <Pencil size={13} aria-hidden />{fr ? 'Modifier' : 'Edit'}
                                  </button>
                                )}
                                {!l.champ.archived_at && (() => {
                                  const liste = voisins(l.champ);
                                  const i = liste.findIndex((x) => x.id === l.champ.id);
                                  return (
                                    <>
                                      <button role="menuitem" type="button" disabled={i <= 0} onClick={() => { void bouger(l.champ, -1); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-secondary disabled:opacity-40">
                                        <ArrowUp size={13} aria-hidden />{fr ? 'Monter' : 'Move up'}
                                      </button>
                                      <button role="menuitem" type="button" disabled={i < 0 || i >= liste.length - 1} onClick={() => { void bouger(l.champ, 1); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-secondary disabled:opacity-40">
                                        <ArrowDown size={13} aria-hidden />{fr ? 'Descendre' : 'Move down'}
                                      </button>
                                    </>
                                  );
                                })()}
                                {!l.champ.archived_at && (
                                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase text-text-tertiary">{fr ? 'Déplacer vers' : 'Move to'}</div>
                                )}
                                {!l.champ.archived_at && [{ id: null as string | null, name: fr ? 'Sans dossier' : 'No folder' }, ...dossiers.filter((d) => d.object_type === l.objet)]
                                  .filter((d) => d.id !== l.champ.folder_id).map((d) => (
                                    <button key={d.id ?? 'aucun'} role="menuitem" type="button" onClick={() => { void deplacer(l.champ, d.id); }} className="block w-full px-5 py-1.5 text-left text-[13px] hover:bg-surface-secondary">{d.name}</button>
                                  ))}
                                {l.champ.archived_at ? (
                                  <button role="menuitem" type="button" onClick={() => { void restaurer(l.champ); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-secondary">
                                    <RotateCcw size={13} aria-hidden />{fr ? 'Restaurer' : 'Restore'}
                                  </button>
                                ) : null}
                                <button role="menuitem" type="button" onClick={() => { setMenu(null); setASupprimer(l.champ); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-red-600 hover:bg-surface-secondary">
                                  <Trash2 size={13} aria-hidden />{l.champ.archived_at ? (fr ? 'Supprimer définitivement' : 'Delete permanently') : (fr ? 'Archiver ou supprimer' : 'Archive or delete')}
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            {/* ── Pagination (GHL : « Fields per page 20 · 1 - 20 of 35 · Previous 1 2 Next ») ── */}
            {!isLoading && !error && triees.length > 0 && (
              <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center justify-end gap-3 text-[12px] text-text-secondary">
                <label htmlFor={`${ids}-parpage`}>{fr ? 'Champs par page' : 'Fields per page'}</label>
                <select id={`${ids}-parpage`} value={parPage} onChange={(e) => changerParPage(Number(e.target.value))}
                  className="h-8 rounded-md border border-outline bg-surface-card px-2 text-[12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                  {PAR_PAGE.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="tabular-nums">
                  {pageCourante * parPage + 1} - {Math.min((pageCourante + 1) * parPage, triees.length)} {fr ? 'sur' : 'of'} {triees.length}
                </span>
                <div className="flex items-center gap-1">
                  <button type="button" disabled={pageCourante === 0} onClick={() => setPage(pageCourante - 1)}
                    className="h-8 rounded-md border border-outline px-2.5 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{fr ? 'Précédent' : 'Previous'}</button>
                  {Array.from({ length: nbPages }, (_, i) => i)
                    .filter((i) => nbPages <= 7 || i === 0 || i === nbPages - 1 || Math.abs(i - pageCourante) <= 1)
                    .map((i, k, arr) => (
                      <React.Fragment key={i}>
                        {k > 0 && i - arr[k - 1] > 1 && <span aria-hidden>…</span>}
                        <button type="button" aria-current={i === pageCourante ? 'page' : undefined} onClick={() => setPage(i)}
                          className={cn('h-8 min-w-8 rounded-md border px-2 tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                            i === pageCourante ? 'border-primary text-primary' : 'border-transparent hover:border-outline')}>{i + 1}</button>
                      </React.Fragment>
                    ))}
                  <button type="button" disabled={pageCourante >= nbPages - 1} onClick={() => setPage(pageCourante + 1)}
                    className="h-8 rounded-md border border-outline px-2.5 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{fr ? 'Suivant' : 'Next'}</button>
                </div>
              </nav>
            )}
          </>
        ) : (
          <VueDossiers dossiers={dossiers.filter((d) => onglet === 'tous' || d.object_type === onglet)} champs={data?.fields ?? []} fr={fr}
            onNouveauChamp={(d) => setModaleChamp({ champ: null, dossier: d })} onChange={recharger} />
        )}
      </div>

      {(onglet === 'deal' || onglet === 'tous') && data && (
        <CartesPipelineReglage champs={data.fields.filter((c) => c.object_type === 'deal' && !c.archived_at)} fr={fr} />
      )}

      {modaleChamp && (
        <ModaleChamp key={modaleChamp.champ?.id ?? `nouveau-${modaleChamp.dossier ?? ''}`} open onClose={() => setModaleChamp(null)}
          onEnregistre={() => { void recharger(); }} objet={modaleChamp.champ?.object_type
            ?? (modaleChamp.dossier ? dossiers.find((d) => d.id === modaleChamp.dossier)?.object_type ?? objetCourant : objetCourant)}
          dossiers={dossiers} champ={modaleChamp.champ} dossierInitial={modaleChamp.dossier} fr={fr}
          objetAChoisir={!modaleChamp.champ && !modaleChamp.dossier && onglet === 'tous'} />
      )}
      <ModaleDossier open={modaleDossier} onClose={() => setModaleDossier(false)} onCree={() => { void recharger(); }} objet={objetCourant} fr={fr} />
      <ModaleCherchables open={modaleCherchables} onClose={() => setModaleCherchables(false)} onEnregistre={() => { void recharger(); }}
        objet={objetCourant} champs={(data?.fields ?? []).filter((c) => c.object_type === objetCourant)} standard={data?.standard[objetCourant] ?? []} fr={fr} />
      <ModaleUniques open={modaleUniques} onClose={() => setModaleUniques(false)} onEnregistre={() => { void recharger(); }}
        champs={(data?.fields ?? []).filter((c) => onglet === 'tous' || c.object_type === onglet)} fr={fr} />
      <ModaleSuggestions open={modaleSuggestions} onClose={() => setModaleSuggestions(false)} onInstalle={() => { void recharger(); }}
        champsExistants={data?.fields ?? []} fr={fr} />
      <ModaleSuppression open={!!aSupprimer} onClose={() => setASupprimer(null)} onFait={() => { void recharger(); }} champ={aSupprimer} fr={fr} />
    </div>
  );
}

/** Vue « Dossiers » : renommer, supprimer (les champs passent « Sans dossier »), ajouter un champ dedans. */
function VueDossiers({ dossiers, champs, fr, onNouveauChamp, onChange }: {
  dossiers: { id: string; name: string; object_type: ObjetChamp }[]; champs: ChampPerso[]; fr: boolean;
  onNouveauChamp: (dossierId: string) => void; onChange: () => void;
}) {
  const [edition, setEdition] = useState<Record<string, string>>({});
  if (dossiers.length === 0) {
    return <EmptyState icon={FolderOpen} title={fr ? 'Aucun dossier' : 'No folders'} description={fr ? 'Un dossier regroupe plusieurs champs, comme un gabarit.' : 'A folder groups several fields, like a template.'} />;
  }
  const renommer = async (id: string) => {
    const nom = edition[id]?.trim();
    if (!nom) return;
    try {
      await renommerDossier(id, nom);
      setEdition((e) => { const { [id]: _x, ...r } = e; return r; });
      onChange();
    } catch (err) {
      console.error('[ChampsPerso] renommer dossier', err);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };
  const supprimer = async (id: string, nom: string, nb: number) => {
    const ok = await confirmer({
      title: fr ? `Supprimer « ${nom} » ?` : `Delete “${nom}”?`,
      message: fr ? `Aucun champ n’est supprimé : ${nb} champ(s) passeront « Sans dossier ».` : `No field is deleted: ${nb} field(s) will move to “No folder”.`,
      confirmLabel: fr ? 'Supprimer le dossier' : 'Delete folder', danger: true,
    });
    if (!ok) return;
    try {
      await supprimerDossier(id);
      onChange();
    } catch (err) {
      console.error('[ChampsPerso] supprimer dossier', err);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <ul className="divide-y divide-outline/40 rounded-md border border-outline">
      {dossiers.map((d) => {
        const nb = champs.filter((c) => c.folder_id === d.id).length;
        const enEdition = edition[d.id] !== undefined;
        return (
          <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
            <FolderOpen size={15} className="text-text-tertiary" aria-hidden />
            {enEdition ? (
              <input aria-label={fr ? 'Nom du dossier' : 'Folder name'} autoFocus value={edition[d.id]} maxLength={100}
                onChange={(e) => setEdition((x) => ({ ...x, [d.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') void renommer(d.id); if (e.key === 'Escape') setEdition((x) => { const { [d.id]: _y, ...r } = x; return r; }); }}
                onBlur={() => { void renommer(d.id); }} className="glass-input h-8 flex-1 text-[13px]" />
            ) : (
              <span className="flex-1 text-[13px] font-medium text-text-primary">{d.name}
                <span className="ml-2 text-[12px] font-normal text-text-tertiary">{fr ? LIBELLES_OBJET[d.object_type].fr : LIBELLES_OBJET[d.object_type].en} · {nb} {fr ? 'champ(s)' : 'field(s)'}</span>
              </span>
            )}
            <button type="button" onClick={() => onNouveauChamp(d.id)} className="text-[12px] font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded">
              {fr ? '+ Champ' : '+ Field'}
            </button>
            <button type="button" aria-label={fr ? `Renommer ${d.name}` : `Rename ${d.name}`} onClick={() => setEdition((x) => ({ ...x, [d.id]: d.name }))}
              className="rounded p-1 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><Pencil size={13} aria-hidden /></button>
            <button type="button" aria-label={fr ? `Supprimer ${d.name}` : `Delete ${d.name}`} onClick={() => { void supprimer(d.id, d.name, nb); }}
              className="rounded p-1 text-text-tertiary hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><Trash2 size={13} aria-hidden /></button>
          </li>
        );
      })}
    </ul>
  );
}
