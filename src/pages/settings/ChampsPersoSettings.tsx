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
  ChevronDown, Copy, FolderOpen, FolderPlus, Lock, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Trash2, Layers, Sparkles,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import { FilterPill } from '../../components/ui';
import EmptyState from '../../components/ui/EmptyState';
import DatePickerInput from '../../components/ui/DatePickerInput';
import { confirmer } from '../../components/ui/ConfirmDialog';
import { useModuleAccess } from '../../hooks/useModuleAccess';
import {
  archiverChamp, listerChamps, lireFuseau, renommerDossier, supprimerDossier, modifierChamp,
  type ChampPerso, type ObjetChamp,
} from '../../lib/champsPersoApi';
import { OBJETS, LIBELLES_OBJET, LIBELLES_TYPE, TYPES_CHAMP, variableModele, type TypeChamp } from '../../lib/champs/types';
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

/** Une ligne de la table : un champ personnalisé OU un champ standard. */
type Ligne =
  | { sorte: 'custom'; id: string; objet: ObjetChamp; champ: ChampPerso }
  | { sorte: 'standard'; id: string; objet: ObjetChamp; std: ChampStandard };

export default function ChampsPersoSettings() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const ids = useId();
  const qc = useQueryClient();
  const { isEnabled, loading: chargeDrapeau, indetermine } = useModuleAccess('custom_fields_v2');

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
  const [grouper, setGrouper] = useState(true);
  const [replies, setReplies] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<string | null>(null);
  const [menuGlobal, setMenuGlobal] = useState(false);

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
    const fermer = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) { setMenu(null); setMenuGlobal(false); } };
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

  const compte = (o: Onglet) => toutesLignes.filter((l) => l.sorte === 'custom' && (o === 'tous' || l.objet === o)).length;

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
  const groupes = useMemo(() => {
    if (!grouper) return [{ id: '__tous', nom: '', lignes }];
    const res: { id: string; nom: string; lignes: Ligne[] }[] = [];
    for (const d of dossiers) {
      const ls = lignes.filter((l) => l.sorte === 'custom' && l.champ.folder_id === d.id);
      if (ls.length) res.push({ id: d.id, nom: `${d.name} · ${fr ? LIBELLES_OBJET[d.object_type].fr : LIBELLES_OBJET[d.object_type].en}`, lignes: ls });
    }
    const sans = lignes.filter((l) => l.sorte === 'custom' && !l.champ.folder_id);
    if (sans.length) res.push({ id: '__sans', nom: fr ? 'Sans dossier' : 'No folder', lignes: sans });
    const std = lignes.filter((l) => l.sorte === 'standard');
    if (std.length) res.push({ id: '__std', nom: fr ? 'Champs standard' : 'Standard fields', lignes: std });
    return res;
  }, [grouper, lignes, dossiers, fr]);

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

  // État inconnu (bureau pas encore choisi, réseau) : on attend, on n'affirme pas « pas activée ».
  if (chargeDrapeau || indetermine) return null;
  if (!isEnabled) {
    return (
      <div className="max-w-2xl">
        <EmptyState icon={Layers} title={fr ? 'Champs personnalisés' : 'Custom fields'}
          description={fr ? 'Cette fonctionnalité n’est pas encore activée pour votre entreprise.' : 'This feature is not enabled for your company yet.'} />
      </div>
    );
  }

  const fmtDate = (iso: string) => new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: fuseau }).format(new Date(iso));
  const colonnes = '1.6fr 1fr 1fr 1.4fr 0.8fr 1fr 48px';

  return (
    <div className="space-y-4" ref={menuRef}>
      {/* ── En-tête ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-text-primary">{fr ? 'Champs personnalisés' : 'Custom fields'}</h2>
          <p className="mt-0.5 text-[12px] text-text-tertiary">
            {fr ? 'Crée et gère les champs de tes objets pour capter et organiser tes données.' : 'Create and manage custom fields for your objects to capture and organize data.'}
          </p>
        </div>
        <div className="relative flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setModaleSuggestions(true)} className="glass-button inline-flex items-center gap-2 whitespace-nowrap">
            <Sparkles size={14} aria-hidden /> {fr ? 'Champs suggérés' : 'Suggested fields'}
          </button>
          <button type="button" onClick={() => setModaleDossier(true)} className="glass-button inline-flex items-center gap-2 whitespace-nowrap">
            <FolderPlus size={14} aria-hidden /> {fr ? 'Nouveau dossier' : 'Create folder'}
          </button>
          <button type="button" onClick={() => setModaleChamp({ champ: null })} className="glass-button-primary inline-flex items-center gap-2 whitespace-nowrap">
            <Plus size={14} aria-hidden /> {fr ? 'Nouveau champ' : 'Create field'}
          </button>
          <button type="button" aria-label={fr ? 'Plus d’options' : 'More options'} aria-haspopup="menu" aria-expanded={menuGlobal}
            onClick={() => setMenuGlobal((v) => !v)}
            className="rounded-md border border-outline p-2 text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <MoreHorizontal size={16} aria-hidden />
          </button>
          {menuGlobal && (
            <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-60 rounded-md border border-outline bg-surface-elevated py-1 shadow-dropdown">
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

      {/* ── Objets ── */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={fr ? 'Objet' : 'Object'}>
        {(['tous', ...OBJETS] as Onglet[]).map((o) => (
          <button key={o} role="tab" type="button" aria-selected={onglet === o} onClick={() => setOnglet(o)}
            className={cn('inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              onglet === o ? 'border-primary/40 bg-primary/5 text-text-primary' : 'border-outline-subtle bg-surface-card text-text-secondary hover:text-text-primary')}>
            {o === 'tous' ? (fr ? 'Tous' : 'All') : (fr ? LIBELLES_OBJET[o].fr : LIBELLES_OBJET[o].en)}
            <span className="rounded-full bg-surface-secondary px-1.5 text-[11px] tabular-nums text-text-tertiary">{compte(o)}</span>
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-outline bg-surface-card p-3">
        {/* ── Vue ── */}
        <div className="mb-3 inline-flex rounded-lg bg-surface-secondary/80 p-1" role="tablist" aria-label={fr ? 'Vue' : 'View'}>
          {(['champs', 'dossiers'] as const).map((v) => (
            <button key={v} role="tab" type="button" aria-selected={vue === v} onClick={() => setVue(v)}
              className={cn('rounded-md px-3 py-1 text-[13px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                vue === v ? 'bg-surface-card text-text-primary shadow-sm' : 'text-text-tertiary')}>
              {v === 'champs' ? (fr ? 'Champs' : 'Fields') : (fr ? 'Dossiers' : 'Folders')}
              <span className="ml-1.5 text-[11px] text-text-tertiary">
                {v === 'champs' ? lignes.filter((l) => l.sorte === 'custom').length : dossiers.filter((d) => onglet === 'tous' || d.object_type === onglet).length}
              </span>
            </button>
          ))}
        </div>

        {vue === 'champs' ? (
          <>
            {/* ── Filtres ── */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <FilterPill label={fr ? 'Type' : 'Field type'} value={filtreType} onChange={(v) => setFiltreType(v as 'all' | TypeChamp)}
                options={[{ value: 'all', label: fr ? 'Tous' : 'All' }, ...TYPES_CHAMP.map((t) => ({ value: t, label: fr ? LIBELLES_TYPE[t].fr : LIBELLES_TYPE[t].en }))]} />
              <FilterPill label={fr ? 'Source' : 'Source'} value={source} onChange={(v) => setSource(v as Source)}
                options={[{ value: 'all', label: fr ? 'Toutes' : 'All' }, { value: 'standard', label: 'Standard' }, { value: 'custom', label: fr ? 'Personnalisé' : 'Custom' }]} />
              <FilterPill label={fr ? 'Créé' : 'Created'} value={creeOp} onChange={(v) => setCreeOp(v as 'all' | Operateur)}
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
              <label htmlFor={`${ids}-grouper`} className="ml-1 flex items-center gap-1.5 text-[12px] text-text-secondary">
                <input id={`${ids}-grouper`} type="checkbox" checked={grouper} onChange={(e) => setGrouper(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
                {fr ? 'Grouper par dossier' : 'Group by folder'}
              </label>
              <div className="relative ml-auto">
                <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
                <input value={recherche} onChange={(e) => setRecherche(e.target.value)} aria-label={fr ? 'Chercher un champ' : 'Search fields'}
                  placeholder={fr ? 'Chercher un champ' : 'Search fields'}
                  className="h-9 w-[220px] rounded-md border border-outline bg-surface-card pl-8 pr-3 text-[14px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
              </div>
            </div>

            {/* ── Table ── */}
            <div className="overflow-x-auto rounded-md border border-outline">
              <div className="grid min-w-[860px]" style={{ gridTemplateColumns: colonnes }}>
                {[fr ? 'Nom du champ' : 'Field name', fr ? 'Type' : 'Field type', fr ? 'Dossier' : 'Folder', fr ? 'Variable' : 'Key', 'Source', fr ? 'Créé le' : 'Created', ''].map((h, i) => (
                  <div key={i} className="border-b border-outline px-3 py-2.5 text-[13px] font-medium text-text-primary">{h}</div>
                ))}

                {isLoading && Array.from({ length: 6 }).map((_, i) => (
                  <React.Fragment key={`sk-${i}`}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <div key={j} className="border-b border-outline/30 px-3 py-3"><div className="h-4 w-20 animate-pulse rounded bg-surface-tertiary" /></div>
                    ))}
                  </React.Fragment>
                ))}

                {!isLoading && error && (
                  <div className="col-span-7 py-12 text-center text-[13px] text-red-600">{fr ? 'Impossible de charger les champs.' : 'Could not load fields.'}</div>
                )}

                {!isLoading && !error && lignes.length === 0 && (
                  <div className="col-span-7 py-14">
                    <EmptyState icon={Layers} title={fr ? 'Aucun champ' : 'No fields'}
                      description={fr ? 'Crée ton premier champ : superficie, type de surface, nombre de fenêtres…' : 'Create your first field: area, surface type, number of windows…'}
                      action={<button type="button" onClick={() => setModaleChamp({ champ: null })} className="glass-button-primary inline-flex items-center gap-2"><Plus size={14} aria-hidden />{fr ? 'Nouveau champ' : 'Create field'}</button>} />
                  </div>
                )}

                {!isLoading && !error && groupes.map((g) => {
                  const replie = !!replies[g.id];
                  return (
                    <React.Fragment key={g.id}>
                      {grouper && (
                        <button type="button" aria-expanded={!replie} onClick={() => setReplies((r) => ({ ...r, [g.id]: !replie }))}
                          className="col-span-7 flex items-center gap-2 border-b border-outline/40 bg-surface-secondary/50 px-3 py-1.5 text-left text-[12px] font-semibold text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                          <ChevronDown size={13} aria-hidden className={cn('transition-transform', replie && '-rotate-90')} />
                          <FolderOpen size={13} aria-hidden /> {g.nom} <span className="font-normal text-text-tertiary">({g.lignes.length})</span>
                        </button>
                      )}
                      {!replie && g.lignes.map((l) => {
                        const type = l.sorte === 'custom' ? l.champ.field_type : l.std.field_type;
                        const Icone = ICONE_TYPE[type];
                        const nom = l.sorte === 'custom' ? l.champ.label : (fr ? l.std.label.fr : l.std.label.en);
                        const variable = l.sorte === 'custom' ? `{${variableModele(l.objet, l.champ.key)}}` : `${l.objet}.${l.std.key}`;
                        const dossier = l.sorte === 'custom' ? dossiers.find((d) => d.id === l.champ.folder_id)?.name : null;
                        const cell = cn('flex items-center border-b border-outline/30 px-3 py-2.5 text-[13px] text-text-primary min-w-0', l.sorte === 'custom' && l.champ.archived_at && 'opacity-60');
                        return (
                          <React.Fragment key={l.id}>
                            <div className={cn(cell, 'gap-1.5')}>
                              <span className="truncate font-medium">{nom}</span>
                              {l.sorte === 'standard' && <Lock size={12} className="shrink-0 text-text-tertiary" aria-label={fr ? 'Champ standard, lecture seule' : 'Standard field, read-only'} />}
                              {l.sorte === 'custom' && l.champ.is_required && <span className="text-red-500" title={fr ? 'Obligatoire' : 'Required'}>*</span>}
                              {l.sorte === 'custom' && l.champ.is_searchable && <Search size={11} className="shrink-0 text-text-tertiary" aria-label={fr ? 'Cherchable' : 'Searchable'} />}
                              {l.sorte === 'custom' && l.champ.is_unique && <span className="rounded bg-surface-secondary px-1 text-[10px] text-text-tertiary">{fr ? 'unique' : 'unique'}</span>}
                              {l.sorte === 'custom' && l.champ.archived_at && <span className="rounded bg-surface-secondary px-1 text-[10px] text-text-tertiary">{fr ? 'archivé' : 'archived'}</span>}
                            </div>
                            <div className={cn(cell, 'gap-1.5 text-text-secondary')}><Icone size={13} aria-hidden />{fr ? LIBELLES_TYPE[type].fr : LIBELLES_TYPE[type].en}</div>
                            <div className={cn(cell, 'text-text-secondary')}>
                              {l.sorte === 'custom'
                                ? (dossier ? <span className="inline-flex items-center gap-1 rounded-md border border-outline-subtle px-1.5 py-0.5 text-[12px]"><FolderOpen size={11} aria-hidden />{dossier}</span> : <span className="text-text-tertiary">—</span>)
                                : <span className="text-[12px] text-text-tertiary">{fr ? LIBELLES_OBJET[l.objet].fr : LIBELLES_OBJET[l.objet].en}</span>}
                            </div>
                            <div className={cn(cell, 'gap-1')}>
                              <code className="truncate font-mono text-[12px] text-text-secondary">{variable}</code>
                              {l.sorte === 'custom' && (
                                <button type="button" aria-label={`${fr ? 'Copier' : 'Copy'} ${variable}`} onClick={() => copier(variable)}
                                  className="shrink-0 rounded p-0.5 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><Copy size={12} aria-hidden /></button>
                              )}
                            </div>
                            <div className={cn(cell, 'text-text-secondary')}>{l.sorte === 'custom' ? (fr ? 'Personnalisé' : 'Custom') : 'Standard'}</div>
                            <div className={cn(cell, 'tabular-nums text-text-secondary')}>{l.sorte === 'custom' ? fmtDate(l.champ.created_at) : '—'}</div>
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
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
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
          dossiers={dossiers} champ={modaleChamp.champ} dossierInitial={modaleChamp.dossier} fr={fr} />
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
