/**
 * Page détail d'un pipeline — calquée sur GoHighLevel (capture 2 de la
 * mission du 2026-09-25).
 *
 * SAUVEGARDE AUTOMATIQUE : chaque changement part tout de suite (au clic, ou
 * à la sortie d'un champ texte — jamais à chaque touche), avec un retour
 * discret « Enregistré ». Pas de bouton Enregistrer.
 *
 * Ce que GHL n'a pas et que Lume garde (chevron ▾ d'une étape) : le nom
 * anglais, le conseil au vendeur et le lien vers les automatisations de
 * l'étape. Les étapes supprimées restent restaurables en bas de page.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft, ArrowUpRight, Check, GripVertical, Loader2, Lock, MoreVertical, Pencil, Percent, Plus, Search,
  Settings2, Type,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ajouterEtape, definirAffichagePipeline, desarchiverEtape, fetchDeals, fetchStages, renommerEtape,
  renommerPipeline, reordonnerEtapes, type PipelineResume, type PipelineStage,
} from '../../../lib/pipelineVentesApi';
import { CarteCouleurs, CarteProbabilite, IconesRapports, lireProbabilite, usePlacementMenu } from './ReglagesCommuns';
import { SupprimerEtapeModal } from './ActionsPipeline';

type Etat = 'repos' | 'enregistrement' | 'enregistre';

/** Un enregistrement automatique, avec son retour discret. */
function useSauvegarde(fr: boolean) {
  const [etat, setEtat] = useState<Etat>('repos');
  const minuteur = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  async function sauver(action: () => Promise<void>): Promise<boolean> {
    setEtat('enregistrement');
    try {
      await action();
      setEtat('enregistre');
      clearTimeout(minuteur.current);
      minuteur.current = setTimeout(() => setEtat('repos'), 2000);
      return true;
    } catch (e) {
      setEtat('repos');
      console.error('[pipelines] enregistrement automatique', e);
      toast.error(e instanceof Error ? e.message : String(e));
      return false;
    }
  }
  useEffect(() => () => clearTimeout(minuteur.current), []);
  const indicateur = (
    <span aria-live="polite" className="inline-flex items-center gap-1 text-[12px] text-text-muted">
      {etat === 'enregistrement' && <><Loader2 size={12} className="animate-spin" aria-hidden="true" />{fr ? 'Enregistrement…' : 'Saving…'}</>}
      {etat === 'enregistre' && <><Check size={12} aria-hidden="true" />{fr ? 'Enregistré' : 'Saved'}</>}
    </span>
  );
  return { sauver, indicateur };
}

/** Un champ texte qui s'enregistre à la sortie (blur) ou sur Entrée. */
function ChampAuto({ id, valeur, onSauver, className, placeholder, inputMode, ariaLabel, disabled }: {
  id: string;
  disabled?: boolean;
  valeur: string;
  onSauver: (v: string) => Promise<boolean>;
  className?: string;
  placeholder?: string;
  inputMode?: 'decimal' | 'text';
  ariaLabel?: string;
}) {
  const [v, setV] = useState(valeur);
  useEffect(() => { setV(valeur); }, [valeur]);
  const valider = async () => {
    if (v === valeur) return;
    const ok = await onSauver(v);
    if (!ok) setV(valeur);
  };
  return (
    <input
      id={id}
      type="text"
      value={v}
      inputMode={inputMode}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      title={disabled ? 'Gagné = 100 %, Perdu = 0 %' : undefined}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => void valider()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setV(valeur); (e.target as HTMLInputElement).blur(); }
      }}
      className={className}
    />
  );
}

