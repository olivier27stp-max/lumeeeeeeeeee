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
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Pencil, Undo2, Redo2, Cloud, Check, Loader2,
  Play, Plus, Hand, Maximize2, ZoomIn, ZoomOut, Sparkles, X, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import type { AutomationRule } from '../lib/automationRulesApi';
import {
  chargerEditeur,
  creerAutomatisation,
  modifierAutomatisation,
  genererParcoursAvecLumi,
  chargerMembres,
  chargerEtiquettes,
  apercuAutomatisation,
  changerPublication,
  lireVersionAutomatisation,
  chargerStatistiques,
  restaurerAutomatisation,
  type StatsEtape,
  type BrouillonAutomatisation,
  type CatalogueAutomatisations,
  type ApercuAutomatisation,
} from '../lib/automationBuilderApi';
import {
  type Etape,
  type TypeEtape,
  nouvelIdEtape,
  etapeVierge,
  insererEtape,
  retirerEtape,
  finDuParcours,
  estFormatOrigine,
  projeterFormatOrigine,
  apercuConversion,
  TEXTES_ACTION_PROVISOIRE,
} from '../lib/sequenceTypes';
import SequenceCanvas from '../components/automations/SequenceCanvas';
import PanneauEtape from '../components/automations/PanneauEtape';
import TiroirChoix, { type ChoixTiroir } from '../components/automations/TiroirChoix';
import ClavardageLumi from '../components/automations/ClavardageLumi';
import InterrupteurPublication from '../components/automations/InterrupteurPublication';
import { usePlanFeature } from '../hooks/usePlanFeature';
import PanneauDeclencheur from '../components/automations/PanneauDeclencheur';
import { useChampsTous, objetDeLaRegle, champSurveille, saisieDepuisValeurCondition } from '../components/champs/automatisations';
import { LIBELLES_OBJET } from '../lib/champs/types';
import { fetchPipelines, fetchStages } from '../lib/pipelineVentesApi';
import { listPredefinedServices } from '../lib/servicesApi';
import { localizeAutomationName } from '../lib/automationNames';
import {
  ACTIONS,
  CASE_SORTIE,
  DECLENCHEURS,
  conditionsApresChangement,
  FAMILLES_ACTIONS,
  FAMILLES_DECLENCHEURS,
  actionCompatible,
  champVisible,
  configParDefaut,
  declencheurOffert,
  trouverAction,
  trouverDeclencheur,
} from '../lib/automationCatalogue';
import { actionsDuParcours, problemesPublication } from '../lib/publicationAutomatisation';
import { useModuleAccess } from '../hooks/useModuleAccess';
import { apercuClientsInactifs } from '../lib/reservationApi';
import { OngletJournaux, OngletHistorique } from '../components/automations/OngletJournaux';
import OngletReglages, { type ReglagesAutomatisation } from '../components/automations/OngletReglages';
import { confirmer } from '../components/ui/ConfirmDialog';
import { creerFileBascule } from '../lib/fileBascule';
import { captureClientException } from '../lib/sentry';
import { lireEtatPause } from '../lib/automationWebhooksApi';

type Onglet = 'parcours' | 'reglages' | 'historique' | 'journaux';

/** Un déclencheur et SES réglages : ce qu'un choix dans le tiroir écrit. */
interface ChoixDeclencheur { trigger_event: string; conditions: Record<string, unknown> }

/**
 * Le serveur répond-il que la règle N'EXISTE PLUS (404) ? `automationBuilderApi`
 * pose le statut HTTP sur l'erreur. Lu par sa forme, sans rien importer de
 * plus : une panne (500, réseau) n'a pas ce statut et reste une panne.
 */
function estIntrouvable(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { status?: unknown }).status === 404;
}

/**
 * Le serveur a-t-il refusé une écriture PÉRIMÉE (409 `modifiee_ailleurs`,
 * constat A-09) ? La règle a changé depuis que l'éditeur l'a lue — par Lumi
 * ou dans un autre onglet. Réessayer ne servira à rien : il faut recharger.
 */
function estModifieeAilleurs(e: unknown): boolean {
  return typeof e === 'object' && e !== null
    && (e as { status?: unknown }).status === 409
    && (e as { code?: unknown }).code === 'modifiee_ailleurs';
}

/**
 * Le serveur a-t-il REFUSÉ l'écriture (400, 403, 409, 422…) ? Ce n'est pas une
 * panne : la demande elle-même ne passe pas (une valeur hors bornes, un
 * parcours qui finit par une attente, une automatisation publiée qu'on
 * casserait). La renvoyer telle quelle sera refusé pareil — on ne réessaie
 * JAMAIS un refus (triage éditeur, S-04).
 */
function estRefus(e: unknown): boolean {
  const statut = typeof e === 'object' && e !== null ? (e as { status?: unknown }).status : undefined;
  return typeof statut === 'number' && [400, 403, 409, 410, 413, 422].includes(statut);
}

/**
 * Les étapes que le parcours ATTEINT, en partant de sa tête (`steps[0]`) : par
 * la suite, les deux branches d'une condition, la réponse du client et le
 * moment dépassé d'une attente. Ce que le moteur exécute, et ce que le canevas
 * dessine — une étape hors de cet ensemble existe en base sans jamais servir.
 */
function etapesAtteintes(steps: Etape[]): Set<string> {
  const parId = new Map(steps.map((e) => [e.id, e]));
  const vues = new Set<string>();
  const pile: string[] = steps[0] ? [steps[0].id] : [];
  while (pile.length) {
    const id = pile.pop() as string;
    const e = parId.get(id);
    if (!e || vues.has(id)) continue;
    vues.add(id);
    const suites = e.type === 'si' ? [e.alors, e.sinon]
      : e.type === 'arreter' ? []
      : e.type === 'attendre' ? [e.suivant, e.si_reponse, e.si_depasse]
      : [e.suivant];
    for (const s of suites) if (s) pile.push(s);
  }
  return vues;
}

/**
 * Ce qu'une modification du parcours laisserait ORPHELIN (triage éditeur,
 * S-12) : les étapes qu'on atteignait `avant` et qu'on n'atteint plus `apres`.
 * « Arrêter ici » posé au milieu coupe la suite ; supprimer une condition ne
 * rebranche que sa branche « si oui ». Ces étapes disparaissaient de l'écran
 * et restaient en base, reliées à rien.
 */
function etapesPerdues(avant: Etape[], apres: Etape[]): Etape[] {
  const avantAtteintes = etapesAtteintes(avant);
  const apresAtteintes = etapesAtteintes(apres);
  return apres.filter((e) => avantAtteintes.has(e.id) && !apresAtteintes.has(e.id));
}

/** Le parcours sans ces étapes — ce qui n'est plus à l'écran n'est plus en base. */
function sansEtapes(steps: Etape[], retirees: Etape[]): Etape[] {
  if (retirees.length === 0) return steps;
  const ids = new Set(retirees.map((e) => e.id));
  return steps.filter((e) => !ids.has(e.id));
}

/** Bornes du zoom. Au-delà, on ne lit plus rien ; en deçà, on se perd. */
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.6;
const ZOOM_PAS = 0.1;

