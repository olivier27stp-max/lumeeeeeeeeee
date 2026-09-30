/* ══════════════════════════════════════════════════════════════
   Bibliothèque de modèles — « Partir d'un modèle » (2026-09-30).

   Calquée sur la « Template library » de GoHighLevel, en plus simple : une
   colonne de catégories, une recherche, un tri, grille ou liste ; un clic sur
   une carte ouvre l'aperçu DANS la fenêtre ; « Utiliser ce modèle » crée une
   copie en brouillon et ouvre l'éditeur.

   Ouvrir la bibliothèque n'écrit rien : le catalogue est lu (GET), et la
   seule écriture est le POST de « Utiliser ce modèle ».
   ═════════════════════════════════════════════════════════════ */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Bell, CalendarClock, CheckSquare, ChevronDown, ChevronUp, CreditCard, FileText, GitBranch,
  LayoutGrid, List, Loader2, Mail, MessageSquare, RefreshCw, Search, SlidersHorizontal, Star, UserPlus, Zap,
} from 'lucide-react';
import Modal from '../ui/Modal';
import { cn } from '../../lib/utils';
import { fetchModelesAutomatisation, utiliserModele } from '../../lib/automationBuilderApi';
import type { AutomationRule } from '../../lib/automationRulesApi';
import { trouverAction, trouverDeclencheur } from '../../lib/automationCatalogue';
import {
  CATEGORIES_MODELES, etapesApercu, filtrerModeles, trierModeles,
  type CanalModele, type CategorieModele, type EtapeApercu, type ModeleAutomatisation, type TriModeles,
} from '../../lib/automationTemplates';

const ICONE_CATEGORIE: Record<CategorieModele, typeof Zap> = {
  soumissions: FileText,
  bienvenue: UserPlus,
  rendez_vous: CalendarClock,
  facturation: CreditCard,
  apres_job: Star,
  relance_clients: RefreshCw,
  pipeline: GitBranch,
};

const CANAUX: Record<CanalModele, { icone: typeof Zap; fr: string; en: string }> = {
  sms: { icone: MessageSquare, fr: 'Texto', en: 'Text' },
  courriel: { icone: Mail, fr: 'Courriel', en: 'Email' },
  notification: { icone: Bell, fr: 'Notification', en: 'Notification' },
  tache: { icone: CheckSquare, fr: 'Tâche', en: 'Task' },
  avis: { icone: Star, fr: 'Demande d’avis', en: 'Review request' },
  pipeline: { icone: GitBranch, fr: 'Pipeline', en: 'Pipeline' },
};

const CANAL_ACTION: Record<string, CanalModele> = {
  send_sms: 'sms', send_email: 'courriel', create_notification: 'notification',
  create_task: 'tache', request_review: 'avis', move_deal_stage: 'pipeline',
};

const CATEGORIES_VISIBLES_PAR_DEFAUT = 5;

function libelleCategorie(cle: CategorieModele, fr: boolean): string {
  const c = CATEGORIES_MODELES.find((x) => x.cle === cle);
  return c ? (fr ? c.fr : c.en) : cle;
}

function duree(secondes: number, fr: boolean): string {
  const s = Math.abs(secondes);
  const unite = (n: number, un: [string, string], plusieurs: [string, string]) =>
    `${n} ${n > 1 ? (fr ? plusieurs[0] : plusieurs[1]) : (fr ? un[0] : un[1])}`;
  if (s >= 86_400 && s % 86_400 === 0) return unite(s / 86_400, ['jour', 'day'], ['jours', 'days']);
  if (s >= 3_600 && s % 3_600 === 0) return unite(s / 3_600, ['heure', 'hour'], ['heures', 'hours']);
  if (s >= 60) return unite(Math.round(s / 60), ['minute', 'minute'], ['minutes', 'minutes']);
  return unite(s, ['seconde', 'second'], ['secondes', 'seconds']);
}

function libelleAttente(e: Extract<EtapeApercu, { genre: 'attente' }>, fr: boolean): string {
  if (e.mode === 'avant_date' || e.secondes < 0) return fr ? `${duree(e.secondes, fr)} avant le rendez-vous` : `${duree(e.secondes, fr)} before the appointment`;
  if (e.mode === 'reponse') return fr ? `Attendre une réponse (au plus ${duree(e.secondes, fr)})` : `Wait for a reply (up to ${duree(e.secondes, fr)})`;
  return fr ? `Attendre ${duree(e.secondes, fr)}` : `Wait ${duree(e.secondes, fr)}`;
}

