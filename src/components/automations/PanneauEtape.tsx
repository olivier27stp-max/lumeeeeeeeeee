/* ═══════════════════════════════════════════════════════════════
   Le panneau d'édition d'une étape — celui de GoHighLevel.

   C'était LE trou : cliquer une carte sélectionnait l'étape et n'ouvrait
   rien. On voyait son parcours sans jamais pouvoir le modifier.

   Ce panneau reprend, élément par élément, celui de leur capture :

     ┌──────────────────────────────────────┐
     │ [icône] Courriel                  ✕  │  ← en-tête : l'action
     │         Envoyer un courriel au client│
     ├──────────────────────────────────────┤
     │  Modifier l'action  │  Statistiques  │  ← deux onglets
     ├──────────────────────────────────────┤
     │ Nom de l'action *                    │
     │ [Courriel de confirmation          ] │
     │ Objet *                              │
     │ [...]                                │  ← les champs du catalogue
     ├──────────────────────────────────────┤
     │ Supprimer      Annuler   Enregistrer │  ← le pied
     └──────────────────────────────────────┘

   ── Pourquoi un brouillon local ────────────────────────────────
   Le panneau travaille sur une COPIE de l'étape, et ne la renvoie qu'au
   moment d'enregistrer. C'est ce qui donne un vrai « Annuler » : sans
   copie, chaque frappe modifierait le parcours et le bouton ne pourrait
   rien annuler du tout.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { X, Trash2, BarChart3, Pencil } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  ACTIONS,
  DELAI_MAX_SECONDES,
  DELAI_NEGATIF_MAX_SECONDES,
  FAMILLES_ACTIONS,
  actionCompatible,
  champVisible,
  fauteDeValeur,
  trouverAction,
} from '../../lib/automationCatalogue';
import type { ChampAction as ModeleChamp } from '../../lib/automationCatalogue';
import type { Etape, EtapeAction, EtapeAttendre, EtapeSi } from '../../lib/sequenceTypes';
import ChampActionUI from './ChampAction';
import {
  BoutonsVariablesChamps, ConditionsChampsEtape, EditeurMajChamp, sansConditionsIncompletes,
} from '../champs/automatisations';
import type { ChampPerso, ObjetChamp } from '../../lib/champs/types';
import { estCorpsHtml, htmlVersTexte, texteVersHtml, variablesInconnues, variableLisible } from '../../lib/emailBodyText';
import { confirmer } from '../ui/ConfirmDialog';
import { analyserConditions, conditionsConservees, texteDesConditions } from '../../lib/conditionsEtapeSi';
import AutreVersionMessage, { AvisRetraitAutreVersion, type ChoixAutreVersion } from './AutreVersionMessage';

/** Les conditions d'une étape « si », en texte modifiable (règles : src/lib/conditionsEtapeSi.ts). */
const texteSi = (etape: Etape, fr: boolean): string => (etape.type === 'si' ? texteDesConditions(etape.conditions, fr) : '');

/**
 * Les conditions de champs d'une étape « si », à GARDER quand le texte est
 * réanalysé : le texte ne les porte pas, les perdre à chaque frappe
 * effacerait ce que l'éditeur de champs vient d'ajouter.
 */
function champsPersoDe(etape: Etape): Record<string, unknown> {
  const liste = etape.type === 'si' ? etape.conditions?.champs_perso : undefined;
  return Array.isArray(liste) ? { champs_perso: liste } : {};
}

/**
 * LA VERSION ANGLAISE D'UN TEXTE (`<cle>_en`) — triage actions, ligne 2.
 *
 * Le moteur l'envoie À LA PLACE du texte français quand la langue du bureau
 * est l'anglais (`champLocalise`, server/lib/actions). Les automatisations
 * fournies en portent une, et « Convertir » la garde. Le panneau ne montrait
 * que le français : on corrigeait « 20 % jusqu'au 1er juin » pendant que
 * « 10% off until May 1st. », invisible, continuait de partir.
 *
 * Elle est donc un champ comme un autre — même contrôle, même compteur, mêmes
 * variables — affiché dès que l'étape en porte une.
 *
 * AJUSTEMENT (décision du coordinateur, après revérification de 539be241) :
 *   · le champ PRINCIPAL montre le texte que le bureau ENVOIE — `body` s'il
 *     envoie en français, `body_en` s'il envoie en anglais (`langueEnvoi`,
 *     le réglage « Messages en FR / EN ») ;
 *   · l'AUTRE langue vit dans un bloc secondaire, replié par défaut ;
 *   · corriger le texte principal sans toucher à l'autre ne bloque JAMAIS
 *     « Enregistrer » : le bloc se déplie, dit « Cette version n'est plus à
 *     jour. » et offre « La retirer » (coché d'office) ou « La garder ».
 *     Rien n'est retiré en silence, rien de périmé ne reste sans choix.
 * Le bloc secondaire est le composant PARTAGÉ `AutreVersionMessage` (éditeur
 * de courriel, texto de la liste, Réglages › Messagerie) : un seul bloc par
 * étape, qui porte tous ses textes de l'autre langue (objet et message), et
 * les mêmes mots sur tous les écrans, par construction (décision du
 * coordinateur, 2026-10-02).
 * Une version retirée disparaît de l'étape : le moteur retombe sur `body`
 * (`champLocalise`). Dans un bureau qui envoie en anglais, « retirer la
 * version française » fait donc du texte anglais le SEUL texte : il passe
 * dans `body`, et `body_en` disparaît.
 */
const cleAnglaise = (cle: string): string => `${cle}_en`;
const aVersionAnglaise = (champ: ModeleChamp): boolean => champ.type === 'zone' || champ.type === 'texte';
/** Le champ de l'AUTRE langue, dans son bloc secondaire. */
function champAutreLangue(champ: ModeleChamp, cle: string, autreEstAnglais: boolean): ModeleChamp {
  return {
    ...champ,
    cle,
    fr: `${champ.fr} — version ${autreEstAnglais ? 'anglaise' : 'française'}`,
    en: `${champ.en} — ${autreEstAnglais ? 'English' : 'French'} version`,
    obligatoire: false,
    defaut_fr: undefined,
    defaut_en: undefined,
    aide_fr: `Part à la place du texte ci-dessus si vos messages partent en ${autreEstAnglais ? 'anglais' : 'français'}. Vide = le texte ci-dessus part à tout le monde.`,
    aide_en: `Sent instead of the text above if your messages go out in ${autreEstAnglais ? 'English' : 'French'}. Empty = the text above goes to everyone.`,
  };
}

/** L'étape telle qu'on l'enregistre : une version anglaise VIDÉE disparaît, au lieu de rester en `""`. */
function sansAnglaisVide(etape: Etape): Etape {
  if (etape.type !== 'action') return etape;
  const config = Object.fromEntries(
    Object.entries(etape.action.config).filter(([cle, v]) => !(cle.endsWith('_en') && (v ?? '').trim() === '')),
  );
  return { ...etape, action: { ...etape.action, config } };
}

/**
 * L'étape telle qu'on l'enregistre, une fois RETIRÉES les autres versions
 * qu'on a choisi de retirer : il ne reste qu'un texte, sous la clé de base —
 * celle que le moteur lit quand la version demandée manque.
 */
