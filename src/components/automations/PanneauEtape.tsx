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

import React, { useEffect, useId, useMemo, useState } from 'react';
import { X, Trash2, BarChart3, Pencil } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  ACTIONS,
  FAMILLES_ACTIONS,
  actionCompatible,
  champVisible,
  trouverAction,
} from '../../lib/automationCatalogue';
import type { ChampAction as ModeleChamp } from '../../lib/automationCatalogue';
import type { Etape, EtapeAction, EtapeAttendre, EtapeSi } from '../../lib/sequenceTypes';
import ChampActionUI from './ChampAction';
import {
  BoutonsVariablesChamps, ConditionsChampsEtape, EditeurMajChamp, sansConditionsIncompletes,
} from '../champs/automatisations';
import type { ChampPerso, ObjetChamp } from '../../lib/champs/types';
import { htmlVersTexte, texteVersHtml, variablesInconnues, variableLisible } from '../../lib/emailBodyText';
import { confirmer } from '../ui/ConfirmDialog';

/** Les conditions d'une étape « si », en texte modifiable. */
/** L'opérateur, tel qu'on l'ecrit : `montant > 5000`. */
const SIGNES: Array<[string, string]> = [
  ['gte', '>='], ['lte', '<='], ['gt', '>'], ['lt', '<'], ['neq', '!='], ['eq', '='],
];

function texteDesConditions(etape: Etape): string {
  if (etape.type !== 'si') return '';
  const lignes: string[] = [];
  for (const [cle, v] of Object.entries(etape.conditions ?? {})) {
    // Les conditions de champs personnalisés ont leur propre éditeur : les
    // écrire ici donnerait « champs_perso = [object Object] ».
    if (cle === 'champs_perso') continue;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      // Un intervalle (`{ gte, lt }`) s'ecrit sur DEUX lignes : c'est ce
      // qu'on relit le mieux, et l'analyse les recolle sur la meme cle.
      for (const [op, signe] of SIGNES) {
        if (op in (v as Record<string, unknown>)) {
          lignes.push(cle + ' ' + signe + ' ' + String((v as Record<string, unknown>)[op]));
        }
      }
      continue;
    }
    lignes.push(cle + ' = ' + String(v));
  }
  return lignes.join(String.fromCharCode(10));
}

/** Le texte saisi → l'objet `conditions`. Une ligne incomplète est ignorée. */
/** Un nombre pur (montant, quantité) reste un nombre. */
const NOMBRE_SEUL = /^-?[0-9]+([.][0-9]+)?$/;

function analyserConditions(texte: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const ligne of texte.split(String.fromCharCode(10))) {
    // `>=` et `<=` d'abord : sinon `>` couperait `>=` en deux.
    const trouve = SIGNES
      .map(([op, signe]) => ({ op, signe, i: ligne.indexOf(signe) }))
      .filter((x) => x.i > 0)
      .sort((a, b) => (a.i - b.i) || (b.signe.length - a.signe.length))[0];
    if (!trouve) continue;

    const cle = ligne.slice(0, trouve.i).trim();
    const val = ligne.slice(trouve.i + trouve.signe.length).trim();
    if (!cle || !val) continue;

    if (trouve.op === 'eq') {
      // L'égalité reste écrite à plat : c'est la forme d'origine, que
      // portent toutes les règles existantes.
      out[cle] = val;
      continue;
    }

    // Un montant s'écrit en chiffres : on le garde en nombre pour que la
    // comparaison ne dépende pas d'une conversion plus loin.
    const valeur = NOMBRE_SEUL.test(val) ? Number(val) : val;
    const existant = out[cle];
    out[cle] = (existant !== null && typeof existant === 'object' && !Array.isArray(existant))
      ? { ...(existant as Record<string, unknown>), [trouve.op]: valeur }
      : { [trouve.op]: valeur };
  }
  return out;
}

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
 */