function libelleAction(type: string, fr: boolean): string {
  const a = trouverAction(type);
  return a ? (fr ? a.fr : a.en) : type;
}

function libelleDeclencheur(cle: string, fr: boolean): string {
  const d = trouverDeclencheur(cle);
  return d ? (fr ? d.fr : d.en) : cle;
}

/** Conditions du déclencheur, en clair (« source ≠ request_form »). */
function libellesConditions(conditions: Record<string, unknown>): string[] {
  return Object.entries(conditions).map(([cle, v]) => {
    if (v && typeof v === 'object') {
      const [op, val] = Object.entries(v as Record<string, unknown>)[0] ?? ['', ''];
      const symbole = op === 'neq' ? '≠' : op === 'gt' ? '>' : op === 'lt' ? '<' : op === 'in' ? '∈' : '=';
      return `${cle} ${symbole} ${String(val)}`;
    }
    return `${cle} = ${String(v)}`;
  });
}

/** Le texte d'un courriel HTML, lisible, sans jamais injecter de HTML. */
function texteBrut(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Les variables ([client_first_name], {{deal.title}}) en surbrillance. */
function AvecVariables({ texte }: { texte: string }) {
  const morceaux = texte.split(/(\[[a-z0-9_]+\]|\{\{[^}]+\}\})/gi);
  return (
    <>
      {morceaux.map((m, i) => (/^(\[[a-z0-9_]+\]|\{\{[^}]+\}\})$/i.test(m)
        ? <mark key={i} className="rounded bg-primary/10 px-0.5 font-medium text-text-primary">{m}</mark>
        : <span key={i}>{m}</span>))}
    </>
  );
}

/** Miniature du flux, dessinée en code : déclencheur puis les étapes. */
function Miniature({ modele, compacte = false }: { modele: ModeleAutomatisation; compacte?: boolean }) {
  const etapes = etapesApercu(modele).filter((e) => e.genre !== 'fin');
  const max = compacte ? 4 : 6;
  const visibles = etapes.slice(0, max);
  return (
    <div className={cn('flex items-center gap-1', compacte ? '' : 'flex-wrap')} aria-hidden="true">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary text-[var(--color-primary-foreground)]">
        <Zap size={12} />
      </span>
      {visibles.map((e, i) => {
        const Icone = e.genre === 'action' ? (CANAUX[CANAL_ACTION[e.type]]?.icone ?? Zap)
          : e.genre === 'attente' ? CalendarClock : GitBranch;
        return (
          <span key={i} className="inline-flex items-center gap-1">
            <span className="h-px w-2 bg-border" />
            <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded-md border border-outline bg-surface-card',
              e.genre === 'attente' ? 'text-text-tertiary' : 'text-text-secondary')}>
              <Icone size={12} />
            </span>
          </span>
        );
      })}
      {etapes.length > max && <span className="ml-1 text-[11px] text-text-tertiary">+{etapes.length - max}</span>}
    </div>
  );
}

function Canaux({ canaux, fr }: { canaux: CanalModele[]; fr: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {canaux.map((c) => {
        const { icone: Icone, fr: lf, en: le } = CANAUX[c];
        return <Icone key={c} size={13} className="text-text-tertiary" aria-label={fr ? lf : le} />;
      })}
    </span>
  );
}

function EtiquetteCategorie({ cle, fr }: { cle: CategorieModele; fr: boolean }) {
  const Icone = ICONE_CATEGORIE[cle];
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-surface-secondary px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
      <Icone size={11} aria-hidden="true" />
      {libelleCategorie(cle, fr)}
    </span>
  );
}

