/* ═══════════════════════════════════════════════════════════════
   L'éditeur d'automatisation — page pleine

   Le modèle est celui de GoHighLevel, relevé sur leur app : on QUITTE la
   liste et on occupe tout l'écran, barre latérale comprise. Une automatisation
   se construit dans un espace, pas dans une boîte de dialogue de 680 px —
   c'est la différence entre « remplir un formulaire » et « travailler sur un
   parcours ».

   Techniquement : `fixed inset-0 z-50`, le même procédé que `QuoteMeasure`
   (la page de mesure sur carte) qui passe déjà par-dessus la navigation.

   ── Disposition ────────────────────────────────────────────────
   ┌──────────────────────────────────────────────────────────┐
   │ ← Mes automatisations   [nom éditable]   ↶ ↷  Enregistré │  barre 1
   ├──────────────────────────────────────────────────────────┤
   │  Parcours · Réglages · Historique · Journaux             │  barre 2
   │                          Tester  [Brouillon ⚪— Publier]  │
   ├──────────────────────────────────────────────────────────┤
   │                                                          │
   │                    [ canevas ]                  ⊕ Ajouter│
   │                                                          │
   │  ✋ + 100% − ⛶                              [minimap]     │
   └──────────────────────────────────────────────────────────┘
   ═══════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Pencil, Undo2, Redo2, Cloud, Check, Loader2,
  Play, Plus, Hand, Maximize2, ZoomIn, ZoomOut, Sparkles, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import type { AutomationRule } from '../lib/automationRulesApi';
import {
  chargerAutomatisations,
  modifierAutomatisation,
  genererParcoursAvecLumi,
  type CatalogueAutomatisations,
} from '../lib/automationBuilderApi';
import {
  type Etape,
  type TypeEtape,
  nouvelIdEtape,
  etapeVierge,
  insererEtape,
} from '../lib/sequenceTypes';
import SequenceCanvas from '../components/automations/SequenceCanvas';
import { OngletJournaux, OngletHistorique } from '../components/automations/OngletJournaux';
import OngletReglages, { type ReglagesAutomatisation } from '../components/automations/OngletReglages';
import { confirmer } from '../components/ui/ConfirmDialog';

type Onglet = 'parcours' | 'reglages' | 'historique' | 'journaux';

/** Bornes du zoom. Au-delà, on ne lit plus rien ; en deçà, on se perd. */
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.6;
const ZOOM_PAS = 0.1;