const cleAnglaise = (cle: string): string => `${cle}_en`;
const aVersionAnglaise = (champ: ModeleChamp): boolean => champ.type === 'zone' || champ.type === 'texte';
function champAnglais(champ: ModeleChamp): ModeleChamp {
  return {
    ...champ,
    cle: cleAnglaise(champ.cle),
    fr: `${champ.fr} — version anglaise`,
    en: `${champ.en} — English version`,
    obligatoire: false,
    defaut_fr: undefined,
    defaut_en: undefined,
    aide_fr: 'Part à la place du texte français quand la langue du bureau est l’anglais. Vide = le texte français part à tout le monde.',
    aide_en: 'Sent instead of the French text when the office language is English. Empty = the French text goes to everyone.',
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
/** Du HTML du produit : il COMMENCE par une balise de bloc. « total < 500 $ » n'en est pas. */
const estCorpsHtml = (valeur: string | undefined): valeur is string =>
  typeof valeur === 'string' && /^\s*<(div|p|h[1-6]|ul|table)\b[^>]*>/i.test(valeur);

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
    config[cle] = valeur === origine.texte ? origine.html : texteVersHtml(valeur);
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

export default function PanneauEtape({
  etape, fr, declencheur, membres, etiquettes, automatisations = [], etapesPipeline = [], champsPerso = [], objetChamps = null, stats,
  nouvelle = false, onEnregistrer, onSupprimer, onFermer, onModifie,
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
  const [conditionsTexte, setConditionsTexte] = useState(() => texteDesConditions(etape));
  /** Champs dont la version anglaise, inchangée, a été déclarée « toujours valable ». */
  const [anglaisConfirme, setAnglaisConfirme] = useState<string[]>([]);

  /*
   * Changer de CARTE remet le panneau sur la nouvelle étape, et ramène
   * l'onglet d'édition — on ouvre une étape pour la modifier, pas pour lire
   * les statistiques de la précédente.
   *
   * La dépendance est `etape.id`, PAS `etape` : le jour où le parent cessera
   * de mémoriser l'étape (`useMemo` sur `steps`), un objet neuf à chaque
   * rendu rejouerait cet effet en boucle et effacerait la saisie en cours.
   * Suivre l'identifiant décrit ce qu'on veut vraiment — « une AUTRE carte a
   * été ouverte » — au lieu de dépendre d'un détail du parent.
   */
  useEffect(() => {
    setBrouillon(reference.etape);
    setConditionsTexte(texteDesConditions(etape));
    setAnglaisConfirme([]);
    setOnglet('edition');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- voir ci-dessus : suivre `etape` rendrait le panneau fragile à une optimisation du parent.
  }, [etape.id]);

  /*
   * UN BROUILLON NON ENREGISTRÉ NE SE JETTE PAS SANS PRÉVENIR (audit
   * 2026-09-28). Fermer le panneau, « Annuler » ou cliquer une autre carte
   * perdait la saisie en silence. Le panneau demande confirmation pour sa
   * fermeture ; le parent, prévenu par `onModifie`, pour un changement de
   * carte.
   */
  const modifie = useMemo(
    // Une étape NEUVE est tout entière une saisie non enregistrée.
    () => nouvelle || (brouillon.id === etape.id
      && (JSON.stringify(brouillon) !== JSON.stringify(reference.etape) || conditionsTexte !== texteDesConditions(etape))),
    [brouillon, etape, reference, conditionsTexte, nouvelle],
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
   * Les textes de l'étape qui portent une version anglaise, et celles qui
   * sont PÉRIMÉES : le français a changé dans ce panneau, pas l'anglais, et
   * personne n'a dit qu'il restait valable. Une version périmée empêche
   * d'enregistrer — sinon elle partirait telle quelle, en silence.
   */
  const versionsAnglaises = useMemo(() => {
    if (brouillon.type !== 'action' || !modele) return [];
    const config = brouillon.action.config as Record<string, string | undefined>;
    const origine = (reference.etape.type === 'action' ? reference.etape.action.config : {}) as Record<string, string | undefined>;
    return modele.champs
      .filter((c) => aVersionAnglaise(c) && config[cleAnglaise(c.cle)] !== undefined && champVisible(c, config))
      .map((c) => {
        const cleEn = cleAnglaise(c.cle);
        const anglais = config[cleEn] ?? '';
        /** Le français a changé ici, l'anglais non : à revoir, ou à confirmer. */
        const aRevoir = (config[c.cle] ?? '') !== (origine[c.cle] ?? '')
          && anglais.trim() !== ''
          && anglais === (origine[cleEn] ?? '');
        return { champ: c, modeleAnglais: champAnglais(c), cleEn, aRevoir, perimee: aRevoir && !anglaisConfirme.includes(c.cle) };
      });
  }, [brouillon, reference, modele, anglaisConfirme]);

  /** Ce qui empêche d'enregistrer, dit avant de cliquer. */
  const problemes = useMemo(() => {
    const out: string[] = [];
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
      if (!config[champ.cle]?.trim()) {
        out.push(fr ? `« ${champ.fr} » est vide.` : `“${champ.en}” is empty.`);
      }
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
    for (const v of versionsAnglaises) {
      if (!v.perimee) continue;
      out.push(fr
        ? `« ${v.champ.fr} » a changé, pas sa version anglaise : mettez-la à jour, videz-la, ou confirmez qu’elle reste valable.`
        : `“${v.champ.en}” changed, not its English version: update it, empty it, or confirm it still holds.`);
    }
    return out;
  }, [brouillon, modele, fr, declencheur, objetChamps, champsPerso, versionsAnglaises]);

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
  const champDelai: 'delai_secondes' | 'secondes_avant' = avantDate ? 'secondes_avant' : 'delai_secondes';
  const delai = brouillon.type === 'attendre'
    ? decomposer((avantDate ? brouillon.secondes_avant : brouillon.delai_secondes) ?? 0)
    : null;

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
                    const anglais = versionsAnglaises.find((v) => v.champ.cle === champ.cle);
                    return (
                      <React.Fragment key={champ.cle}>
                        <ChampActionUI
                          champ={champ}
                          valeur={(brouillon.action.config as Record<string, string | undefined>)[champ.cle] ?? ''}
                          onChange={(v) => majConfig(champ.cle, v)}
                          fr={fr}
                          membres={membres}
                          etiquettes={etiquettes}
                          automatisations={automatisations}
                          etapesPipeline={etapesPipeline}
                          sms={modele.cle === 'send_sms' && champ.cle === 'body'}
                        />
                        {/* Sa version anglaise, quand l'étape en porte une : le
                            même champ, juste en dessous. */}
                        {anglais && (
                          <div>
                            <ChampActionUI
                              champ={anglais.modeleAnglais}
                              valeur={(brouillon.action.config as Record<string, string | undefined>)[anglais.cleEn] ?? ''}
                              onChange={(v) => majConfig(anglais.cleEn, v)}
                              fr={fr}
                              sms={modele.cle === 'send_sms' && champ.cle === 'body'}
                            />
                            {anglais.aRevoir && (
                              <div className="mt-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                                <p>
                                  {fr
                                    ? 'Le texte français a changé, pas cette version anglaise. Mettez-la à jour — ou videz-la pour que le français parte à tout le monde.'
                                    : 'The French text changed, not this English version. Update it — or empty it so the French goes to everyone.'}
                                </p>
                                <label htmlFor={`${ids}-anglais-${champ.cle}`} className="mt-1.5 flex cursor-pointer items-center gap-2">
                                  <input
                                    id={`${ids}-anglais-${champ.cle}`}
                                    type="checkbox"
                                    checked={anglaisConfirme.includes(champ.cle)}
                                    onChange={(e) => setAnglaisConfirme((liste) => (e.target.checked
                                      ? [...liste, champ.cle]
                                      : liste.filter((c) => c !== champ.cle)))}
                                    className="h-4 w-4 rounded border-border text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                  />
                                  <span>{fr ? 'La version anglaise reste valable telle quelle' : 'The English version still holds as is'}</span>
                                </label>
                              </div>
                            )}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}

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
                            const actuel =
                              (brouillon.action.config as Record<string, string | undefined>)[champ.cle] ?? '';
                            majConfig(champ.cle, `${actuel}[${v.cle}]`);
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
            {brouillon.type === 'attendre' && delai && (
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
                    value={delai.valeur}
                    onChange={(e) => {
                      const n = Math.max(0, Number(e.target.value) || 0);
                      const u = UNITES.find((x) => x.cle === delai.unite) ?? UNITES[0];
                      setBrouillon({ ...(brouillon as EtapeAttendre), [champDelai]: n * u.secondes });
                    }}
                    className="w-24 rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  <select
                    aria-label={fr ? 'Unité de temps' : 'Time unit'}
                    value={delai.unite}
                    onChange={(e) => {
                      const u = UNITES.find((x) => x.cle === e.target.value) ?? UNITES[0];
                      setBrouillon({ ...(brouillon as EtapeAttendre), [champDelai]: delai.valeur * u.secondes });
                    }}
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
                      setBrouillon(mode === 'avant_date'
                        ? { ...actuelle, mode, secondes_avant: actuelle.secondes_avant ?? actuelle.delai_secondes, delai_secondes: 0 }
                        : { ...actuelle, mode, delai_secondes: actuelle.mode === 'avant_date' ? (actuelle.secondes_avant ?? 86400) : actuelle.delai_secondes });
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
                    ? 'Une ligne par condition : champ = valeur, ou une comparaison (montant > 5000, created_at >= 2026-06-01). Deux lignes sur le même champ font un intervalle. Le parcours suit « alors » quand toutes sont vraies.'
                    : 'One condition per line: field = value, or a comparison (amount > 5000, created_at >= 2026-06-01). Two lines on the same field make a range. The journey follows “then” when all are true.'}
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
                          conditions: { ...analyserConditions(ajout), ...champsPersoDe(brouillon) },
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
                      conditions: { ...analyserConditions(e.target.value), ...champsPersoDe(brouillon) },
                    });
                  }}
                  className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 font-mono text-xs text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
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

            {/* Ce qui bloque l'enregistrement, dit avant de cliquer. */}
            {problemes.length > 0 && (
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
        {problemes.length > 0 && (
          <span className="max-w-[55%] text-right text-[11px] leading-tight text-danger">
            {problemes[0]}
          </span>
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
            : versEnregistrement(sansAnglaisVide(brouillon), reference.html))}
          disabled={problemes.length > 0}
          className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {fr ? 'Enregistrer' : 'Save action'}
        </button>
      </div>
    </aside>
  );
}

export type { EtapeAction };