function sansVersionsRetirees(etape: Etape, aRetirer: Array<{ cle: string; principalEstAnglais: boolean }>): Etape {
  if (etape.type !== 'action' || aRetirer.length === 0) return etape;
  const config = { ...etape.action.config };
  for (const { cle, principalEstAnglais } of aRetirer) {
    const cleEn = cleAnglaise(cle);
    // Le bureau envoie en anglais : c'est le texte anglais qu'on garde, seul.
    if (principalEstAnglais) config[cle] = config[cleEn];
    delete config[cleEn];
  }
  return { ...etape, action: { ...etape.action, config } };
}

/**
 * LE CORPS D'UN COURRIEL FOURNI EST DU HTML — triage actions, ligne 3.
 *
 * Les automatisations fournies stockent `<div style="font-family:…"><h2>…` :
 * nécessaire à l'envoi, illisible pour qui veut changer une phrase. Le panneau
 * montrait ce balisage brut dans « Message ». Comme l'éditeur de la liste
 * (MessageEditor), on édite donc du TEXTE :
 *   · à l'ouverture, le HTML devient son texte (`htmlVersTexte`) ;
 *   · à l'enregistrement, un texte INCHANGÉ rend le HTML d'origine, à
 *     l'octet près ; un texte modifié est remis en HTML (`texteVersHtml`).
 * Un corps écrit en texte simple (toute étape créée dans l'éditeur) n'est
 * jamais touché : il est enregistré tel qu'on l'a tapé.
 */
const CLES_CORPS_COURRIEL = ['body', cleAnglaise('body')];

/** L'étape telle que le panneau l'édite, et ce qu'il faut pour rendre le HTML à l'enregistrement. */
function versEdition(etape: Etape): { etape: Etape; html: Record<string, { html: string; texte: string }> } {
  const html: Record<string, { html: string; texte: string }> = {};
  if (etape.type !== 'action' || etape.action.type !== 'send_email') return { etape, html };
  const config = { ...etape.action.config };
  for (const cle of CLES_CORPS_COURRIEL) {
    const valeur = config[cle];
    if (!estCorpsHtml(valeur)) continue;
    html[cle] = { html: valeur, texte: htmlVersTexte(valeur) };
    config[cle] = html[cle].texte;
  }
  return Object.keys(html).length ? { etape: { ...etape, action: { ...etape.action, config } }, html } : { etape, html };
}

/** L'inverse, au moment d'enregistrer. Une étape devenue autre chose qu'un courriel garde le TEXTE. */
function versEnregistrement(etape: Etape, html: Record<string, { html: string; texte: string }>): Etape {
  if (etape.type !== 'action' || etape.action.type !== 'send_email') return etape;
  const config = { ...etape.action.config };
  for (const [cle, origine] of Object.entries(html)) {
    const valeur = config[cle];
    if (typeof valeur !== 'string' || valeur.trim() === '') continue;
    // Un texte resté tel quel retrouve SON HTML — y compris passé d'une clé à
    // l'autre (la version anglaise devenue le seul texte, voir `sansVersionsRetirees`).
    const intact = valeur === origine.texte ? origine : Object.values(html).find((o) => o.texte === valeur);
    config[cle] = intact ? intact.html : texteVersHtml(valeur);
  }
  return { ...etape, action: { ...etape.action, config } };
}

/** Les variables offertes, insérables d'un clic dans un champ de texte. */
const VARIABLES = [
  { cle: 'client_name', fr: 'Nom du client', en: 'Client name' },
  { cle: 'company_name', fr: 'Nom de votre entreprise', en: 'Your business name' },
  { cle: 'invoice_total', fr: 'Total', en: 'Total' },
  { cle: 'invoice_link', fr: 'Lien facture', en: 'Invoice link' },
  { cle: 'quote_link', fr: 'Lien du devis', en: 'Quote link' },
  { cle: 'appointment_date', fr: 'Date du rendez-vous', en: 'Appointment date' },
];

interface Props {
  etape: Etape;
  fr: boolean;
  /**
   * Le déclencheur de la règle.
   *
   * Il décide de l'ENTITÉ qui arrivera (un devis, une facture, un
   * rendez-vous), donc des actions qui ont un sens : « envoyer la facture »
   * après « soumission envoyée » ne peut pas marcher. On les retire du menu
   * plutôt que de laisser publier un parcours qui échouera en silence.
   */
  declencheur?: string;
  membres: Array<{ user_id: string; nom: string }>;
  etiquettes: string[];
  /** Autres automatisations publiées, pour « Démarrer une automatisation ». */
  automatisations?: Array<{ id: string; nom: string }>;
  /** Étapes des pipelines du bureau, pour « Déplacer l’opportunité → Une étape précise ». */
  etapesPipeline?: Array<{ id: string; label: string }>;
  /** Champs personnalisés actifs : action « Mettre à jour un champ », conditions, variables. */
  champsPerso?: ChampPerso[];
  /**
   * L'objet de la fiche que l'événement fera arriver (client, deal…), déduit
   * du déclencheur ET de ses réglages (« Date atteinte » sur un champ du
   * deal → deal). `null` = inconnu.
   */
  objetChamps?: ObjetChamp | null;
  /** Statistiques de l'étape, pour l'onglet du même nom. */
  stats?: { envoyes: number; sautes: number; echecs: number; en_attente: number } | null;
  /**
   * L'étape vient d'être choisie dans le tiroir et n'est PAS encore dans le
   * parcours : « Enregistrer » l'y ajoute, fermer le panneau l'abandonne —
   * ce qui se demande, comme toute saisie non enregistrée.
   */
  nouvelle?: boolean;
  /**
   * Qui vient de modifier le parcours HORS de ce panneau : Lumi, ou autre
   * chose (annuler / rétablir, rechargement). Sert à nommer l'auteur quand
   * l'étape ouverte change pendant une saisie.
   */
  modifieePar?: 'lumi' | 'autre' | null;
  /**
   * La langue dans laquelle le bureau ENVOIE ses messages (réglage « Messages
   * en FR / EN », `company_settings.default_language`) : c'est ce texte-là
   * que le champ principal montre. Inconnue : français, le défaut du moteur.
   */
  langueEnvoi?: 'fr' | 'en';
  onEnregistrer: (etape: Etape) => void;
  onSupprimer: (id: string) => void;
  onFermer: () => void;
  /**
   * Le brouillon diffère-t-il de l'étape enregistrée ? Le parent s'en sert
   * pour demander confirmation avant d'ouvrir une AUTRE carte.
   */
  onModifie?: (modifie: boolean) => void;
}

/** Les unités de délai proposées pour une attente. */
const UNITES: Array<{ cle: string; secondes: number; fr: string; en: string }> = [
  { cle: 'minutes', secondes: 60, fr: 'minutes', en: 'minutes' },
  { cle: 'heures', secondes: 3600, fr: 'heures', en: 'hours' },
  { cle: 'jours', secondes: 86400, fr: 'jours', en: 'days' },
];

/** Décompose un délai en la plus grande unité qui tombe juste. */
function decomposer(secondes: number): { valeur: number; unite: string } {
  if (secondes > 0 && secondes % 86400 === 0) return { valeur: secondes / 86400, unite: 'jours' };
  if (secondes > 0 && secondes % 3600 === 0) return { valeur: secondes / 3600, unite: 'heures' };
  return { valeur: Math.max(0, Math.round(secondes / 60)), unite: 'minutes' };
}

/**
 * Le délai d'une attente TEL QU'ON LE SAISIT — triage actions, ligne 4 : le
 * nombre, en texte (donc vide le temps de le retaper), et l'unité CHOISIE.
 *
 * Les deux étaient recalculés à chaque frappe depuis les secondes : effacer le
 * « 3 » de « 3 jours » donnait 0 seconde, donc « 0 minutes », et le 5 tapé
 * ensuite devenait « 05 minutes ». Trois jours étaient devenus cinq minutes.
 */