function MenuEtape({ fr, nom, verrouillee, onRenommer, onSupprimer }: {
  fr: boolean; nom: string; verrouillee: boolean; onRenommer: () => void; onSupprimer: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  const declencheur = useRef<HTMLButtonElement>(null);
  const placement = usePlacementMenu(ouvert, declencheur, () => setOuvert(false));
  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: MouseEvent) => { if (!racine.current?.contains(e.target as Node)) setOuvert(false); };
    document.addEventListener('mousedown', fermer);
    return () => document.removeEventListener('mousedown', fermer);
  }, [ouvert]);
  return (
    <div ref={racine} className="relative inline-flex items-center gap-1">
      {verrouillee && (
        <span title={fr ? 'Étape système : ne peut pas être supprimée' : 'System stage: cannot be deleted'} className="text-text-muted">
          <Lock size={13} aria-label={fr ? 'Verrouillée' : 'Locked'} />
        </span>
      )}
      <button
        ref={declencheur}
        type="button"
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-label={fr ? `Actions pour l’étape ${nom}` : `Actions for stage ${nom}`}
        onClick={() => setOuvert((o) => !o)}
        className="rounded-md p-1.5 text-text-tertiary hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
      >
        <MoreVertical size={15} aria-hidden="true" />
      </button>
      {ouvert && (
        <div role="menu" style={placement} className="z-50 w-40 rounded-lg border border-outline bg-surface-card py-1 shadow-lg">
          <button type="button" role="menuitem" onClick={() => { setOuvert(false); onRenommer(); }} className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-surface-secondary focus-visible:outline-none focus-visible:bg-surface-secondary">
            {fr ? 'Renommer' : 'Rename'}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={verrouillee}
            title={verrouillee ? (fr ? 'Gagné et Perdu sont verrouillées' : 'Won and Lost are locked') : undefined}
            onClick={() => { setOuvert(false); onSupprimer(); }}
            className="block w-full px-3 py-1.5 text-left text-[13px] text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:bg-red-50 dark:hover:bg-red-500/10"
          >
            {fr ? 'Supprimer' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  );
}

function LigneEtape({ e, fr, nbDeals, glissable, sauver, onSupprimer }: {
  e: PipelineStage;
  fr: boolean;
  nbDeals: number;
  glissable: boolean;
  sauver: (a: () => Promise<void>) => Promise<boolean>;
  onSupprimer: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: e.id, disabled: !glissable });
  const [deplie, setDeplie] = useState(false);
  const refNom = useRef<HTMLInputElement | null>(null);
  const verrouillee = e.kind !== 'open';
  const nom = fr ? e.name_fr : e.name_en;
  const ids = { nom: `etape-${e.id}-nom`, proba: `etape-${e.id}-proba`, en: `etape-${e.id}-en`, cfr: `etape-${e.id}-cfr`, cen: `etape-${e.id}-cen` };
  const maj = (champs: Parameters<typeof renommerEtape>[1]) => sauver(() => renommerEtape(e.id, champs));

  return (
    <>
      <tr
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={`border-b border-border-subtle ${isDragging ? 'relative z-10 bg-surface-card opacity-80 shadow' : 'odd:bg-surface-secondary/30'}`}
      >
        <td className="w-8 px-2 py-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            disabled={!glissable}
            aria-label={fr ? `Déplacer « ${nom} »` : `Move “${nom}”`}
            className="cursor-grab touch-none rounded text-text-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
          >
            <GripVertical size={15} aria-hidden="true" />
          </button>
        </td>
        <td className="px-3 py-2">
          <label htmlFor={ids.nom} className="sr-only">{fr ? 'Nom de l’étape' : 'Stage name'}</label>
          <div className="flex flex-col gap-0.5 lg:flex-row lg:items-center lg:gap-2">
            <ChampAuto
              id={ids.nom}
              valeur={fr ? e.name_fr : e.name_en}
              onSauver={(v) => (v.trim() === ''
                ? Promise.resolve(false)
                : maj(fr ? { name_fr: v.trim() } : { name_en: v.trim() }))}
              className="w-full min-w-[96px] max-w-[320px] rounded border border-transparent bg-transparent px-1.5 py-1 text-[13px] text-text-primary hover:border-outline focus-visible:border-outline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
            />
            {nbDeals > 0 && <span className="shrink-0 px-1.5 text-[11px] text-text-muted lg:px-0">{nbDeals} {fr ? 'deal(s)' : 'deal(s)'}</span>}
          </div>
        </td>
        <td className="w-[96px] px-2 py-2 lg:w-[130px]">
          <div className="flex items-center gap-1">
            <ChampAuto
              id={ids.proba}
              ariaLabel={fr ? `Probabilité de « ${nom} » (%)` : `Probability of “${nom}” (%)`}
              valeur={e.probability == null ? '' : String(Number(e.probability))}
              inputMode="decimal"
              placeholder="—"
              disabled={verrouillee}
              onSauver={async (v) => {
                if (verrouillee) return false;
                const p = lireProbabilite(v);
                if (p !== null && (Number.isNaN(p) || p < 0 || p > 100)) {
                  toast.error(fr ? 'La probabilité doit être comprise entre 0 et 100.' : 'Probability must be between 0 and 100.');
                  return false;
                }
                return maj({ probability: p });
              }}
              className="input-field w-16 text-[12.5px] tabular-nums disabled:opacity-60 lg:w-20"
            />
            <span aria-hidden="true" className="text-[12px] text-text-tertiary">%</span>
          </div>
        </td>
        <td className="w-[118px] px-2 py-2 lg:w-[150px]">
          <IconesRapports
            fr={fr}
            nomEtape={nom}
            entonnoir={e.show_in_reports}
            camembert={e.show_in_pie}
            onEntonnoir={(v) => void maj({ show_in_reports: v })}
            onCamembert={(v) => void maj({ show_in_pie: v })}
            deplie={deplie}
            onDeplier={() => setDeplie((d) => !d)}
          />
        </td>
        <td className="sticky right-0 w-16 bg-surface-card px-2 py-2 text-right shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.12)]">
          <MenuEtape
            fr={fr}
            nom={nom}
            verrouillee={verrouillee}
            onRenommer={() => { refNom.current = document.getElementById(ids.nom) as HTMLInputElement | null; refNom.current?.focus(); refNom.current?.select(); }}
            onSupprimer={onSupprimer}
          />
        </td>
      </tr>
      {deplie && (
        <tr className="border-b border-border-subtle bg-surface-secondary/40">
          <td />
          <td colSpan={4} className="px-3 py-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label htmlFor={ids.en} className="mb-1 block text-[11.5px] text-text-tertiary">
                  {fr ? 'Nom en anglais' : 'Name in French'}
                </label>
                <ChampAuto
                  id={ids.en}
                  valeur={fr ? e.name_en : e.name_fr}
                  onSauver={(v) => (v.trim() === '' ? Promise.resolve(false) : maj(fr ? { name_en: v.trim() } : { name_fr: v.trim() }))}
                  className="input-field w-full text-[12.5px]"
                />
              </div>
              <div>
                <label htmlFor={ids.cfr} className="mb-1 block text-[11.5px] text-text-tertiary">
                  {fr ? 'Conseil au vendeur (français)' : 'Rep guidance (French)'}
                </label>
                <ChampAuto id={ids.cfr} valeur={e.guidance_fr} onSauver={(v) => maj({ guidance_fr: v })} className="input-field w-full text-[12.5px]" />
              </div>
              <div>
                <label htmlFor={ids.cen} className="mb-1 block text-[11.5px] text-text-tertiary">
                  {fr ? 'Conseil au vendeur (anglais)' : 'Rep guidance (English)'}
                </label>
                <ChampAuto id={ids.cen} valeur={e.guidance_en} onSauver={(v) => maj({ guidance_en: v })} className="input-field w-full text-[12.5px]" />
              </div>
            </div>
            <Link
              to="/automations"
              className="mt-2 inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
            >
              {fr ? 'Ouvrir les automatisations' : 'Open automations'}
              <ArrowUpRight size={12} aria-hidden="true" />
            </Link>
          </td>
        </tr>
      )}
    </>
  );
}

export default function PipelineDetail({ fr, pipeline, onRetour, onChangement }: {
  fr: boolean;
  pipeline: PipelineResume;
  onRetour: () => void;
  onChangement: () => void;
}) {
  const qc = useQueryClient();
  const idRecherche = useId();
  const idNom = useId();
  const idNouvelle = useId();
  const { sauver, indicateur } = useSauvegarde(fr);
  const [onglet, setOnglet] = useState<'etapes' | 'tags'>('etapes');
  const [renommage, setRenommage] = useState(false);
  const [nom, setNom] = useState(pipeline.name);
  const [recherche, setRecherche] = useState('');
  const [ajout, setAjout] = useState(false);
  const [nouvelle, setNouvelle] = useState('');
  const [aSupprimer, setASupprimer] = useState<PipelineStage | null>(null);
  const [voirArchivees, setVoirArchivees] = useState(false);
  useEffect(() => { setNom(pipeline.name); }, [pipeline.name]);

  const cleEtapes = ['pipeline-stages', pipeline.id];
  const etapesQ = useQuery({ queryKey: cleEtapes, queryFn: () => fetchStages(pipeline.id) });
  const dealsQ = useQuery({ queryKey: ['pipeline-deals', pipeline.id], queryFn: () => fetchDeals(pipeline.id) });
  const toutes = useMemo(() => etapesQ.data ?? [], [etapesQ.data]);
  const actives = useMemo(() => toutes.filter((e) => e.archived_at === null).sort((a, b) => a.position - b.position), [toutes]);
  const archivees = toutes.filter((e) => e.archived_at !== null);
  const [ordre, setOrdre] = useState<PipelineStage[]>([]);
  useEffect(() => { setOrdre(actives); }, [actives]);
  const parEtape = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of dealsQ.data ?? []) m[d.stage_id] = (m[d.stage_id] ?? 0) + 1;
    return m;
  }, [dealsQ.data]);

  const t = recherche.trim().toLowerCase();
  const visibles = t ? ordre.filter((e) => `${e.name_fr} ${e.name_en}`.toLowerCase().includes(t)) : ordre;

  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: cleEtapes });
    onChangement();
  };
  const sauverEtRafraichir = async (a: () => Promise<void>) => {
    const ok = await sauver(a);
    if (ok) rafraichir();
    return ok;
  };

  const capteurs = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function glisser(ev: DragEndEvent) {
    if (!ev.over || ev.active.id === ev.over.id) return;
    const de = ordre.findIndex((x) => x.id === ev.active.id);
    const vers = ordre.findIndex((x) => x.id === ev.over?.id);
    const nouvel = arrayMove(ordre, de, vers);
    const avant = ordre;
    setOrdre(nouvel);
    void sauverEtRafraichir(() => reordonnerEtapes(nouvel.map((x, i) => ({ id: x.id, position: i + 1 }))))
      .then((ok) => { if (!ok) setOrdre(avant); });
  }

  async function ajouterUneEtape() {
    const n = nouvelle.trim();
    if (!n) return;
    const ok = await sauverEtRafraichir(async () => {
      // Posée après tout, puis glissée AVANT Gagné/Perdu : c'est là qu'on
      // la veut neuf fois sur dix.
      const derniere = Math.max(0, ...toutes.map((x) => x.position));
      const creee = await ajouterEtape(pipeline.id, { name_fr: n, name_en: n, position: derniere + 1 });
      const fin = actives.findIndex((x) => x.kind !== 'open');
      const liste = fin < 0 ? [...actives, creee] : [...actives.slice(0, fin), creee, ...actives.slice(fin)];
      await reordonnerEtapes(liste.map((x, i) => ({ id: x.id, position: i + 1 })));
    });
    if (ok) { setNouvelle(''); setAjout(false); }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onRetour}
          aria-label={fr ? 'Retour à la liste des pipelines' : 'Back to pipelines'}
          className="rounded-md p-1.5 text-text-secondary hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
        >
          <ArrowLeft size={17} aria-hidden="true" />
        </button>
        {renommage ? (
          <>
            <label htmlFor={idNom} className="sr-only">{fr ? 'Nom du pipeline' : 'Pipeline name'}</label>
            <input
              id={idNom}
              type="text"
              autoFocus
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setNom(pipeline.name); setRenommage(false); }
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              onBlur={() => {
                setRenommage(false);
                if (nom.trim() === '' || nom.trim() === pipeline.name) { setNom(pipeline.name); return; }
                void sauverEtRafraichir(() => renommerPipeline(pipeline.id, nom)).then((ok) => { if (!ok) setNom(pipeline.name); });
              }}
              className="input-field min-w-[240px] text-[16px] font-semibold"
            />
          </>
        ) : (
          <>
            <h2 className="text-[17px] font-semibold text-primary">{nom}</h2>
            <button
              type="button"
              onClick={() => setRenommage(true)}
              aria-label={fr ? 'Renommer le pipeline' : 'Rename pipeline'}
              className="rounded-md p-1.5 text-text-secondary hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
            >
              <Pencil size={14} aria-hidden="true" />
            </button>
          </>
        )}
        <span className="ml-auto">{indicateur}</span>
      </div>

      <div role="tablist" aria-label={fr ? 'Sections du pipeline' : 'Pipeline sections'} className="flex gap-4 border-b border-outline">
        {([['etapes', fr ? 'Étapes' : 'Stages'], ['tags', 'Smart tags']] as const).map(([cle, libelle]) => (
          <button
            key={cle}
            type="button"
            role="tab"
            aria-selected={onglet === cle}
            onClick={() => setOnglet(cle)}
            className={`-mb-px border-b-2 px-1 pb-1.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary ${onglet === cle ? 'border-primary font-medium text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
          >
            {libelle}
          </button>
        ))}
      </div>

      {onglet === 'tags' ? (
        <div className="rounded-xl border border-dashed border-outline bg-surface-card px-6 py-12 text-center">
          <p className="text-[14px] font-semibold text-text-primary">Smart tags</p>
          <p className="mt-1 text-[12.5px] text-text-tertiary">
            {fr ? 'Bientôt : des étiquettes posées automatiquement sur les deals selon des règles.' : 'Coming soon: tags applied automatically to deals by rules.'}
          </p>
        </div>
      ) : (
        <>
          <CarteProbabilite
            fr={fr}
            actif={!!pipeline.use_deal_probability}
            onChange={(v) => void sauverEtRafraichir(() => definirAffichagePipeline(pipeline.id, { use_deal_probability: v }))}
          />
          <CarteCouleurs
            fr={fr}
            valeur={pipeline.color_mode ?? 'none'}
            onChange={(v) => void sauverEtRafraichir(() => definirAffichagePipeline(pipeline.id, { color_mode: v }))}
          />

          <div className="rounded-xl border border-outline bg-surface-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle p-3">
              <div className="relative w-full max-w-[220px]">
                <label htmlFor={idRecherche} className="sr-only">{fr ? 'Rechercher une étape' : 'Search stages'}</label>
                <Search size={13} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  id={idRecherche}
                  type="search"
                  value={recherche}
                  onChange={(e) => setRecherche(e.target.value)}
                  placeholder={fr ? 'Rechercher' : 'Search'}
                  className="input-field w-full pl-7 text-[12.5px]"
                />
              </div>
              <button type="button" onClick={() => setAjout(true)} className="btn-primary inline-flex items-center gap-1.5 text-[13px] px-3 py-1.5">
                <Plus size={14} aria-hidden="true" />
                {fr ? 'Ajouter une étape' : 'Add stage'}
              </button>
            </div>

            {ajout && (
              <form
                className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-surface-secondary/40 p-3"
                onSubmit={(e) => { e.preventDefault(); void ajouterUneEtape(); }}
              >
                <label htmlFor={idNouvelle} className="text-[12px] text-text-tertiary">{fr ? 'Nom de la nouvelle étape' : 'New stage name'}</label>
                <input
                  id={idNouvelle}
                  type="text"
                  autoFocus
                  value={nouvelle}
                  onChange={(e) => setNouvelle(e.target.value)}
                  placeholder={fr ? 'Ex. : Visite planifiée' : 'e.g. Site visit booked'}
                  className="input-field min-w-[220px] text-[12.5px]"
                />
                <button type="submit" className="btn-primary text-[12.5px] px-3 py-1.5">{fr ? 'Ajouter' : 'Add'}</button>
                <button type="button" onClick={() => { setAjout(false); setNouvelle(''); }} className="btn-secondary text-[12.5px] px-3 py-1.5">
                  {fr ? 'Annuler' : 'Cancel'}
                </button>
              </form>
            )}

            <div className="overflow-x-auto">
              <DndContext sensors={capteurs} collisionDetection={closestCenter} onDragEnd={glisser}>
                <table className="w-full text-[13px]">
                  <thead className="bg-surface-secondary/60 text-left text-[12.5px] text-text-secondary">
                    <tr>
                      <th scope="col" className="w-8 px-2 py-2"><span className="sr-only">{fr ? 'Ordre' : 'Order'}</span></th>
                      <th scope="col" className="px-3 py-2 font-semibold"><span className="inline-flex items-center gap-1.5"><Type size={13} aria-hidden="true" />{fr ? 'Nom d’étape' : 'Stage name'}</span></th>
                      <th scope="col" className="px-3 py-2 font-semibold"><span className="inline-flex items-center gap-1.5"><Percent size={13} aria-hidden="true" />{fr ? 'Probabilité (%)' : 'Probability (%)'}</span></th>
                      <th scope="col" className="px-3 py-2 font-semibold"><span className="inline-flex items-center gap-1.5"><Settings2 size={13} aria-hidden="true" />{fr ? 'Afficher dans les rapports' : 'Show in reports'}</span></th>
                      <th scope="col" className="sticky right-0 bg-surface-secondary px-3 py-2 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <SortableContext items={visibles.map((x) => x.id)} strategy={verticalListSortingStrategy}>
                    <tbody>
                      {etapesQ.isLoading && (
                        <tr><td colSpan={5} className="px-3 py-10 text-center text-text-muted">{fr ? 'Chargement des étapes…' : 'Loading stages…'}</td></tr>
                      )}
                      {etapesQ.isError && (
                        <tr><td colSpan={5} className="px-3 py-10 text-center text-red-600">{fr ? 'Impossible de charger les étapes.' : 'Could not load stages.'}</td></tr>
                      )}
                      {!etapesQ.isLoading && visibles.length === 0 && !etapesQ.isError && (
                        <tr><td colSpan={5} className="px-3 py-10 text-center text-text-muted">{fr ? 'Aucune étape ne correspond.' : 'No stage matches.'}</td></tr>
                      )}
                      {visibles.map((e) => (
                        <LigneEtape
                          key={e.id}
                          e={e}
                          fr={fr}
                          nbDeals={parEtape[e.id] ?? 0}
                          glissable={t === ''}
                          sauver={sauverEtRafraichir}
                          onSupprimer={() => setASupprimer(e)}
                        />
                      ))}
                    </tbody>
                  </SortableContext>
                </table>
              </DndContext>
            </div>
          </div>

          {archivees.length > 0 && (
            <div className="rounded-xl border border-outline bg-surface-card p-3">
              <button
                type="button"
                aria-expanded={voirArchivees}
                onClick={() => setVoirArchivees((v) => !v)}
                className="text-[12.5px] font-medium text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary rounded"
              >
                {fr ? `Étapes supprimées (${archivees.length})` : `Deleted stages (${archivees.length})`}
              </button>
              {voirArchivees && (
                <ul className="mt-2 divide-y divide-border-subtle">
                  {archivees.map((e) => (
                    <li key={e.id} className="flex items-center justify-between py-1.5 text-[13px]">
                      <span className="text-text-secondary">{fr ? e.name_fr : e.name_en}</span>
                      <button
                        type="button"
                        onClick={() => void sauverEtRafraichir(() => desarchiverEtape(e.id))}
                        className="btn-secondary text-[12px] px-2.5 py-1"
                      >
                        {fr ? 'Restaurer' : 'Restore'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      <SupprimerEtapeModal
        fr={fr}
        etape={aSupprimer}
        etapes={actives}
        nbDeals={aSupprimer ? parEtape[aSupprimer.id] ?? 0 : 0}
        onFermer={() => setASupprimer(null)}
        onSupprime={() => {
          setASupprimer(null);
          void qc.invalidateQueries({ queryKey: ['pipeline-deals', pipeline.id] });
          rafraichir();
        }}
      />
    </div>
  );
}