function nouvelleCle(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface Props {
  open: boolean;
  fr: boolean;
  onClose: () => void;
  /** Appelé après la création : la page ferme, redirige et affiche le toast. */
  onCree: (regle: AutomationRule) => void;
  /** Erreur de création : la fenêtre reste ouverte. */
  onErreur: (message: string) => void;
}

export default function BibliothequeModeles({ open, fr, onClose, onCree, onErreur }: Props) {
  const ids = useId();
  const [modeles, setModeles] = useState<ModeleAutomatisation[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [essai, setEssai] = useState(0);
  const [saisie, setSaisie] = useState('');
  const [recherche, setRecherche] = useState('');
  const [categories, setCategories] = useState<Set<CategorieModele>>(() => new Set());
  const [tri, setTri] = useState<TriModeles>('recent');
  const [vue, setVue] = useState<'grille' | 'liste'>('grille');
  const [toutesCategories, setToutesCategories] = useState(false);
  const [categoriesOuvertes, setCategoriesOuvertes] = useState(true);
  const [filtresMobile, setFiltresMobile] = useState(false);
  const [apercu, setApercu] = useState<ModeleAutomatisation | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const cleIdempotence = useRef('');
  /** Verrou SYNCHRONE : deux clics dans le même instant voient encore `envoi` à faux. */
  const enCours = useRef(false);

  // Chargement à l'ouverture (lecture seule). Réinitialisé à la fermeture.
  useEffect(() => {
    if (!open) return;
    let vivant = true;
    setErreur(null);
    fetchModelesAutomatisation()
      .then((m) => { if (vivant) setModeles(m); })
      .catch((e: unknown) => {
        console.error('[bibliotheque-modeles] chargement', e);
        if (vivant) setErreur(e instanceof Error ? e.message : String(e));
      });
    return () => { vivant = false; };
  }, [open, essai]);

  useEffect(() => {
    if (open) return;
    setApercu(null); setSaisie(''); setRecherche(''); setCategories(new Set()); setFiltresMobile(false);
  }, [open]);

  // Recherche différée (~200 ms) : on ne refiltre pas à chaque lettre.
  useEffect(() => {
    const t = setTimeout(() => setRecherche(saisie), 200);
    return () => clearTimeout(t);
  }, [saisie]);

  const compteParCategorie = useMemo(() => {
    const n = new Map<CategorieModele, number>();
    for (const m of modeles ?? []) n.set(m.categorie, (n.get(m.categorie) ?? 0) + 1);
    return n;
  }, [modeles]);

  // Une catégorie sans modèle n'est pas affichée.
  const categoriesAffichees = CATEGORIES_MODELES.filter((c) => (compteParCategorie.get(c.cle) ?? 0) > 0);
  const categoriesVisibles = toutesCategories ? categoriesAffichees : categoriesAffichees.slice(0, CATEGORIES_VISIBLES_PAR_DEFAUT);

  const resultats = useMemo(
    () => trierModeles(filtrerModeles(modeles ?? [], { recherche, categories, fr }), tri, fr),
    [modeles, recherche, categories, tri, fr],
  );

  const basculerCategorie = (cle: CategorieModele) => setCategories((prev) => {
    const s = new Set(prev);
    if (s.has(cle)) s.delete(cle); else s.add(cle);
    return s;
  });
  const reinitialiser = () => { setSaisie(''); setRecherche(''); setCategories(new Set()); };

  const ouvrirApercu = (m: ModeleAutomatisation) => {
    cleIdempotence.current = nouvelleCle();
    setApercu(m);
  };

  const utiliser = async () => {
    if (!apercu || enCours.current) return;
    enCours.current = true;
    setEnvoi(true);
    try {
      const regle = await utiliserModele(apercu.id, cleIdempotence.current);
      onCree(regle);
    } catch (e: unknown) {
      console.error('[bibliotheque-modeles] utiliser', e);
      // Nouvelle clé : réessayer après un échec doit pouvoir créer.
      cleIdempotence.current = nouvelleCle();
      onErreur(e instanceof Error ? e.message : String(e));
    } finally {
      enCours.current = false;
      setEnvoi(false);
    }
  };

  const listeCategories = (prefixe: string) => (
    <div className="space-y-1">
      {categoriesVisibles.map((c) => {
        const id = `${ids}-${prefixe}-${c.cle}`;
        return (
          <div key={c.cle} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-secondary">
            <input id={id} type="checkbox" checked={categories.has(c.cle)} onChange={() => basculerCategorie(c.cle)}
              className="h-3.5 w-3.5 rounded border-outline" />
            <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 text-[13px] text-text-secondary">
              <span className="truncate">{fr ? c.fr : c.en}</span>
              <span className="text-[12px] tabular-nums text-text-tertiary">{compteParCategorie.get(c.cle) ?? 0}</span>
            </label>
          </div>
        );
      })}
      {categoriesAffichees.length > CATEGORIES_VISIBLES_PAR_DEFAUT && (
        <button type="button" onClick={() => setToutesCategories((v) => !v)}
          className="inline-flex items-center gap-1 px-2 py-1 text-[12px] font-medium text-text-primary hover:underline">
          {toutesCategories ? (fr ? 'Afficher moins' : 'Show less') : (fr ? 'Afficher plus' : 'Show more')}
          {toutesCategories ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
        </button>
      )}
    </div>
  );

  const contenu = () => {
    if (erreur) {
      return (
        <div className="py-16 text-center">
          <p className="text-[13px] font-medium text-text-primary">{fr ? 'Impossible de charger les modèles.' : 'Could not load the templates.'}</p>
          <p className="mt-1 text-[12px] text-text-tertiary">{erreur}</p>
          <button type="button" onClick={() => setEssai((n) => n + 1)} className="glass-button mt-4">
            {fr ? 'Réessayer' : 'Try again'}
          </button>
        </div>
      );
    }
    if (!modeles) {
      return (
        <div className={cn(vue === 'grille' ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3' : 'space-y-2')} aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="animate-pulse rounded-xl border border-outline p-3">
              <div className="h-16 rounded-lg bg-surface-secondary" />
              <div className="mt-3 h-3 w-2/3 rounded bg-surface-secondary" />
              <div className="mt-2 h-3 w-full rounded bg-surface-secondary" />
            </div>
          ))}
        </div>
      );
    }
    if (resultats.length === 0) {
      return (
        <div className="py-16 text-center">
          <p className="text-[13px] font-medium text-text-primary">{fr ? 'Aucun modèle trouvé' : 'No templates found'}</p>
          <button type="button" onClick={reinitialiser} className="glass-button mt-4">
            {fr ? 'Réinitialiser les filtres' : 'Reset filters'}
          </button>
        </div>
      );
    }
    if (vue === 'liste') {
      return (
        <ul className="divide-y divide-border rounded-xl border border-outline">
          {resultats.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => ouvrirApercu(m)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-text-primary">{fr ? m.nom.fr : m.nom.en}</p>
                  <p className="truncate text-[12px] text-text-tertiary">{fr ? m.description.fr : m.description.en}</p>
                </div>
                <span className="hidden sm:inline"><EtiquetteCategorie cle={m.categorie} fr={fr} /></span>
                <span className="shrink-0 text-[12px] tabular-nums text-text-tertiary">
                  {m.nb_etapes} {fr ? (m.nb_etapes > 1 ? 'étapes' : 'étape') : (m.nb_etapes > 1 ? 'steps' : 'step')}
                </span>
                <Canaux canaux={m.canaux} fr={fr} />
              </button>
            </li>
          ))}
        </ul>
      );
    }
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {resultats.map((m) => (
          <button key={m.id} type="button" onClick={() => ouvrirApercu(m)}
            className="flex flex-col rounded-xl border border-outline bg-surface-card p-3 text-left transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <div className="flex h-16 items-center rounded-lg bg-surface-secondary px-3">
              <Miniature modele={m} compacte />
            </div>
            <div className="mt-2.5"><EtiquetteCategorie cle={m.categorie} fr={fr} /></div>
            <p className="mt-1.5 line-clamp-2 text-[13px] font-semibold leading-snug text-text-primary">{fr ? m.nom.fr : m.nom.en}</p>
            <p className="mt-0.5 truncate text-[12px] text-text-tertiary">{fr ? m.description.fr : m.description.en}</p>
            <div className="mt-auto flex items-center justify-between pt-2.5">
              <span className="text-[12px] tabular-nums text-text-tertiary">
                {m.nb_etapes} {fr ? (m.nb_etapes > 1 ? 'étapes' : 'étape') : (m.nb_etapes > 1 ? 'steps' : 'step')}
              </span>
              <Canaux canaux={m.canaux} fr={fr} />
            </div>
          </button>
        ))}
      </div>
    );
  };

  const vueApercu = (m: ModeleAutomatisation) => {
    const etapes = etapesApercu(m).filter((e) => e.genre !== 'fin');
    const conditions = libellesConditions(m.conditions);
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <EtiquetteCategorie cle={m.categorie} fr={fr} />
          <Canaux canaux={m.canaux} fr={fr} />
        </div>
        <h3 className="mt-2 text-[16px] font-bold text-text-primary">{fr ? m.nom.fr : m.nom.en}</h3>
        <p className="mt-1 text-[13px] text-text-secondary">{fr ? m.description.fr : m.description.en}</p>

        <div className="mt-4 rounded-xl border border-outline p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">{fr ? 'Déclencheur' : 'Trigger'}</p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium text-text-primary">
            <Zap size={13} aria-hidden="true" /> {libelleDeclencheur(m.declencheur, fr)}
          </p>
          <p className="mt-1 text-[12px] text-text-tertiary">
            {conditions.length === 0
              ? (fr ? 'Aucune condition.' : 'No conditions.')
              : `${fr ? 'Conditions' : 'Conditions'} : ${conditions.join(' · ')}`}
          </p>
        </div>

        <ol className="mt-3 space-y-2">
          {etapes.map((e, i) => (
            <li key={i} className="rounded-xl border border-outline p-3">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-[11px] font-semibold tabular-nums text-text-secondary">{i + 1}</span>
                {e.genre === 'attente' && <span className="text-text-secondary">{libelleAttente(e, fr)}</span>}
                {e.genre === 'condition' && <span className="text-text-secondary">{fr ? 'Si' : 'If'} {libellesConditions(e.conditions).join(' · ')}</span>}
                {e.genre === 'action' && <span className="font-medium text-text-primary">{libelleAction(e.type, fr)}</span>}
              </div>
              {e.genre === 'action' && <ContenuAction type={e.type} config={e.config} fr={fr} />}
            </li>
          ))}
        </ol>
      </div>
    );
  };

  return (
    <Modal open={open} onClose={onClose} size="4xl" title={fr ? 'Bibliothèque de modèles' : 'Template library'}
      footer={apercu ? (
        <>
          <button type="button" onClick={() => setApercu(null)} disabled={envoi} className="glass-button inline-flex items-center gap-1.5">
            <ArrowLeft size={13} aria-hidden="true" /> {fr ? 'Retour' : 'Back'}
          </button>
          <button type="button" onClick={() => { void utiliser(); }} disabled={envoi} aria-busy={envoi}
            className="glass-button-primary inline-flex items-center gap-1.5 disabled:opacity-60">
            {envoi && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
            {fr ? 'Utiliser ce modèle' : 'Use this template'}
          </button>
        </>
      ) : undefined}>
      {apercu ? vueApercu(apercu) : (
        <div className="flex flex-col gap-4 md:flex-row">
          {/* Colonne gauche (tablette et ordinateur). */}
          <nav className="hidden w-56 shrink-0 md:block" aria-label={fr ? 'Filtres' : 'Filters'}>
            <button type="button" onClick={reinitialiser} aria-pressed={categories.size === 0}
              className={cn('w-full rounded-lg px-2 py-1.5 text-left text-[13px] font-medium',
                categories.size === 0 ? 'bg-surface-secondary text-text-primary' : 'text-text-secondary hover:bg-surface-secondary')}>
              {fr ? 'Tous les modèles' : 'All templates'}
            </button>
            <div className="mt-3 border-t border-border pt-3">
              <button type="button" onClick={() => setCategoriesOuvertes((v) => !v)} aria-expanded={categoriesOuvertes}
                className="flex w-full items-center justify-between px-2 py-1 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                {fr ? 'Catégories' : 'Categories'}
                {categoriesOuvertes ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
              </button>
              {categoriesOuvertes && <div className="mt-1">{listeCategories('g')}</div>}
            </div>
          </nav>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="text-[14px] font-semibold text-text-primary">{fr ? 'Automatisations' : 'Automations'}</h4>
              <p className="text-[12px] text-text-tertiary" aria-live="polite">
                {modeles ? (fr ? `Affichage de ${resultats.length} modèle${resultats.length > 1 ? 's' : ''}` : `Showing ${resultats.length} template${resultats.length > 1 ? 's' : ''}`) : ' '}
              </p>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
                <input id={`${ids}-recherche`} type="search" value={saisie} onChange={(e) => setSaisie(e.target.value)}
                  aria-label={fr ? 'Rechercher un modèle' : 'Search templates'} placeholder={fr ? 'Rechercher' : 'Search'}
                  className="glass-input w-full pl-8 text-[13px]" />
              </div>
              <select id={`${ids}-tri`} value={tri} onChange={(e) => setTri(e.target.value as TriModeles)}
                aria-label={fr ? 'Trier' : 'Sort'} className="glass-input text-[13px]">
                <option value="recent">{fr ? 'Plus récent' : 'Most recent'}</option>
                <option value="nom">{fr ? 'Nom (A–Z)' : 'Name (A–Z)'}</option>
                <option value="etapes">{fr ? 'Nombre d’étapes' : 'Number of steps'}</option>
              </select>
              <div className="inline-flex overflow-hidden rounded-lg border border-outline" role="group" aria-label={fr ? 'Affichage' : 'View'}>
                <button type="button" onClick={() => setVue('grille')} aria-pressed={vue === 'grille'} aria-label={fr ? 'Grille' : 'Grid'}
                  className={cn('p-2', vue === 'grille' ? 'bg-surface-secondary text-text-primary' : 'text-text-tertiary hover:text-text-primary')}>
                  <LayoutGrid size={14} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => setVue('liste')} aria-pressed={vue === 'liste'} aria-label={fr ? 'Liste' : 'List'}
                  className={cn('border-l border-outline p-2', vue === 'liste' ? 'bg-surface-secondary text-text-primary' : 'text-text-tertiary hover:text-text-primary')}>
                  <List size={14} aria-hidden="true" />
                </button>
              </div>
              {/* Téléphone : la colonne devient un menu de filtres. */}
              <button type="button" onClick={() => setFiltresMobile((v) => !v)} aria-expanded={filtresMobile}
                className="glass-button inline-flex items-center gap-1.5 md:hidden">
                <SlidersHorizontal size={13} aria-hidden="true" />
                {fr ? 'Filtres' : 'Filters'}{categories.size > 0 ? ` (${categories.size})` : ''}
              </button>
            </div>
            {filtresMobile && (
              <div className="mt-2 rounded-xl border border-outline p-2 md:hidden">
                <button type="button" onClick={reinitialiser}
                  className="w-full rounded-lg px-2 py-1.5 text-left text-[13px] font-medium text-text-primary hover:bg-surface-secondary">
                  {fr ? 'Tous les modèles' : 'All templates'}
                </button>
                {listeCategories('m')}
              </div>
            )}

            <div className="mt-3">{contenu()}</div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ContenuAction({ type, config, fr }: { type: string; config: Record<string, unknown>; fr: boolean }) {
  const lire = (cle: string) => {
    const v = (fr ? config[cle] : config[`${cle}_en`] ?? config[cle]);
    return typeof v === 'string' ? v : '';
  };
  if (type === 'send_sms' || type === 'request_review') {
    const corps = lire('body');
    if (!corps) return null;
    return <p className="mt-2 whitespace-pre-line rounded-lg bg-surface-secondary p-2.5 text-[12px] leading-relaxed text-text-secondary"><AvecVariables texte={corps} /></p>;
  }
  if (type === 'send_email') {
    const sujet = lire('subject');
    const corps = texteBrut(lire('body'));
    return (
      <div className="mt-2 rounded-lg bg-surface-secondary p-2.5 text-[12px] leading-relaxed text-text-secondary">
        {sujet && <p className="font-semibold text-text-primary"><AvecVariables texte={sujet} /></p>}
        {corps && <p className="mt-1 whitespace-pre-line"><AvecVariables texte={corps} /></p>}
      </div>
    );
  }
  if (type === 'create_notification' || type === 'create_task') {
    const titre = lire('title') || lire('body') || lire('description');
    if (!titre) return null;
    return <p className="mt-2 text-[12px] text-text-tertiary"><AvecVariables texte={titre} /></p>;
  }
  return null;
}