interface SaisieDelai { texte: string; unite: string }
function saisieDelaiDe(etape: Etape): SaisieDelai {
  if (etape.type !== 'attendre') return { texte: '', unite: 'minutes' };
  const d = decomposer((etape.mode === 'avant_date' ? etape.secondes_avant : etape.delai_secondes) ?? 0);
  return { texte: String(d.valeur), unite: d.unite };
}
/** Le nombre saisi, s'il se lit comme une durée (0 ou plus) ; sinon `null`. */
function nombreSaisi(texte: string): number | null {
  const t = texte.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function PanneauEtape({
  etape, fr, declencheur, membres, etiquettes, automatisations = [], etapesPipeline = [], champsPerso = [], objetChamps = null, stats,
  nouvelle = false, modifieePar = null, langueEnvoi = 'fr', onEnregistrer, onSupprimer, onFermer, onModifie,
}: Props) {
  const ids = useId();
  const [onglet, setOnglet] = useState<'edition' | 'stats'>('edition');
  /**
   * L'étape TELLE QU'ON L'ÉDITE : le corps HTML d'un courriel fourni y est du
   * texte (voir `versEdition`). C'est à elle, pas à `etape`, que le brouillon
   * se compare pour savoir si quelque chose a changé.
   */
  const reference = useMemo(() => versEdition(etape), [etape]);
  // Le brouillon : on ne touche au parcours qu'en enregistrant.
  const [brouillon, setBrouillon] = useState<Etape>(reference.etape);

  /**
   * Le texte BRUT du champ « Conditions », tel qu'on le tape.
   *
   * Il était dérivé de l'objet `conditions` à chaque rendu, et l'analyse ne
   * gardait une ligne que si la clé ET la valeur étaient remplies. Taper
   * « statut » (sans encore de « = ») jetait donc la ligne, et la valeur
   * dérivée réécrivait un champ vide : le champ S'EFFAÇAIT à chaque frappe.
   * De l'extérieur, on croyait qu'il refusait le clavier.
   *
   * On garde donc le texte tel quel pendant la saisie, et on ne l'analyse
   * qu'au moment d'enregistrer.
   */
  const [conditionsTexte, setConditionsTexte] = useState(() => texteSi(etape, fr));
  /** Champs dont la version anglaise, inchangée, a été déclarée « toujours valable ». */
  /** L'autre langue, périmée : « La retirer » (d'office) ou « La garder telle quelle ». */
  const [choixAutre, setChoixAutre] = useState<ChoixAutreVersion>('retirer');
  /** Le bloc « autre langue », déplié par l'utilisateur (ou resté ouvert après avoir été périmé). */
  const [autreDepliee, setAutreDepliee] = useState(false);

  /**
   * LA VERSION DE L'ÉTAPE DONT LE BROUILLON EST PARTI (constat A-01, le bug
   * n° 1 du propriétaire : « Lumi dit avoir changé le message, rien ne
   * change »).
   *
   * Le brouillon n'était rechargé que si l'IDENTIFIANT de l'étape changeait.
   * Or Lumi rend la MÊME étape (`e1`) avec un autre texte : le canevas
   * changeait, le panneau resté ouvert gardait l'ancien texte, se croyait
   * « modifié », et son « Enregistrer » remettait l'ancien texte par-dessus
   * celui de Lumi.
   *
   * On retient donc de quelle version le brouillon est parti. Quand l'étape
   * reçue change PAR AILLEURS (Lumi, annuler / rétablir, rechargement) :
   *   · rien n'a été tapé ici → le panneau prend aussitôt la nouvelle version ;
   *   · une saisie est en cours → rien n'est écrasé, ni dans un sens ni dans
   *     l'autre : un bandeau le dit et laisse choisir (`conflit`).
   */
  const [base, setBase] = useState<Etape>(reference.etape);
  /** L'étape a changé ailleurs pendant une saisie : qui l'a changée, tant que le choix n'est pas fait. */
  const [conflit, setConflit] = useState<'lumi' | 'autre' | null>(null);
  /** Étape « attendre » : le nombre et l'unité tels qu'on les saisit (voir `saisieDelaiDe`). */
  const [delaiSaisi, setDelaiSaisi] = useState<SaisieDelai>(() => saisieDelaiDe(reference.etape));
  /** Le brouillon et le texte des conditions du dernier rendu, lus par l'effet ci-dessous. */
  const saisie = useRef({ brouillon, conditionsTexte });
  saisie.current = { brouillon, conditionsTexte };

  const prendre = (version: Etape) => {
    setBase(version);
    setBrouillon(version);
    setDelaiSaisi(saisieDelaiDe(version));
    setConditionsTexte(texteSi(version, fr));
    setChoixAutre('retirer');
    setAutreDepliee(false);
    setConflit(null);
  };

  /*
   * Changer de CARTE remet le panneau sur la nouvelle étape, et ramène
   * l'onglet d'édition — on ouvre une étape pour la modifier, pas pour lire
   * les statistiques de la précédente.
   *
   * Même carte : on compare le CONTENU, jamais l'identité de l'objet — le
   * parent rend un objet neuf à chaque modification du parcours, et s'y fier
   * effacerait la saisie en cours à chaque rendu.
   */
  useEffect(() => {
    const recue = reference.etape;
    if (recue.id !== base.id) {
      prendre(recue);
      setOnglet('edition');
      return;
    }
    if (JSON.stringify(recue) === JSON.stringify(base)) return;
    const brouillonActuel = JSON.stringify(saisie.current.brouillon);
    const intact = brouillonActuel === JSON.stringify(base)
      && saisie.current.conditionsTexte === texteSi(base, fr);
    // Rien de tapé ici — ou exactement ce qui vient d'arriver : la nouvelle version, sans question.
    if (intact || brouillonActuel === JSON.stringify(recue)) prendre(recue);
    else setConflit(modifieePar === 'lumi' ? 'lumi' : 'autre');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ne réagit qu'à l'étape REÇUE : `base` et `modifieePar` sont lus au moment où elle change.
  }, [reference]);

  /*
   * UN BROUILLON NON ENREGISTRÉ NE SE JETTE PAS SANS PRÉVENIR (audit
   * 2026-09-28). Fermer le panneau, « Annuler » ou cliquer une autre carte
   * perdait la saisie en silence. Le panneau demande confirmation pour sa
   * fermeture ; le parent, prévenu par `onModifie`, pour un changement de
   * carte.
   */
  const modifie = useMemo(
    // Une étape NEUVE est tout entière une saisie non enregistrée.
    () => nouvelle || (brouillon.id === base.id
      && (JSON.stringify(brouillon) !== JSON.stringify(base) || conditionsTexte !== texteSi(base, fr))),
    [brouillon, base, conditionsTexte, nouvelle, fr],
  );
  useEffect(() => { onModifie?.(modifie); }, [modifie, onModifie]);
  useEffect(() => () => onModifie?.(false), [onModifie]);

  const fermer = async () => {
    if (modifie) {
      const ok = await confirmer(nouvelle
        ? {
          title: fr ? 'Fermer sans ajouter cette étape ?' : 'Close without adding this step?',
          message: fr
            ? 'Cette étape n’a pas été enregistrée : elle ne sera pas ajoutée au parcours.'
            : 'This step was not saved: it will not be added to the journey.',
          confirmLabel: fr ? 'Ne pas l’ajouter' : 'Do not add it',
          danger: true,
        }
        : {
          title: fr ? 'Fermer sans enregistrer ?' : 'Close without saving?',
          message: fr
            ? 'Les modifications de cette étape ne sont pas enregistrées : elles seront perdues.'
            : 'This step’s changes are not saved: they will be lost.',
          confirmLabel: fr ? 'Fermer sans enregistrer' : 'Close without saving',
          danger: true,
        });
      if (!ok) return;
    }
    onFermer();
  };

  const modele = brouillon.type === 'action' ? trouverAction(brouillon.action.type) : undefined;
  /** L'étape technique « note dans l'historique » (`log_activity`) : rien à régler. */
  const journal = brouillon.type === 'action' && brouillon.action.type === 'log_activity';

  /**
   * Les textes de l'étape qui existent en DEUX langues : lequel est le texte
   * principal (celui que le bureau envoie), lequel est l'autre, et si l'autre
   * est PÉRIMÉ — le principal a changé dans ce panneau, pas lui. Une version
   * périmée ne bloque rien : le bloc secondaire se déplie et fait choisir
   * (la retirer, par défaut, ou la garder).
   *
   * Le rôle de chaque clé se décide sur l'étape D'ORIGINE (`base`), pas sur
   * la saisie : vider le champ principal pour le retaper ne doit pas le faire
   * basculer sur l'autre langue au milieu d'une frappe.
   */
  const versionsLangue = useMemo(() => {
    if (brouillon.type !== 'action' || !modele) return [];
    const config = brouillon.action.config as Record<string, string | undefined>;
    const origine = (base.type === 'action' ? base.action.config : {}) as Record<string, string | undefined>;
    return modele.champs
      .filter((c) => aVersionAnglaise(c) && champVisible(c, config)
        && config[cleAnglaise(c.cle)] !== undefined
        && ((origine[cleAnglaise(c.cle)] ?? '').trim() !== '' || (config[cleAnglaise(c.cle)] ?? '').trim() !== ''))
      .map((c) => {
        const cleEn = cleAnglaise(c.cle);
        // Le moteur ne lit `_en` que si elle est remplie : sinon c'est `body` qui part, même en anglais.
        const principalEstAnglais = langueEnvoi === 'en' && (origine[cleEn] ?? '').trim() !== '';
        const clePrincipale = principalEstAnglais ? cleEn : c.cle;
        const cleAutre = principalEstAnglais ? c.cle : cleEn;
        const autre = config[cleAutre] ?? '';
        const origineAutre = origine[cleAutre] ?? '';
        return {
          champ: c, clePrincipale, cleAutre, principalEstAnglais, autreEstAnglais: !principalEstAnglais,
          modeleAutre: champAutreLangue(c, cleAutre, !principalEstAnglais),
          /** Le texte principal a changé dans ce panneau. */
          principalChange: (config[clePrincipale] ?? '') !== (origine[clePrincipale] ?? ''),
          /** L'autre langue a été retouchée dans ce panneau : l'utilisateur s'en occupe. */
          autreChangee: autre !== origineAutre,
          /** L'autre langue a été VIDÉE à la main : c'est la retirer. */
          videe: autre.trim() === '',
        };
      });
  }, [brouillon, base, modele, langueEnvoi]);
  /**
   * L'AUTRE VERSION — tous les textes de l'autre langue de l'étape, ensemble —
   * n'est plus à jour : un texte principal a changé ici, et personne n'a touché
   * à l'autre langue. (Même règle que le texto de la liste et l'éditeur de
   * courriel : la version se retire ou se garde EN ENTIER.)
   */
  const autrePerimee = versionsLangue.some((v) => v.principalChange && !v.videe)
    && !versionsLangue.some((v) => v.autreChangee);
  // Un bloc déplié parce que sa version est périmée RESTE déplié ensuite :
  // retaper l'autre langue lève « périmée », et le champ se refermerait sous les doigts.
  useEffect(() => {
    if (autrePerimee) setAutreDepliee(true);
  }, [autrePerimee]);
  /** Le champ principal d'un texte : la clé de la langue que le bureau envoie. */
  const clePrincipaleDe = (cle: string): string => versionsLangue.find((v) => v.champ.cle === cle)?.clePrincipale ?? cle;
  /** L'étape à enregistrer : les versions périmées non gardées, et celles vidées à la main, sont retirées. */
  const pourEnregistrer = (etapeAction: Etape): Etape => sansAnglaisVide(sansVersionsRetirees(
    etapeAction,
    versionsLangue
      .filter((v) => (autrePerimee && choixAutre === 'retirer' && !v.videe) || (v.videe && v.principalEstAnglais))
      .map((v) => ({ cle: v.champ.cle, principalEstAnglais: v.principalEstAnglais })),
  ));

  /*
   * ÉTAPE « SI… » : CE QUE LA ZONE « CONDITIONS » NE SAIT PAS LIRE OU ÉCRIRE
   * N'EST JAMAIS JETÉ EN SILENCE (triage déclencheurs, 05:470 et 05:501).
   *   · une ligne illisible (« montant 5000 », « statut = ») est signalée et
   *     retient l'enregistrement — avant, elle était ignorée : la condition
   *     partait vide et le parcours suivait toujours « si oui » ;
   *   · une condition que le texte ne peut pas porter est gardée telle quelle
   *     (`conservees`) et montrée en lecture seule — avant, le premier
   *     enregistrement l'effaçait.
   */
  const origineSi = base.type === 'si' ? base.conditions : null;
  const lignesIllisibles = useMemo(
    () => (brouillon.type === 'si' ? analyserConditions(conditionsTexte, origineSi).illisibles : []),
    [brouillon.type, conditionsTexte, origineSi],
  );
  const conservees = useMemo(
    () => (brouillon.type === 'si' ? conditionsConservees(brouillon.conditions) : {}),
    [brouillon],
  );
  /** Le texte de la zone → les `conditions` de l'étape : lignes lisibles + conditions conservées + champs personnalisés. */
  const conditionsSaisies = (texte: string): Record<string, unknown> => ({
    ...conservees,
    ...analyserConditions(texte, origineSi).conditions,
    ...champsPersoDe(brouillon),
  });

  /** Ce qui empêche d'enregistrer, dit avant de cliquer. */
  const problemes = useMemo(() => {
    const out: string[] = [];
    if (brouillon.type === 'si') {
      for (const l of lignesIllisibles) {
        out.push(fr ? `Ligne illisible « ${l.ligne} » : ${l.fr}` : `Unreadable line “${l.ligne}”: ${l.en}`);
      }
      return out;
    }
    if (brouillon.type === 'attendre') {
      // Un champ vidé le temps de retaper le nombre : pas « 0 », rien — on le dit.
      if (nombreSaisi(delaiSaisi.texte) === null) {
        out.push(fr ? 'Indiquez combien de temps attendre (0 ou plus).' : 'Enter how long to wait (0 or more).');
      }
      /*
       * Les plafonds du serveur, dits ICI (triage actions, 05-panneau-etape:345 ;
       * déclencheurs, 05-etapes-controle:338). 900 jours, ou 45 jours avant un
       * rendez-vous : « Enregistrer » restait offert, et le serveur refusait
       * ensuite le parcours entier. Mêmes constantes que lui (catalogue).
       */
      if (brouillon.mode === 'avant_date') {
        if ((brouillon.secondes_avant ?? 0) > DELAI_NEGATIF_MAX_SECONDES) {
          out.push(fr ? 'On peut envoyer au plus 30 jours avant le rendez-vous.' : 'You can send at most 30 days before the appointment.');
        }
      } else if ((brouillon.delai_secondes ?? 0) > DELAI_MAX_SECONDES) {
        out.push(fr ? 'Une attente ne peut pas dépasser 366 jours (un an).' : 'A wait cannot exceed 366 days (one year).');
      }
      return out;
    }
    if (brouillon.type !== 'action') return out;
    if (!modele) return out;
    const config = brouillon.action.config as Record<string, string | undefined>;
    /*
     * L'action peut-elle seulement partir sur ce déclencheur ?
     *
     * Le cas arrive quand on change le déclencheur d'une règle déjà bâtie :
     * « envoyer la facture » reste dans le parcours mais l'entité qui
     * arrivera est devenue un devis. Le dire ICI, pas dans un journal
     * d'échec après publication.
     */
    if (declencheur && !actionCompatible(modele, declencheur, objetChamps)) {
      out.push(
        fr
          ? `« ${modele.fr} » ne peut pas suivre ce déclencheur : choisissez-en une autre.`
          : `“${modele.en}” cannot follow this trigger: pick another one.`,
      );
    }

    for (const champ of modele.champs) {
      if (!champ.obligatoire) continue;
      if (!champVisible(champ, config)) continue;
      // Jugé sur le texte PRINCIPAL (celui que le bureau envoie) : c'est lui qui est à l'écran.
      if (!config[clePrincipaleDe(champ.cle)]?.trim()) {
        out.push(fr ? `« ${champ.fr} » est vide.` : `“${champ.en}” is empty.`);
      }
    }
    /*
     * UNE SAISIE QUE LE SERVEUR REFUSERAIT EST REFUSÉE ICI, avec la borne
     * (triage actions, lignes 8 et 9). 999 jours, -5 jours, 10 000 001 $, une
     * adresse en http:// : « Enregistrer » restait actif, et le refus arrivait
     * trois secondes plus tard, par l'enregistrement automatique. La règle est
     * celle du serveur (`fauteDeValeur`, catalogue partagé).
     */
    for (const champ of modele.champs) {
      if (!champVisible(champ, config)) continue;
      const faute = fauteDeValeur(champ, config[champ.cle]);
      if (faute) out.push(fr ? `« ${champ.fr} » ${faute.fr}.` : `“${champ.en}” ${faute.en}.`);
    }
    /*
     * « Mettre à jour un champ » n'écrit QUE sur la fiche de l'événement
     * (executerMajChamp) : un champ d'un autre objet échouerait à chaque
     * passage, dans un journal que personne ne lit.
     */
    if (modele.cle === 'update_custom_field' && objetChamps && config.field_id) {
      const champ = champsPerso.find((c) => c.id === config.field_id);
      if (champ && champ.object_type !== objetChamps) {
        out.push(fr
          ? `« ${champ.label} » n’est pas un champ de la fiche que ce déclencheur fait arriver.`
          : `“${champ.label}” is not a field of the record this trigger brings.`);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `clePrincipaleDe` ne dépend que de `versionsLangue`.
  }, [brouillon, modele, fr, declencheur, objetChamps, champsPerso, versionsLangue, delaiSaisi, lignesIllisibles]);

  /** Variables écrites dans les textes de l'action que le serveur ne saura pas remplir. */
  const inconnues = useMemo(() => {
    if (brouillon.type !== 'action' || !modele) return [];
    const config = brouillon.action.config as Record<string, string | undefined>;
    const trouvees = new Set<string>();
    for (const champ of modele.champs) {
      if (champ.type !== 'zone' && champ.type !== 'texte') continue;
      if (!champVisible(champ, config)) continue;
      for (const v of variablesInconnues(config[champ.cle] ?? '')) trouvees.add(v);
      // La version anglaise part aux clients comme l'autre : mêmes variables, même contrôle.
      for (const v of variablesInconnues(config[cleAnglaise(champ.cle)] ?? '')) trouvees.add(v);
    }
    return [...trouvees];
  }, [brouillon, modele]);

  const majConfig = (cle: string, valeur: string) => {
    setBrouillon((b) => {
      if (b.type !== 'action') return b;
      return { ...b, action: { ...b.action, config: { ...b.action.config, [cle]: valeur } } };
    });
  };

  /** Changer le type d'action : on repart d'une config vide. */
  const changerType = (type: string) => {
    setBrouillon((b) => {
      if (b.type !== 'action') return b;
      // Le texte est presque toujours réutilisable d'une action à l'autre ;
      // le reste ne l'est pas (un objet de courriel sur un texto ferait
      // refuser l'enregistrement par la validation serveur).
      const texte = b.action.config.body;
      // … et sa version anglaise le suit : la laisser tomber ici l'effacerait
      // sans que personne le voie.
      const anglais = b.action.config[cleAnglaise('body')];
      const cible = trouverAction(type);
      const garde: Record<string, string | undefined> = cible?.champs?.some((c) => c.cle === 'body') && texte
        ? { body: texte, ...(anglais?.trim() ? { [cleAnglaise('body')]: anglais } : {}) }
        : {};
      return { ...b, action: { type, config: garde } };
    });
  };

  const titre = (() => {
    if (brouillon.type === 'action') {
      if (journal) return fr ? 'Note dans l’historique' : 'History note';
      return brouillon.nom?.trim() || (modele ? (fr ? modele.fr : modele.en) : 'Action');
    }
    if (brouillon.type === 'attendre') return fr ? 'Attendre' : 'Wait';
    if (brouillon.type === 'si') return fr ? 'Condition' : 'Condition';
    return fr ? 'Arrêter ici' : 'Stop here';
  })();

  const sousTitre = (() => {
    if (brouillon.type === 'action' && modele) return fr ? modele.aide_fr : modele.aide_en;
    if (brouillon.type === 'attendre') {
      return fr ? 'Met le parcours en pause avant la suite.' : 'Pauses the journey before the next step.';
    }
    if (brouillon.type === 'si') {
      return fr ? 'Sépare le parcours en deux chemins.' : 'Splits the journey in two.';
    }
    return fr ? 'Le parcours se termine ici.' : 'The journey ends here.';
  })();

  // « Avant la date » : le délai saisi est « combien avant », pas une durée.
  const avantDate = brouillon.type === 'attendre' && brouillon.mode === 'avant_date';
  /** Le nombre et l'unité saisis → les secondes de l'attente (un champ vide vaut 0 en attendant). */
  const poserDelai = (saisie: SaisieDelai) => {
    setDelaiSaisi(saisie);
    const u = UNITES.find((x) => x.cle === saisie.unite) ?? UNITES[0];
    setBrouillon((b) => (b.type === 'attendre'
      ? { ...b, [b.mode === 'avant_date' ? 'secondes_avant' : 'delai_secondes']: Math.round((nombreSaisi(saisie.texte) ?? 0) * u.secondes) }
      : b));
  };

  return (
    <aside
      aria-label={fr ? 'Modifier l’étape' : 'Edit step'}
      className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-surface-card"
    >
      {/* ── En-tête ─────────────────────────────────────────── */}
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-text-primary">{titre}</h2>
          <p className="mt-0.5 text-[11px] text-text-tertiary">{sousTitre}</p>
        </div>
        <button
          type="button"
          onClick={() => void fermer()}
          aria-label={fr ? 'Fermer le panneau' : 'Close panel'}
          className="shrink-0 rounded-md p-1 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* ── Onglets ─────────────────────────────────────────── */}
      <div className="flex border-b border-border" role="tablist">
        {([
          ['edition', fr ? 'Modifier l’action' : 'Edit action', Pencil],
          ['stats', fr ? 'Statistiques' : 'Statistics', BarChart3],
        ] as const).map(([cle, libelle, Icone]) => (
          <button
            key={cle}
            type="button"
            role="tab"
            aria-selected={onglet === cle}
            onClick={() => setOnglet(cle)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              onglet === cle
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            <Icone className="h-3.5 w-3.5" aria-hidden="true" />
            {libelle}
          </button>
        ))}
      </div>

      {/* ── Corps ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {onglet === 'stats' ? (
          <div className="space-y-3">
            {stats && stats.envoyes + stats.sautes + stats.echecs + stats.en_attente > 0 ? (
              <>
                <p className="text-[11px] text-text-tertiary">
                  {fr ? '60 derniers jours.' : 'Last 60 days.'}
                </p>
                {([
                  [fr ? 'Réussis' : 'Succeeded', stats.envoyes, 'text-emerald-600 dark:text-emerald-400'],
                  // Une étape SAUTÉE (pas de numéro texto, pas de courriel…)
                  // n'est ni un envoi ni un échec : comptée à part.
                  [fr ? 'Sautés' : 'Skipped', stats.sautes, 'text-text-secondary'],
                  [fr ? 'Échoués' : 'Failed', stats.echecs, 'text-red-600 dark:text-red-400'],
                  [fr ? 'En attente' : 'Pending', stats.en_attente, 'text-text-primary'],
                ] as const).map(([libelle, valeur, couleur]) => (
                  <div key={libelle} className="flex items-baseline justify-between rounded-lg border border-border px-3 py-2.5">
                    <span className="text-xs text-text-secondary">{libelle}</span>
                    <span className={cn('text-lg font-semibold tabular-nums', couleur)}>{valeur}</span>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-xs text-text-tertiary">
                {fr
                  ? 'Aucun passage encore. Les chiffres apparaîtront après le premier déclenchement.'
                  : 'No runs yet. Numbers show up after the first trigger.'}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* L'étape a changé AILLEURS pendant qu'on la modifiait ici : on
                ne choisit pas à la place de l'utilisateur. */}
            {conflit && (
              <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                <p className="font-medium">
                  {conflit === 'lumi'
                    ? (fr ? 'Lumi a modifié cette étape pendant que vous l’éditiez.' : 'Lumi changed this step while you were editing it.')
                    : (fr ? 'Cette étape a été modifiée ailleurs pendant que vous l’éditiez.' : 'This step was changed elsewhere while you were editing it.')}
                </p>
                <p className="mt-0.5 text-[11px]">
                  {fr
                    ? 'Rien n’est écrasé : choisissez la version à garder.'
                    : 'Nothing is overwritten: choose which version to keep.'}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => prendre(reference.etape)}
                    className="rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {conflit === 'lumi'
                      ? (fr ? 'Voir la version de Lumi' : 'See Lumi’s version')
                      : (fr ? 'Voir l’autre version' : 'See the other version')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setBase(reference.etape); setConflit(null); }}
                    className="rounded-md border border-amber-400 px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-amber-700 dark:hover:bg-amber-900/40"
                  >
                    {fr ? 'Garder ma version' : 'Keep my version'}
                  </button>
                </div>
              </div>
            )}
            {/* ── Étape « action » ────────────────────────────── */}
            {journal && (
              <p className="rounded-lg bg-surface-secondary p-3 text-[13px] text-text-secondary">
                {fr
                  ? 'Étape technique : Lume inscrit ce moment dans l’historique du client. Il n’y a rien à régler ; vous pouvez la supprimer si vous n’en voulez pas.'
                  : 'Technical step: Lume records this moment in the client’s history. Nothing to set; you can delete it if you don’t want it.'}
              </p>
            )}
            {brouillon.type === 'action' && !journal && (
              <>
                {/* Nom de l'action — le « Action Name » de GHL. */}
                <div>
                  <label htmlFor={`${ids}-nom`} className="mb-1 block text-xs font-medium text-text-primary">
                    {fr ? 'Nom de l’action' : 'Action name'}
                    <span className="font-normal text-text-tertiary"> {fr ? '(facultatif)' : '(optional)'}</span>
                  </label>
                  <input
                    id={`${ids}-nom`}
                    type="text"
                    maxLength={80}
                    value={brouillon.nom ?? ''}
                    onChange={(e) => setBrouillon({ ...brouillon, nom: e.target.value })}
                    placeholder={modele ? (fr ? modele.fr : modele.en) : ''}
                    className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  <p className="mt-1 text-[11px] text-text-tertiary">
                    {fr
                      ? 'Ce qui s’affiche sur la carte. Utile quand le parcours envoie plusieurs courriels.'
                      : 'What shows on the card. Useful when a journey sends several emails.'}
                  </p>
                </div>

                {/* Le type d'action, groupé par famille comme leur menu. */}
                <div>
                  <label htmlFor={`${ids}-type`} className="mb-1 block text-xs font-medium text-text-primary">
                    {fr ? 'Quoi faire' : 'What to do'}
                    <span className="text-red-500"> *</span>
                  </label>
                  <select
                    id={`${ids}-type`}
                    value={brouillon.action.type}
                    onChange={(e) => changerType(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {FAMILLES_ACTIONS.map((famille) => {
                      // Seules les actions COMPATIBLES avec le déclencheur.
                      // Une famille qui n'en garde aucune disparaît, plutôt
                      // que d'afficher un groupe vide.
                      const offertes = ACTIONS.filter(
                        (a) => a.famille === famille.cle && !a.indisponible
                          && (!declencheur || actionCompatible(a, declencheur, objetChamps)),
                      );
                      if (!offertes.length) return null;
                      return (
                        <optgroup key={famille.cle} label={fr ? famille.fr : famille.en}>
                          {offertes.map((a) => (
                            <option key={a.cle} value={a.cle}>
                              {fr ? a.fr : a.en}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>

                {/* « Mettre à jour un champ » : une liste des champs et une
                    valeur adaptée au type, plus un identifiant à taper. */}
                {modele?.cle === 'update_custom_field' && (
                  <EditeurMajChamp
                    fieldId={(brouillon.action.config as Record<string, string | undefined>).field_id ?? ''}
                    valeur={(brouillon.action.config as Record<string, string | undefined>).value ?? ''}
                    onChange={majConfig}
                    champs={champsPerso}
                    objet={objetChamps}
                    fr={fr}
                  />
                )}

                {/* Les champs de l'action choisie. */}
                {modele?.cle !== 'update_custom_field' && modele?.champs
                  .filter((champ) => champVisible(champ, brouillon.action.config as Record<string, unknown>))
                  .map((champ) => {
                    const langue = versionsLangue.find((v) => v.champ.cle === champ.cle);
                    const config = brouillon.action.config as Record<string, string | undefined>;
                    // Le champ principal montre le texte que le bureau ENVOIE.
                    const clePrincipale = langue?.clePrincipale ?? champ.cle;
                    return (
                      <ChampActionUI
                        key={champ.cle}
                        champ={champ}
                        valeur={config[clePrincipale] ?? ''}
                        onChange={(v) => majConfig(clePrincipale, v)}
                        fr={fr}
                        membres={membres}
                        etiquettes={etiquettes}
                        automatisations={automatisations}
                        etapesPipeline={etapesPipeline}
                        sms={modele.cle === 'send_sms' && champ.cle === 'body'}
                      />
                    );
                  })}

                {/* L'autre langue, quand l'étape en porte une : UN bloc secondaire,
                    replié tant qu'il n'y a rien à décider — le même composant, donc
                    les mêmes mots, que la liste et l'éditeur de courriel. */}
                {modele && modele.cle !== 'update_custom_field' && versionsLangue.length > 0 && (
                  <AutreVersionMessage
                    id={`${ids}-autre-version`}
                    fr={fr}
                    langue={versionsLangue[0].autreEstAnglais ? 'en' : 'fr'}
                    perimee={autrePerimee}
                    choix={choixAutre}
                    onChoix={setChoixAutre}
                    deplie={autreDepliee}
                    onDeplie={setAutreDepliee}
                  >
                    {versionsLangue.map((v) => (
                      <ChampActionUI
                        key={v.cleAutre}
                        champ={v.modeleAutre}
                        valeur={(brouillon.action.config as Record<string, string | undefined>)[v.cleAutre] ?? ''}
                        onChange={(valeur) => majConfig(v.cleAutre, valeur)}
                        fr={fr}
                        sms={modele.cle === 'send_sms' && v.champ.cle === 'body'}
                      />
                    ))}
                  </AutreVersionMessage>
                )}

                {/* Une variable que le serveur ne connaît pas part VIDE :
                    « Bonjour [prenom], » devient « Bonjour , ». La liste le
                    disait, pas cet éditeur — où s'écrivent toutes les
                    nouvelles automatisations. On NOMME la fautive. */}
                {inconnues.length > 0 && (
                  <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    {fr
                      ? `${inconnues.length > 1 ? 'Variables inconnues' : 'Variable inconnue'} : ${inconnues.map(variableLisible).join(', ')} — sera vide dans le message envoyé.`
                      : `Unknown variable${inconnues.length > 1 ? 's' : ''}: ${inconnues.map(variableLisible).join(', ')} — will be empty in the sent message.`}
                  </p>
                )}

                {/* Variables — cliquer pour insérer, plutôt que les retenir. */}
                {modele?.champs?.some((c) => c.type === 'zone') && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-medium text-text-secondary">
                      {fr ? 'Insérer une information du client' : 'Insert client information'}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {VARIABLES.map((v) => (
                        <button
                          key={v.cle}
                          type="button"
                          onClick={() => {
                            const champ = modele.champs.find((c) => c.type === 'zone');
                            if (!champ) return;
                            // Dans le texte PRINCIPAL : celui que le bureau envoie.
                            const cle = clePrincipaleDe(champ.cle);
                            const actuel =
                              (brouillon.action.config as Record<string, string | undefined>)[cle] ?? '';
                            majConfig(cle, `${actuel}[${v.cle}]`);
                          }}
                          className="rounded-md bg-surface-tertiary px-2 py-1 text-[11px] text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {fr ? v.fr : v.en}
                        </button>
                      ))}
                    </div>
                    {/* « Insérer un champ » : {{client.cle}}, {{deal.cle}}… —
                        résolus par le serveur (resolveTemplate). */}
                    <p className="mb-1.5 mt-3 text-[11px] font-medium text-text-secondary">
                      {fr ? 'Insérer un champ' : 'Insert a field'}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <BoutonsVariablesChamps
                        champs={champsPerso}
                        fr={fr}
                        onInserer={(variable) => {
                          const champ = modele.champs.find((c) => c.type === 'zone');
                          if (!champ) return;
                          const actuel =
                            (brouillon.action.config as Record<string, string | undefined>)[champ.cle] ?? '';
                          // La variable arrive déjà écrite ({{client.cle}}) : pas de crochets par-dessus.
                          majConfig(champ.cle, `${actuel}${variable}`);
                        }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Étape « attendre » ──────────────────────────── */}
            {brouillon.type === 'attendre' && (
              <div>
                <label htmlFor={`${ids}-delai`} className="mb-1 block text-xs font-medium text-text-primary">
                  {fr ? 'Attendre' : 'Wait'}
                  <span className="text-red-500"> *</span>
                </label>
                <div className="flex gap-2">
                  <input
                    id={`${ids}-delai`}
                    type="number"
                    min={0}
                    max={365}
                    value={delaiSaisi.texte}
                    onChange={(e) => poserDelai({ texte: e.target.value, unite: delaiSaisi.unite })}
                    className="w-24 rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  <select
                    aria-label={fr ? 'Unité de temps' : 'Time unit'}
                    value={delaiSaisi.unite}
                    onChange={(e) => poserDelai({ texte: delaiSaisi.texte, unite: e.target.value })}
                    className="flex-1 rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {UNITES.map((u) => (
                      <option key={u.cle} value={u.cle}>
                        {fr ? u.fr : u.en}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="mt-1 text-[11px] text-text-tertiary">
                  {fr
                    ? 'Les messages ne partent jamais entre 20 h et 8 h, même si l’attente se termine la nuit.'
                    : 'Messages never go out between 8 p.m. and 8 a.m., even if the wait ends overnight.'}
                </p>

                {/* Attendre une DURÉE, ou attendre que le client réponde.
                    Le second est ce qui rend une relance intelligente : plus
                    besoin d'une condition « a-t-il répondu ? » ensuite. */}
                <div className="mt-3">
                  <label htmlFor={`${ids}-mode`} className="mb-1 block text-xs font-medium text-text-primary">
                    {fr ? 'Ce qu’on attend' : 'What we wait for'}
                  </label>
                  <select
                    id={`${ids}-mode`}
                    value={(brouillon as EtapeAttendre).mode ?? 'duree'}
                    onChange={(e) => {
                      const mode = e.target.value as 'duree' | 'reponse' | 'avant_date';
                      const actuelle = brouillon as EtapeAttendre;
                      // Passer à « avant la date » reprend le délai saisi comme
                      // « combien avant », et la durée propre de l'attente tombe à 0.
                      // … le délai À L'ÉCRAN (nombre et unité saisis), pas une valeur restée dans l'étape.
                      const u = UNITES.find((x) => x.cle === delaiSaisi.unite) ?? UNITES[0];
                      const secondes = Math.round((nombreSaisi(delaiSaisi.texte) ?? 0) * u.secondes);
                      setBrouillon(mode === 'avant_date'
                        ? { ...actuelle, mode, secondes_avant: secondes, delai_secondes: 0 }
                        : { ...actuelle, mode, delai_secondes: secondes });
                    }}
                    className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <option value="duree">{fr ? 'Simplement ce délai' : 'Just this delay'}</option>
                    <option value="reponse">
                      {fr ? 'La réponse du client (au plus ce délai)' : 'The client’s reply (at most this delay)'}
                    </option>
                    {/* Seul « Rendez-vous planifié » porte une date à venir. */}
                    {(declencheur === 'appointment.created' || avantDate) && (
                      <option value="avant_date">
                        {fr ? 'Ce délai AVANT le rendez-vous' : 'This long BEFORE the appointment'}
                      </option>
                    )}
                  </select>
                  <p className="mt-1 text-[11px] text-text-tertiary">
                    {avantDate
                      ? (fr
                        ? 'Le rappel part ce délai avant le rendez-vous. Rendez-vous déplacé : le rappel suit. Moment déjà passé : ce rappel est sauté.'
                        : 'The reminder goes out this long before the appointment. Moved appointment: the reminder follows. Already past: this reminder is skipped.')
                      : (brouillon as EtapeAttendre).mode === 'reponse'
                      ? (fr
                        ? 'S’il répond, le parcours s’arrête ici. Sinon, la suite part une fois le délai écoulé.'
                        : 'If they reply, the journey stops here. Otherwise the next step runs once the delay is up.')
                      : (fr
                        ? 'Le parcours continue une fois le délai écoulé, quoi qu’il arrive.'
                        : 'The journey continues once the delay is up, whatever happens.')}
                  </p>
                </div>
              </div>
            )}

            {/* ── Étape « si » ────────────────────────────────── */}
            {brouillon.type === 'si' && (
              <div>
                <label htmlFor={`${ids}-cond`} className="mb-1 block text-xs font-medium text-text-primary">
                  {fr ? 'Conditions' : 'Conditions'}
                </label>
                <p className="mb-2 text-[11px] text-text-tertiary">
                  {fr
                    ? 'Une ligne par condition : champ = valeur, une comparaison (montant > 5000, created_at >= 2026-06-01), ou une liste (source est l’un de web, facebook ; statut n’est aucun de perdu). Deux lignes sur le même champ font un intervalle. Le parcours suit « alors » quand toutes sont vraies.'
                    : 'One condition per line: field = value, a comparison (amount > 5000, created_at >= 2026-06-01), or a list (source is one of web, facebook; status is none of lost). Two lines on the same field make a range. The journey follows “then” when all are true.'}
                </p>

                {/*
                  Des exemples CLIQUABLES plutôt qu'un champ nu.
                  L'audit du 2026-09-25 le dit : « aucune autocomplétion,
                  aucune liste des champs valides — l'utilisateur ne sait
                  même pas quoi écrire ». Les champs disponibles dépendent du
                  déclencheur (le moteur compare aux métadonnées de
                  l'événement), donc on propose les plus courants au lieu
                  d'inventer une liste exhaustive qui serait fausse ailleurs.
                */}
                <div className="mb-2 flex flex-wrap gap-1">
                  {['statut = ', 'source = ', 'total_cents > ', 'created_at >= '].map((exemple) => (
                    <button
                      key={exemple}
                      type="button"
                      onClick={() => {
                        const ajout = `${conditionsTexte.trim() ? `${conditionsTexte.replace(/\n+$/, '')}\n` : ''}${exemple}`;
                        setConditionsTexte(ajout);
                        setBrouillon({
                          ...(brouillon as EtapeSi),
                          conditions: conditionsSaisies(ajout),
                        });
                      }}
                      className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-secondary transition-colors hover:border-accent hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {exemple}
                    </button>
                  ))}
                </div>
                <textarea
                  id={`${ids}-cond`}
                  rows={4}
                  value={conditionsTexte}
                  onChange={(e) => {
                    // Le texte affiché est CELUI QU'ON TAPE, jamais une
                    // reconstruction depuis l'objet : c'est ce qui rendait le
                    // champ inutilisable (une ligne sans « = » était jetée, et
                    // la valeur dérivée réécrivait un champ vide à chaque
                    // frappe). L'objet suit, pour l'enregistrement.
                    setConditionsTexte(e.target.value);
                    setBrouillon({
                      ...(brouillon as EtapeSi),
                      conditions: conditionsSaisies(e.target.value),
                    });
                  }}
                  className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 font-mono text-xs text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                {lignesIllisibles.length > 0 && (
                  <div role="alert" className="mt-1.5 rounded-lg border border-danger/40 bg-danger-light px-3 py-2 text-[11px] text-danger">
                    {lignesIllisibles.map((l, i) => (
                      <p key={`${i}-${l.ligne}`}>
                        {fr ? `Ligne illisible « ${l.ligne} » : ${l.fr}` : `Unreadable line “${l.ligne}”: ${l.en}`}
                      </p>
                    ))}
                  </div>
                )}
                {Object.keys(conservees).length > 0 && (
                  <div className="mt-1.5 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-[11px] text-text-secondary">
                    <p className="font-medium text-text-primary">
                      {fr
                        ? 'Conditions avancées, conservées telles quelles (non modifiables ici) :'
                        : 'Advanced conditions, kept as they are (not editable here):'}
                    </p>
                    <ul className="mt-1 space-y-0.5 font-mono">
                      {Object.entries(conservees).map(([cle, v]) => (
                        <li key={cle} className="break-all">{cle} : {JSON.stringify(v)}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {/* Conditions sur les champs personnalisés de la fiche,
                    jugées sur les valeurs ACTUELLES quand on arrive ici. */}
                <ConditionsChampsEtape
                  conditions={(brouillon as EtapeSi).conditions as Record<string, unknown> | undefined}
                  onChange={(c) => setBrouillon({ ...(brouillon as EtapeSi), conditions: c })}
                  champs={champsPerso}
                  objet={objetChamps}
                  fr={fr}
                />
              </div>
            )}

            {brouillon.type === 'arreter' && (
              <p className="text-xs text-text-secondary">
                {fr
                  ? 'Rien à configurer. Le client sort du parcours en arrivant ici.'
                  : 'Nothing to configure. The client leaves the journey here.'}
              </p>
            )}

            {/* Ce qui bloque l'enregistrement, dit avant de cliquer. (Étape « si » :
                ses lignes illisibles sont déjà dites sous la zone « Conditions ».) */}
            {problemes.length > 0 && brouillon.type !== 'si' && (
              <ul className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/30">
                {problemes.map((p) => (
                  <li key={p} className="text-[11px] text-amber-800 dark:text-amber-200">
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ── Pied : Supprimer · Annuler · Enregistrer ─────────── */}
      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={() => onSupprimer(brouillon.id)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          {fr ? 'Supprimer' : 'Delete'}
        </button>
        <span className="flex-1" />
        {/*
          POURQUOI « Enregistrer » est grisé.

          Le bouton était désactivé sans un mot : au clic, rien ne se
          passait, l'étape restait « à compléter » et l'utilisateur ne
          savait pas ce qui manquait. QA du 2026-09-25 (P2-12) — cas
          rencontré : un message de texto laissé vide.

          Les problèmes sont déjà calculés en clair juste au-dessus : il
          suffisait de les dire.
        */}
        {(conflit || problemes.length > 0) && (
          <span className="max-w-[55%] text-right text-[11px] leading-tight text-danger">
            {conflit
              ? (fr ? 'Choisissez d’abord quelle version garder.' : 'First choose which version to keep.')
              : problemes[0]}
          </span>
        )}
        {/* Ce qu'« Enregistrer » va retirer est écrit ICI, à côté du bouton : le bloc
            de l'autre langue peut être sous le pli (fenêtre basse, texte long). */}
        {!conflit && problemes.length === 0 && autrePerimee && choixAutre === 'retirer' && versionsLangue.length > 0 && (
          <AvisRetraitAutreVersion
            fr={fr}
            langue={versionsLangue[0].autreEstAnglais ? 'en' : 'fr'}
            idBloc={`${ids}-autre-version`}
            className="max-w-[55%] text-right"
          />
        )}
        <button
          type="button"
          onClick={() => void fermer()}
          className="rounded-lg px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {fr ? 'Annuler' : 'Cancel'}
        </button>
        <button
          type="button"
          onClick={() => onEnregistrer(brouillon.type === 'si'
            // Une ligne de champ incomplète bloquerait la branche pour toujours.
            ? { ...brouillon, conditions: sansConditionsIncompletes((brouillon.conditions ?? {}) as Record<string, unknown>) }
            : versEnregistrement(pourEnregistrer(brouillon), reference.html))}
          disabled={problemes.length > 0 || conflit !== null}
          className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {fr ? 'Enregistrer' : 'Save action'}
        </button>
      </div>
    </aside>
  );
}

export type { EtapeAction };