export default function AutomationBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [parametres] = useSearchParams();
  const { language } = useTranslation();
  const fr = language === 'fr';
  /*
   * « Construire avec Lumi » est une fonction de Lumi, donc d'Autopilot
   * (décision du 2026-09-28). Sans Lumi (Minimum, Scale), on montre ce que
   * ça apporte et où l'obtenir — le serveur refuse de toute façon
   * (`plan_sans_lumi`). Pendant le chargement, on ne cache rien.
   */
  const { hasFeature: aLumi, loading: planEnChargement } = usePlanFeature('includes_ai');
  const lumiDisponible = aLumi || planEnChargement;

  const [regle, setRegle] = useState<AutomationRule | null>(null);
  /*
   * « Partir de zéro » et « Construire avec Lumi » ouvrent
   * `/automations/nouvelle` : RIEN n'est créé en base tant que
   * l'utilisateur n'a rien fait (audit 2026-09-28 — brouillons orphelins, et
   * sans Autopilot la règle naissait AVANT l'écran de vente). Elle naît à la
   * première vraie sauvegarde, dans `ecrire`, une seule fois même si deux
   * sauvegardes partent en même temps.
   */
  const estNouvelle = id === 'nouvelle';
  const idReel = useRef<string | null>(estNouvelle ? null : (id ?? null));
  const creationEnVol = useRef<Promise<AutomationRule> | null>(null);
  /** Vrai le temps de remplacer `/nouvelle` par l'id créé : pas de rechargement. */
  const passageALaRegleCreee = useRef(false);
  const regleCourante = useRef<AutomationRule | null>(null);
  useEffect(() => { regleCourante.current = regle; }, [regle]);
  const { isEnabled: sortieALaCreation } = useModuleAccess('auto_sortie_parcours');
  /*
   * LA RÈGLE N'EXISTE PLUS (audit du 2026-10-01). Supprimée ailleurs pendant
   * que l'éditeur restait ouvert, le serveur refuse chaque écriture — et
   * l'enregistrement automatique annonçait « nouvel essai automatique » pour
   * un essai qui ne pouvait jamais réussir. Au premier 404, l'éditeur le dit
   * et s'arrête.
   */
  const [disparue, setDisparue] = useState(false);
  /*
   * ELLE A ÉTÉ MODIFIÉE AILLEURS (constat A-09). L'éditeur envoie son parcours
   * en entier : resté ouvert pendant que Lumi (clavardage général) ou un autre
   * onglet changeait la même automatisation, il réécrivait sa version périmée
   * par-dessus, sans un mot. Il envoie donc la version qu'il a LUE
   * (`versionLue`, le `updated_at` de la règle) ; le serveur refuse si elle a
   * changé (409), et l'éditeur le dit et propose de recharger — ni écrasement
   * silencieux, ni boucle de nouveaux essais.
   */
  const [modifieeAilleurs, setModifieeAilleurs] = useState(false);
  /** La version lue, PAR règle : l'éditeur peut passer d'une automatisation à une autre sans se démonter. */
  const versionsLues = useRef(new Map<string, string>());
  const versionLue = useCallback((idRegle: string | null | undefined): string | null => (
    idRegle ? versionsLues.current.get(idRegle) ?? null : null
  ), []);
  const noterVersion = useCallback((idRegle: string | null | undefined, version: unknown) => {
    if (idRegle && typeof version === 'string' && version) versionsLues.current.set(idRegle, version);
  }, []);
  /*
   * UNE écriture à la fois : chacune part avec la version rendue par la
   * précédente. Deux écritures parties en parallèle (l'enregistrement
   * automatique et un changement de déclencheur) porteraient la même version,
   * et la seconde se ferait refuser par notre propre garde.
   */
  const fileEcritures = useRef<Promise<unknown>>(Promise.resolve());
  const enFile = useCallback(<T,>(tache: () => Promise<T>): Promise<T> => {
    const suite = fileEcritures.current.then(tache, tache);
    fileEcritures.current = suite.catch(() => undefined);
    return suite;
  }, []);

  /**
   * Toute écriture de la règle passe par ici. Brouillon jamais enregistré :
   * la PREMIÈRE écriture le crée (avec le contenu demandé), les suivantes
   * attendent cette création puis modifient.
   */
  /** Écrit dans UNE règle, nommée : à sa place dans la file, avec SA version lue. */
  const ecrireRegle = useCallback((idRegle: string, patch: Partial<BrouillonAutomatisation>): Promise<AutomationRule> => (
    enFile(() => modifierAutomatisation(idRegle, patch, versionLue(idRegle)).then((maj) => {
      noterVersion(idRegle, maj?.updated_at);
      return maj;
    }, (e: unknown) => {
      // Seulement si c'est encore la règle à l'écran (une écriture de départ vise l'ancienne).
      if (idRegle === idReel.current) {
        if (estIntrouvable(e)) setDisparue(true);
        if (estModifieeAilleurs(e)) setModifieeAilleurs(true);
      }
      throw e;
    }))
  ), [enFile, versionLue, noterVersion]);

  const ecrire = useCallback(async (patch: Partial<BrouillonAutomatisation>): Promise<AutomationRule> => {
    const modifier = (idRegle: string) => ecrireRegle(idRegle, patch);
    /*
     * CE QUI EST À L'ÉCRAN NE S'ÉCRIT QUE DANS SA RÈGLE (triage éditeur, S-01).
     * L'éditeur passe d'une automatisation à une autre sans se démonter (le
     * lien « Ouvrir » d'un toast) : pendant que la 2e charge, l'état à l'écran
     * est encore celui de la 1re. Une écriture née de cet état ne doit JAMAIS
     * partir vers la 2e — elle y écrivait le nom et le parcours de la 1re.
     */
    const aLEcran = regleCourante.current?.id;
    if (idReel.current && aLEcran && aLEcran !== idReel.current) {
      throw new Error(fr
        ? 'Écriture annulée : l’éditeur est en train de changer d’automatisation.'
        : 'Write cancelled: the editor is switching to another automation.');
    }
    if (idReel.current) return modifier(idReel.current);
    if (creationEnVol.current) {
      const creee = await creationEnVol.current;
      return modifier(creee.id);
    }
    const base = regleCourante.current;
    const enCreation = creerAutomatisation({
      name: base?.name || (fr ? 'Nouvelle automatisation' : 'New automation'),
      trigger_event: base?.trigger_event ?? 'quote.sent',
      conditions: (base?.conditions ?? {}) as Record<string, unknown>,
      delay_seconds: 0,
      // Action PROVISOIRE (le serveur en exige une) : l'éditeur la reconnaît
      // comme un parcours vide — voir TEXTES_ACTION_PROVISOIRE.
      actions: [{ type: 'send_sms', config: { body: TEXTES_ACTION_PROVISOIRE[fr ? 0 : 1] } }],
      steps: [],
      // Sortie automatique du parcours : une NOUVELLE automatisation naît
      // avec la case cochée. Drapeau coupé = rien d'écrit, comme avant.
      ...(sortieALaCreation ? { settings: { arreter_si_resolu: true } } : {}),
      ...patch,
      is_active: false,
    }).then((creee) => {
      idReel.current = creee.id;
      noterVersion(creee.id, creee.updated_at);
      passageALaRegleCreee.current = true;
      setRegle((r) => (r ? { ...r, id: creee.id, org_id: creee.org_id, created_at: creee.created_at, updated_at: creee.updated_at } : creee));
      navigate(`/automations/${creee.id}${parametres.get('lumi') === '1' ? '?lumi=1' : ''}`, { replace: true });
      return creee;
    }, (e: unknown) => {
      creationEnVol.current = null;
      throw e;
    });
    creationEnVol.current = enCreation;
    return enCreation;
  }, [fr, navigate, parametres, sortieALaCreation, ecrireRegle, noterVersion]);
  /*
   * Interrupteur martelé (Rafba, 2026-09-28) : chaque clic envoyait sa
   * requête calculée sur un état périmé, et la dernière réponse ARRIVÉE
   * gagnait. La file envoie un changement à la fois et finit toujours sur
   * le dernier clic (fileBascule.ts).
   */
  const frBascule = useRef(language === 'fr');
  useEffect(() => { frBascule.current = language === 'fr'; }, [language]);
  const confirmationPublication = useRef(false);
  const [, setVersionBascule] = useState(0);
  const [fileBascule] = useState(() => creerFileBascule({
    // La route serveur de publication (M8), la même que la liste. Dans la
    // file des écritures : publier touche la règle, donc sa version (A-09).
    envoyer: (id, actif) => enFile(async () => {
      noterVersion(id, await changerPublication(id, actif));
    }),
    surFin: (id, actif) => {
      setRegle((r) => (r && r.id === id ? { ...r, is_active: actif } : r));
      setVersionBascule((v) => v + 1);
      toast.success(actif
        ? (frBascule.current ? 'Automatisation publiée' : 'Automation published')
        : (frBascule.current ? 'Repassée en brouillon' : 'Back to draft'), { id: `bascule-${id}` });
    },
    surEchec: (id, retour, erreur) => {
      setRegle((r) => (r && r.id === id ? { ...r, is_active: retour } : r));
      setVersionBascule((v) => v + 1);
      // Règle supprimée entre-temps : l'écran « n'existe plus » le dit.
      if (estIntrouvable(erreur)) { setDisparue(true); return; }
      toast.error(erreur instanceof Error ? erreur.message : String(erreur), { id: `bascule-${id}` });
    },
  }));
  const [catalogue, setCatalogue] = useState<CatalogueAutomatisations | null>(null);
  const [chargement, setChargement] = useState(true);
  const [onglet, setOnglet] = useState<Onglet>('parcours');

  // ── Nom éditable ──
  const [nom, setNom] = useState('');
  const [editeNom, setEditeNom] = useState(false);

  // ── État d'enregistrement, façon « Saved » de GHL ──
  // Trois états : à jour, en cours, en attente. L'utilisateur doit savoir si
  // son travail est en sécurité sans avoir à chercher un bouton.
  const [etatSauvegarde, setEtatSauvegarde] = useState<'a_jour' | 'en_cours' | 'modifie' | 'incomplet' | 'refuse'>('a_jour');
  /**
   * LE DERNIER REFUS DU SERVEUR (triage éditeur, S-04), gardé à l'écran tant
   * que rien ne s'enregistre : sa phrase, et les étapes qu'il désigne. Un
   * refus n'est pas réessayé — la prochaine modification du parcours repart,
   * elle, en enregistrement.
   */
  const [refus, setRefus] = useState<{ message: string; etapes: string[] } | null>(null);

  /*
   * Le serveur refuse au-delà de 30 étapes (`ETAPES_MAX`, validation.ts) :
   * un parcours plus long n'est jamais enregistré. Sans garde ici, on
   * laissait l'utilisateur en ajouter puis échouer — il croyait avoir
   * perdu son travail. On refuse AVANT, avec la raison. QA du 2026-09-25.
   */
  const ETAPES_MAX = 30;

  /** Les échanges avec Lumi, pour qu'une correction porte sur le contexte. */
  /*
   * Le fil de la conversation avec Lumi. Il servait UNIQUEMENT de contexte
   * envoyé au modèle, sans jamais être affiché : on tapait une demande, le
   * canevas changeait, et les tours précédents disparaissaient. On ne voyait
   * donc pas ce qu'on venait de demander ni ce que Lumi avait répondu.
   *
   * On garde ici l'historique ENTIER pour l'écran, et on ne tronque qu'à
   * l'envoi (voir `construireAvecLumi`). L'inverse — tronquer à
   * l'enregistrement, comme avant — donnerait un fil qui oublie en silence.
   */
  const [echangesLumi, setEchangesLumi] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  /** Le panneau de Lumi, replié par l'utilisateur (le fil est gardé). */
  const [lumiReduit, setLumiReduit] = useState(false);
  /** « Restaurer » en cours, depuis l'écran d'une automatisation à la corbeille. */
  const [restauration, setRestauration] = useState(false);
  /**
   * La 2e automatisation déjà créée dans cette conversation : quand Lumi la
   * corrige (« voici mon lien Calendly »), on la MET À JOUR au lieu d'en
   * créer une autre copie.
   */
  const autreCreee = useRef<{ id: string; trigger_event: string } | null>(null);
  /** Le champ de Lumi : « Construire avec Lumi » y place le curseur. */
  const champLumi = useRef<HTMLTextAreaElement>(null);

  // ── Le parcours ──
  const [steps, setSteps] = useState<Etape[]>([]);
  const [etapeChoisie, setEtapeChoisie] = useState<string | null>(null);
  /*
   * L'ÉTAPE CHOISIE DANS LE TIROIR, PAS ENCORE DANS LE PARCOURS (triage
   * actions, ligne 1). Elle entrait dans `steps` au clic, et l'enregistrement
   * automatique l'écrivait trois secondes plus tard : sur une automatisation
   * PUBLIÉE, le texto d'exemple (« Bonjour [client_name], c'est
   * [company_name]. Merci ! ») était en ligne avant que quiconque l'ait lu.
   *
   * Elle attend donc ICI, hors de `steps` : le canevas la montre à sa place,
   * son panneau s'ouvre, et elle n'entre dans le parcours — donc dans ce que
   * l'enregistrement automatique écrit — qu'au clic sur « Enregistrer » de son
   * panneau. Fermer le panneau l'abandonne.
   */
  const [etapeEnAttente, setEtapeEnAttente] = useState<{ etape: Etape; apresId: string | null; branche?: 'alors' | 'sinon' } | null>(null);
  /**
   * Qui a modifié le parcours en dernier, HORS du panneau d'étape : Lumi, ou
   * autre chose (annuler / rétablir). Le panneau resté ouvert s'en sert pour
   * dire « Lumi a modifié cette étape… » quand une saisie y est en cours.
   */
  const [modifieePar, setModifieePar] = useState<'lumi' | 'autre' | null>(null);
  /** Le panneau ouvert a-t-il un brouillon non enregistré ? (PanneauEtape.onModifie) */
  const brouillonEtapeModifie = useRef(false);
  /** … et son reflet en ÉTAT : la garde du bouton « Précédent » doit réagir quand une saisie commence. */
  const [saisieEnCours, setSaisieEnCours] = useState(false);
  const signalerBrouillonEtape = useCallback((m: boolean) => {
    brouillonEtapeModifie.current = m;
    setSaisieEnCours(m || brouillonDeclencheurModifie.current);
  }, []);
  /** Même chose pour les réglages du déclencheur (PanneauDeclencheur.onModifie). */
  const brouillonDeclencheurModifie = useRef(false);
  const signalerBrouillonDeclencheur = useCallback((m: boolean) => {
    brouillonDeclencheurModifie.current = m;
    setSaisieEnCours(m || brouillonEtapeModifie.current);
  }, []);

  // ── De quoi remplir les menus du panneau ──
  // Les membres (pour « assigner a ») et les etiquettes deja utilisees.
  // Charges une fois : un menu qui recharge a chaque ouverture de panneau
  // clignote, et ces deux listes bougent rarement.
  const [membres, setMembres] = useState<Array<{ user_id: string; nom: string }>>([]);
  /**
   * Les AUTRES automatisations publiées, pour « Démarrer une automatisation ».
   *
   * Publiées seulement (un brouillon n'enverrait rien), vivantes seulement
   * (une règle à la corbeille ne se déclenche plus), et jamais celle qu'on
   * édite — une automatisation qui se démarre elle-même boucle.
   */
  const [autresAutomatisations, setAutresAutomatisations] = useState<Array<{ id: string; nom: string }>>([]);
  const [etiquettes, setEtiquettes] = useState<string[]>([]);

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
  /** Le tiroir « Ajouter un déclencheur » est-il ouvert ? */
  const [tiroirDeclencheur, setTiroirDeclencheur] = useState(false);
  /** Le panneau de RÉGLAGE du déclencheur (« quelle date surveiller ? »). */
  const [reglageDeclencheur, setReglageDeclencheur] = useState(false);

  /*
   * UN SEUL PANNEAU À DROITE À LA FOIS (audit du 2026-10-01). Cliquer la
   * carte « Quand » pendant qu'une étape était ouverte posait deux panneaux
   * de 380 px côte à côte (trois « Annuler », deux « Enregistrer ») ; et
   * « + » pendant que les réglages du déclencheur étaient ouverts ne faisait
   * rien. Ouvrir l'un ferme l'autre — après avoir demandé, si une saisie non
   * enregistrée s'y perdrait (la règle du changement d'étape, audit
   * 2026-09-28).
   *
   * Rien à confirmer : la suite s'exécute TOUT DE SUITE, dans le même geste.
   */
  const quandPanneauLibre = useCallback((suite: () => void, versEtape?: string) => {
    const enFrancais = language === 'fr';
    const questions: Array<Parameters<typeof confirmer>[0]> = [];
    const ajoutAbandonne = !!etapeEnAttente && versEtape !== etapeEnAttente.etape.id;
    if (ajoutAbandonne) {
      // L'étape en cours d'ajout n'est pas dans le parcours : la quitter l'abandonne.
      questions.push({
        title: enFrancais ? 'Abandonner l’étape en cours d’ajout ?' : 'Drop the step being added?',
        message: enFrancais
          ? 'L’étape ouverte n’a pas été enregistrée : elle ne sera pas ajoutée au parcours.'
          : 'The open step was not saved: it will not be added to the journey.',
        confirmLabel: enFrancais ? 'Ne pas l’ajouter' : 'Do not add it',
        danger: true,
      });
    } else if (etapeChoisie && versEtape !== etapeChoisie && brouillonEtapeModifie.current) {
      questions.push(versEtape
        ? {
          title: enFrancais ? 'Changer d’étape sans enregistrer ?' : 'Switch step without saving?',
          message: enFrancais
            ? 'Les modifications de l’étape ouverte ne sont pas enregistrées : elles seront perdues.'
            : 'The open step’s changes are not saved: they will be lost.',
          confirmLabel: enFrancais ? 'Changer d’étape' : 'Switch step',
          danger: true,
        }
        : {
          title: enFrancais ? 'Fermer l’étape sans enregistrer ?' : 'Close the step without saving?',
          message: enFrancais
            ? 'Les modifications de l’étape ouverte ne sont pas enregistrées : elles seront perdues.'
            : 'The open step’s changes are not saved: they will be lost.',
          confirmLabel: enFrancais ? 'Fermer sans enregistrer' : 'Close without saving',
          danger: true,
        });
    }
    if (reglageDeclencheur && brouillonDeclencheurModifie.current) {
      questions.push({
        title: enFrancais ? 'Fermer les réglages sans enregistrer ?' : 'Close the settings without saving?',
        message: enFrancais
          ? 'Les réglages du déclencheur ne sont pas enregistrés : ils seront perdus.'
          : 'The trigger settings are not saved: they will be lost.',
        confirmLabel: enFrancais ? 'Fermer sans enregistrer' : 'Close without saving',
        danger: true,
      });
    }
    if (questions.length === 0) { suite(); return; }
    void (async () => {
      for (const question of questions) {
        if (!(await confirmer(question))) return;
      }
      if (ajoutAbandonne) setEtapeEnAttente(null);
      suite();
    })();
  }, [etapeChoisie, reglageDeclencheur, language, etapeEnAttente]);

  /** Affiche le panneau d'une étape — SEUL : tiroirs et réglages du déclencheur se ferment. */
  const montrerEtape = useCallback((idEtape: string) => {
    setTiroirDeclencheur(false);
    setReglageDeclencheur(false);
    setAjoutEnCours(null);
    setEtapeChoisie(idEtape);
    // Une AUTRE étape affichée : l'ajout en attente est abandonné.
    setEtapeEnAttente((a) => (a && a.etape.id !== idEtape ? null : a));
  }, []);

  /** Ouvrir une carte du canevas, à la demande de l'utilisateur. */
  const ouvrirEtape = useCallback((idEtape: string) => {
    quandPanneauLibre(() => montrerEtape(idEtape), idEtape);
  }, [quandPanneauLibre, montrerEtape]);
  /**
   * Les champs personnalisés actifs de l'entreprise (tous objets) : « quel
   * champ ? » de « Champ modifié », « Mettre à jour un champ », les filtres
   * et conditions, les variables. Une seule requête, partagée (react-query).
   */
  const champsPerso = useChampsTous();
  /**
   * L'objet de la fiche que l'événement fera arriver — celui dont on peut
   * lire et écrire les champs. Pour « Champ modifié » et « Date atteinte »,
   * il dépend du champ choisi (client ou deal).
   */
  const objetRegle = useMemo(
    () => objetDeLaRegle(regle?.trigger_event, (regle?.conditions ?? null) as Record<string, unknown> | null, champsPerso),
    [regle?.trigger_event, regle?.conditions, champsPerso],
  );
  /**
   * Les champs DATE du client ET du pipeline (deal), pour « Date atteinte ».
   * Un champ archivé ne doit plus déclencher d'envoi (`useChampsTous` les
   * écarte déjà). Le nom de l'objet préfixe : « Pipeline · Fermeture prévue ».
   */
  const champsDate = useMemo(
    () => champsPerso
      .filter((c) => c.field_type === 'date' && (c.object_type === 'client' || c.object_type === 'deal'))
      .map((c) => ({ id: c.id, label: `${fr ? LIBELLES_OBJET[c.object_type].fr : LIBELLES_OBJET[c.object_type].en} · ${c.label}` })),
    [champsPerso, fr],
  );
  /**
   * Les étapes des pipelines, pour « Opportunité entre dans une étape ».
   *
   * Chargées seulement si le déclencheur en a besoin : deux appels réseau
   * de plus sur un parcours « facture payée » ne serviraient à rien.
   */
  const [etapesPipeline, setEtapesPipeline] = useState<Array<{ id: string; label: string }>>([]);
  /** L'étape dont le menu « … » est ouvert. */
  const [menuEtape, setMenuEtape] = useState<string | null>(null);
  /** L'aperçu (« Tester ») : ce qui partirait, sur un vrai client. */
  const [apercu, setApercu] = useState<ApercuAutomatisation | null>(null);
  const [apercuEnCours, setApercuEnCours] = useState(false);
  /**
   * Passages par étape (onglet « Statistiques » du panneau), lus par la
   * route agrégée. Ils étaient toujours vides : `stats={null}` en dur.
   */
  const [statsEtapes, setStatsEtapes] = useState<Record<string, StatsEtape> | null>(null);
  const idStats = regle?.id ?? '';
  useEffect(() => {
    if (!idStats) { setStatsEtapes(null); return; }
    let vivant = true;
    chargerStatistiques(idStats)
      .then((s) => { if (vivant) setStatsEtapes(s.par_etape ?? {}); })
      .catch((e: unknown) => console.error('[builder] statistiques par étape', e instanceof Error ? e.message : String(e)));
    return () => { vivant = false; };
  }, [idStats]);

  /**
   * Des départs tout faits — on ne part jamais d'une page blanche.
   * Ce sont les quatre besoins qui reviennent chez une entreprise de services.
   */
  const SUGGESTIONS = [
    { fr: 'Relance de devis', en: 'Quote follow-up',
      promptFr: 'Après l’envoi d’un devis, attends 3 jours puis envoie un texto de suivi si le client n’a pas répondu.',
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
    // « + » sous la carte EN ATTENTE : elle n'est pas dans le parcours, la
    // nouvelle prend donc SA place (s'y accrocher la laisserait orpheline).
    const ancre = etapeEnAttente && apresId === etapeEnAttente.etape.id
      ? { apresId: etapeEnAttente.apresId, branche: etapeEnAttente.branche }
      : { apresId, branche };
    quandPanneauLibre(() => {
      // Le tiroir « Actions » prend la place des réglages du déclencheur :
      // resté ouvert, leur panneau le cachait et « + » ne faisait rien.
      setTiroirDeclencheur(false);
      setReglageDeclencheur(false);
      setAjoutEnCours(ancre);
    });
  };

  /**
   * Insère l'étape choisie dans le tiroir, et l'ouvre pour l'éditer.
   *
   * `cle` est soit un type d'étape (`attendre`, `si`, `arreter`), soit la
   * clé d'une ACTION du catalogue. Choisir directement « Envoyer un texto »
   * évite l'aller-retour « ajouter un message » puis « choisir lequel » —
   * c'est ce que fait leur tiroir, et c'est un clic de moins à chaque étape.
   */
  const confirmerAjout = async (cle: string) => {
    if (!ajoutEnCours) return;
    if (steps.length >= ETAPES_MAX) {
      toast.error(fr
        ? `Un parcours compte au plus ${ETAPES_MAX} étapes. Retirez-en une avant d’ajouter.`
        : `A journey holds at most ${ETAPES_MAX} steps. Remove one before adding.`);
      setAjoutEnCours(null);
      return;
    }
    const id = nouvelIdEtape(steps);
    const estLogique = cle === 'attendre' || cle === 'si' || cle === 'arreter';
    const nouvelle = estLogique
      ? etapeVierge(cle as TypeEtape, id)
      // Une étape neuve naît COMPLÈTE : un courriel sans objet ni corps est
      // refusé par le serveur, donc jamais enregistré — l'étape disparaissait
      // au rechargement (signalé le 2026-09-25). Le texte proposé est un vrai
      // brouillon, envoyable tel quel et réécrit en un clic.
      : { ...etapeVierge('action', id), action: { type: cle, config: configParDefaut(cle, fr) } };
    /*
     * « ARRÊTER ICI » AU MILIEU COUPE LA SUITE (triage éditeur, S-12). Les
     * étapes qui suivaient disparaissaient du canevas sans un mot — et
     * restaient en base, reliées à rien. On le DEMANDE d'abord, en disant
     * combien d'étapes partent ; elles seront vraiment retirées quand
     * l'arrêt sera enregistré.
     */
    if (cle === 'arreter') {
      const perdues = etapesPerdues(steps, insererEtape(steps, nouvelle, ajoutEnCours.apresId, ajoutEnCours.branche));
      if (perdues.length > 0) {
        const n = perdues.length;
        const ok = await confirmer({
          title: fr ? 'Arrêter ici et retirer la suite ?' : 'Stop here and remove what follows?',
          message: fr
            ? `Le parcours s’arrêtera à cet endroit : ${n > 1 ? `les ${n} étapes qui suivent ne seront plus jamais atteintes et seront retirées` : 'l’étape qui suit ne sera plus jamais atteinte et sera retirée'} du parcours.`
            : `The journey will stop at this point: ${n > 1 ? `the ${n} steps after it will never be reached and will be removed` : 'the step after it will never be reached and will be removed'} from the journey.`,
          confirmLabel: fr ? 'Arrêter ici' : 'Stop here',
          danger: true,
        });
        // Refusé : le tiroir reste ouvert, on peut choisir autre chose.
        if (!ok) return;
      }
    }
    // Pas dans `steps` : rien n'est écrit tant que son panneau n'est pas
    // enregistré (voir `etapeEnAttente`).
    montrerEtape(nouvelle.id);
    setEtapeEnAttente({ etape: nouvelle, apresId: ajoutEnCours.apresId, branche: ajoutEnCours.branche });
  };

  /**
   * Ce que le tiroir propose comme étapes : les actions compatibles avec le
   * déclencheur, puis la logique du parcours.
   *
   * Une action incompatible n'est PAS masquée mais grisée avec sa raison :
   * masquer laisserait croire qu'elle n'existe pas.
   */
  const choixEtapes = useMemo<ChoixTiroir[]>(() => {
    const decl = regle?.trigger_event ?? '';
    const actions: ChoixTiroir[] = ACTIONS.map((a) => ({
      cle: a.cle,
      titre: fr ? a.fr : a.en,
      aide: fr ? a.aide_fr : a.aide_en,
      famille: a.famille,
      indisponible: a.indisponible
        ? (fr ? a.indisponible.fr : a.indisponible.en)
        : actionCompatible(a, decl, objetRegle)
        ? undefined
        : (fr
          ? 'Ne va pas avec ce déclencheur'
          : 'Does not work with this trigger'),
    }));
    const logique: ChoixTiroir[] = [
      { cle: 'attendre', famille: 'logique',
        titre: fr ? 'Attendre' : 'Wait',
        aide: fr ? 'Met le parcours en pause avant la suite.' : 'Pauses before the next step.' },
      { cle: 'si', famille: 'logique',
        titre: fr ? 'Condition' : 'Condition',
        aide: fr ? 'Sépare le parcours en deux chemins.' : 'Splits the journey in two.' },
      { cle: 'arreter', famille: 'logique',
        titre: fr ? 'Arrêter ici' : 'Stop here',
        aide: fr ? 'Le client sort du parcours.' : 'The client leaves the journey.' },
    ];
    return [...actions, ...logique];
  }, [regle, fr, objetRegle]);

  /*
   * Les déclencheurs réservés à une capacité en rodage (`drapeau`) ne sont
   * offerts qu'aux entreprises qui l'ont : ailleurs, l'événement n'est
   * jamais émis et l'automatisation ne partirait jamais.
   */
  const { isEnabled: consultationDocumentsActive } = useModuleAccess('auto_consultation_documents');
  const { isEnabled: paiementEchoueActif } = useModuleAccess('auto_paiement_echoue');
  const { isEnabled: clientInactifActif } = useModuleAccess('auto_client_inactif');
  const drapeauxActifs = useMemo(
    () => new Set<string>([
      ...(consultationDocumentsActive ? ['auto_consultation_documents'] : []),
      ...(paiementEchoueActif ? ['auto_paiement_echoue'] : []),
      ...(clientInactifActif ? ['auto_client_inactif'] : []),
    ]),
    [consultationDocumentsActive, paiementEchoueActif, clientInactifActif],
  );

  /** Les déclencheurs offerts, ceux qui ne partent pas encore étant grisés. */
  const choixDeclencheurs = useMemo<ChoixTiroir[]>(
    () => DECLENCHEURS.filter((d) => declencheurOffert(d, drapeauxActifs)).map((d) => ({
      cle: d.cle,
      titre: fr ? d.fr : d.en,
      aide: fr ? d.aide_fr : d.aide_en,
      famille: d.famille,
      indisponible: d.bientot
        ? (fr ? 'Bientôt disponible' : 'Coming soon')
        : undefined,
    })),
    [fr, drapeauxActifs],
  );

  /*
   * LE DERNIER CHOIX GAGNE, ET L'ÉCRAN LE DIT TOUT DE SUITE (audit du
   * 2026-10-01). Chaque choix partait aussitôt en PATCH, en parallèle : cinq
   * choix rapprochés, et c'est la dernière RÉPONSE arrivée qui restait — pas
   * le dernier clic. Pendant ce temps la carte gardait l'ancien déclencheur
   * sous un « Enregistré » : un clic y ouvrait les réglages de l'ancien.
   *
   * Même principe que la file de publication (`fileBascule.ts`) :
   *   · la carte suit le DERNIER choix, tout de suite ;
   *   · un seul enregistrement en vol ; à sa réponse, si le choix a changé
   *     entre-temps, on envoie le nouveau — jamais deux en parallèle ;
   *   · un refus ramène la carte au dernier déclencheur CONFIRMÉ par le
   *     serveur, et le dit.
   */
  const fileDeclencheur = useRef<{
    confirme: ChoixDeclencheur | null;
    voulu: ChoixDeclencheur | null;
    /** Résout à `true` quand la base porte le dernier choix, `false` sur un refus. */
    enVol: Promise<boolean> | null;
  }>({ confirme: null, voulu: null, enVol: null });
  /** Un changement de déclencheur attend la réponse du serveur. */
  const [declencheurEnVol, setDeclencheurEnVol] = useState(false);

  /** Changer le déclencheur de la règle depuis le tiroir. */
  const choisirDeclencheur = useCallback((cle: string) => {
    if (!regle) return;
    setTiroirDeclencheur(false);
    if (cle === regle.trigger_event) return;
    const file = fileDeclencheur.current;
    // Rien en vol : ce que l'écran montre EST ce que la base contient.
    if (!file.enVol) {
      file.confirme = { trigger_event: regle.trigger_event, conditions: (regle.conditions ?? {}) as Record<string, unknown> };
    }
    // Les réglages de l'ANCIEN déclencheur partent avec lui ; ceux du
    // nouveau sont posés d'office (voir `conditionsApresChangement`).
    const voulu: ChoixDeclencheur = {
      trigger_event: cle,
      conditions: conditionsApresChangement(regle.trigger_event, cle, (regle.conditions ?? {}) as Record<string, unknown>),
    };
    file.voulu = voulu;
    setRegle((r) => (r ? { ...r, ...voulu } : r));
    if (file.enVol) return;
    setDeclencheurEnVol(true);
    file.enVol = (async () => {
      try {
        while (file.voulu) {
          const cible = file.voulu;
          const maj = await ecrire(cible);
          file.confirme = { trigger_event: maj.trigger_event, conditions: (maj.conditions ?? {}) as Record<string, unknown> };
          // Un autre choix a été fait pendant l'envoi : il part au tour suivant.
          if (file.voulu === cible) {
            file.voulu = null;
            setRegle(maj);
          }
        }
        return true;
      } catch (e: unknown) {
        const retour = file.confirme;
        file.voulu = null;
        if (retour) setRegle((r) => (r ? { ...r, ...retour } : r));
        // Règle supprimée entre-temps : l'écran « n'existe plus » le dit déjà.
        if (!estIntrouvable(e)) toast.error(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        file.enVol = null;
        setDeclencheurEnVol(false);
      }
    })();
  }, [regle, ecrire]);

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
    const parcoursALEcran = ajoutEnAttente
      ? insererEtape(steps, ajoutEnAttente.etape, ajoutEnAttente.apresId, ajoutEnAttente.branche)
      : steps;
    setGenere(true);
    try {
      /*
       * Envoyer une demande à Lumi est une vraie action : un brouillon jamais
       * enregistré naît ICI (et pas au clic sur « Construire avec Lumi »),
       * pour que la conversation soit gardée avec l'automatisation.
       */
      if (!idReel.current) await ecrire({ name: nom.trim() || regle?.name || (fr ? 'Nouvelle automatisation' : 'New automation') });
      /*
       * On donne à Lumi la CONVERSATION et le parcours à l'écran.
       *
       * Avant, il ne recevait que la dernière phrase : « change le
       * délai à 7 jours » reconstruisait tout — déclencheur changé,
       * deux SMS devenus un, nom renommé. Et « non, le deuxième c'est
       * 2 jours » ne produisait RIEN, sans un mot. QA du 2026-09-25.
       */
      const propose = await genererParcoursAvecLumi(demande, fr ? 'fr' : 'en', {
        // 6 derniers tours seulement : c'est ce que la route accepte, et
        // l'historique complet gonflerait le prompt sans rien apporter.
        echanges: echangesLumi.slice(-6),
        ruleId: idReel.current,
        // « Le parcours à l'écran » compte l'étape en cours d'ajout : c'est
        // d'elle que parle « change le message » juste après l'avoir choisie.
        parcoursActuel: parcoursALEcran.length > 0
          ? { trigger_event: regle?.trigger_event, steps: parcoursALEcran }
          : null,
      });
      // Garder la conversation a touché la règle : sa version est celle-ci.
      noterVersion(idReel.current, propose.updated_at);
      /*
       * EN LIGNE : ON DEMANDE AVANT D'APPLIQUER (triage éditeur, S-03). Sur une
       * automatisation PUBLIÉE, la proposition entrait dans le parcours comme
       * sur un brouillon, et l'enregistrement automatique la mettait en ligne
       * trois secondes plus tard, sans aucune question — sous un message qui
       * disait « en pause, à publier quand tu es prêt ».
       *
       * La proposition est montrée ; elle n'entre dans le parcours qu'après un
       * oui explicite. Sur un brouillon, rien ne change : rien ne part.
       */
      const enLigne = !!regle && !!idReel.current && fileBascule.etatAffiche(idReel.current, regle.is_active);
      if (enLigne) {
        const applique = await confirmer({
          title: fr ? 'Appliquer les changements de Lumi ?' : 'Apply Lumi’s changes?',
          message: [
            fr
              ? 'Cette automatisation est en ligne : appliquer les changements de Lumi ?'
              : 'This automation is live: apply Lumi’s changes?',
            ...(propose.resume ? [propose.resume] : []),
            fr
              ? 'Ils s’appliqueront dès le prochain déclenchement. Sans votre accord, le parcours en ligne ne change pas.'
              : 'They take effect at the next trigger. Without your approval, the live journey does not change.',
          ].join('\n\n'),
          confirmLabel: fr ? 'Appliquer' : 'Apply',
        });
        if (!applique) {
          setEchangesLumi((e) => [
            ...e,
            { role: 'user' as const, content: demande },
            {
              role: 'assistant' as const,
              content: `${propose.resume || (fr ? 'Parcours proposé.' : 'Path proposed.')}\n\n${fr
                ? '— Non appliqué : le parcours en ligne est inchangé.'
                : '— Not applied: the live journey is unchanged.'}`,
            },
          ]);
          setPrompt('');
          toast.info(fr
            ? 'Changements de Lumi non appliqués : le parcours en ligne est inchangé.'
            : 'Lumi’s changes were not applied: the live journey is unchanged.');
          return;
        }
      }
      // Le panneau d'étape resté ouvert saura QUI vient de changer son étape.
      setModifieePar('lumi');
      memoriser(propose.steps as Etape[]);
      setResumeLumi(propose.resume || null);
      // Le nom et le déclencheur suivent la proposition — c'est ce que
      // l'utilisateur a décrit, il pourra les changer.
      if (propose.nom) setNom(propose.nom);
      if (propose.trigger_event && regle) {
        // Mise à jour FONCTIONNELLE : `regle` ici date d'avant la création
        // du brouillon, et l'écraser remettrait un id vide.
        const declencheurEnBase = regle.trigger_event;
        setRegle((r) => (r ? { ...r, trigger_event: propose.trigger_event } : r));
        /*
         * L'échec était AVALÉ (`.catch(() => {})`, audit 2026-09-28) :
         * l'écran montrait le déclencheur de Lumi, la base gardait l'ancien.
         * On le dit, et l'écran revient à ce que la base contient.
         */
        // Un déclencheur CHANGÉ par Lumi emporte les réglages de l'ancien, comme au tiroir.
        const conditionsLumi = propose.trigger_event !== declencheurEnBase
          ? conditionsApresChangement(declencheurEnBase, propose.trigger_event, (regle.conditions ?? {}) as Record<string, unknown>)
          : null;
        if (conditionsLumi) setRegle((r) => (r ? { ...r, conditions: conditionsLumi } : r));
        ecrire({ trigger_event: propose.trigger_event, ...(conditionsLumi ? { conditions: conditionsLumi } : {}) }).catch((e: unknown) => {
          console.error('[builder] déclencheur proposé par Lumi non enregistré', e);
          captureClientException(e, { where: 'AutomationBuilderPage.construireAvecLumi' });
          setRegle((r) => (r ? { ...r, trigger_event: declencheurEnBase } : r));
          toast.error(fr
            ? `Le déclencheur proposé par Lumi n’a pas pu être enregistré : ${e instanceof Error ? e.message : String(e)}`
            : `Lumi’s trigger could not be saved: ${e instanceof Error ? e.message : String(e)}`);
        });
      }
      // La conversation se poursuit : le tour suivant saura ce qui
      // vient d'être demandé et ce que Lumi a répondu.
      /*
       * Une DEUXIÈME automatisation, sur un autre déclencheur (« quand le
       * client répond, envoie mon lien Calendly »). Un parcours n'a qu'un
       * déclencheur : elle est créée à part, EN BROUILLON, comme toute
       * règle née d'une conversation — rien ne part avant publication.
       */
      let noteAutre = '';
      if (propose.autre) {
        try {
          const premiere = (propose.autre.steps as Etape[]).find((e) => e.type === 'action');
          const contenu = {
            name: propose.autre.nom,
            trigger_event: propose.autre.trigger_event,
            delay_seconds: 0,
            // Reflet de la première action : le serveur exige au moins une
            // action ; le moteur, lui, suit les étapes.
            actions: premiere && premiere.type === 'action' ? [premiere.action as never] : [],
            steps: propose.autre.steps,
            settings: propose.autre.une_fois_par_client_jours
              ? { delai_entre_passages_jours: propose.autre.une_fois_par_client_jours }
              : null,
          };
          const dejaLa = autreCreee.current?.trigger_event === propose.autre.trigger_event ? autreCreee.current : null;
          const creee = dejaLa
            ? await modifierAutomatisation(dejaLa.id, contenu)
            : await creerAutomatisation({ ...contenu, is_active: false });
          autreCreee.current = { id: creee.id, trigger_event: propose.autre.trigger_event };
          noteAutre = fr
            ? ` — ${dejaLa ? 'J’ai mis à jour' : 'Et j’ai créé'} une 2e automatisation, « ${propose.autre.nom} » (en brouillon) : ${propose.autre.resume}`
            : ` — ${dejaLa ? 'I updated' : 'And I created'} a second automation, “${propose.autre.nom}” (draft): ${propose.autre.resume}`;
          toast.success(fr
            ? `« ${propose.autre.nom} » ${dejaLa ? 'mise à jour' : 'créée en brouillon'}`
            : `“${propose.autre.nom}” ${dejaLa ? 'updated' : 'created as a draft'}`, {
            action: { label: fr ? 'Ouvrir' : 'Open', onClick: () => navigate(`/automations/${creee.id}`) },
            duration: 10_000,
          });
        } catch (e: unknown) {
          console.error('[builder] 2e automatisation non créée', e instanceof Error ? e.message : String(e));
          toast.error(fr ? 'La 2e automatisation n’a pas pu être créée.' : 'The second automation could not be created.');
        }
      }
      setEchangesLumi((e) => [
        ...e,
        { role: 'user' as const, content: demande },
        { role: 'assistant' as const, content: (propose.resume || (fr ? 'Parcours construit.' : 'Path built.')) + noteAutre },
      ]);
      setPrompt('');
      /*
       * On DIT que rien ne part encore.
       *
       * Lumi construisait sans jamais l'annoncer : seul l'état
       * « Brouillon » dans un coin de l'écran le montrait. Quelqu'un qui
       * vient de décrire une relance croit qu'elle tourne — QA du
       * 2026-09-25 (P2-4).
       *
       * C'est dit ICI plutôt que demandé au modèle : une consigne de
       * plus coûte des tokens à chaque appel et peut être oubliée. Le
       * code, lui, le dit toujours.
       */
      /*
       * Plus de coût affiché (P2-10) : construire une automatisation est
       * OFFERT depuis le 2026-09-28, hors budget Lumi — le champ le dit.
       */
      // … sauf sur une automatisation EN LIGNE, où « en pause » serait faux.
      toast.success(enLigne
        ? (fr
          ? 'Changements de Lumi appliqués — l’automatisation est en ligne : ils valent dès le prochain déclenchement.'
          : 'Lumi’s changes applied — the automation is live: they take effect at the next trigger.')
        : (fr
          ? 'Lumi a construit le parcours — en pause, à publier quand tu es prêt.'
          : 'Lumi built the path — paused, publish it when you are ready.'));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
      /*
       * Rien n'a été construit : le serveur a retiré le brouillon VIDE né de
       * cet envoi (il restait en base, « Nouvelle automatisation » sans
       * étape — audit V2, L-7). L'éditeur redevient un brouillon local ; la
       * prochaine sauvegarde le recrée. Aucune suppression ici : elle vit
       * dans la liste, jamais à côté de « Publier ».
       */
      if ((e as { brouillonRetire?: boolean } | null)?.brouillonRetire) {
        idReel.current = null;
        creationEnVol.current = null;
        setRegle((r) => (r ? { ...r, id: '' } : r));
        passageALaRegleCreee.current = true;
        navigate('/automations/nouvelle?lumi=1', { replace: true });
      }
    } finally {
      setGenere(false);
    }
  };

  // ── Chargement ──
  /*
   * Échec de chargement ≠ automatisation introuvable (launch 2026-09-28) :
   * après les 3 essais, l'écran disait « introuvable » — on croyait
   * l'automatisation supprimée. Un échec dit « Impossible de charger » et
   * propose « Réessayer ».
   */
  const [echecChargement, setEchecChargement] = useState(false);
  const [essaiChargement, setEssaiChargement] = useState(0);
  useEffect(() => {
    // `/nouvelle` vient d'être remplacé par l'id du brouillon créé : l'écran
    // EST déjà la règle — relire la base écraserait ce qu'on tape.
    if (passageALaRegleCreee.current) { passageALaRegleCreee.current = false; return; }
    /*
     * UNE AUTRE RÈGLE OUVERTE DANS LE MÊME ÉDITEUR (lien « Ouvrir » d'un toast).
     *
     * Triage éditeur, S-01 — une corruption de données : dès ce moment les
     * écritures visaient la NOUVELLE règle, alors que l'écran portait encore
     * le nom et le parcours de l'ancienne tant que la nouvelle chargeait. Sur
     * un réseau lent, l'enregistrement automatique (3 s) partait donc dans la
     * 2e automatisation avec le contenu de la 1re.
     *
     *   1. ce qui attendait d'être enregistré part dans SA règle, nommée ;
     *   2. l'écran quitte l'ancienne règle tout de suite (« Chargement… ») :
     *      plus rien d'elle ne reste en mémoire pour être écrit ailleurs.
     * (`ecrire` refuse en plus toute écriture dont l'état n'est pas celui de
     * la règle visée.)
     */
    const precedente = idReel.current;
    const suivante = estNouvelle ? null : (id ?? null);
    if (precedente && precedente !== suivante) {
      const d = etatAuDepart.current;
      if (d.aRegle && d.etat === 'incomplet') {
        toast.error(d.fr
          ? 'Automatisation quittée sans enregistrer : une étape était incomplète.'
          : 'Automation left without saving: a step was incomplete.');
      } else if (d.aRegle && d.incompletes === 0 && (d.etat === 'modifie' || d.etat === 'en_cours' || d.etat === 'refuse')) {
        ecrireRegle(precedente, { name: d.nom, ...d.contenu(d.steps) }).catch((e: unknown) => {
          console.error('[automatisations] enregistrement au changement d’automatisation impossible', e);
          captureClientException(e, { where: 'AutomationBuilderPage.changementDeRegle' });
          toast.error(d.fr
            ? `Les dernières modifications de l’automatisation précédente n’ont pas pu être enregistrées : ${e instanceof Error ? e.message : String(e)}`
            : `The previous automation’s latest changes could not be saved: ${e instanceof Error ? e.message : String(e)}`);
        });
      }
      setChargement(true);
      setRegle(null);
      setNom('');
      setSteps([]);
      setHistorique([]);
      setPosition(-1);
      setEtatSauvegarde('a_jour');
      echecsSauvegarde.current = 0;
      setEtapeChoisie(null);
      setEtapeEnAttente(null);
      setAjoutEnCours(null);
      setTiroirDeclencheur(false);
      setReglageDeclencheur(false);
      setMenuEtape(null);
      setApercu(null);
      setResumeLumi(null);
      setModifieeAilleurs(false);
      setRefus(null);
      autreCreee.current = null;
    }
    idReel.current = suivante;
    creationEnVol.current = null;
    setDisparue(false);
    // La langue au moment du chargement, lue par ref : changer de langue en
    // cours d'édition ne doit PAS relancer ce chargement — il remplaçait les
    // étapes non enregistrées par la version du serveur (audit 2026-09-28).
    const frChargement = frBascule.current;
    let vivant = true;
    /*
     * Un échec passager (serveur occupé, 429, réseau) ne doit pas laisser
     * l'éditeur vide : on réessaie deux fois (1,5 s puis 3 s) avant de le
     * dire. Signalé le 2026-09-28 : « y en a qui s'ouvrent pas ».
     */
    // PERF-2 : SA règle par id, jamais toutes les règles de l'entreprise.
    const chargerAvecReprise = async (essai = 1): Promise<Awaited<ReturnType<typeof chargerEditeur>>> => {
      try {
        return await chargerEditeur(estNouvelle ? null : (id ?? null));
      } catch (e) {
        if (essai >= 3 || !vivant) throw e;
        await new Promise((r) => setTimeout(r, 1500 * essai));
        return chargerAvecReprise(essai + 1);
      }
    };
    chargerAvecReprise()
      .then((d) => {
        if (!vivant) return;
        setCatalogue(d.catalogue);
        // `/nouvelle` : un brouillon LOCAL, rien en base (voir `ecrire`).
        const trouvee = estNouvelle
          ? {
            id: '', org_id: '', name: frChargement ? 'Nouvelle automatisation' : 'New automation', description: null,
            trigger_event: 'quote.sent', conditions: {}, delay_seconds: 0,
            actions: [{ type: 'send_sms', config: { body: TEXTES_ACTION_PROVISOIRE[frChargement ? 0 : 1] } }],
            steps: [], settings: null, is_active: false, is_preset: false, preset_key: null,
            created_at: '', updated_at: '', lumi_conversation: [],
          } satisfies AutomationRule
          : d.rule;
        setRegle(trouvee);
        // La version LUE : chaque enregistrement la renvoie au serveur (garde A-09).
        if (!estNouvelle) noterVersion(trouvee?.id, trouvee?.updated_at);
        // Un panneau d'étape resté ouvert pendant un RECHARGEMENT : ce qui change sous lui vient d'ailleurs.
        setModifieePar('autre');
        /*
         * Le nom des préréglages est stocké en ANGLAIS en base
         * (« Appointment Confirmation ») — 275 des 500 règles actives en
         * portent un. La liste le traduisait déjà à l'affichage ; pas
         * l'éditeur, faute d'accès à la table.
         *
         * On cliquait donc sur « Confirmation de rendez-vous » pour
         * atterrir sur « Appointment Confirmation ». Le champ étant
         * modifiable, ce qui est affiché est aussi ce qui sera
         * enregistré : un préréglage renommé par son propriétaire garde
         * son nom à lui, puisque la table ne connaît que les libellés
         * d'origine.
         */
        setNom(localizeAutomationName(trouvee?.name ?? '', frChargement ? 'fr' : 'en'));
        const etapes = (trouvee?.steps as Etape[] | undefined) ?? [];
        // Le fil avec Lumi est gardé avec l'automatisation : il survit à la
        // fermeture de l'éditeur, et Lumi s'en souvient.
        setEchangesLumi(Array.isArray(trouvee?.lumi_conversation) ? trouvee.lumi_conversation : []);
        setSteps(etapes);
        setHistorique([etapes]);
        setPosition(0);
        // Rien n'a encore touché le parcours : ses `actions` restent celles de la base.
        parcoursTouche.current = false;
        actionsDOrigine.current = trouvee && estFormatOrigine({ steps: etapes, actions: trouvee.actions }) ? trouvee.actions : null;
        setAutresAutomatisations(d.autres.filter((r) => r.id !== id).map((r) => ({ id: r.id, nom: r.name })));
      })
      .catch((e: unknown) => {
        console.error('[builder] chargement échoué', e instanceof Error ? e.message : String(e));
        if (vivant) setEchecChargement(true);
      })
      .finally(() => { if (vivant) setChargement(false); });

    // Les listes du panneau. Un echec ici ne doit PAS empecher d'ouvrir
    // l'editeur : sans membres, le menu « assigner a » sera juste vide.
    chargerMembres()
      .then((m) => { if (vivant) setMembres(m); })
      .catch((e: unknown) => console.error('[builder] membres', e instanceof Error ? e.message : String(e)));
    chargerEtiquettes()
      .then((t) => { if (vivant) setEtiquettes(t); })
      .catch((e: unknown) => console.error('[builder] etiquettes', e instanceof Error ? e.message : String(e)));

    return () => { vivant = false; };
  }, [id, essaiChargement]);

  /**
   * RECHARGER la version en base (constat A-09) : après un refus « modifiée
   * ailleurs », ou en silence quand la fenêtre reprend le focus et que rien
   * n'attend d'être enregistré. Ce que l'éditeur avait en mémoire est remplacé.
   */
  const recharger = useCallback(() => {
    setModifieeAilleurs(false);
    setRefus(null);
    setEtapeEnAttente(null);
    echecsSauvegarde.current = 0;
    setEtatSauvegarde('a_jour');
    setEssaiChargement((n) => n + 1);
  }, []);

  /*
   * LA PAUSE GLOBALE DU BUREAU (« Tout arrêter », posée depuis la liste) —
   * triage éditeur, S-32. L'éditeur d'une automatisation publiée affichait
   * « Publiée », en vert, sans un mot : rien ne disait qu'elle n'envoyait plus
   * rien. La liste, elle, l'affiche. Lue à l'ouverture, et relue quand la
   * fenêtre reprend le focus (on a pu la lever dans un autre onglet).
   */
  const [bureauEnPause, setBureauEnPause] = useState(false);
  useEffect(() => {
    let vivant = true;
    const lire = () => {
      if (document.visibilityState === 'hidden') return;
      lireEtatPause()
        .then((e) => { if (vivant) setBureauEnPause(e?.paused === true); })
        .catch((e: unknown) => console.error('[builder] état de la pause illisible', e instanceof Error ? e.message : String(e)));
    };
    lire();
    window.addEventListener('focus', lire);
    return () => { vivant = false; window.removeEventListener('focus', lire); };
  }, []);

  /*
   * LA FENÊTRE REPREND LE FOCUS : une lecture légère de la version. Si la
   * règle a changé en base (Lumi dans le clavardage général, un autre onglet)
   * et que l'éditeur n'a RIEN de non enregistré, il la recharge sans rien
   * demander — on revient sur l'onglet, on voit ce qui est vrai. S'il a une
   * saisie en cours, il ne touche à rien : c'est son prochain enregistrement
   * qui sera refusé (409) et qui le dira.
   */
  const rienANePasPerdre = useRef(false);
  rienANePasPerdre.current = etatSauvegarde === 'a_jour' && !declencheurEnVol && !genere && !chargement
    && !disparue && !modifieeAilleurs && !etapeEnAttente && !!regle?.id && !regle.deleted_at;
  useEffect(() => {
    let vivant = true;
    const auRetour = () => {
      if (document.visibilityState === 'hidden') return;
      const idRegle = idReel.current;
      const propre = () => rienANePasPerdre.current && !brouillonEtapeModifie.current && !brouillonDeclencheurModifie.current;
      if (!idRegle || !versionLue(idRegle) || !propre()) return;
      lireVersionAutomatisation(idRegle)
        .then((version) => {
          // Relu APRÈS la lecture : une saisie commencée entre-temps n'est pas écrasée.
          if (!vivant || !version || version === versionLue(idRegle) || idRegle !== idReel.current || !propre()) return;
          recharger();
        })
        .catch((e: unknown) => console.error('[builder] version de l’automatisation illisible', e instanceof Error ? e.message : String(e)));
    };
    window.addEventListener('focus', auRetour);
    document.addEventListener('visibilitychange', auRetour);
    return () => {
      vivant = false;
      window.removeEventListener('focus', auRetour);
      document.removeEventListener('visibilitychange', auRetour);
    };
  }, [recharger]);

  /*
   * « Construire avec Lumi » ouvre l'éditeur avec `?lumi=1` : le curseur
   * va DANS le champ de Lumi. Avant, le paramètre n'était lu nulle part et
   * ce départ était identique à « Partir de zéro ».
   */
  const veutLumi = parametres.get('lumi') === '1';
  useEffect(() => {
    if (chargement || !veutLumi) return;
    setLumiReduit(false);
    const t = window.setTimeout(() => champLumi.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [chargement, veutLumi]);

  /** Dès le premier message, le fil s'ouvre en panneau à gauche. */
  const lumiLateral = lumiDisponible && (echangesLumi.length > 0 || genere);

  /*
   * `actions` SUIT LE PARCOURS (triage éditeur, 05b:303 ; constat A-02).
   *
   * La règle porte deux copies de ses messages : `steps` et `actions`.
   * L'éditeur n'écrivait que `steps` : un parcours CONVERTI gardait dans
   * `actions` son ancien message, et dès qu'on supprimait sa dernière étape la
   * règle retombait au « format d'origine » — l'étape supprimée revenait, en
   * lecture seule, et continuait de partir.
   *
   * Dès que le parcours est touché ici, `actions` en devient le reflet
   * (`actionsDuParcours`), à l'écran ET dans chaque enregistrement. Une règle
   * qu'on n'a pas touchée garde ses `actions` (la renommer ne les réécrit pas).
   */
  const parcoursTouche = useRef(false);
  /**
   * Les `actions` d'une règle CHARGÉE au format d'origine : « annuler »
   * jusqu'au point de départ doit la rendre telle qu'elle était, pas vide.
   * Oubliées à la conversion — après elle, un parcours vide est un parcours vide.
   */
  const actionsDOrigine = useRef<AutomationRule['actions'] | null>(null);
  const refletActions = useCallback((etapes: Etape[]): AutomationRule['actions'] => (
    etapes.length === 0 && actionsDOrigine.current
      ? actionsDOrigine.current
      : actionsDuParcours(etapes, frBascule.current) as AutomationRule['actions']
  ), []);
  /** Ce qu'un enregistrement du parcours envoie : les étapes, et leur reflet dès que le parcours a été touché. */
  const contenuParcours = useCallback((etapes: Etape[]): Pick<BrouillonAutomatisation, 'steps' | 'actions'> | Pick<BrouillonAutomatisation, 'steps'> => (
    parcoursTouche.current
      ? { steps: etapes, actions: refletActions(etapes) as BrouillonAutomatisation['actions'] }
      : { steps: etapes }
  ), [refletActions]);
  /** Le parcours vient de changer ICI : l'écran porte aussitôt des `actions` en accord. */
  const accorderActions = useCallback((etapes: Etape[]) => {
    parcoursTouche.current = true;
    setRegle((r) => (r ? { ...r, actions: refletActions(etapes) } : r));
  }, [refletActions]);

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
    accorderActions(nouvelles);
    setEtatSauvegarde('modifie');
  }, [position, accorderActions]);

  const annuler = () => {
    if (position <= 0) return;
    setModifieePar('autre');
    setPosition((p) => p - 1);
    setSteps(historique[position - 1]);
    accorderActions(historique[position - 1]);
    setEtatSauvegarde('modifie');
  };

  const refaire = () => {
    if (position >= historique.length - 1) return;
    setModifieePar('autre');
    setPosition((p) => p + 1);
    setSteps(historique[position + 1]);
    accorderActions(historique[position + 1]);
    setEtatSauvegarde('modifie');
  };

  /*
   * Ctrl+Z / Ctrl+Y (Cmd+Z / Cmd+Maj+Z sur Mac) — les deux flèches de la
   * barre, au clavier (audit du 2026-10-01 : Ctrl+Z ne faisait rien, la carte
   * supprimée par erreur ne revenait pas).
   *
   * JAMAIS quand le focus est dans un champ de saisie : là, Ctrl+Z est celui
   * du navigateur, qui annule la frappe. Ni hors de l'onglet Parcours (on
   * défaisait un canevas qu'on ne voit pas), ni sous une boîte de dialogue.
   */
  const canevasAffiche = onglet === 'parcours' && !chargement && !!regle && !regle.deleted_at && !disparue;
  const raccourcisCanevas = useRef({ annuler, refaire, actifs: canevasAffiche });
  raccourcisCanevas.current = { annuler, refaire, actifs: canevasAffiche };
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented) return;
      const touche = e.key.toLowerCase();
      const veutAnnuler = touche === 'z' && !e.shiftKey;
      const veutRefaire = (touche === 'z' && e.shiftKey) || (touche === 'y' && e.ctrlKey && !e.shiftKey);
      if (!veutAnnuler && !veutRefaire) return;
      const cible = e.target instanceof Element ? e.target : null;
      if (cible?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
      if (!raccourcisCanevas.current.actifs || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      if (veutAnnuler) raccourcisCanevas.current.annuler();
      else raccourcisCanevas.current.refaire();
    };
    document.addEventListener('keydown', surTouche);
    return () => document.removeEventListener('keydown', surTouche);
  }, []);

  // ── Le panneau d'edition ──
  // Ouvrir une carte, la modifier, l'enregistrer ou la supprimer. C'etait
  // le trou du builder : cliquer une carte la selectionnait et n'ouvrait
  // rien — on voyait son parcours sans jamais pouvoir le modifier.
  /*
   * L'ajout en attente ne vaut que tant que le parcours autour de lui n'a pas
   * bougé (annuler / refaire, proposition de Lumi) : son point d'accroche doit
   * exister encore, et son identifiant rester libre.
   */
  const ajoutEnAttente = useMemo(() => {
    if (!etapeEnAttente) return null;
    const { etape, apresId } = etapeEnAttente;
    if (steps.some((e) => e.id === etape.id)) return null;
    if (apresId !== null && !steps.some((e) => e.id === apresId)) return null;
    return etapeEnAttente;
  }, [etapeEnAttente, steps]);
  useEffect(() => {
    if (etapeEnAttente && !ajoutEnAttente) setEtapeEnAttente(null);
  }, [etapeEnAttente, ajoutEnAttente]);

  const etapeOuverte = useMemo(
    () => (ajoutEnAttente && ajoutEnAttente.etape.id === etapeChoisie
      ? ajoutEnAttente.etape
      : steps.find((e) => e.id === etapeChoisie) ?? null),
    [steps, etapeChoisie, ajoutEnAttente],
  );

  const enregistrerEtape = useCallback((modifiee: Etape) => {
    if (ajoutEnAttente && ajoutEnAttente.etape.id === modifiee.id) {
      // « Enregistrer » dans le panneau d'une étape neuve : c'est MAINTENANT
      // qu'elle entre dans le parcours (et que l'enregistrement auto la verra).
      // … et ce qu'elle coupe du parcours (un « Arrêter ici » au milieu,
      // déjà annoncé au choix) en sort avec : rien ne reste orphelin en base.
      const inseree = insererEtape(steps, modifiee, ajoutEnAttente.apresId, ajoutEnAttente.branche);
      memoriser(sansEtapes(inseree, etapesPerdues(steps, inseree)));
      setEtapeEnAttente(null);
    } else {
      memoriser(steps.map((e) => (e.id === modifiee.id ? modifiee : e)));
    }
    setEtapeChoisie(null);
  }, [steps, memoriser, ajoutEnAttente]);

  /**
   * Dupliquer une étape — le « Copier l'action » de leur menu.
   *
   * La copie s'insère JUSTE APRÈS l'originale et reprend sa configuration.
   * C'est le geste qui sert vraiment : trois relances qui ne diffèrent que
   * par leur texte se font en dupliquant, pas en recommençant.
   */
  const dupliquerEtape = useCallback((idEtape: string) => {
    const source = steps.find((e) => e.id === idEtape);
    if (!source || source.type !== 'action') return;
    const copie: Etape = {
      ...source,
      id: nouvelIdEtape(steps),
      // Le nom porte « (copie) » : deux cartes au même nom seraient
      // impossibles à distinguer sur le canevas.
      // Suffixe dans la langue de l'interface (audit V2, A-16).
      nom: source.nom ? `${source.nom} ${fr ? '(copie)' : '(copy)'}` : null,
      action: { ...source.action, config: { ...source.action.config } },
      suivant: null,
    };
    if (steps.length >= ETAPES_MAX) {
      toast.error(fr
        ? `Un parcours compte au plus ${ETAPES_MAX} étapes. Retirez-en une avant de dupliquer.`
        : `A journey holds at most ${ETAPES_MAX} steps. Remove one before duplicating.`);
      setMenuEtape(null);
      return;
    }
    memoriser(insererEtape(steps, copie, idEtape));
    setMenuEtape(null);
    montrerEtape(copie.id);
  }, [steps, memoriser, fr, montrerEtape]);

  /**
   * Supprimer cette étape ET tout ce qui la suit.
   *
   * Le « Supprimer toutes les actions à partir d'ici » de leur menu. On
   * marche le fil à partir de l'étape, sans jamais repasser deux fois —
   * un graphe mal formé ne doit pas faire boucler la suppression.
   */
  const supprimerDepuis = useCallback(async (idEtape: string) => {
    // L'étape en cours d'ajout n'a rien après elle qui soit à elle : l'abandonner suffit.
    if (ajoutEnAttente?.etape.id === idEtape) {
      setEtapeEnAttente(null);
      setMenuEtape(null);
      setEtapeChoisie(null);
      return;
    }
    const aRetirer = new Set<string>();
    const file = [idEtape];
    while (file.length) {
      const id = file.shift()!;
      if (aRetirer.has(id)) continue;
      aRetirer.add(id);
      const e = steps.find((x) => x.id === id);
      if (!e) continue;
      if (e.type === 'si') {
        if (e.alors) file.push(e.alors);
        if (e.sinon) file.push(e.sinon);
      } else if (e.type !== 'arreter' && e.suivant) {
        file.push(e.suivant);
      }
    }
    const ok = await confirmer({
      title: fr ? `Supprimer ${aRetirer.size} étape(s) ?` : `Delete ${aRetirer.size} step(s)?`,
      message: fr
        ? 'Cette étape et tout ce qui la suit seront retirés du parcours.'
        : 'This step and everything after it will be removed.',
      confirmLabel: fr ? 'Supprimer' : 'Delete',
      danger: true,
    });
    if (!ok) return;
    let restant = steps;
    for (const id of aRetirer) restant = retirerEtape(restant, id);
    memoriser(restant);
    setMenuEtape(null);
    setEtapeChoisie(null);
  }, [steps, memoriser, fr, ajoutEnAttente]);

  const supprimerEtape = useCallback(async (idEtape: string) => {
    // L'étape en cours d'ajout n'est pas dans le parcours : rien à recoudre.
    if (ajoutEnAttente?.etape.id === idEtape) {
      setEtapeEnAttente(null);
      setEtapeChoisie(null);
      return;
    }
    // Ce qui ne se rebranche pas est DIT, et retiré (S-12) : supprimer une
    // condition ne rebranche que sa branche « si oui ».
    const recousu = retirerEtape(steps, idEtape);
    const perdues = etapesPerdues(steps, recousu);
    const n = perdues.length;
    const cible = steps.find((e) => e.id === idEtape);
    const ok = await confirmer({
      danger: true,
      title: fr ? 'Supprimer cette étape ?' : 'Delete this step?',
      message: n === 0
        ? (fr
          ? 'Ce qui venait après reste dans le parcours et se rebranche tout seul.'
          : 'What came after stays in the journey and reconnects on its own.')
        : cible?.type === 'si'
          ? (fr
            ? `La branche « si oui » reste dans le parcours et se rebranche. La branche « si non » (${n} étape${n > 1 ? 's' : ''}) sera retirée avec la condition.`
            : `The “if yes” branch stays in the journey and reconnects. The “if no” branch (${n} step${n > 1 ? 's' : ''}) will be removed with the condition.`)
          : (fr
            ? `La suite reste dans le parcours et se rebranche. ${n > 1 ? `${n} étapes que plus rien n’atteindrait seront retirées` : 'Une étape que plus rien n’atteindrait sera retirée'} avec elle.`
            : `What follows stays in the journey and reconnects. ${n > 1 ? `${n} steps that nothing would reach will be removed` : 'One step that nothing would reach will be removed'} with it.`),
      confirmLabel: fr ? 'Supprimer' : 'Delete',
    });
    if (!ok) return;
    memoriser(sansEtapes(recousu, perdues));
    setEtapeChoisie(null);
  }, [steps, memoriser, fr, ajoutEnAttente]);

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
  /**
   * Les problèmes du parcours, calculés EN CONTINU — pas seulement au clic
   * sur « Publier ».
   *
   * Signalé le 2026-09-25 : « quand l'action ne concorde pas, je veux que le
   * système le signale automatiquement, pour qu'on ne bâtisse pas des
   * parcours qui ne marchent pas ». Découvrir à la publication qu'une action
   * ne va pas avec son déclencheur, c'est le découvrir après avoir tout monté.
   */
  const problemesVivants = useMemo(
    // Le module PARTAGÉ avec la route serveur de publication (M8) : ce que
    // l'éditeur annonce est exactement ce que le serveur refusera.
    () => problemesPublication({
      trigger_event: regle?.trigger_event,
      steps,
      actions: regle?.actions,
      conditions: (regle?.conditions ?? null) as Record<string, unknown> | null,
      is_preset: regle?.is_preset,
      fr,
      // L'entité que fixe le champ surveillé (« Date atteinte » sur un champ
      // du pipeline = une opportunité) : la même que pour le tiroir et le panneau.
      entite: objetRegle,
    }),
    [regle?.trigger_event, regle?.actions, regle?.conditions, regle?.is_preset, steps, fr, objetRegle],
  );
  /** Les étapes fautives, pour les signaler SUR le canevas (§6.5). */
  const etapesEnErreur = useMemo(
    // … et celles que le serveur vient de refuser d'enregistrer.
    () => new Set([
      ...problemesVivants.filter((p) => p.gravite === 'bloquant' && p.etapeId).map((p) => p.etapeId as string),
      ...(refus?.etapes ?? []),
    ]),
    [problemesVivants, refus],
  );
  const bloquantsVivants = useMemo(
    () => problemesVivants.filter((p) => p.gravite === 'bloquant'),
    [problemesVivants],
  );

  const etapesIncompletes = useMemo(
    () => steps.filter((e) => {
      if (e.type !== 'action') return false;
      const modele = trouverAction(e.action?.type ?? '');
      // Une action hors catalogue : le serveur la refusera de toute facon,
      // on la compte comme incomplete plutot que de tenter l'enregistrement
      // en boucle.
      if (!modele) return true;
      const config = (e.action?.config ?? {}) as Record<string, string | undefined>;
      // Chaque action a SES champs obligatoires : `webhook` exige une
      // adresse, pas un corps de message. Lire `body`/`title` en dur laissait
      // passer une action vide vers un serveur qui la refuse, et
      // l'enregistrement echouait en boucle sans que rien ne l'explique.
      return modele.champs.some(
        (c) => c.obligatoire && champVisible(c, config) && !config[c.cle]?.trim(),
      );
    }).length,
    [steps],
  );

  /**
   * L'enregistrement automatique — 3 secondes après la FIN de la frappe.
   *
   * À 1 seconde, taper une phrase déclenchait un appel par mot : le serveur
   * répondait « Too many requests. Please try again later. », en anglais et
   * brut, sur l'écran de quelqu'un qui écrivait simplement son message
   * (P1-9 de l'audit). Will a tranché : on garde l'enregistrement auto —
   * il fait partie de la promesse — mais on respire, on réessaie, et
   * l'utilisateur ne voit jamais l'erreur technique.
   */
  /*
   * Échecs d'affilée de l'enregistrement automatique (audit V2, A-12).
   *
   * Un échec repassait l'état à « modifié », ce qui relançait l'effet — donc
   * un essai toutes les 3 s, sans fin — et le `toast.error` n'était jamais
   * atteint : le nettoyage de l'effet (relancé par `en_cours`) avait déjà
   * posé `annule`. On DIT l'échec, et on espace les reprises (3, 6, 12, 24,
   * puis 48 s au plus) jusqu'au retour du serveur.
   */
  const echecsSauvegarde = useRef(0);
  /** L'état d'enregistrement du dernier rendu, lu par une reprise en cours (voir plus bas). */
  const etatSauvegardeCourant = useRef(etatSauvegarde);
  etatSauvegardeCourant.current = etatSauvegarde;
  /** « Réessayer » (bouton du message d'échec) : le prochain essai part tout de suite. */
  const essaiSansDelai = useRef(false);
  const [essaiDemande, setEssaiDemande] = useState(0);
  const reessayerEnregistrement = useCallback(() => {
    echecsSauvegarde.current = 0;
    essaiSansDelai.current = true;
    setEtatSauvegarde((actuel) => (actuel === 'en_cours' ? actuel : 'modifie'));
    setEssaiDemande((n) => n + 1);
  }, []);
  useEffect(() => {
    // Règle disparue (404) : plus rien à enregistrer, donc plus d'essai.
    // Modifiée ailleurs (409) : pareil — on attend « Recharger », on n'écrase rien.
    // Lumi travaille : sa réponse touche la règle (la conversation y est gardée),
    // on enregistre après elle, avec la bonne version.
    if (etatSauvegarde !== 'modifie' || !regle || disparue || modifieeAilleurs || genere) return;
    if (etapesIncompletes > 0) { setEtatSauvegarde('incomplet'); return; }
    const delai = essaiSansDelai.current ? 0 : 3000 * 2 ** Math.min(echecsSauvegarde.current, 4);
    essaiSansDelai.current = false;

    const minuterie = setTimeout(async () => {
      /*
       * CE QUI EST PARTI AU SERVEUR DOIT ÊTRE CONFIRMÉ À L'ÉCRAN.
       *
       * Cet effet dépend de `steps` ET de `etatSauvegarde`. Poser
       * `en_cours` le RELANÇAIT donc lui-même : le nettoyage mettait
       * `annule = true`, la réponse du serveur revenait, et le
       * `if (!annule)` l'ignorait. `a_jour` n'était JAMAIS posé —
       * l'indicateur restait bloqué sur « Enregistrement… » alors que
       * la mutation avait réussi. QA du 2026-09-25 (P1-3), et le même
       * à la publication.
       *
       * On retient ce qu'on envoie : à la réponse, on ne confirme que si
       * l'état à l'écran est TOUJOURS celui-là. Un changement survenu
       * entre-temps repart en « modifié » au lieu d'être perdu — c'est
       * ce qui faisait disparaître la moitié d'un parcours de 16 étapes
       * (P1-8) : chaque duplication annulait la sauvegarde en vol.
       */
      const envoye = JSON.stringify(steps);
      setEtatSauvegarde('en_cours');
      // Trois tentatives, espacées de plus en plus : 1,5 s puis 4 s. Un
      // plafond de débit se relâche vite ; réessayer tout de suite le
      // relancerait pour rien.
      const attentes = [1500, 4000];
      for (let essai = 0; essai <= attentes.length; essai++) {
        /*
         * LA REPRISE APRÈS UN 429 (triage éditeur, 12-enregistrement:86). Elle
         * s'arrêtait sur un drapeau `annule` que posait le nettoyage de CET
         * effet — relancé par notre propre passage à « en cours ». Le premier
         * essai partait, jamais le deuxième : l'indicateur restait sur
         * « Enregistrement… » pour de bon et rien n'atteignait la base.
         *
         * Une reprise ne s'abandonne que si elle n'a plus lieu d'être : l'écran
         * n'est plus « en cours » (une modification plus récente a repris la
         * main, et son propre enregistrement partira).
         */
        if (essai > 0 && etatSauvegardeCourant.current !== 'en_cours') return;
        try {
          await ecrire({ name: nom.trim() || regle.name, ...contenuParcours(steps) });
          echecsSauvegarde.current = 0;
          /*
           * On confirme même si l'effet a été relancé : le serveur a bien
           * reçu `envoye`. Si l'écran a changé depuis, le nouvel état
           * repart de lui-même en « modifié » — ce qu'on ne veut surtout
           * pas, c'est laisser « Enregistrement… » à jamais.
           */
          setRefus(null);
          setEtatSauvegarde((actuel) => {
            if (actuel !== 'en_cours') return actuel;
            return JSON.stringify(steps) === envoye ? 'a_jour' : 'modifie';
          });
          return;
        } catch (e: unknown) {
          /*
           * 404 : l'automatisation n'existe plus. Ni toast « nouvel essai
           * automatique », ni reprise — `ecrire` a déjà basculé l'écran.
           */
          // 409 « modifiée ailleurs » : même règle — le bandeau le dit et offre de recharger.
          if (estIntrouvable(e) || estModifieeAilleurs(e)) {
            // Dit aussi par un message : le bandeau peut être hors de vue (onglet Journaux…).
            if (estModifieeAilleurs(e)) toast.error(e instanceof Error ? e.message : String(e), { id: 'enregistrement-auto' });
            setEtatSauvegarde((actuel) => (actuel === 'en_cours' ? 'modifie' : actuel));
            return;
          }
          const message = e instanceof Error ? e.message : String(e);
          /*
           * UN REFUS N'EST PAS UNE PANNE (triage éditeur, S-04). « Ajouter »
           * puis « Attendre » en dernière étape — un geste normal — donnait
           * « Enregistrement impossible pour le moment — nouvel essai
           * automatique. (La séquence se termine par une attente…) », et le
           * même parcours refusé repartait en boucle, 400 après 400.
           *
           * Un refus est DIT comme un refus, n'est jamais renvoyé, désigne
           * l'étape quand le serveur la nomme, et reste à l'écran : rien ne
           * s'enregistre tant qu'il n'est pas corrigé. La prochaine
           * modification du parcours repart en enregistrement.
           */
          if (estRefus(e)) {
            const indices = (e as { etapes?: unknown }).etapes;
            const fautives = Array.isArray(indices)
              ? indices.flatMap((i) => (typeof i === 'number' && steps[i] ? [steps[i].id] : []))
              : [];
            setRefus({ message, etapes: [...new Set(fautives)] });
            toast.error(fr ? `Enregistrement refusé — ${message}` : `Save refused — ${message}`, { id: 'enregistrement-auto' });
            setEtatSauvegarde((actuel) => (actuel === 'en_cours' ? 'refuse' : actuel));
            return;
          }
          const tropVite = (e as { status?: unknown } | null)?.status === 429 || /too many requests|429|rate limit/i.test(message);
          if (tropVite && essai < attentes.length) {
            // Le délai que le serveur indique (`Retry-After`), sinon un délai court croissant.
            const indique = Number((e as { retryApresMs?: unknown } | null)?.retryApresMs);
            const attente = Number.isFinite(indique) && indique > 0 ? Math.min(Math.max(indique, attentes[essai]), 15_000) : attentes[essai];
            await new Promise((r) => setTimeout(r, attente));
            continue;
          }
          echecsSauvegarde.current += 1;
          // Dit AVANT de relancer (un seul toast, remplacé à chaque essai).
          // Jamais l'erreur brute : « Too many requests » en anglais ne dit
          // rien à un entrepreneur qui écrivait son message.
          toast.error(tropVite
            ? (fr
              ? 'Trop de modifications d’un coup — on réessaie dans un instant.'
              : 'Too many changes at once — retrying in a moment.')
            : (fr
              ? `Enregistrement impossible pour le moment — nouvel essai automatique. (${message})`
              : `Could not save right now — retrying automatically. (${message})`), {
            id: 'enregistrement-auto',
            // Sans attendre le prochain essai automatique (espacé de plus en plus).
            action: { label: fr ? 'Réessayer' : 'Try again', onClick: reessayerEnregistrement },
          });
          // Même raison : ne jamais rester bloqué sur « en cours ».
          setEtatSauvegarde((actuel) => (actuel === 'en_cours' ? 'modifie' : actuel));
          return;
        }
      }
    }, delai);
    return () => { clearTimeout(minuterie); };
  }, [etatSauvegarde, regle, nom, steps, etapesIncompletes, fr, ecrire, disparue, modifieeAilleurs, genere, essaiDemande, reessayerEnregistrement]);

  // Dès que la dernière étape vide est remplie, on repart en enregistrement.
  useEffect(() => {
    if (etatSauvegarde === 'incomplet' && etapesIncompletes === 0) setEtatSauvegarde('modifie');
  }, [etatSauvegarde, etapesIncompletes]);

  // ── Publier / dépublier ──
  const basculerPublication = async () => {
    if (!regle) return;
    // Une confirmation déjà à l'écran : les clics suivants n'en ouvrent pas d'autres.
    if (confirmationPublication.current) return;
    const versActive = !fileBascule.etatAffiche(regle.id, regle.is_active);
    if (versActive && ajoutEnAttente) {
      // Elle n'est pas dans le parcours : publier la laisserait de côté sans le dire.
      toast.error(fr
        ? 'Une étape est en cours d’ajout : enregistrez-la dans son panneau, ou fermez-le, avant de publier.'
        : 'A step is being added: save it in its panel, or close it, before publishing.');
      return;
    }
    if (versActive) {
      /*
       * REFUSER AVANT, PAS APRÈS.
       *
       * L'audit d'un vrai compte GoHighLevel a trouvé cinq erreurs
       * bloquantes dans un workflow publiable : leur builder laisse
       * publier un parcours cassé, et l'entreprise ne s'en aperçoit qu'en
       * constatant que personne n'a rien reçu.
       *
       * On nomme l'étape fautive et on l'ouvre d'un clic : une erreur
       * qu'on peut cliquer se corrige, une erreur qu'on doit chercher se
       * contourne.
       */
      const problemes = problemesPublication({
        trigger_event: regle.trigger_event,
        steps,
        actions: regle.actions,
        // Sans les conditions, on ne verrait pas qu'un réglage OBLIGATOIRE
        // du déclencheur manque — la règle se publierait pour ne jamais
        // partir.
        conditions: (regle.conditions ?? null) as Record<string, unknown> | null,
        is_preset: regle.is_preset,
        fr,
        entite: objetRegle,
      });
      const bloquants = problemes.filter((p) => p.gravite === 'bloquant');
      if (bloquants.length > 0) {
        const premier = bloquants[0];
        if (premier.etapeId) montrerEtape(premier.etapeId);
        toast.error(
          bloquants.length === 1
            ? premier.message
            : `${premier.message} (${bloquants.length - 1} ${fr ? 'autre(s) à corriger' : 'more to fix'})`,
        );
        return;
      }

      const avertissements = problemes.filter((p) => p.gravite === 'avertissement');
      // « Client inactif » : dire combien de clients sont visés AVANT d'activer.
      let visesAujourdhui: string | null = null;
      if (regle.trigger_event === 'client.inactive') {
        try {
          const n = await apercuClientsInactifs(Number((regle.conditions as Record<string, unknown> | null)?.mois ?? 6));
          visesAujourdhui = fr
            ? `${n} client${n > 1 ? 's' : ''} correspond${n > 1 ? 'ent' : ''} aujourd’hui. Les messages partiront par petits lots, en journée.`
            : `${n} client${n > 1 ? 's' : ''} match${n > 1 ? '' : 'es'} today. Messages will go out in small batches, during the day.`;
        } catch (e) {
          console.error('[AutomationBuilderPage] aperçu clients inactifs', e);
        }
      }
      /*
       * « de vrais messages à vos clients » SEULEMENT s'il en part : sinon la
       * confirmation se contredisait avec l'avertissement « aucun message ne
       * part au client » juste en dessous (audit V2, A-15).
       */
      const actionsPubliees = (steps.length > 0
        ? steps.flatMap((e) => (e.type === 'action' ? [e.action] : []))
        : (regle.actions ?? [])) as Array<{ type?: string }>;
      const ecritAuClient = actionsPubliees.some((a) => trouverAction(String(a?.type ?? ''))?.vers_client);
      confirmationPublication.current = true;
      const ok = await confirmer({
        title: fr ? 'Publier cette automatisation ?' : 'Publish this automation?',
        message: [
          ecritAuClient
            ? (fr
              ? 'Elle commencera à envoyer de vrais messages à vos clients dès le prochain déclenchement.'
              : 'It will start sending real messages to your clients at the next trigger.')
            : (fr
              ? 'Elle se déclenchera dès le prochain événement — pour du travail interne seulement.'
              : 'It will run at the next event — internal work only.'),
          ...(visesAujourdhui ? [visesAujourdhui] : []),
          ...avertissements.map((a) => `⚠ ${a.message}`),
        ].join('\n\n'),
        confirmLabel: fr ? 'Publier' : 'Publish',
      }).finally(() => { confirmationPublication.current = false; });
      if (!ok) return;
      /*
       * Le serveur vérifie la version ENREGISTRÉE : les dernières
       * secondes de modifications partent d'abord, sinon il jugerait
       * (et publierait) l'avant-dernière version du parcours.
       */
      if (etatSauvegarde === 'modifie' || etatSauvegarde === 'en_cours' || etatSauvegarde === 'refuse') {
        try {
          await ecrire({ name: nom.trim() || regle.name, ...contenuParcours(steps) });
          setRefus(null);
          setEtatSauvegarde('a_jour');
        } catch (e: unknown) {
          toast.error(e instanceof Error ? e.message : String(e));
          return;
        }
      }
    }
    // Un brouillon jamais enregistré n'a rien à publier (le contrôle
    // ci-dessus l'a déjà dit) ; sinon l'id RÉEL, créé au besoin juste avant.
    const cible = idReel.current;
    if (!cible) return;
    const voulu = fileBascule.basculer(cible, regle.is_active);
    setRegle((r) => (r ? { ...r, is_active: voulu } : r));
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

  /**
   * La règle est-elle au FORMAT D'ORIGINE (`actions`, sans parcours) ?
   *
   * Mesuré en prod le 2026-09-25 : 250 règles sur 251. Le canevas ne lisant
   * que `steps`, toutes affichaient « Ajouter une première étape » alors
   * qu'elles tournent et envoient des messages — l'éditeur mentait à
   * presque tous les clients.
   *
   * On les AFFICHE en lecture seule, projetées dans la forme du canevas.
   * Aucune écriture : convertir reste un geste explicite (décision de Will
   * — pas de conversion silencieuse d'une règle active).
   */
  const formatOrigine = useMemo(
    () => !!regle && estFormatOrigine({ steps, actions: regle.actions }),
    [regle, steps],
  );
  const etapesAffichees = useMemo(
    () => (formatOrigine && regle
      ? projeterFormatOrigine({ actions: regle.actions, delay_seconds: regle.delay_seconds })
      // L'étape en cours d'ajout est MONTRÉE à sa place, sans être dans `steps`.
      : ajoutEnAttente
        ? insererEtape(steps, ajoutEnAttente.etape, ajoutEnAttente.apresId, ajoutEnAttente.branche)
        : steps),
    [formatOrigine, regle, steps, ajoutEnAttente],
  );

  /**
   * Ce qu'une conversion ferait — calculé AVANT de proposer le bouton.
   *
   * Exigence de Will : l'utilisateur doit voir ce qui va changer avant de
   * confirmer. Et 100 règles de prod sur 250 portent un `log_activity` que
   * le serveur refuse : mieux vaut ne pas offrir le bouton que de le faire
   * échouer au clic.
   */
  const conversion = useMemo(
    () => (formatOrigine && regle
      ? apercuConversion({ actions: regle.actions, delay_seconds: regle.delay_seconds })
      : null),
    [formatOrigine, regle],
  );
  const [conversionEnCours, setConversionEnCours] = useState(false);

  /**
   * Convertir : un seul écrit, jamais en silence sur une règle PUBLIÉE.
   *
   * Rafba (2026-09-30) : « je ne suis pas capable de jouer avec les
   * paramètres des autres bulles » — un clic sur une étape d'un parcours au
   * format d'origine ne faisait rien. Désormais ce clic convertit puis ouvre
   * l'étape : sans question pour un BROUILLON (il n'envoie rien), après
   * confirmation pour une automatisation publiée (décision de Will).
   */
  const convertirParcours = useCallback(async (ouvrir?: string) => {
    if (!regle) return;
    if (!conversion?.possible) {
      toast.info(fr
        ? 'Ce parcours contient une étape d’un ancien format qui ne se convertit pas : il reste en lecture seule.'
        : 'This journey contains an old-format step that cannot be converted: it stays read-only.');
      return;
    }
    if (regle.is_active) {
      const ok = await confirmer({
        title: fr ? 'Convertir ce parcours ?' : 'Convert this journey?',
        message: fr
          ? `Les ${conversion.etapes.length} étapes affichées deviendront modifiables dans le canevas. L'automatisation continue de fonctionner pendant et après : les envois ne changent pas.`
          : `The ${conversion.etapes.length} steps shown will become editable on the canvas. The automation keeps running during and after: what it sends does not change.`,
        confirmLabel: fr ? 'Convertir' : 'Convert',
      });
      if (!ok) return;
    }
    setConversionEnCours(true);
    try {
      // Par `ecrire` : la conversion porte la garde de version comme toute écriture.
      // … et `actions` part avec, en accord : aucune copie de l'ancien format ne reste en base.
      const maj = await ecrire({
        steps: conversion.etapes,
        actions: actionsDuParcours(conversion.etapes, fr) as BrouillonAutomatisation['actions'],
      });
      const converties = (maj.steps as Etape[] | undefined) ?? [];
      setRegle(maj);
      setSteps(converties);
      // C'est désormais un parcours : vidé, il est VIDE (plus de retour au
      // format d'origine), et « annuler » ne remonte pas avant la conversion.
      actionsDOrigine.current = null;
      parcoursTouche.current = true;
      setHistorique([converties]);
      setPosition(0);
      if (ouvrir) montrerEtape(ouvrir);
      toast.success(fr ? 'Parcours converti — il est modifiable' : 'Journey converted — it is editable');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setConversionEnCours(false);
    }
  }, [regle, conversion, fr, montrerEtape, ecrire]);

  /**
   * Y a-t-il du travail NON ENREGISTRÉ ?
   *
   * `modifie` = la minuterie n'a pas encore écrit. `incomplet` = une étape
   * bloque l'enregistrement (un champ obligatoire vide) — c'est le cas le
   * plus dangereux : on croit son parcours sauvé alors que rien n'est parti.
   */
  // « en cours » compte aussi : fermer l'onglet pendant l'enregistrement
  // peut couper la requête avant que le serveur l'ait reçue (P2-13).
  // … et un changement de déclencheur dont le serveur n'a pas encore répondu.
  // … et un parcours que le serveur REFUSE : il n'est pas en base.
  const travailNonEnregistre = declencheurEnVol || etatSauvegarde === 'modifie' || etatSauvegarde === 'incomplet' || etatSauvegarde === 'en_cours' || etatSauvegarde === 'refuse';

  /**
   * Prévenir avant de FERMER l'onglet.
   *
   * C'est le défaut de GoHighLevel relevé par l'audit : « nœuds non
   * enregistrés abandonnés silencieusement (perte de travail) ». Le mandat
   * demande explicitement de ne pas le reproduire. Le navigateur affiche
   * son propre message — on ne peut pas le personnaliser, mais on peut
   * refuser de laisser partir sans rien dire.
   */
  useEffect(() => {
    if (!travailNonEnregistre) return;
    const avertir = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', avertir);
    return () => window.removeEventListener('beforeunload', avertir);
  }, [travailNonEnregistre]);

  /*
   * LE BOUTON « RETOUR » DU NAVIGATEUR (audit V2, A-04).
   *
   * `beforeunload` ne couvre que la fermeture de l'onglet, et le routeur de
   * l'app est déclaratif (`<BrowserRouter>`) : `useBlocker` n'y existe pas,
   * et `NavigationGuard` n'intercepte pas `popstate`. Revenir en arrière
   * démontait donc l'éditeur et jetait les 3 dernières secondes de travail.
   *
   * On fait ce que fait « ← Mes automatisations » : on ENREGISTRE en
   * partant — au démontage, avec l'état du dernier rendu. La requête
   * survit au démontage ; un échec, ou une étape incomplète qui empêche
   * d'enregistrer, est DIT par un message (le toast vit hors de la page).
   */
  const sortieGeree = useRef(false);

  /*
   * … ET CE QUI NE PEUT PAS S'ENREGISTRER EN PARTANT SE DEMANDE AVANT (triage
   * éditeur, EDT-166). Une étape incomplète, un parcours que le serveur
   * refuse, une saisie en cours dans un panneau : « Précédent » quittait
   * l'éditeur, le travail était perdu, et un toast le disait après coup.
   * « Mes automatisations », lui, pose la question.
   *
   * Le routeur ne sait pas retenir un retour arrière. Tant qu'il y a quelque
   * chose à perdre, on pose donc une entrée d'historique en double (même
   * adresse) : « Précédent » la consomme sans quitter la page, et c'est là
   * qu'on demande. Oui : on recule pour de bon. Non : on la repose.
   */
  const aPerdreEnPartant = !!regle && !disparue && !modifieeAilleurs
    && (etatSauvegarde === 'incomplet' || etatSauvegarde === 'refuse' || !!etapeEnAttente || saisieEnCours);
  const raisonDePerte = useRef<'incomplet' | 'refuse' | 'saisie'>('saisie');
  raisonDePerte.current = etatSauvegarde === 'incomplet' ? 'incomplet' : etatSauvegarde === 'refuse' ? 'refuse' : 'saisie';
  useEffect(() => {
    if (!aPerdreEnPartant) return;
    const MARQUE = 'lumeGardeEditeur';
    const poser = () => window.history.pushState({ ...(window.history.state ?? {}), [MARQUE]: true }, '');
    if (!(window.history.state as Record<string, unknown> | null)?.[MARQUE]) poser();
    let enSortie = false;
    let questionOuverte = false;
    const surRetour = () => {
      // Notre propre recul, ou une question déjà à l'écran : rien à refaire.
      if (enSortie || questionOuverte) return;
      // Encore sur l'entrée en double (un « Suivant ») : rien n'est quitté.
      if ((window.history.state as Record<string, unknown> | null)?.[MARQUE]) return;
      questionOuverte = true;
      const enFrancais = frBascule.current;
      const raison = raisonDePerte.current;
      void confirmer({
        title: enFrancais ? 'Quitter sans enregistrer ?' : 'Leave without saving?',
        message: raison === 'incomplet'
          ? (enFrancais
            ? 'Une étape est incomplète, donc le parcours n’a pas pu être enregistré. Si vous quittez maintenant, ces modifications seront perdues.'
            : 'A step is incomplete, so the journey could not be saved. If you leave now, those changes are lost.')
          : raison === 'refuse'
            ? (enFrancais
              ? 'Le parcours tel qu’il est a été refusé à l’enregistrement. Si vous quittez maintenant, ces modifications seront perdues.'
              : 'The journey as it stands was refused when saving. If you leave now, those changes are lost.')
            : (enFrancais
              ? 'Une étape est en cours de modification et n’a pas été enregistrée. Si vous quittez maintenant, ce que vous y avez saisi sera perdu.'
              : 'A step is being edited and has not been saved. If you leave now, what you entered there is lost.'),
        confirmLabel: enFrancais ? 'Quitter' : 'Leave',
        danger: true,
      }).then((quitter) => {
        questionOuverte = false;
        if (quitter) {
          // Abandon confirmé : le départ n'a plus rien à dire ni à tenter.
          enSortie = true;
          sortieGeree.current = true;
          window.history.back();
        } else {
          poser();
        }
      });
    };
    window.addEventListener('popstate', surRetour);
    return () => window.removeEventListener('popstate', surRetour);
  }, [aPerdreEnPartant]);

  // Une règle disparue (404) n'a plus rien à enregistrer au départ.
  const etatAuDepart = useRef({ etat: etatSauvegarde, incompletes: etapesIncompletes, nom: nom.trim() || regle?.name || '', steps, fr, ecrire, contenu: contenuParcours, aRegle: !!regle && !disparue && !modifieeAilleurs });
  etatAuDepart.current = { etat: etatSauvegarde, incompletes: etapesIncompletes, nom: nom.trim() || regle?.name || '', steps, fr, ecrire, contenu: contenuParcours, aRegle: !!regle && !disparue && !modifieeAilleurs };
  useEffect(() => () => {
    const d = etatAuDepart.current;
    if (sortieGeree.current || !d.aRegle) return;
    if (d.etat === 'incomplet') {
      toast.error(d.fr
        ? 'Automatisation quittée sans enregistrer : une étape était incomplète.'
        : 'Automation left without saving: a step was incomplete.');
      return;
    }
    if ((d.etat !== 'modifie' && d.etat !== 'en_cours' && d.etat !== 'refuse') || d.incompletes > 0) return;
    d.ecrire({ name: d.nom, ...d.contenu(d.steps) }).catch((e: unknown) => {
      console.error('[automatisations] enregistrement au départ impossible', e);
      captureClientException(e, { where: 'AutomationBuilderPage.depart' });
      toast.error(d.fr
        ? `Vos dernières modifications n’ont pas pu être enregistrées : ${e instanceof Error ? e.message : String(e)}`
        : `Your latest changes could not be saved: ${e instanceof Error ? e.message : String(e)}`);
    });
  }, []);

  /** Quitter l'éditeur — en demandant d'abord si du travail se perdrait. */
  const quitterEditeur = useCallback(async () => {
    /*
     * ENREGISTRER AVANT DE PARTIR, plutôt qu'avertir.
     *
     * Quand toutes les étapes sont complètes, rien n'empêche d'enregistrer :
     * on le fait, puis on part. Avant, deux trous : quitter pendant les 3 s
     * d'attente de l'autosauvegarde, ou pendant qu'elle était EN COURS
     * (état non couvert par le garde) — sans aucun signal. QA du 2026-09-25
     * (P2-13) : « avertir ou garantir la sauvegarde dans tous les cas ».
     *
     * On n'avertit plus que quand on NE PEUT PAS enregistrer : une étape
     * incomplète, ou le serveur qui refuse.
     */
    let echecEnregistrement = false;
    if (regle && etapesIncompletes === 0 && (etatSauvegarde === 'modifie' || etatSauvegarde === 'en_cours' || etatSauvegarde === 'refuse')) {
      try {
        await ecrire({ name: nom.trim() || regle.name, ...contenuParcours(steps) });
        setRefus(null);
        setEtatSauvegarde('a_jour');
      } catch (e: unknown) {
        console.error('[automatisations] enregistrement à la sortie impossible', e);
        echecEnregistrement = true;
      }
    }

    if (etatSauvegarde === 'incomplet' || echecEnregistrement) {
      const ok = await confirmer({
        title: fr ? 'Quitter sans enregistrer ?' : 'Leave without saving?',
        message: etatSauvegarde === 'incomplet'
          ? (fr
            ? 'Une étape est incomplète, donc le parcours n’a pas pu être enregistré. Si vous quittez maintenant, ces modifications seront perdues.'
            : 'A step is incomplete, so the journey could not be saved. If you leave now, those changes are lost.')
          : (fr
            ? 'Vos dernières modifications ne sont pas encore enregistrées. Si vous quittez maintenant, elles seront perdues.'
            : 'Your latest changes are not saved yet. If you leave now, they will be lost.'),
        confirmLabel: fr ? 'Quitter' : 'Leave',
        danger: true,
      });
      if (!ok) return;
    }
    // Déjà enregistré (ou abandon confirmé) : le départ n'a rien à refaire.
    sortieGeree.current = true;
    navigate('/automations');
  }, [regle, etapesIncompletes, etatSauvegarde, nom, steps, fr, navigate, ecrire]);

  const declencheurLabel = useMemo(() => {
    if (!catalogue || !regle) return fr ? '— à choisir —' : '— to pick —';
    /*
     * Le catalogue du SERVEUR est filtré par drapeau : une règle posée sur un
     * déclencheur que le bureau n'a pas (drapeau coupé après coup, modèle,
     * Lumi) n'y est pas, et la carte affichait sa clé technique —
     * « QUAND payment.failed » (audit du 2026-10-01). Le NOM se lit alors dans
     * le catalogue complet, comme le fait la liste des automatisations.
     */
    const d = catalogue.declencheurs.find((x) => x.cle === regle.trigger_event) ?? trouverDeclencheur(regle.trigger_event);
    return d ? (fr ? d.fr : d.en) : regle.trigger_event;
  }, [catalogue, regle, fr]);

  /** Le déclencheur choisi, tel que le catalogue le décrit. */
  const declencheurCourant = useMemo(
    () => catalogue?.declencheurs?.find((x) => x.cle === regle?.trigger_event) ?? null,
    [catalogue, regle?.trigger_event],
  );

  /*
   * Le déclencheur a-t-il un panneau de réglages ? Ses champs, OU la case
   * « Arrêter si… » de la sortie automatique du parcours — drapeau coupé,
   * seuls les champs comptent, comme avant.
   */
  const { isEnabled: sortieParcoursActive } = useModuleAccess('auto_sortie_parcours');
  const declencheurReglable = Boolean(
    declencheurCourant
    && ((declencheurCourant.champs?.length ?? 0) > 0 || (sortieParcoursActive && CASE_SORTIE[declencheurCourant.cle])
      // « Champ modifié » se règle (quel champ, quelle valeur) ; tout
      // déclencheur dont la fiche a des champs offre ses FILTRES.
      || declencheurCourant.cle === 'custom_field.changed'
      || (objetRegle !== null && champsPerso.some((c) => c.object_type === objetRegle))),
  );

  /** Le déclencheur demande-t-il un service du catalogue ? */
  const [servicesCatalogue, setServicesCatalogue] = useState<Array<{ id: string; label: string }>>([]);
  const besoinServices = !!declencheurCourant?.champs?.some((c) => c.type === 'service');
  useEffect(() => {
    if (!besoinServices) return;
    let vivant = true;
    listPredefinedServices()
      .then((s) => { if (vivant) setServicesCatalogue(s.map((x) => ({ id: x.id, label: x.name }))); })
      .catch((e: unknown) => console.error('[automations] services illisibles', e));
    return () => { vivant = false; };
  }, [besoinServices]);

  /** Le déclencheur demande-t-il une étape de pipeline ? */
  // … et dès qu'un panneau d'étape est ouvert : « Déplacer l'opportunité » y
  // offre le menu des étapes, y compris quand on vient de changer d'action
  // dans le panneau (le parcours enregistré ne le sait pas encore).
  const besoinEtapes = !!declencheurCourant?.champs?.some((c) => c.type === 'etape_pipeline')
    || etapeChoisie !== null
    || steps.some((e) => e.type === 'action' && e.action?.type === 'move_deal_stage');
  useEffect(() => {
    if (!besoinEtapes) return;
    let vivant = true;
    (async () => {
      try {
        const pipelines = await fetchPipelines();
        // Le nom du pipeline PRÉFIXE celui de l'étape : deux pipelines ont
        // souvent une étape « Soumission envoyée », et une liste de doublons
        // ne permet pas de choisir.
        const listes = await Promise.all(pipelines.map(async (p) => {
          const etapes = await fetchStages(p.id);
          return etapes
            .filter((e) => !e.archived_at)
            .map((e) => ({ id: e.id, label: `${p.name} · ${fr ? e.name_fr : e.name_en}` }));
        }));
        if (vivant) setEtapesPipeline(listes.flat());
      } catch (e: unknown) {
        // Une liste vide se distingue mal d'un échec : on le journalise.
        console.error('[automations] étapes de pipeline illisibles', e);
      }
    })();
    return () => { vivant = false; };
  }, [besoinEtapes, fr]);

  /**
   * Les réglages du déclencheur, en clair sous sa carte.
   *
   * Reprend l'idée de GHL (« Event type is "Normal" ») : on voit ce que la
   * règle écoute vraiment sans rien ouvrir. Un réglage obligatoire mais
   * absent est SIGNALÉ — c'est le seul moyen de repérer d'un coup d'œil
   * une règle qui ne partirait jamais.
   */
  const declencheurDetail = useMemo(() => {
    const champs = declencheurCourant?.champs ?? [];
    const conditions = (regle?.conditions ?? {}) as Record<string, unknown>;
    const bouts: string[] = [];
    // « Champ modifié » : le champ surveillé, et la valeur attendue.
    if (declencheurCourant?.cle === 'custom_field.changed') {
      const id = champSurveille(conditions);
      const champ = champsPerso.find((c) => c.id === id);
      if (!id) bouts.push(fr ? 'N’importe quel champ' : 'Any field');
      else if (!champ) bouts.push(fr ? 'champ supprimé' : 'deleted field');
      else {
        const nv = conditions.new_value;
        const brut = nv && typeof nv === 'object' && !Array.isArray(nv) ? (nv as { eq?: unknown }).eq : nv;
        const opt = champ.options.find((o) => o.id === brut)?.label;
        const valeur = brut === undefined || brut === null ? ''
          : opt ?? (typeof brut === 'boolean' ? (brut ? (fr ? 'oui' : 'yes') : (fr ? 'non' : 'no')) : saisieDepuisValeurCondition(champ, brut));
        bouts.push(valeur ? `${champ.label} → ${valeur}` : champ.label);
      }
    }
    for (const champ of champs) {
      const v = conditions[champ.cle];
      if (v === undefined || v === null || String(v).trim() === '') {
        if (champ.obligatoire) {
          bouts.push(fr ? `⚠ ${champ.fr} à choisir` : `⚠ pick ${champ.en}`);
        }
        continue;
      }
      if (champ.type === 'champ_date') {
        const nom = champsDate.find((c) => c.id === String(v))?.label;
        bouts.push(nom ?? (fr ? 'champ supprimé' : 'deleted field'));
      } else if (champ.type === 'etape_pipeline') {
        const nom = etapesPipeline.find((e) => e.id === String(v))?.label;
        bouts.push(nom ?? (fr ? 'étape supprimée' : 'deleted stage'));
      } else if (champ.type === 'service') {
        const nom = servicesCatalogue.find((s) => s.id === String(v))?.label;
        bouts.push(nom ?? (fr ? 'service supprimé' : 'deleted service'));
      } else if (champ.type === 'choix') {
        const opt = champ.options?.find((o) => o.cle === String(v));
        bouts.push(opt ? (fr ? opt.fr : opt.en) : String(v));
      } else {
        bouts.push(`${fr ? champ.fr : champ.en} : ${v}`);
      }
    }
    const nbFiltres = Array.isArray(conditions.champs_perso) ? conditions.champs_perso.length : 0;
    if (nbFiltres) bouts.push(fr ? `${nbFiltres} filtre${nbFiltres > 1 ? 's' : ''}` : `${nbFiltres} filter${nbFiltres > 1 ? 's' : ''}`);
    return bouts.length ? bouts.join(' · ') : null;
  }, [declencheurCourant, regle?.conditions, champsDate, etapesPipeline, servicesCatalogue, champsPerso, fr]);

  /** Enregistrer les réglages du déclencheur. */
  const enregistrerDeclencheur = useCallback(async (conditions: Record<string, unknown>, arreterSiResolu?: boolean) => {
    if (!regle) return;
    /*
     * Un changement de déclencheur encore en vol : ces réglages attendent sa
     * réponse. Partis en parallèle, les deux se doublaient, et le plus lent
     * écrasait l'autre. Changement refusé : la carte est revenue à l'ancien
     * déclencheur (c'est déjà dit) — ces réglages n'étaient pas les siens.
     */
    const changementEnVol = fileDeclencheur.current.enVol;
    if (changementEnVol && !(await changementEnVol)) return;
    try {
      // La case « Arrêter si… » vit dans `settings` : on la fusionne avec les
      // réglages existants (fenêtre, réentrée…) au lieu de les écraser.
      const maj = await ecrire(arreterSiResolu === undefined
        ? { conditions }
        : { conditions, settings: { ...((regle.settings ?? {}) as Record<string, unknown>), arreter_si_resolu: arreterSiResolu } });
      setRegle(maj);
      setReglageDeclencheur(false);
      toast.success(fr ? 'Réglages enregistrés' : 'Settings saved');
    } catch (e: unknown) {
      // Règle supprimée entre-temps : l'écran « n'existe plus » le dit déjà.
      if (!estIntrouvable(e)) toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [regle, fr, ecrire]);

  /** Les réglages du déclencheur sont-ils à l'écran ? */
  const panneauDeclencheurAffiche = reglageDeclencheur && !!declencheurCourant && declencheurReglable;

  /**
   * Un clic sur la carte « Quand » ouvre ses RÉGLAGES quand il y en a
   * (« quelle date surveiller ? »), et le tiroir de changement sinon. C'est
   * le geste de GHL : on règle d'abord, on change de déclencheur depuis le
   * tiroir que le panneau propose. Le panneau d'étape ouvert lui cède la
   * place (un seul panneau à droite).
   */
  const ouvrirDeclencheur = () => {
    if (panneauDeclencheurAffiche || tiroirDeclencheur) return;
    quandPanneauLibre(() => {
      setEtapeChoisie(null);
      setAjoutEnCours(null);
      if (declencheurReglable) setReglageDeclencheur(true);
      else setTiroirDeclencheur(true);
    });
  };

  if (chargement) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface">
        {/* L'écran DIT qu'il charge : un rond gris seul, sur un serveur lent,
            ne distinguait pas « ça charge » de « c'est figé » — et un lecteur
            d'écran n'annonçait rien (audit du 2026-10-01). */}
        <div role="status" className="flex flex-col items-center gap-2 text-sm text-text-secondary">
          <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" aria-hidden="true" />
          <span>{fr ? 'Chargement de l’automatisation…' : 'Loading the automation…'}</span>
        </div>
      </div>
    );
  }

  if (!regle && echecChargement) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-surface">
        <p className="text-sm text-text-secondary">
          {fr ? 'Impossible de charger cette automatisation pour le moment.' : 'Could not load this automation right now.'}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setEchecChargement(false); setChargement(true); setEssaiChargement((n) => n + 1); }}
            className="rounded-lg bg-text-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {fr ? 'Réessayer' : 'Try again'}
          </button>
          <button
            type="button"
            onClick={() => void quitterEditeur()}
            className="rounded-lg border border-outline px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {fr ? 'Mes automatisations' : 'My automations'}
          </button>
        </div>
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
          onClick={() => void quitterEditeur()}
          className="rounded-lg bg-text-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {fr ? 'Mes automatisations' : 'My automations'}
        </button>
      </div>
    );
  }

  /*
   * ELLE N'EXISTE PLUS : supprimée ailleurs pendant que l'éditeur restait
   * ouvert (le serveur répond 404 à toute écriture). Ni canevas ni panneaux —
   * rien de ce qu'on y ferait ne pourrait s'enregistrer. On sort par la liste,
   * SANS repasser par l'enregistrement de sortie (il échouerait encore).
   */
  if (disparue) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-surface px-6 text-center">
        <div role="alert">
          <p className="text-base font-semibold text-text-primary">
            {fr ? 'Cette automatisation n’existe plus.' : 'This automation no longer exists.'}
          </p>
          <p className="mt-1 max-w-md text-sm text-text-secondary">
            {fr
              ? 'Elle a été supprimée, ou vous n’y avez plus accès : les dernières modifications n’ont pas pu être enregistrées.'
              : 'It was deleted, or you no longer have access to it: the latest changes could not be saved.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { sortieGeree.current = true; navigate('/automations'); }}
          className="rounded-lg bg-text-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {fr ? 'Mes automatisations' : 'My automations'}
        </button>
      </div>
    );
  }

  /*
   * À LA CORBEILLE : ni canevas ni panneaux. L'éditeur s'ouvrait par son
   * adresse (lien gardé, onglet resté ouvert) sur une automatisation
   * supprimée comme sur une autre, sans le dire, et la laissait modifier
   * (audit du 2026-10-01). On dit où elle est, et on offre de la restaurer.
   */
  if (regle.deleted_at) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-surface px-6 text-center">
        <p className="text-base font-semibold text-text-primary">{nom || regle.name}</p>
        <p className="max-w-md text-sm text-text-secondary">
          {fr
            ? 'Cette automatisation est à la corbeille : elle ne se déclenche plus et ne se modifie pas. Restaurez-la pour la retravailler — elle reviendra en brouillon.'
            : 'This automation is in the bin: it no longer runs and cannot be edited. Restore it to work on it — it comes back as a draft.'}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={restauration}
            onClick={() => {
              setRestauration(true);
              restaurerAutomatisation(regle.id)
                .then((maj) => {
                  noterVersion(maj?.id ?? regle.id, maj?.updated_at);
                  setRegle((r) => (r ? { ...r, deleted_at: null, is_active: maj.is_active } : maj));
                  toast.success(fr ? 'Automatisation restaurée, en brouillon.' : 'Automation restored, as a draft.');
                })
                .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
                .finally(() => setRestauration(false));
            }}
            className="rounded-lg bg-text-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {restauration ? (fr ? 'Restauration…' : 'Restoring…') : (fr ? 'Restaurer' : 'Restore')}
          </button>
          <button
            type="button"
            onClick={() => void quitterEditeur()}
            className="rounded-lg border border-outline px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {fr ? 'Mes automatisations' : 'My automations'}
          </button>
        </div>
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
        {/* Une étape en cours d'ajout se perdrait en partant : on le demande d'abord. */}
        <button
          type="button"
          onClick={() => (ajoutEnAttente ? quandPanneauLibre(() => void quitterEditeur()) : void quitterEditeur())}
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
            {modifieeAilleurs ? (
              // Ni « Modifié » (rien ne partira) ni « Enregistré » (ce serait faux).
              <span className="inline-flex items-center gap-1.5 text-warning">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                {fr ? 'Modifiée ailleurs' : 'Changed elsewhere'}
              </span>
            ) : etatSauvegarde === 'refuse' ? (
              // « Modifié » laisserait croire que l'enregistrement va venir : il ne viendra pas.
              <span className="inline-flex items-center gap-1.5 text-danger">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                {fr ? 'Refusé — à corriger' : 'Refused — to fix'}
              </span>
            ) : etatSauvegarde === 'incomplet' ? (
              <span className="inline-flex items-center gap-1.5 text-warning">
                <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
                {fr
                  ? `${etapesIncompletes} étape(s) à compléter`
                  : `${etapesIncompletes} step(s) to complete`}
              </span>
            ) : etatSauvegarde === 'en_cours' || declencheurEnVol ? (
              // Le changement de déclencheur compte aussi : « Enregistré »
              // pendant que son PATCH était en vol mentait (audit 2026-10-01).
              <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{fr ? 'Enregistrement…' : 'Saving…'}</>
            ) : etatSauvegarde === 'modifie' ? (
              <><Cloud className="h-3.5 w-3.5" aria-hidden="true" />{fr ? 'Modifié' : 'Edited'}</>
            ) : regle && !regle.id ? (
              /*
                Une automatisation NEUVE n'existe pas encore en base : elle
                est créée à la première modification (voir `ecrire`).
                Afficher « Enregistré » ici était faux (vu sur lumecrm.net le
                2026-10-01 : 0 ligne en base) — on quittait la page en
                croyant avoir un brouillon, il n'y en avait pas.
              */
              <><Cloud className="h-3.5 w-3.5" aria-hidden="true" />{fr ? 'Pas encore enregistrée' : 'Not saved yet'}</>
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
            onClick={async () => {
              if (!regle) return;
              if (!idReel.current) {
                toast.info(fr ? 'Ajoutez une première étape : il n’y a encore rien à prévisualiser.' : 'Add a first step: there is nothing to preview yet.');
                return;
              }
              setApercuEnCours(true);
              try {
                /*
                 * L'aperçu lit la version ENREGISTRÉE : sans ceci, les 3
                 * dernières secondes de modifications (délai de la sauvegarde
                 * auto) n'apparaissaient pas (launch 2026-09-28). On enregistre
                 * d'abord ce qui attend, comme avant de publier.
                 */
                if (etatSauvegarde === 'incomplet') {
                  toast.info(fr ? 'Complétez les étapes en cours pour voir l’aperçu à jour.' : 'Complete the unfinished steps to see an up-to-date preview.');
                  return;
                }
                if (etatSauvegarde === 'modifie' || etatSauvegarde === 'en_cours' || etatSauvegarde === 'refuse') {
                  await ecrire({ name: nom.trim() || regle.name, ...contenuParcours(steps) });
                  setRefus(null);
                  setEtatSauvegarde('a_jour');
                }
                setApercu(await apercuAutomatisation(idReel.current));
              } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : String(e));
              } finally {
                setApercuEnCours(false);
              }
            }}
            disabled={apercuEnCours}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            {/* « Aperçu », pas « Tester » : rien ne part. Le QA du 25 a relevé
                qu'un « Tester » laisse croire à un envoi réel. */}
            {fr ? 'Aperçu' : 'Preview'}
          </button>

          {/* Rouge = brouillon (rien ne part), vert = publiée. */}
          <InterrupteurPublication
            actif={regle.is_active}
            onBascule={basculerPublication}
            enCours={fileBascule.enCours(regle.id)}
            libelle={fr ? 'Publier l’automatisation' : 'Publish the automation'}
            avecEtiquette
            fr={fr}
          />
        </div>
      </div>

      {/* ══ Le bureau a tout mis en pause (S-32) : « Publiée » ne veut pas
          dire « envoie ». Dit sur tous les onglets, tant que la pause dure. ══ */}
      {bureauEnPause && (
        <div role="status" className="flex shrink-0 items-start gap-2 border-b border-warning/40 bg-warning-light px-4 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-warning">
              {fr ? 'Vos automatisations sont en pause.' : 'Your automations are paused.'}
            </p>
            <p className="mt-0.5 text-[12px] text-text-secondary">
              {regle.is_active
                ? (fr
                  ? 'Cette automatisation est publiée, mais elle n’envoie rien tant que la pause dure. La pause se lève depuis « Mes automatisations ».'
                  : 'This automation is published, but it sends nothing while the pause lasts. Lift the pause from “My automations”.')
                : (fr
                  ? 'Même publiée, cette automatisation n’enverra rien tant que la pause dure. La pause se lève depuis « Mes automatisations ».'
                  : 'Even once published, this automation will send nothing while the pause lasts. Lift the pause from “My automations”.')}
            </p>
          </div>
        </div>
      )}

      {/* ══ Modifiée ailleurs (A-09) : dit sur tous les onglets, avec la seule
          issue qui n'écrase rien — recharger la version en base. ══ */}
      {modifieeAilleurs && (
        <div role="alert" className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-warning/40 bg-warning-light px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-warning">
              {fr
                ? 'Cette automatisation a été modifiée ailleurs (par Lumi ou dans un autre onglet).'
                : 'This automation was changed elsewhere (by Lumi or in another tab).'}
            </p>
            <p className="mt-0.5 text-[12px] text-text-secondary">
              {fr
                ? 'Pour ne rien écraser, vos dernières modifications n’ont pas été enregistrées. Rechargez pour repartir de la version à jour.'
                : 'To avoid overwriting anything, your latest changes were not saved. Reload to start again from the current version.'}
            </p>
          </div>
          <button
            type="button"
            onClick={recharger}
            className="shrink-0 rounded-lg bg-text-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {fr ? 'Recharger' : 'Reload'}
          </button>
        </div>
      )}

      {/* ══ Enregistrement refusé (S-04) : dit tant qu'il dure, avec ce qu'il
          faut corriger et l'étape désignée quand le serveur la nomme. ══ */}
      {etatSauvegarde === 'refuse' && refus && !modifieeAilleurs && (
        <div role="alert" className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-danger/40 bg-danger/5 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-danger">
              {fr
                ? 'Enregistrement refusé : rien n’est enregistré tant que ce n’est pas corrigé.'
                : 'Save refused: nothing is saved until this is fixed.'}
            </p>
            <p className="mt-0.5 text-[12px] text-text-secondary">{refus.message}</p>
          </div>
          {refus.etapes.length > 0 && (
            <button
              type="button"
              onClick={() => { setOnglet('parcours'); ouvrirEtape(refus.etapes[0]); }}
              className="shrink-0 rounded-lg border border-danger/50 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {fr ? 'Ouvrir l’étape' : 'Open the step'}
            </button>
          )}
        </div>
      )}

      {/* ══ Le contenu ══ */}
      {/* Une RANGEE : le canevas a gauche, le panneau d'edition a droite —
          la disposition de GoHighLevel. Le canevas se retrecit quand le
          panneau s'ouvre, plutot que de passer dessous : on doit pouvoir
          lire la carte qu'on est en train de modifier. */}
      <div className="flex flex-1 overflow-hidden">
      {onglet === 'parcours' && lumiLateral && !lumiReduit && (
        <ClavardageLumi
          fr={fr}
          variante="lateral"
          echanges={echangesLumi}
          genere={genere}
          prompt={prompt}
          onPrompt={setPrompt}
          onEnvoyer={() => void construireAvecLumi()}
          textareaId={`${idsPage}-prompt`}
          textareaRef={champLumi}
          onReduire={() => setLumiReduit(true)}
        />
      )}
      <div className="relative flex-1 overflow-hidden">
        {onglet === 'parcours' && lumiLateral && lumiReduit && (
          <button
            type="button"
            onClick={() => { setLumiReduit(false); window.setTimeout(() => champLumi.current?.focus(), 0); }}
            className="absolute left-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-card px-3 py-1.5 text-xs font-medium text-text-primary shadow-sm transition-colors hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            {fr ? 'Lumi' : 'Lumi'}
          </button>
        )}
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
                {/* ── Le champ « Décris ton automatisation à Lumi » ──
                    Il reste visible EN PERMANENCE, comme chez GoHighLevel :
                    il disparaissait dès la première étape ajoutée, or c'est
                    précisément quand un parcours existe qu'on veut demander
                    « ajoute une relance » ou « et si le client ne répond pas ».
                    Signalé le 2026-09-25 : « je mets une étape, l'IA n'est
                    plus là ». ── */}
                {/* ── Ce qui empêcherait le parcours de fonctionner ──
                    Affiché PENDANT la construction, pas seulement au clic sur
                    « Publier » : découvrir à la fin qu'une action ne va pas
                    avec son déclencheur, c'est le découvrir trop tard.
                    Cliquer un problème ouvre l'étape fautive. ── */}
                {/*
                  PAS sur un canevas vide et non publié : une automatisation
                  qu'on vient d'ouvrir accueillait son auteur par une alerte
                  rouge « 1 chose(s) à corriger — ajoutez au moins une étape »,
                  avant qu'il ait touché à quoi que ce soit (vu sur lumecrm.net
                  le 2026-10-01). Le canevas le dit déjà (« Ajouter une
                  première étape »), et « Publier » le rappelle si on essaie.
                */}
                {bloquantsVivants.length > 0 && (regle.is_active || etapesAffichees.length > 0) && (
                  <div className="mx-auto mb-4 max-w-xl px-4">
                    <div className="rounded-xl border border-danger/40 bg-danger/5 p-3">
                      <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-danger">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        {/* Publiée ET cassée (règle d'avant la garde serveur,
                            A-03) : « avant de publier » mentait — elle l'est. */}
                        {regle.is_active
                          ? (fr
                            ? `Publiée mais cassée : ${bloquantsVivants.length} ${bloquantsVivants.length > 1 ? 'choses' : 'chose'} à corriger — rien ne part correctement`
                            : `Published but broken: ${bloquantsVivants.length} ${bloquantsVivants.length > 1 ? 'things' : 'thing'} to fix — nothing goes out correctly`)
                          : (fr
                            ? `${bloquantsVivants.length} ${bloquantsVivants.length > 1 ? 'choses' : 'chose'} à corriger avant de publier`
                            : `${bloquantsVivants.length} ${bloquantsVivants.length > 1 ? 'things' : 'thing'} to fix before publishing`)}
                      </p>
                      <ul className="space-y-1">
                        {bloquantsVivants.slice(0, 4).map((p, i) => (
                          <li key={`${p.message}-${i}`}>
                            {p.etapeId ? (
                              <button
                                type="button"
                                onClick={() => { if (p.etapeId) void ouvrirEtape(p.etapeId); }}
                                className="text-left text-[12px] text-text-secondary underline decoration-dotted underline-offset-2 transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                {p.message}
                              </button>
                            ) : (
                              <span className="text-[12px] text-text-secondary">{p.message}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* Avant le premier message : l'invitation au centre. Dès le
                    premier message, le fil passe en panneau à gauche. */}
                {!lumiDisponible && (
                  <div className="mx-auto mb-4 max-w-xl px-4">
                    <div className="rounded-2xl border border-border bg-surface-card p-5 text-center shadow-sm">
                      <p className="flex items-center justify-center gap-2 text-sm font-medium text-text-primary">
                        <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
                        {fr ? 'Construire avec Lumi — inclus dans Autopilot' : 'Build with Lumi — included in Autopilot'}
                      </p>
                      <p className="mt-1.5 text-[12px] text-text-secondary">
                        {fr
                          ? 'Décris ton automatisation en une phrase et Lumi la monte pour toi. En attendant, bâtis-la avec la carte « Quand » et le « + ».'
                          : 'Describe your automation in one sentence and Lumi builds it. Meanwhile, build it with the “When” card and “+”.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => navigate('/settings/billing')}
                        className="glass-button mt-3 inline-flex items-center gap-1.5 text-[12px]"
                      >
                        {fr ? 'Voir Autopilot' : 'See Autopilot'}
                      </button>
                    </div>
                  </div>
                )}
                {lumiDisponible && !lumiLateral && (
                  <div className="mx-auto mb-4 flex max-w-xl flex-col items-center px-4">
                    <ClavardageLumi
                      fr={fr}
                      variante="carte"
                      echanges={echangesLumi}
                      genere={genere}
                      prompt={prompt}
                      onPrompt={setPrompt}
                      onEnvoyer={() => void construireAvecLumi()}
                      textareaId={`${idsPage}-prompt`}
                      textareaRef={champLumi}
                      pied={
                        /* Des départs tout faits : on ne part jamais de rien. */
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
                      }
                    />
                  </div>
                )}

                {/* ── Le format d'origine, annoncé franchement ──
                    On montre le parcours RÉEL (projeté depuis `actions`) au
                    lieu d'un canevas vide, et on dit pourquoi il n'est pas
                    modifiable. Convertir reste un geste explicite : jamais
                    en silence sur une règle qui écrit à de vrais clients. ── */}
                {formatOrigine && (
                  <div className="mx-auto mb-4 max-w-xl px-4">
                    <div className="rounded-xl border border-warning/40 bg-warning-light p-3">
                      <p className="text-[13px] font-semibold text-warning">
                        {fr ? 'Parcours au format d’origine' : 'Journey in the original format'}
                      </p>
                      <p className="mt-1 text-[12px] text-text-secondary">
                        {fr
                          ? 'Cette automatisation fonctionne normalement. Cliquez sur une étape pour la modifier : le parcours sera converti, les envois ne changent pas.'
                          : 'This automation works normally. Click a step to edit it: the journey will be converted, what it sends does not change.'}
                      </p>

                      {/*
                        Convertir n'est proposé QUE si rien ne se perd. Une
                        règle qui écrit la trace interne (`log_activity`,
                        100 règles de prod sur 250) n'est pas convertible :
                        le serveur refuserait le parcours, et la convertir en
                        retirant cette étape effacerait son historique en
                        silence. On le dit plutôt que d'offrir un bouton qui
                        échoue.
                      */}
                      {conversion?.possible ? (
                        <button
                          type="button"
                          onClick={() => void convertirParcours()}
                          disabled={conversionEnCours}
                          className="glass-button mt-2 inline-flex items-center gap-1.5 text-[12px] disabled:opacity-50"
                        >
                          {conversionEnCours
                            ? (fr ? 'Conversion…' : 'Converting…')
                            : (fr ? 'Convertir en parcours modifiable' : 'Convert to an editable journey')}
                        </button>
                      ) : (
                        <p className="mt-2 text-[12px] text-text-tertiary">
                          {fr
                            ? 'Ce parcours contient une étape technique qui ne se convertit pas : il reste en lecture seule pour ne rien perdre.'
                            : 'This journey contains a technical step that cannot be converted: it stays read-only so nothing is lost.'}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {etapesAffichees.length === 0 ? (
                  <div className="mx-auto flex max-w-xl flex-col items-center px-4">

                    <span className="my-4 text-xs text-text-tertiary">{fr ? 'ou' : 'or'}</span>

                    {/* Un parcours commence par son DÉCLENCHEUR, pas par une
                        action : c'est lui qui décide de l'entité qui arrivera,
                        donc des actions qui auront un sens ensuite. On montre
                        celui qui est choisi, et un clic l'échange. */}
                    <button
                      type="button"
                      onClick={() => setTiroirDeclencheur(true)}
                      className="w-full max-w-[300px] rounded-xl border-2 border-dashed border-accent/50 bg-accent/5 px-4 py-4 text-sm font-medium text-accent transition-colors hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {/*
                        Le déclencheur EN PLACE est dit en clair, puis l'invitation
                        à en changer. « Choisir le déclencheur » avec « Devis
                        envoyé » en petit dessous laissait croire qu'aucun n'était
                        choisi (signalé par deux testeurs le 2026-10-01) — or la
                        règle part bel et bien sur celui-là.
                      */}
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-accent/80">
                        {fr ? 'Quand' : 'When'}
                      </span>
                      <span className="block text-sm font-semibold text-text-primary">{declencheurLabel}</span>
                      <span className="mt-1 block text-[11px] font-normal text-text-secondary">
                        {fr ? 'Cliquer pour choisir un autre déclencheur' : 'Click to pick another trigger'}
                      </span>
                    </button>

                    {/*
                      Les réglages du déclencheur, atteignables AUSSI sur un
                      canevas vide.
                      Sans ce bouton, « Date atteinte » ne pouvait être réglé
                      qu'une fois une étape ajoutée — or on choisit son
                      déclencheur AVANT de bâtir le parcours. Le réglage
                      manquant est bloquant à la publication : on se serait
                      retrouvé coincé sans savoir où cliquer.
                    */}
                    {declencheurReglable ? (
                      <button
                        type="button"
                        onClick={() => setReglageDeclencheur(true)}
                        className="mt-2 w-full max-w-[300px] rounded-lg border border-border px-3 py-2 text-[12px] text-text-secondary transition-colors hover:border-accent hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {declencheurDetail ?? (fr ? 'Régler le déclencheur' : 'Configure the trigger')}
                      </button>
                    ) : null}

                    {/* Le connecteur, comme sur le canevas garni. */}
                    <svg width="2" height="28" className="my-1 text-border" aria-hidden="true">
                      <line x1="1" y1="0" x2="1" y2="28" stroke="currentColor" strokeWidth="2" />
                    </svg>

                    <button
                      type="button"
                      onClick={() => ouvrirAjout(null)}
                      className="w-full max-w-[300px] rounded-xl border-2 border-dashed border-border px-4 py-4 text-sm font-medium text-text-secondary transition-colors hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Plus className="mx-auto mb-1 h-5 w-5" aria-hidden="true" />
                      {fr ? 'Ajouter une première étape' : 'Add a first step'}
                    </button>

                    <svg width="2" height="20" className="mt-1 text-border" aria-hidden="true">
                      <line x1="1" y1="0" x2="1" y2="20" stroke="currentColor" strokeWidth="2" />
                    </svg>
                    <span className="mt-1 rounded-full bg-surface-tertiary px-3 py-1 text-[11px] font-medium text-text-tertiary">
                      {fr ? 'FIN' : 'END'}
                    </span>
                  </div>
                ) : (
                  catalogue && (
                    <SequenceCanvas
                      declencheurLabel={declencheurLabel}
                      steps={etapesAffichees}
                      fr={fr}
                      lectureSeule={formatOrigine}
                      selectionId={etapeChoisie}
                      // Format d'origine : le clic convertit, puis ouvre l'étape.
                      onSelection={(idEtape) => (formatOrigine ? void convertirParcours(idEtape) : void ouvrirEtape(idEtape))}
                      onAjouter={ouvrirAjout}
                      onMenu={setMenuEtape}
                      onDeclencheur={ouvrirDeclencheur}
                      declencheurDetail={declencheurDetail}
                      etapesEnErreur={etapesEnErreur}
                    />
                  )
                )}
              </div>
            </div>

            {/* Le menu « … » d'une carte — dupliquer, supprimer, supprimer
                la suite. Un voile couvre l'écran pour que le premier clic à
                côté referme le menu, plutôt qu'il reste ouvert derrière. */}
            {menuEtape && (
              <>
                <button
                  type="button"
                  aria-label={fr ? 'Fermer le menu' : 'Close menu'}
                  onClick={() => setMenuEtape(null)}
                  className="absolute inset-0 z-20 cursor-default focus:outline-none"
                />
                <div className="absolute left-1/2 top-24 z-30 w-[260px] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface-card py-1 shadow-lg">
                  {/* Seule une ACTION se duplique : « Dupliquer » proposé sur une
                      condition ne faisait rien et laissait le menu ouvert
                      (audit V2, A-13). Les autres étapes disent « l'étape ». */}
                  {(() => {
                    const estAction = steps.find((e) => e.id === menuEtape)?.type === 'action';
                    return ([
                      ['dupliquer', fr ? 'Dupliquer l’action' : 'Duplicate action'],
                      ['modifier', estAction ? (fr ? 'Modifier l’action' : 'Edit action') : (fr ? 'Modifier l’étape' : 'Edit step')],
                      ['supprimer', estAction ? (fr ? 'Supprimer l’action' : 'Delete action') : (fr ? 'Supprimer l’étape' : 'Delete step')],
                      ['depuis', fr ? 'Supprimer à partir d’ici' : 'Delete from here'],
                    ] as const).filter(([cle]) => cle !== 'dupliquer' || estAction);
                  })().map(([cle, libelle]) => (
                    <button
                      key={cle}
                      type="button"
                      onClick={() => {
                        const id = menuEtape;
                        if (!id) return;
                        if (cle === 'dupliquer' && ajoutEnAttente) { setMenuEtape(null); quandPanneauLibre(() => dupliquerEtape(id)); }
                        else if (cle === 'dupliquer') dupliquerEtape(id);
                        else if (cle === 'modifier') { setMenuEtape(null); void ouvrirEtape(id); }
                        else if (cle === 'supprimer') { setMenuEtape(null); void supprimerEtape(id); }
                        else void supprimerDepuis(id);
                      }}
                      className={cn(
                        'block w-full px-3 py-2 text-left text-xs transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        cle === 'supprimer' || cle === 'depuis'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-text-primary',
                      )}
                    >
                      {libelle}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Ce que Lumi a compris — au-dessus du canevas, comme leur
                bandeau « Explain this workflow ». L'utilisateur doit pouvoir
                vérifier d'un coup d'œil avant de publier. */}
            {/* L'aperçu — ce qui partirait, et à qui. Rien n'est envoyé.
                Un texte écrit avec une variable inexistante donne
                « Bonjour , » : ça saute aux yeux ici, jamais dans
                l'éditeur. */}
            {apercu && (
              <div className="absolute inset-0 z-30 flex items-start justify-center overflow-y-auto bg-surface/80 p-6 backdrop-blur-sm">
                <div className="w-full max-w-lg rounded-2xl border border-border bg-surface-card p-4 shadow-lg">
                  <div className="mb-3 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-sm font-semibold text-text-primary">
                        {fr ? 'Ce qui partirait' : 'What would go out'}
                      </h2>
                      <p className="mt-0.5 text-[11px] font-medium text-text-secondary">
                        {fr ? 'Aperçu seulement — rien n’est envoyé.' : 'Preview only — nothing is sent.'}
                      </p>
                      {apercu.client ? (
                        <p className="mt-0.5 text-[11px] text-text-tertiary">
                          {fr ? 'Exemple avec ' : 'Example with '}
                          <span className="font-medium text-text-secondary">{apercu.client.nom}</span>
                          {apercu.client.email ? ` · ${apercu.client.email}` : ''}
                          {' · '}
                          {fr ? 'rien n’est envoyé' : 'nothing is sent'}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[11px] text-text-tertiary">{apercu.message}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setApercu(null)}
                      aria-label={fr ? 'Fermer l’aperçu' : 'Close preview'}
                      className="shrink-0 rounded-md p-1 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  {apercu.apercu.length === 0 ? (
                    <p className="py-4 text-center text-xs text-text-tertiary">
                      {fr ? 'Aucune étape à montrer.' : 'No step to show.'}
                    </p>
                  ) : (
                    <ol className="space-y-2">
                      {apercu.apercu.map((e, i) => {
                        const modele = trouverAction(e.action);
                        return (
                          <li key={`${e.action}-${i}`} className="rounded-xl border border-border p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
                              {e.nom || (modele ? (fr ? modele.fr : modele.en) : e.action)}
                            </p>
                            {Object.entries(e.rendu).length === 0 ? (
                              <p className="mt-1 text-[12px] italic text-text-tertiary">
                                {fr ? '(rien à afficher)' : '(nothing to show)'}
                              </p>
                            ) : (
                              Object.entries(e.rendu).map(([cle, valeur]) => {
                                const champ = modele?.champs?.find((c) => c.cle === cle);
                                // Un CHOIX se lit par son libellé (« Le propriétaire »),
                                // jamais par sa clé brute (audit V2, A-15).
                                const option = champ?.type === 'choix' ? champ.options?.find((o) => o.cle === valeur) : undefined;
                                return (
                                  <div key={cle} className="mt-1.5">
                                    <span className="block text-[10px] uppercase text-text-tertiary">
                                      {champ ? (fr ? champ.fr : champ.en) : cle}
                                    </span>
                                    <span className="block whitespace-pre-wrap text-[13px] text-text-primary">
                                      {option ? (fr ? option.fr : option.en) : valeur}
                                    </span>
                                  </div>
                                );
                              })
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              </div>
            )}

            {/*
              Le bandeau flotte AU-DESSUS du canevas, là où se trouve la carte
              du déclencheur. Deux règles pour qu'il ne la cache pas :
               · quand la conversation est ouverte à gauche, la réponse y est
                 déjà, en entier et mise en forme : pas de bandeau ;
               · sinon, la PREMIÈRE phrase seulement. La réponse complète
                 (nouveaux textes, étapes retirées…) tient en plusieurs
                 paragraphes : aplatie ici, elle recouvrait le déclencheur
                 (constaté en prod le 2026-10-01).
            */}
            {resumeLumi && !(lumiLateral && !lumiReduit) && (
              <div className="absolute left-1/2 top-4 z-10 flex max-w-[520px] -translate-x-1/2 items-start gap-2 rounded-xl border border-accent/40 bg-surface-card px-3 py-2 shadow-sm">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
                <p className="text-[12px] text-text-primary">{resumeLumi.split('\n\n')[0]}</p>
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

            {/* Ajouter — en haut à droite, comme chez GHL.
                Il ouvrait un simple message : il ajoute maintenant une étape
                à la FIN du parcours, ce que son libellé promettait.
                PAS sur une règle au format d'origine (lecture seule) : une
                étape ajoutée enregistrait `steps`, et le moteur, qui suit
                `steps` dès qu'il y en a, abandonnait en silence le texto et
                la tâche d'origine (audit V2, A-02). On passe par
                « Convertir », qui montre ce qui change. */}
            {!formatOrigine && (
            <button
              type="button"
              onClick={() => {
                // La vraie fin du chemin principal, parcourue depuis la tête —
                // pas le dernier élément du tableau (A-05).
                const fin = finDuParcours(steps);
                ouvrirAjout(fin.apresId, fin.branche);
              }}
              className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-text-primary shadow-sm transition-colors hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {fr ? 'Ajouter' : 'Add'}
            </button>
            )}

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
        {/* Un brouillon jamais enregistré n'a ni historique, ni journaux, ni
            réglages à écrire : on le dit au lieu d'interroger la base avec
            un identifiant vide. */}
        {onglet !== 'parcours' && !regle.id && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <p className="text-sm text-text-secondary">
              {fr
                ? 'Cette automatisation n’est pas encore enregistrée : ajoutez une première étape.'
                : 'This automation is not saved yet: add a first step.'}
            </p>
          </div>
        )}
        {onglet === 'historique' && regle.id && <div className="absolute inset-0 overflow-y-auto"><OngletHistorique ruleId={regle.id} fr={fr} /></div>}
        {onglet === 'journaux' && regle.id && <div className="absolute inset-0 overflow-y-auto"><OngletJournaux ruleId={regle.id} fr={fr} /></div>}

        {onglet === 'reglages' && regle.id && (
          <div className="absolute inset-0 overflow-y-auto">
            <OngletReglages
              ruleId={regle.id}
              reglages={(regle.settings ?? null) as ReglagesAutomatisation | null}
              fr={fr}
              enregistrer={ecrire}
              onChange={(r) => setRegle((x) => (x ? { ...x, settings: r as Record<string, unknown> | null } : x))}
            />
          </div>
        )}
      </div>

      {/* Les deux tiroirs et le panneau se partagent la place à droite.
          Un seul à la fois : ouvrir un tiroir ferme l'édition en cours,
          sinon deux panneaux de 380 px écraseraient le canevas. */}
      {onglet === 'parcours' && tiroirDeclencheur && (
        <TiroirChoix
          titre={fr ? 'Déclencheurs' : 'Triggers'}
          sousTitre={fr ? 'Ce qui met l’automatisation en route' : 'What starts the automation'}
          familles={FAMILLES_DECLENCHEURS}
          choix={choixDeclencheurs}
          fr={fr}
          onChoisir={choisirDeclencheur}
          onFermer={() => setTiroirDeclencheur(false)}
        />
      )}

      {/* Les réglages du déclencheur — « quelle date surveiller ? ».
          Avant le tiroir d'ajout : un seul panneau à droite à la fois. */}
      {onglet === 'parcours' && !tiroirDeclencheur && reglageDeclencheur && declencheurCourant && declencheurReglable && (
        <PanneauDeclencheur
          declencheur={declencheurCourant}
          conditions={(regle?.conditions ?? null) as Record<string, unknown> | null}
          reglages={(regle?.settings ?? null) as Record<string, unknown> | null}
          fr={fr}
          champsDate={champsDate}
          etapesPipeline={etapesPipeline}
          etiquettes={etiquettes}
          services={servicesCatalogue}
          champsPerso={champsPerso}
          onChanger={() => { setReglageDeclencheur(false); setTiroirDeclencheur(true); }}
          onEnregistrer={enregistrerDeclencheur}
          onFermer={() => setReglageDeclencheur(false)}
          onModifie={signalerBrouillonDeclencheur}
        />
      )}

      {onglet === 'parcours' && !tiroirDeclencheur && !reglageDeclencheur && ajoutEnCours && (
        <TiroirChoix
          titre={fr ? 'Actions' : 'Actions'}
          sousTitre={fr ? 'Ce que l’automatisation fera' : 'What the automation will do'}
          familles={[
            ...FAMILLES_ACTIONS,
            { cle: 'logique', fr: 'Parcours', en: 'Journey' },
          ]}
          choix={choixEtapes}
          fr={fr}
          onChoisir={confirmerAjout}
          onFermer={() => setAjoutEnCours(null)}
        />
      )}

      {/* Le panneau d'edition — la moitie qui manquait. Jamais À CÔTÉ des
          réglages du déclencheur : un seul panneau à droite. */}
      {onglet === 'parcours' && !tiroirDeclencheur && !panneauDeclencheurAffiche && !ajoutEnCours && etapeOuverte && (
        <PanneauEtape
          etape={etapeOuverte}
          fr={fr}
          declencheur={regle.trigger_event}
          membres={membres}
          etiquettes={etiquettes}
          automatisations={autresAutomatisations}
          etapesPipeline={etapesPipeline}
          champsPerso={champsPerso}
          objetChamps={objetRegle}
          stats={statsEtapes?.[etapeOuverte.id] ?? null}
          nouvelle={ajoutEnAttente?.etape.id === etapeOuverte.id}
          modifieePar={modifieePar}
          onEnregistrer={enregistrerEtape}
          onSupprimer={supprimerEtape}
          onFermer={() => { setEtapeChoisie(null); setEtapeEnAttente(null); }}
          onModifie={signalerBrouillonEtape}
        />
      )}
      </div>
    </div>
  );
}