export default function AutomationBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';

  const [regle, setRegle] = useState<AutomationRule | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueAutomatisations | null>(null);
  const [chargement, setChargement] = useState(true);
  const [onglet, setOnglet] = useState<Onglet>('parcours');

  // ── Nom éditable ──
  const [nom, setNom] = useState('');
  const [editeNom, setEditeNom] = useState(false);

  // ── État d'enregistrement, façon « Saved » de GHL ──
  // Trois états : à jour, en cours, en attente. L'utilisateur doit savoir si
  // son travail est en sécurité sans avoir à chercher un bouton.
  const [etatSauvegarde, setEtatSauvegarde] = useState<'a_jour' | 'en_cours' | 'modifie' | 'incomplet'>('a_jour');

  // ── Le parcours ──
  const [steps, setSteps] = useState<Etape[]>([]);
  const [etapeChoisie, setEtapeChoisie] = useState<string | null>(null);

  // ── Annuler / refaire ──
  // Une pile de versions du parcours. Indispensable dès qu'on manipule un
  // graphe : supprimer la mauvaise carte doit se rattraper d'un geste.
  const [historique, setHistorique] = useState<Etape[][]>([]);
  const [position, setPosition] = useState(-1);

  // ── Canevas ──
  const [zoom, setZoom] = useState(1);
  const [decalage, setDecalage] = useState({ x: 0, y: 0 });
  const [mainActive, setMainActive] = useState(false);
  const deplacement = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);

  // ── Construire en décrivant ──
  const idsPage = useId();
  const [prompt, setPrompt] = useState('');
  /** Où insérer la prochaine étape, tant que son type n'est pas choisi. */
  const [ajoutEnCours, setAjoutEnCours] = useState<{ apresId: string | null; branche?: 'alors' | 'sinon' } | null>(null);

  /**
   * Des départs tout faits — on ne part jamais d'une page blanche.
   * Ce sont les quatre besoins qui reviennent chez une entreprise de services.
   */
  const SUGGESTIONS = [
    { fr: 'Relance de soumission', en: 'Quote follow-up',
      promptFr: 'Après l’envoi d’une soumission, attends 3 jours puis envoie un texto de suivi si le client n’a pas répondu.',
      promptEn: 'After sending a quote, wait 3 days then text a follow-up if the client has not replied.' },
    { fr: 'Rappel de rendez-vous', en: 'Appointment reminder',
      promptFr: 'La veille d’un rendez-vous, envoie un texto de rappel au client avec l’heure.',
      promptEn: 'The day before an appointment, text the client a reminder with the time.' },
    { fr: 'Facture en retard', en: 'Overdue invoice',
      promptFr: 'Quand une facture dépasse son échéance, envoie un courriel poli, puis relance 7 jours plus tard.',
      promptEn: 'When an invoice goes past due, send a polite email, then follow up 7 days later.' },
    { fr: 'Demande d’avis', en: 'Review request',
      promptFr: 'Deux jours après un job terminé, demande un avis au client par texto.',
      promptEn: 'Two days after a job is completed, text the client for a review.' },
  ];

  /** Ouvre le choix du type d'étape à insérer. */
  const ouvrirAjout = (apresId: string | null, branche?: 'alors' | 'sinon') => {
    setAjoutEnCours({ apresId, branche });
  };

  /** Insère l'étape du type choisi, et la sélectionne pour l'éditer tout de suite. */
  const confirmerAjout = (type: TypeEtape) => {
    if (!ajoutEnCours) return;
    const nouvelle = etapeVierge(type, nouvelIdEtape(steps));
    memoriser(insererEtape(steps, nouvelle, ajoutEnCours.apresId, ajoutEnCours.branche));
    setEtapeChoisie(nouvelle.id);
    setAjoutEnCours(null);
  };

  /**
   * Lumi construit le parcours à partir de la description.
   *
   * Pas encore branché sur l'agent : l'orchestrateur ne propose jamais une
   * écriture sans confirmation, donc ça passera par une proposition affichée
   * dans le canevas avant d'être appliquée. En attendant, on le dit
   * franchement plutôt que de faire semblant.
   */
  /** Ce que Lumi a compris, affiché au-dessus du canevas après génération. */
  const [resumeLumi, setResumeLumi] = useState<string | null>(null);
  const [genere, setGenere] = useState(false);

  /**
   * Lumi propose, l'utilisateur dispose.
   *
   * Le parcours revient dans le canevas SANS être enregistré : il devient un
   * brouillon que l'on peut modifier, compléter ou jeter. On mémorise le
   * changement comme n'importe quelle édition, donc « annuler » le rattrape.
   */
  const construireAvecLumi = async () => {
    const demande = prompt.trim();
    if (demande.length < 10 || genere) return;
    setGenere(true);
    try {
      const propose = await genererParcoursAvecLumi(demande, fr ? 'fr' : 'en');
      memoriser(propose.steps as Etape[]);
      setResumeLumi(propose.resume || null);
      // Le nom et le déclencheur suivent la proposition — c'est ce que
      // l'utilisateur a décrit, il pourra les changer.
      if (propose.nom) setNom(propose.nom);
      if (propose.trigger_event && regle) {
        setRegle({ ...regle, trigger_event: propose.trigger_event });
        modifierAutomatisation(regle.id, { trigger_event: propose.trigger_event }).catch(() => {});
      }
      setPrompt('');
      toast.success(fr ? 'Lumi a construit le parcours' : 'Lumi built the path');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setGenere(false);
    }
  };

  // ── Chargement ──
  useEffect(() => {
    let vivant = true;
    chargerAutomatisations()
      .then((d) => {
        if (!vivant) return;
        setCatalogue(d.catalogue);
        const trouvee = d.rules.find((r) => r.id === id) ?? null;
        setRegle(trouvee);
        setNom(trouvee?.name ?? '');
        const etapes = (trouvee?.steps as Etape[] | undefined) ?? [];
        setSteps(etapes);
        setHistorique([etapes]);
        setPosition(0);
      })
      .catch((e: unknown) => {
        console.error('[builder] chargement échoué', e instanceof Error ? e.message : String(e));
        toast.error(fr ? 'Impossible de charger cette automatisation' : 'Could not load this automation');
      })
      .finally(() => { if (vivant) setChargement(false); });
    return () => { vivant = false; };
  }, [id, fr]);

  /** Empile une version du parcours — c'est ce que « annuler » remontera. */
  const memoriser = useCallback((nouvelles: Etape[]) => {
    setHistorique((prev) => {
      // On coupe ce qui suit la position courante : après un « annuler »,
      // une nouvelle modification efface le futur, comme dans tout éditeur.
      const coupe = prev.slice(0, position + 1);
      return [...coupe, nouvelles];
    });
    setPosition((p) => p + 1);
    setSteps(nouvelles);
    setEtatSauvegarde('modifie');
  }, [position]);

  const annuler = () => {
    if (position <= 0) return;
    setPosition((p) => p - 1);
    setSteps(historique[position - 1]);
    setEtatSauvegarde('modifie');
  };

  const refaire = () => {
    if (position >= historique.length - 1) return;
    setPosition((p) => p + 1);
    setSteps(historique[position + 1]);
    setEtatSauvegarde('modifie');
  };

  // ── Enregistrement ──
  // Différé d'une seconde après la dernière frappe : enregistrer à chaque
  // caractère saturerait le serveur, et attendre un bouton ferait perdre du
  // travail. C'est le compromis que GHL affiche avec son « Saved ».
  /**
   * Une étape « message » sans texte : le serveur la refuse, et il a raison —
   * une automatisation publiée ne doit pas envoyer un message vide. Mais un
   * BROUILLON en cours de construction en contient forcément, le temps qu'on
   * écrive. On ne tente donc pas l'enregistrement, et on le DIT : sans ça,
   * l'enregistrement automatique échouait en boucle et l'utilisateur voyait
   * « Modifié » sans jamais comprendre pourquoi rien ne partait.
   */
  const etapesIncompletes = useMemo(
    () => steps.filter(
      (e) => e.type === 'action'
        && !String(e.action?.config?.body ?? e.action?.config?.title ?? '').trim(),
    ).length,
    [steps],
  );

  useEffect(() => {
    if (etatSauvegarde !== 'modifie' || !regle) return;
    if (etapesIncompletes > 0) { setEtatSauvegarde('incomplet'); return; }
    const minuterie = setTimeout(async () => {
      setEtatSauvegarde('en_cours');
      try {
        await modifierAutomatisation(regle.id, { name: nom.trim() || regle.name, steps });
        setEtatSauvegarde('a_jour');
      } catch (e: unknown) {
        setEtatSauvegarde('modifie');
        toast.error(e instanceof Error ? e.message : String(e));
      }
    }, 1000);
    return () => clearTimeout(minuterie);
  }, [etatSauvegarde, regle, nom, steps, etapesIncompletes]);

  // Dès que la dernière étape vide est remplie, on repart en enregistrement.
  useEffect(() => {
    if (etatSauvegarde === 'incomplet' && etapesIncompletes === 0) setEtatSauvegarde('modifie');
  }, [etatSauvegarde, etapesIncompletes]);

  // ── Publier / dépublier ──
  const basculerPublication = async () => {
    if (!regle) return;
    const versActive = !regle.is_active;
    if (versActive) {
      const ok = await confirmer({
        title: fr ? 'Publier cette automatisation ?' : 'Publish this automation?',
        message: fr
          ? 'Elle commencera à envoyer de vrais messages à vos clients dès le prochain déclenchement.'
          : 'It will start sending real messages to your clients at the next trigger.',
        confirmLabel: fr ? 'Publier' : 'Publish',
      });
      if (!ok) return;
    }
    try {
      const maj = await modifierAutomatisation(regle.id, { is_active: versActive });
      setRegle(maj);
      toast.success(versActive
        ? (fr ? 'Automatisation publiée' : 'Automation published')
        : (fr ? 'Repassée en brouillon' : 'Back to draft'));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  // ── Déplacement du canevas ──
  const debutDeplacement = (e: React.MouseEvent) => {
    if (!mainActive) return;
    deplacement.current = { x: e.clientX, y: e.clientY, dx: decalage.x, dy: decalage.y };
  };
  const pendantDeplacement = (e: React.MouseEvent) => {
    const d = deplacement.current;
    if (!d) return;
    setDecalage({ x: d.dx + (e.clientX - d.x), y: d.dy + (e.clientY - d.y) });
  };
  const finDeplacement = () => { deplacement.current = null; };

  const zoomer = (delta: number) => {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 10) / 10)));
  };
  const recadrer = () => { setZoom(1); setDecalage({ x: 0, y: 0 }); };

  const declencheurLabel = useMemo(() => {
    if (!catalogue || !regle) return fr ? '— à choisir —' : '— to pick —';
    const d = catalogue.declencheurs.find((x) => x.cle === regle.trigger_event);
    return d ? (fr ? d.fr : d.en) : regle.trigger_event;
  }, [catalogue, regle, fr]);

  if (chargement) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface">
        <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" aria-hidden="true" />
      </div>
    );
  }

  if (!regle) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-surface">
        <p className="text-sm text-text-secondary">
          {fr ? 'Cette automatisation est introuvable.' : 'This automation was not found.'}
        </p>
        <button
          type="button"
          onClick={() => navigate('/automations')}
          className="rounded-lg bg-text-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {fr ? 'Mes automatisations' : 'My automations'}
        </button>
      </div>
    );
  }

  const ONGLETS: Array<{ cle: Onglet; fr: string; en: string }> = [
    { cle: 'parcours', fr: 'Parcours', en: 'Builder' },
    { cle: 'reglages', fr: 'Réglages', en: 'Settings' },
    { cle: 'historique', fr: 'Historique', en: 'Enrollment history' },
    { cle: 'journaux', fr: 'Journaux', en: 'Execution logs' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface">
      {/* ══ Barre 1 : sortie, nom, annuler/refaire, état ══ */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <button
          type="button"
          onClick={() => navigate('/automations')}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{fr ? 'Mes automatisations' : 'My automations'}</span>
        </button>

        {/* Le nom, au centre — cliquer dessus l'édite sur place. */}
        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
          {editeNom ? (
            <input
              autoFocus
              value={nom}
              onChange={(e) => { setNom(e.target.value); setEtatSauvegarde('modifie'); }}
              onBlur={() => setEditeNom(false)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditeNom(false); }}
              maxLength={120}
              aria-label={fr ? 'Nom de l’automatisation' : 'Automation name'}
              className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-1.5 text-center text-sm font-medium text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditeNom(true)}
              className="inline-flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="truncate">{nom || regle.name}</span>
              <Pencil className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={annuler}
            disabled={position <= 0}
            aria-label={fr ? 'Annuler' : 'Undo'}
            className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Undo2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={refaire}
            disabled={position >= historique.length - 1}
            aria-label={fr ? 'Refaire' : 'Redo'}
            className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Redo2 className="h-4 w-4" aria-hidden="true" />
          </button>

          {/* L'état d'enregistrement, toujours visible — comme le « Saved » de GHL. */}
          <span className="ml-1 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-text-tertiary">
            {etatSauvegarde === 'incomplet' ? (
              <span className="inline-flex items-center gap-1.5 text-warning">
                <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
                {fr
                  ? `${etapesIncompletes} étape(s) à compléter`
                  : `${etapesIncompletes} step(s) to complete`}
              </span>
            ) : etatSauvegarde === 'en_cours' ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{fr ? 'Enregistrement…' : 'Saving…'}</>
            ) : etatSauvegarde === 'modifie' ? (
              <><Cloud className="h-3.5 w-3.5" aria-hidden="true" />{fr ? 'Modifié' : 'Edited'}</>
            ) : (
              <><Check className="h-3.5 w-3.5" aria-hidden="true" />{fr ? 'Enregistré' : 'Saved'}</>
            )}
          </span>
        </div>
      </header>

      {/* ══ Barre 2 : onglets, tester, brouillon/publier ══ */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4">
        {/* Onglets : les classes `tab-nav` / `tab-item` existent déjà dans
            index.css et servent sur Finances — on ne réinvente pas un
            soulignement qui dériverait du reste de l'app. */}
        <nav className="tab-nav flex-1 border-b-0" role="tablist" aria-label={fr ? 'Sections' : 'Sections'}>
          {ONGLETS.map((o) => (
            <button
              key={o.cle}
              type="button"
              role="tab"
              aria-selected={onglet === o.cle}
              onClick={() => setOnglet(o.cle)}
              className={onglet === o.cle ? 'tab-item-active' : 'tab-item'}
            >
              {fr ? o.fr : o.en}
            </button>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2 py-1.5">
          <button
            type="button"
            onClick={() => toast.info(fr ? 'Le test arrive bientôt' : 'Testing is coming soon')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            {fr ? 'Tester' : 'Test'}
          </button>

          {/* Brouillon ⚪—— Publier : l'interrupteur dit l'état ET l'action. */}
          <div className="inline-flex items-center gap-2 text-xs">
            <span className={cn('font-medium', !regle.is_active ? 'text-text-primary' : 'text-text-tertiary')}>
              {fr ? 'Brouillon' : 'Draft'}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={regle.is_active}
              onClick={basculerPublication}
              aria-label={fr ? 'Publier l’automatisation' : 'Publish the automation'}
              className={cn(
                'relative h-5 w-9 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                regle.is_active ? 'bg-accent' : 'bg-surface-tertiary',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                  regle.is_active ? 'left-[1.125rem]' : 'left-0.5',
                )}
              />
            </button>
            <span className={cn('font-medium', regle.is_active ? 'text-text-primary' : 'text-text-tertiary')}>
              {fr ? 'Publiée' : 'Published'}
            </span>
          </div>
        </div>
      </div>

      {/* ══ Le contenu ══ */}
      <div className="relative flex-1 overflow-hidden">
        {onglet === 'parcours' && (
          <>
            {/* Le fond quadrillé : il donne l'échelle et dit « ceci est un
                espace de travail », pas un formulaire. */}
            <div
              role="presentation"
              onMouseDown={debutDeplacement}
              onMouseMove={pendantDeplacement}
              onMouseUp={finDeplacement}
              onMouseLeave={finDeplacement}
              className={cn(
                'absolute inset-0 overflow-auto',
                mainActive ? 'cursor-grab active:cursor-grabbing' : '',
              )}
              style={{
                backgroundImage:
                  'radial-gradient(circle, rgb(0 0 0 / 0.07) 1px, transparent 1px)',
                backgroundSize: '22px 22px',
              }}
            >
              <div
                className="min-h-full py-10"
                style={{
                  transform: `translate(${decalage.x}px, ${decalage.y}px) scale(${zoom})`,
                  transformOrigin: 'top center',
                }}
              >
                {/* ── Parcours vide : on propose de le DÉCRIRE plutôt que de
                    le construire à la main. C'est le geste qui ouvre le
                    builder de GoHighLevel, et c'est celui qui sert vraiment :
                    un propriétaire d'entreprise sait dire ce qu'il veut, pas
                    poser des nœuds. ── */}
                {steps.length === 0 ? (
                  <div className="mx-auto flex max-w-xl flex-col items-center px-4">
                    <div className="w-full rounded-2xl border border-border bg-surface-card p-5 shadow-sm">
                      <p className="mb-3 flex items-center justify-center gap-2 text-center text-sm font-medium text-text-primary">
                        <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
                        {fr ? 'Décris ton automatisation à Lumi' : 'Describe your automation to Lumi'}
                      </p>
                      <label htmlFor={`${idsPage}-prompt`} className="sr-only">
                        {fr ? 'Décris ton automatisation' : 'Describe your automation'}
                      </label>
                      <textarea
                        id={`${idsPage}-prompt`}
                        rows={3}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder={fr
                          ? 'Après l’envoi d’une soumission, attends 24 h puis envoie un texto de suivi, attends 2 jours de plus pour un courriel, et crée une tâche d’appel après 3 jours.'
                          : 'After sending a quote, wait 24 hours then send a text follow-up, wait 2 more days for an email, and create a call task after 3 days.'}
                        className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      />
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={construireAvecLumi}
                          disabled={prompt.trim().length < 10 || genere}
                          className="glass-button-primary inline-flex items-center gap-1.5 disabled:opacity-40"
                        >
                          {genere
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
                          {genere
                            ? (fr ? 'Lumi construit…' : 'Lumi is building…')
                            : (fr ? 'Construire' : 'Build')}
                        </button>
                      </div>

                      {/* Des départs tout faits : on ne part jamais de rien. */}
                      <div className="mt-3 flex flex-wrap justify-center gap-1.5 border-t border-border pt-3">
                        {SUGGESTIONS.map((sg) => (
                          <button
                            key={sg.fr}
                            type="button"
                            onClick={() => setPrompt(fr ? sg.promptFr : sg.promptEn)}
                            className="rounded-full border border-border px-2.5 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            {fr ? sg.fr : sg.en}
                          </button>
                        ))}
                      </div>
                    </div>

                    <span className="my-4 text-xs text-text-tertiary">{fr ? 'ou' : 'or'}</span>

                    <button
                      type="button"
                      onClick={() => ouvrirAjout(null)}
                      className="w-full max-w-[280px] rounded-xl border-2 border-dashed border-accent/50 bg-accent/5 px-4 py-4 text-sm font-medium text-accent transition-colors hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Plus className="mx-auto mb-1 h-5 w-5" aria-hidden="true" />
                      {fr ? 'Ajouter une première étape' : 'Add a first step'}
                    </button>

                    <span className="mt-4 rounded-full bg-surface-tertiary px-3 py-1 text-[11px] font-medium text-text-tertiary">
                      {fr ? 'FIN' : 'END'}
                    </span>
                  </div>
                ) : (
                  catalogue && (
                    <SequenceCanvas
                      declencheurLabel={declencheurLabel}
                      steps={steps}
                      fr={fr}
                      selectionId={etapeChoisie}
                      onSelection={setEtapeChoisie}
                      onAjouter={ouvrirAjout}
                    />
                  )
                )}
              </div>
            </div>

            {/* Choisir le type de la nouvelle étape. */}
            {ajoutEnCours && (
              <div className="absolute left-1/2 top-20 z-10 w-[280px] -translate-x-1/2 rounded-xl border border-border bg-surface-card p-3 shadow-lg">
                <p className="mb-2 text-xs font-medium text-text-primary">
                  {fr ? 'Ajouter…' : 'Add…'}
                </p>
                <div className="flex flex-col gap-1">
                  {([
                    ['action', fr ? 'Un message' : 'A message'],
                    ['attendre', fr ? 'Une attente' : 'A wait'],
                    ['si', fr ? 'Une condition' : 'A condition'],
                    ['arreter', fr ? 'Arrêter ici' : 'Stop here'],
                  ] as Array<[TypeEtape, string]>).map(([t, libelle]) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => confirmerAjout(t)}
                      className="rounded-lg border border-border px-3 py-2 text-left text-xs text-text-primary transition-colors hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {libelle}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAjoutEnCours(null)}
                    className="mt-1 rounded-lg px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {fr ? 'Annuler' : 'Cancel'}
                  </button>
                </div>
              </div>
            )}

            {/* Ce que Lumi a compris — au-dessus du canevas, comme leur
                bandeau « Explain this workflow ». L'utilisateur doit pouvoir
                vérifier d'un coup d'œil avant de publier. */}
            {resumeLumi && (
              <div className="absolute left-1/2 top-4 z-10 flex max-w-[520px] -translate-x-1/2 items-start gap-2 rounded-xl border border-accent/40 bg-surface-card px-3 py-2 shadow-sm">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
                <p className="text-[12px] text-text-primary">{resumeLumi}</p>
                <button
                  type="button"
                  onClick={() => setResumeLumi(null)}
                  aria-label={fr ? 'Fermer' : 'Close'}
                  className="-mr-1 shrink-0 rounded p-0.5 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* Ajouter — en haut à droite, comme chez GHL. */}
            <button
              type="button"
              onClick={() => toast.info(fr ? 'Ajouter une étape' : 'Add a step')}
              className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-text-primary shadow-sm transition-colors hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {fr ? 'Ajouter' : 'Add'}
            </button>

            {/* Zoom et déplacement — en bas à gauche, comme chez GHL. */}
            <div className="absolute bottom-4 left-4 flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
              <button
                type="button"
                onClick={() => setMainActive((m) => !m)}
                aria-pressed={mainActive}
                aria-label={fr ? 'Déplacer le canevas' : 'Pan the canvas'}
                className={cn(
                  'p-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  mainActive ? 'bg-accent/10 text-accent' : 'text-text-tertiary hover:bg-surface-tertiary',
                )}
              >
                <Hand className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => zoomer(ZOOM_PAS)}
                aria-label={fr ? 'Agrandir' : 'Zoom in'}
                className="border-t border-border p-2 text-text-tertiary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <ZoomIn className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="border-t border-border px-1 py-1.5 text-center text-[11px] tabular-nums text-text-secondary">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => zoomer(-ZOOM_PAS)}
                aria-label={fr ? 'Réduire' : 'Zoom out'}
                className="border-t border-border p-2 text-text-tertiary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <ZoomOut className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={recadrer}
                aria-label={fr ? 'Recadrer' : 'Fit to screen'}
                className="border-t border-border p-2 text-text-tertiary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </>
        )}

        {/* Historique et journaux : les données existent depuis des mois,
            c'est l'écran qui manquait. */}
        {onglet === 'historique' && <div className="absolute inset-0 overflow-y-auto"><OngletHistorique ruleId={regle.id} fr={fr} /></div>}
        {onglet === 'journaux' && <div className="absolute inset-0 overflow-y-auto"><OngletJournaux ruleId={regle.id} fr={fr} /></div>}

        {onglet === 'reglages' && (
          <div className="absolute inset-0 overflow-y-auto">
            <OngletReglages
              ruleId={regle.id}
              reglages={(regle.settings ?? null) as ReglagesAutomatisation | null}
              fr={fr}
              onChange={(r) => setRegle({ ...regle, settings: r as Record<string, unknown> | null })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
