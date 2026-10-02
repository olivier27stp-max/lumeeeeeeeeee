/* ═══════════════════════════════════════════════════════════════
   Édition d'un courriel d'automatisation, directement dans son aperçu.

   Le corps est stocké en HTML. Le montrer tel quel — `<div
   style="font-family:sans-serif;max-width:600px;...">` — est illisible pour
   qui veut simplement changer une phrase.

   Ici, le courriel s'affiche comme le client le recevra, et chaque bloc de
   texte est modifiable sur place : on clique sur la phrase, on la corrige.
   Aucune balise n'est jamais visible.
   ═══════════════════════════════════════════════════════════════ */

import React, { useState, useMemo, useEffect, useCallback, useId, useRef } from 'react';
import { X, Loader2, Check, Plus, Trash2, Type, List } from 'lucide-react';
import { toast } from 'sonner';
import { confirmer } from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';
import {
  ecrireMessageDeRegle, lireMessageDeRegle, getAutomationLanguage, getCompanyBranding, type EcritureMessage,
} from '../../lib/automationRulesApi';
import {
  htmlVersTexte, texteVersHtml, remplacerVariables, VARIABLES_PROPOSEES, VARIABLES_CONNUES, VARIABLES_POINTEES_CONNUES,
} from '../../lib/emailBodyText';
import { variablesPour, VARIABLES_PAR_TYPE } from '../../lib/variablesCourriel';
import { apercuCourriel, envoyerEssaiCourriel } from '../../lib/emailTemplatesApi';
import { useChampsTous, variablesChampsPourCourriel } from '../champs/automatisations';

interface Props {
  /** Règle d'automatisation visée. Absent quand `enregistrerTexte` est fourni. */
  ruleId?: string;
  ruleName: string;
  /** Corps HTML actuel. */
  body: string;
  subject: string;
  fr: boolean;
  onClose: () => void;
  onSaved: () => void;
  /**
   * Où va le texte une fois écrit. Par défaut dans la règle d'automatisation
   * désignée par `ruleId` ; la page « Modèles de courriel » l'envoie plutôt
   * dans `email_templates`. Le même éditeur sert ainsi aux 35 courriels, au
   * lieu d'en écrire un second qui divergerait au premier correctif.
   */
  enregistrerTexte?: (corpsHtml: string, objet: string) => Promise<void>;
  /**
   * Le poste visé (`invoice_sent`, `quote_sent`…), qui décide des variables
   * offertes : le serveur ne remplit pas les mêmes selon l'envoi. Absent pour
   * une automatisation, qui garde la liste générique.
   */
  typeCourriel?: string;
  /** Le déclencheur de l'automatisation : l'aperçu montre le bouton que CE courriel portera (ou aucun). */
  declencheur?: string;
  /**
   * Rendre à ce courriel son texte d'origine. Absent quand l'entreprise n'a
   * rien écrit : il n'y a alors rien à défaire.
   *
   * Cette action vivait dans la LISTE, en bouton-icône sans étiquette, à côté
   * de « modifier » et d'« importer du HTML ». Trois icônes muettes par ligne,
   * dont une destructrice. Elle appartient ici : on défait un texte en le
   * regardant, pas depuis un index.
   */
  revenirAuDefaut?: () => Promise<void> | void;
}

/** Les deux versions qu'un courriel d'automatisation peut porter. */
type Langue = 'fr' | 'en';

/** Une version du courriel, telle qu'on la modifie. */
interface Version {
  blocs: Bloc[];
  objet: string;
}

/** Un bloc du courriel : titre, paragraphe ou puce. */
interface Bloc {
  id: number;
  type: 'titre' | 'paragraphe' | 'puce';
  texte: string;
  /**
   * Le HTML d'où vient ce bloc, et le texte qu'il donnait à l'ouverture. Tant
   * que le texte n'a pas changé, c'est CE HTML qui est enregistré : son gras,
   * son lien, son style. Absent pour un bloc ajouté dans l'éditeur.
   */
  origine?: { html: string; texte: string };
}

/**
 * Identité de l'entreprise, pour montrer le courriel tel qu'il partira.
 *
 * Le serveur enveloppe chaque envoi dans `buildEmailLayout` — logo, en-tête,
 * pied de page avec téléphone et numéros de taxes — exactement comme pour une
 * facture ou un devis. L'éditeur doit le refléter, sinon on écrit un message
 * « nu » sans voir qu'il arrivera habillé.
 */
interface Entreprise {
  company_name?: string | null;
  company_logo_url?: string | null;
  company_phone?: string | null;
  company_email?: string | null;
}

/* Toutes les clés que Lume connaît, tous postes confondus. Sert à repérer
   celle qui existe AILLEURS : « [quote_number] » dans une facture a l'air
   juste, mais le serveur ne la remplit pas là et elle partirait en blanc. */
const TOUTES_LES_CLES = new Set(
  Object.values(VARIABLES_PAR_TYPE).flat().map((v) => v.cle),
);

let compteurId = 0;

/**
 * Champ d'un bloc, auto-dimensionné à son contenu.
 *
 * Déclaré au niveau module, pas dans le composant parent : React recrée un
 * composant défini à l'intérieur d'un rendu à CHAQUE frappe, ce qui démonte le
 * champ et lui fait perdre le focus au milieu d'une phrase.
 */
function ChampBloc({
  bloc, fr, onChange, onFocus,
}: {
  bloc: Bloc;
  fr: boolean;
  onChange: (texte: string) => void;
  /** Le champ qui reçoit le curseur : « Insérer » écrira là où il est. */
  onFocus: (champ: HTMLTextAreaElement) => void;
}) {
  const ajuster = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  return (
    <textarea
      value={bloc.texte}
      onChange={(e) => { onChange(e.target.value); ajuster(e.currentTarget); }}
      onFocus={(e) => onFocus(e.currentTarget)}
      rows={1}
      placeholder={fr ? 'Écrivez ici…' : 'Type here…'}
      aria-label={bloc.type === 'titre' ? (fr ? 'Titre' : 'Title') : bloc.type === 'puce' ? (fr ? 'Puce' : 'Bullet') : (fr ? 'Paragraphe' : 'Paragraph')}
      className={cn(
        'w-full bg-transparent border border-transparent rounded px-2 py-1 resize-none overflow-hidden',
        'hover:border-outline/40 focus:border-primary/60 focus:bg-surface focus:outline-none transition-colors',
        bloc.type === 'titre'
          ? 'text-[17px] font-semibold text-text-primary'
          : 'text-[13px] text-text-secondary leading-relaxed',
      )}
      style={{ minHeight: bloc.type === 'titre' ? 30 : 26 }}
      ref={ajuster}
    />
  );
}

/** Au-delà de ce nombre de variables, la palette offre une recherche. */
const SEUIL_RECHERCHE_VARIABLES = 12;

/** Découpe le texte converti en blocs manipulables. */
function texteEnBlocs(texte: string): Bloc[] {
  const lignes = texte.split('\n').filter((l) => l.trim());
  return lignes.map((ligne, i) => ({
    id: compteurId++,
    type: ligne.startsWith('- ') ? 'puce' : i === 0 ? 'titre' : 'paragraphe',
    texte: ligne.startsWith('- ') ? ligne.slice(2) : ligne,
  }));
}

function blocsEnTexte(blocs: Bloc[]): string {
  return blocs
    .map((b) => (b.type === 'puce' ? `- ${b.texte}` : b.texte))
    .join('\n');
}

/**
 * Ce que disent des blocs, sans les lignes vides ni les espaces de bord : deux
 * courriels qui donnent le même HTML se comparent égaux (une ligne ajoutée et
 * laissée vide n'est pas « une modification »).
 */
function texteCompare(blocs: Bloc[]): string {
  return blocsEnTexte(blocs).split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

/*
 * CE QU'ON N'A PAS TOUCHÉ GARDE SA MISE EN FORME (triage « modèles »,
 * 04-courriel:394 et :410).
 *
 * L'éditeur montre du TEXTE, et reconstruisait tout le courriel à partir de ce
 * texte : corriger un mot d'un paragraphe effaçait le gras d'un autre, changeait
 * le lien « Voir votre soumission » en simple « [quote_link] », et faisait un
 * TITRE de la première ligne quelle qu'elle soit.
 *
 * Chaque bloc garde donc le HTML d'où il vient (`origine`). À l'enregistrement,
 * un bloc dont le texte n'a pas changé rend CE HTML, tel quel ; seul un bloc
 * réécrit (ou ajouté) est reconstruit — par le même générateur qu'avant
 * (`texteVersHtml`), dans son type : un paragraphe reste un paragraphe.
 */

/** Le courriel (HTML) découpé en blocs : un par titre, paragraphe ou puce. */
function htmlEnBlocs(body: string): Bloc[] {
  if (!body.trim()) return [];
  // Sans DOM (hors navigateur) : l'ancienne découpe, par lignes de texte.
  if (typeof DOMParser === 'undefined') return texteEnBlocs(htmlVersTexte(body));

  let conteneur: Element = new DOMParser().parseFromString(body, 'text/html').body;
  // L'enveloppe — un <div> qui contient tout le courriel — n'est pas un bloc.
  for (;;) {
    const enfants = Array.from(conteneur.childNodes).filter((n) => n.nodeType === 1 || (n.textContent ?? '').trim());
    const seul = enfants.length === 1 && enfants[0].nodeType === 1 ? (enfants[0] as Element) : null;
    if (!seul || seul.tagName !== 'DIV') break;
    conteneur = seul;
  }

  const blocs: Bloc[] = [];
  const bloc = (type: Bloc['type'], html: string, interieur: string) => {
    const texte = htmlVersTexte(interieur);
    if (texte.trim()) blocs.push({ id: compteurId++, type, texte, origine: { html, texte } });
  };
  /* Du texte posé à même le courriel, hors de tout paragraphe (un courriel
     écrit en texte brut) : une ligne = un paragraphe. S'il porte du gras ou un
     lien, la suite reste UN bloc, pour garder cette mise en forme. */
  let suite: Node[] = [];
  const viderSuite = () => {
    if (!suite.length) return;
    const html = suite.map((n) => (n.nodeType === 1 ? (n as Element).outerHTML : echapperTexte(n.textContent ?? ''))).join('');
    if (suite.some((n) => n.nodeType === 1 && (n as Element).tagName !== 'BR')) {
      bloc('paragraphe', `<p style="${STYLE_PARAGRAPHE}">${html.trim()}</p>`, html);
    } else {
      for (const ligne of htmlVersTexte(html).split('\n')) {
        if (ligne.trim()) blocs.push({ id: compteurId++, type: 'paragraphe', texte: ligne.trim() });
      }
    }
    suite = [];
  };
  for (const noeud of Array.from(conteneur.childNodes)) {
    const el = noeud.nodeType === 1 ? (noeud as Element) : null;
    if (!el || BALISES_EN_LIGNE.has(el.tagName)) {
      if (el || noeud.nodeType === 3) suite.push(noeud);
      continue;
    }
    viderSuite();
    if (/^H[1-6]$/.test(el.tagName)) bloc('titre', el.outerHTML, el.innerHTML);
    else if (el.tagName === 'UL' || el.tagName === 'OL') {
      for (const li of Array.from(el.children)) bloc('puce', li.tagName === 'LI' ? li.outerHTML : `<li>${li.outerHTML}</li>`, li.innerHTML);
    } else bloc('paragraphe', el.outerHTML, el.tagName === 'P' ? el.innerHTML : el.outerHTML);
  }
  viderSuite();
  return blocs;
}

const BALISES_EN_LIGNE = new Set(['A', 'B', 'STRONG', 'I', 'EM', 'U', 'SPAN', 'BR', 'SMALL', 'FONT']);
const echapperTexte = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Les morceaux du générateur (`texteVersHtml`), pris sur ce qu'il produit plutôt
   que recopiés : l'enveloppe, le style d'un paragraphe, l'ouverture d'une liste.
   S'il change, l'éditeur suit. */
const FIN_ENVELOPPE = '</div>';
const ENVELOPPE_OUVERTE = texteVersHtml('').slice(0, -FIN_ENVELOPPE.length);
/** Tout ce que le générateur écrit avant le contenu qui suit une première ligne « x » (l'enveloppe et son titre). */
const AVANT_LA_SUITE = texteVersHtml('x').slice(0, -FIN_ENVELOPPE.length);
const suiteDe = (texte: string) => texteVersHtml(`x\n${texte}`).slice(AVANT_LA_SUITE.length, -FIN_ENVELOPPE.length);
const STYLE_PARAGRAPHE = suiteDe('x').match(/^<p style="([^"]*)"/)?.[1] ?? '';
const LISTE_OUVERTE = suiteDe('- x').match(/^<ul[^>]*>/)?.[0] ?? '<ul>';

/** Le HTML d'un bloc réécrit ou ajouté, dans SON type. */
function htmlDuBlocReecrit(type: Bloc['type'], texte: string): string {
  // Pour le générateur, la première ligne d'un texte est un titre.
  if (type === 'titre') return texteVersHtml(texte).slice(ENVELOPPE_OUVERTE.length, -FIN_ENVELOPPE.length);
  if (type === 'puce') {
    const liste = suiteDe(`- ${texte.replace(/\s*\n\s*/g, ' ')}`);
    return liste.slice(LISTE_OUVERTE.length, liste.lastIndexOf('</ul>'));
  }
  return suiteDe(texte);
}

/**
 * Blocs → HTML du courriel. Un bloc intact rend son HTML d'origine ; les puces
 * qui se suivent partagent une liste.
 */
function blocsVersHtml(blocs: Bloc[]): string {
  const morceaux: string[] = [];
  let puces: string[] = [];
  const viderPuces = () => {
    if (puces.length) morceaux.push(`${LISTE_OUVERTE}${puces.join('')}</ul>`);
    puces = [];
  };
  for (const b of blocs) {
    if (!b.texte.trim()) continue;
    const html = b.origine && b.origine.texte === b.texte ? b.origine.html : htmlDuBlocReecrit(b.type, b.texte);
    if (b.type === 'puce') { puces.push(html); continue; }
    viderPuces();
    morceaux.push(html);
  }
  viderPuces();
  return `${ENVELOPPE_OUVERTE}${morceaux.join('')}${FIN_ENVELOPPE}`;
}

export default function EmailPreviewEditor({
  ruleId, ruleName, body, subject, fr, onClose, onSaved, enregistrerTexte, typeCourriel, declencheur,
  revenirAuDefaut,
}: Props) {
  /*
   * LES DEUX VERSIONS (triage « modèles », 04-courriel:834).
   *
   * Un courriel d'automatisation peut porter une version anglaise (`body_en`,
   * `subject_en`) : le moteur l'envoie À LA PLACE du français quand la langue
   * du bureau est l'anglais. L'éditeur ne montrait que le français : un bureau
   * anglophone corrigeait un texte que ses clients ne recevaient pas, pendant
   * que l'anglais, invisible, continuait de partir.
   *
   * On montre donc la version qui PART, on dit laquelle, et l'autre reste à un
   * clic. `blocs` et `objet` sont ceux de la version affichée.
   */
  const modeRegle = !!ruleId && !enregistrerTexte;
  const [versions, setVersions] = useState<Record<Langue, Version>>(() => ({
    fr: { blocs: htmlEnBlocs(body), objet: subject },
    en: { blocs: [], objet: '' },
  }));
  const [langue, setLangue] = useState<Langue>('fr');
  const { blocs, objet } = versions[langue];
  const setBlocs = useCallback((maj: (b: Bloc[]) => Bloc[]) => {
    setVersions((v) => ({ ...v, [langue]: { ...v[langue], blocs: maj(v[langue].blocs) } }));
  }, [langue]);
  const setObjet = useCallback((maj: string | ((o: string) => string)) => {
    setVersions((v) => ({ ...v, [langue]: { ...v[langue], objet: typeof maj === 'function' ? maj(v[langue].objet) : maj } }));
  }, [langue]);
  /** Ce qu'on sait de la règle une fois relue. `pret` = on peut montrer le texte. */
  const [lecture, setLecture] = useState<{ pret: boolean; aAnglais: boolean; langueBureau: Langue | null }>(
    { pret: !modeRegle, aAnglais: false, langueBureau: null },
  );
  /** « La version anglaise reste valable telle quelle » : coché par l'utilisateur. */
  const [anglaisConfirme, setAnglaisConfirme] = useState(false);
  const idAnglaisConfirme = useId();
  const [actif, setActif] = useState<number | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [enregistre, setEnregistre] = useState(false);
  const [entreprise, setEntreprise] = useState<Entreprise>({});
  /** Objet ou corps : où la prochaine variable insérée doit atterrir. */
  const [cibleObjet, setCibleObjet] = useState(false);

  /* L'aperçu RÉEL, rendu par le serveur.

     Le bloc modifiable ci-dessous reste : on corrige une phrase en cliquant
     dessus, c'est tout l'intérêt de cet éditeur. Mais il ne DESSINE plus le
     décor — fond, logo, pied — qu'il inventait en React avec les couleurs en
     dur. Deux rendus pour une même chose, donc deux vérités : le jour où le
     gabarit serveur est passé du ciel au gris neutre, l'aperçu a continué de
     montrer un décor que plus personne ne recevait.

     L'onglet « Aperçu réel » affiche ce que le serveur enverrait, dans une
     iframe. `null` = le serveur n'a pas répondu : on reste sur l'éditeur
     plutôt que de bloquer l'écriture pour une image. */
  const [ongletApercu, setOngletApercu] = useState(false);
  const [htmlReel, setHtmlReel] = useState<string | null>(null);
  const [chargementApercu, setChargementApercu] = useState(false);
  const [essaiEnCours, setEssaiEnCours] = useState(false);

  /* S'envoyer le courriel, pour le voir dans une vraie boîte. L'aperçu montre
     le bon rendu, mais il ne dit pas comment Gmail coupe l'objet, ni à quoi
     ressemble le courriel sur un téléphone. */
  const envoyerEssai = async () => {
    setEssaiEnCours(true);
    try {
      const adresse = await envoyerEssaiCourriel(blocsVersHtml(blocs), objet, typeCourriel, declencheur);
      if (adresse) toast.success(fr ? `Essai envoyé à ${adresse}` : `Test sent to ${adresse}`);
      else toast.error(fr ? 'Envoi impossible' : 'Could not send');
    } finally {
      setEssaiEnCours(false);
    }
  };

  useEffect(() => {
    if (!ongletApercu) return;
    let vivant = true;
    setChargementApercu(true);
    void apercuCourriel(blocsVersHtml(blocs), typeCourriel, declencheur)
      .then((h) => { if (vivant) setHtmlReel(h); })
      .finally(() => { if (vivant) setChargementApercu(false); });
    return () => { vivant = false; };
    // Volontairement recalculé à chaque bascule vers l'onglet : l'aperçu doit
    // refléter le texte au moment où on le regarde, pas celui de l'ouverture.
  }, [ongletApercu, blocs]);

  /* Les variables offertes. Pour un modèle, celles que le serveur remplit
     VRAIMENT pour ce poste : proposer `{invoice_total}` sur une soumission
     laisserait un trou dans le courriel reçu par le client. Pour une
     automatisation (`typeCourriel` absent), la liste générique d'avant. */
  const champsPerso = useChampsTous();
  const variables = useMemo(() => [
    ...(typeCourriel
      ? variablesPour(typeCourriel).map((v) => ({ cle: v.cle, fr: v.fr, en: v.en, jeton: undefined as string | undefined }))
      : VARIABLES_PROPOSEES.map((v) => ({ ...v, jeton: undefined as string | undefined }))),
    // Champs personnalisés (v2) que le serveur remplit pour ce poste.
    ...variablesChampsPourCourriel(typeCourriel, champsPerso),
  ], [typeCourriel, champsPerso]);

  /* Le filtre de la palette : sans accents ni casse, sur le libellé affiché
     ET sur la clé — on cherche « prenom » comme « first_name ». */
  const [filtreVariable, setFiltreVariable] = useState('');
  const variablesAffichees = useMemo(() => {
    const nu = (x: string) => x.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const cherche = nu(filtreVariable.trim());
    if (!cherche) return variables;
    return variables.filter((v) => nu(`${fr ? v.fr : v.en} ${v.cle} ${v.jeton ?? ''}`).includes(cherche));
  }, [variables, filtreVariable, fr]);

  /* Les variables ÉCRITES qui n'existent pas.

     Deux façons de se tromper, et aucune ne se voyait :

       [invoice_numbr]  une lettre en moins → le serveur remplace par du VIDE.
                        Le client reçoit « Facture  » : un trou, pas un crochet.
       [montant_dû]     un accent, un tiret ou une espace dans la clé → le
                        serveur ne reconnaît RIEN (`applyTemplate` utilise
                        `\w`) et le crochet part tel quel chez le client.

     Le second cas est le piège francophone : écrire `[montant_dû]` est
     naturel, et c'est précisément ce qui casse.

     On ne peut pas effacer tous les crochets à l'envoi — « Rabais [50 %] »
     est un texte légitime. La seule bonne place pour attraper ça, c'est ici,
     pendant qu'on écrit. */
  const inconnues = useMemo(() => {
    const connues = new Set(variables.map((v) => v.cle));
    /* Une AUTOMATISATION est rendue par le moteur, qui remplit bien plus que
       les raccourcis de la palette : [appointment_address], [company_phone],
       [contract_html]… L'éditeur les prenait pour des fautes et affichait
       « Cette variable n'existe pas » sur les textes que Lume fournit
       lui-même (vu en prod le 2026-10-01). Un modèle de courriel
       (`typeCourriel`) garde sa liste stricte : là, le serveur ne remplit
       que les variables de son poste. */
    if (!typeCourriel) for (const v of VARIABLES_CONNUES) connues.add(v);
    const vues = new Set<string>();
    /* {{client.cle}} — le format GoHighLevel des champs personnalisés. On le
       traite avant les crochets : `{{client.x}}` passerait sinon pour la clé
       bancale `{client.x`. Champ connu → rien à dire ; inconnu → signalé tel
       qu'écrit, pour que l'auteur voie exactement ce qu'il a tapé. */
    // Les deux versions partent aux clients : mêmes variables, même contrôle.
    const ecrit = [versions.fr, ...(lecture.aAnglais ? [versions.en] : [])]
      .map((v) => `${v.objet} ${blocsEnTexte(v.blocs)}`).join(' ');
    const texte = ecrit.replace(
      /\{\{\s*([a-z]+)\.([a-z][a-z0-9_]*)\s*\}\}/g,
      (entier, obj: string, cle: string) => {
        // {{soumission.total}}, {{facture.lien}}… : remplies par le moteur
        // lui-même, ce ne sont pas des champs personnalisés.
        const duMoteur = !typeCourriel && VARIABLES_POINTEES_CONNUES.includes(`${obj}.${cle}`);
        if (!duMoteur && !connues.has(`${obj}_cf_${cle}`)) vues.add(entier);
        return ' ';
      },
    );
    // La clé peut contenir n'importe quoi sauf le crochet fermant : c'est
    // ainsi qu'on attrape `[client-name]` et `[montant_dû]`, que le serveur
    // ne reconnaîtrait pas.
    for (const m of texte.matchAll(/[[{]([^\]}]{1,40})[\]}]/g)) {
      const cle = m[1].trim();
      /* Un crochet de texte courant n'est pas une variable ratée, et crier
         dessus apprendrait vite à ignorer l'avertissement — ce qui le rendrait
         inutile le jour où il a raison.

         Distinguer « [50 %] » de « [invoice_numbr] » par la forme seule est
         fragile : « [ci-dessous] » ressemble à une clé, « [client name] » n'y
         ressemble pas. On compare donc à ce qui EXISTE : on ne signale que ce
         qui est proche d'une variable connue (une lettre en trop, en moins ou
         changée, ou la même clé écrite autrement). Le reste est du texte, et
         on se tait. */
      if (connues.has(cle)) continue;
      /* Une variable d'un AUTRE poste : elle existe quelque part, donc elle a
         l'air juste — mais le serveur ne la remplit pas ici, et elle partirait
         en blanc. C'est le cas le plus sournois : rien dans le mot ne cloche. */
      if (TOUTES_LES_CLES.has(cle)) { vues.add(cle); continue; }
      const nu = (x: string) => x.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
      const cleNue = nu(cle);
      const ressemble = [...connues].some((k) => {
        const kn = nu(k);
        if (kn === cleNue) return true;                       // même clé, autre écriture
        if (Math.abs(kn.length - cleNue.length) > 3) return false;
        /* Un préfixe commun long : « invoice_amont » et « invoice_amount »
           partagent « invoice_am », soit assez pour dire que l'un visait
           l'autre. Le seuil est haut (7 caractères ou les trois quarts) pour
           que deux mots français courants ne se ressemblent pas par hasard. */
        let commun = 0;
        while (commun < kn.length && commun < cleNue.length && kn[commun] === cleNue[commun]) commun++;
        return commun >= Math.min(7, Math.ceil(Math.max(kn.length, cleNue.length) * 0.75));
      });
      if (!ressemble) continue;
      if (!connues.has(cle)) vues.add(cle);
    }
    return [...vues];
  }, [versions, lecture.aAnglais, variables]);

  // L'en-tête et le pied de page sont ajoutés par le SERVEUR à l'envoi
  // (`buildEmailLayout`), comme pour une facture ou un devis. Les afficher ici
  // évite d'écrire un message « nu » sans voir qu'il arrivera habillé — et de
  // répéter le nom de l'entreprise déjà présent dans le pied de page.
  useEffect(() => {
    getCompanyBranding()
      .then(setEntreprise)
      .catch(() => { /* aperçu sans logo : pas bloquant */ });
  }, []);

  /*
   * Le texte EN BASE sur lequel on travaille : celui de l'ouverture, puis celui
   * du dernier enregistrement. Il désigne le courriel à modifier quand la règle
   * en envoie plusieurs (`CibleMessage`), et il dit s'il reste quelque chose à
   * enregistrer — sans attendre que la liste, derrière, se soit rechargée.
   */
  const [enBase, setEnBase] = useState<{ body: string; subject: string; body_en: string; subject_en: string }>(
    { body, subject, body_en: '', subject_en: '' },
  );
  useEffect(() => { setEnBase((b) => ({ ...b, body, subject })); }, [body, subject]);

  /* À l'ouverture : la version anglaise du courriel, s'il en a une, et la
     langue dans laquelle le bureau écrit à ses clients. Le texte n'est montré
     qu'ensuite — sinon on commencerait à corriger la version qui ne part pas. */
  useEffect(() => {
    if (!modeRegle || !ruleId) return;
    let vivant = true;
    void (async () => {
      let anglais: { body: string; subject: string } | null = null;
      let langueBureau: Langue | null = null;
      try {
        const message = await lireMessageDeRegle(ruleId, 'send_email', { corpsLu: body, objetLu: subject });
        const corps = typeof message.config.body_en === 'string' ? message.config.body_en : '';
        const sujet = typeof message.config.subject_en === 'string' ? message.config.subject_en : '';
        if (corps.trim() || sujet.trim()) anglais = { body: corps, subject: sujet };
      } catch (e: unknown) {
        console.error('[automations/courriel] version anglaise illisible', e);
      }
      try {
        langueBureau = await getAutomationLanguage();
      } catch (e: unknown) {
        console.error('[automations/courriel] langue des messages illisible', e);
      }
      if (!vivant) return;
      if (anglais) {
        const lu = anglais;
        setVersions((v) => ({ ...v, en: { blocs: htmlEnBlocs(lu.body), objet: lu.subject } }));
        setEnBase((b) => ({ ...b, body_en: lu.body, subject_en: lu.subject }));
        // On ouvre sur la version qui part.
        if (langueBureau === 'en' && lu.body.trim()) setLangue('en');
      }
      setLecture({ pret: true, aAnglais: !!anglais, langueBureau });
    })();
    return () => { vivant = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- à l'ouverture seulement : relire à chaque frappe remplacerait la saisie.
  }, []);

  const initial = useMemo(() => ({
    fr: { blocs: texteCompare(htmlEnBlocs(enBase.body)), objet: enBase.subject },
    en: { blocs: texteCompare(htmlEnBlocs(enBase.body_en)), objet: enBase.subject_en },
  }), [enBase]);
  const modifieFr = texteCompare(versions.fr.blocs) !== initial.fr.blocs || versions.fr.objet !== initial.fr.objet;
  const modifieEn = lecture.aAnglais
    && (texteCompare(versions.en.blocs) !== initial.en.blocs || versions.en.objet !== initial.en.objet);
  const modifie = modifieFr || modifieEn;
  /**
   * Le français a changé ici, pas l'anglais : il partirait tel quel, périmé,
   * sans que personne le voie. On le dit, et « Enregistrer » attend qu'on le
   * mette à jour, qu'on le vide, ou qu'on confirme qu'il reste valable — la
   * même règle, avec les mêmes mots, que le panneau d'étape de l'éditeur.
   */
  const anglaisARevoir = lecture.aAnglais && modifieFr && !modifieEn && blocsEnTexte(versions.en.blocs).trim() !== '';
  const anglaisPerime = anglaisARevoir && !anglaisConfirme;
  /** La version que les clients reçoivent — `null` quand la langue du bureau n'a pas pu être lue. */
  const langueQuiPart: Langue | null = lecture.langueBureau === null
    ? null
    : lecture.langueBureau === 'en' && lecture.aAnglais && enBase.body_en.trim() ? 'en' : 'fr';

  /**
   * Ferme la fenêtre, en demandant confirmation si du travail serait perdu.
   *
   * Les quatre chemins de fermeture — Échap, la croix, le bouton Fermer, un
   * clic sur le fond — passent par ici. Sans cette garde, un clic à côté
   * effaçait un courriel réécrit sans le moindre avertissement.
   */
  const fermer = useCallback(async () => {
    if (modifie) {
      const question = fr
        ? 'Vos modifications ne sont pas enregistrées. Fermer quand même ?'
        : 'Your changes are not saved. Close anyway?';
      if (!(await confirmer({ message: question, danger: true }))) return;
    }
    onClose();
  }, [modifie, fr, onClose]);

  // Échap ferme la fenêtre — réflexe attendu d'une fenêtre superposée.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void fermer(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fermer]);

  const majBloc = (id: number, texte: string) =>
    setBlocs((bs) => bs.map((b) => (b.id === id ? { ...b, texte } : b)));

  /**
   * Supprime un bloc, en offrant de le rétablir.
   *
   * Le bouton de suppression est proche du texte : un clic malheureux faisait
   * disparaître un paragraphe sans recours, et rien ne permettait d'annuler.
   */
  const supprimerBloc = (id: number) => {
    const bloc = blocs.find((b) => b.id === id);
    const position = blocs.findIndex((b) => b.id === id);
    if (!bloc) return;

    setBlocs((bs) => bs.filter((b) => b.id !== id));

    // Rien à rétablir si la ligne était vide.
    if (!bloc.texte.trim()) return;
    toast(fr ? 'Ligne supprimée' : 'Line removed', {
      action: {
        label: fr ? 'Annuler' : 'Undo',
        onClick: () => setBlocs((bs) => {
          const copie = [...bs];
          copie.splice(Math.min(position, copie.length), 0, bloc);
          return copie;
        }),
      },
    });
  };

  const ajouterBloc = (type: Bloc['type']) =>
    setBlocs((bs) => [...bs, { id: compteurId++, type, texte: '' }]);

  /*
   * « INSÉRER » ÉCRIT LÀ OÙ EST LE CURSEUR (triage « modèles », 04-courriel:538
   * et :547). La variable partait toujours en FIN de ligne — « Bonjour , à
   * demain.[client_first_name] » — et, sur un courriel vidé de ses lignes, le
   * clic ne faisait rien, sans rien dire.
   *
   * Le champ qui a eu le curseur en dernier (l'objet ou une ligne) le garde en
   * mémoire même quand le clic sur le bouton lui prend le focus ; sans champ
   * cliqué, la variable va à la fin de la dernière ligne, comme avant.
   */
  const champActif = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  /** Où remettre le curseur une fois la variable posée : juste après elle. */
  const curseurVoulu = useRef<{ champ: HTMLTextAreaElement | HTMLInputElement; position: number } | null>(null);
  useEffect(() => {
    const voulu = curseurVoulu.current;
    if (!voulu) return;
    curseurVoulu.current = null;
    voulu.champ.focus();
    voulu.champ.setSelectionRange(voulu.position, voulu.position);
  });

  const insererVariable = (cle: string, jeton?: string) => {
    // Un champ personnalisé apporte son écriture complète ({{client.cle}}) ;
    // les variables classiques prennent les crochets historiques.
    const ecriture = jeton ?? `[${cle}]`;
    const champ = champActif.current;
    const auCurseur = (texte: string): string => {
      // Le champ mémorisé n'est pas (ou plus) celui de ce texte : à la fin.
      if (!champ || champ.value !== texte) return `${texte}${ecriture}`;
      const debut = champ.selectionStart ?? texte.length;
      const fin = champ.selectionEnd ?? debut;
      curseurVoulu.current = { champ, position: debut + ecriture.length };
      return `${texte.slice(0, debut)}${ecriture}${texte.slice(fin)}`;
    };
    // L'objet décide de l'ouverture : il doit pouvoir porter le montant ou le
    // numéro, pas seulement le corps.
    if (cibleObjet) {
      setObjet(auCurseur(objet));
      return;
    }
    // Aucune ligne : la variable en ouvre une.
    if (blocs.length === 0) {
      setBlocs(() => [{ id: compteurId++, type: 'paragraphe', texte: ecriture }]);
      return;
    }
    const ligne = blocs.find((b) => b.id === actif) ?? blocs[blocs.length - 1];
    const texte = ligne.id === actif ? auCurseur(ligne.texte) : `${ligne.texte}${ecriture}`;
    setBlocs((bs) => bs.map((b) => (b.id === ligne.id ? { ...b, texte } : b)));
  };

  const enregistrer = async () => {
    if (!modifie || enregistrement || anglaisPerime) return;
    setEnregistrement(true);
    try {
      // Le HTML n'est reconstruit qu'ici : l'utilisateur ne l'a jamais vu.
      const corpsHtml = blocsVersHtml(blocs);
      if (enregistrerTexte) {
        await enregistrerTexte(corpsHtml, objet);
      } else if (ruleId) {
        // Une règle peut envoyer DEUX courriels : on écrit dans celui qu'on a
        // ouvert (désigné par le texte lu), jamais dans « tous les courriels ».
        // Et seulement la ou les versions modifiées : une version anglaise
        // vidée est retirée (le français part alors à tout le monde).
        const ecriture: EcritureMessage = {
          ...(modifieFr ? { body: blocsVersHtml(versions.fr.blocs), subject: versions.fr.objet } : {}),
          ...(modifieEn ? { body_en: blocsVersHtml(versions.en.blocs), subject_en: versions.en.objet } : {}),
        };
        await ecrireMessageDeRegle(ruleId, 'send_email', ecriture, { corpsLu: enBase.body, objetLu: enBase.subject });
        const anglaisVide = modifieEn && !blocsEnTexte(versions.en.blocs).trim();
        setEnBase((b) => ({
          body: ecriture.body ?? b.body,
          subject: ecriture.subject ?? b.subject,
          body_en: anglaisVide ? '' : ecriture.body_en ?? b.body_en,
          subject_en: ecriture.subject_en ?? b.subject_en,
        }));
        setAnglaisConfirme(false);
        // Plus de version anglaise : il ne reste que le français à montrer.
        if (anglaisVide && !versions.en.objet.trim()) {
          setLecture((l) => ({ ...l, aAnglais: false }));
          setLangue('fr');
        }
      } else {
        // Ni destination injectée, ni règle : rien n'aurait été écrit, et
        // l'utilisateur aurait vu « enregistré » pour du travail perdu.
        throw new Error(fr ? 'Aucune destination d’enregistrement' : 'No save destination');
      }
      if (enregistrerTexte) setEnBase((b) => ({ ...b, body: corpsHtml, subject: objet }));
      setEnregistre(true);
      setTimeout(() => setEnregistre(false), 1800);
      onSaved();
      toast.success(fr ? 'Courriel enregistré' : 'Email saved');
    } catch (e: any) {
      // `ecrireMessageDeRegle` lève quand la RLS filtre la ligne — sans quoi
      // l'utilisateur croirait avoir enregistré.
      toast.error(e?.message || (fr ? 'Enregistrement impossible' : 'Could not save'));
    } finally {
      setEnregistrement(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="presentation"
      tabIndex={-1}
      onClick={fermer}
    >
      <div
        className="w-full sm:max-w-3xl h-[95vh] sm:h-auto sm:max-h-[90vh] flex flex-col rounded-t-xl sm:rounded-xl bg-surface-secondary shadow-2xl overflow-hidden"
        role="presentation"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline/50 shrink-0">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text-primary truncate">{ruleName}</p>
            <p className="text-[11px] text-text-tertiary">
              {fr ? 'Cliquez sur le texte pour le modifier' : 'Click the text to edit it'}
            </p>
          </div>
          <button
            onClick={fermer}
            className="p-1.5 rounded-md hover:bg-surface-tertiary text-text-secondary shrink-0"
            aria-label={fr ? 'Fermer' : 'Close'}
          >
            <X size={16} />
          </button>
        </div>

        {/* Le courriel.

            Le fond reprend le CIEL du gabarit serveur (#e6f0ff, celui des
            pages marketing) : sans lui, l'aperçu montrait une enveloppe
            blanche que le client ne reçoit pas, et le propriétaire jugeait son
            courriel sur une image fausse. Les couleurs sont écrites en dur
            plutôt qu'en classes de thème, parce qu'un courriel ne suit pas le
            mode sombre de l'app : il arrive tel quel dans la boîte. */}
        {/* Deux onglets. « Modifier » garde l'édition sur place ; « Aperçu
            réel » montre ce que le serveur enverrait, sans rien redessiner. */}
        <div className="flex items-center gap-1 px-3 sm:px-5 pt-3 border-b border-outline/40">
          <button
            type="button"
            onClick={() => setOngletApercu(false)}
            className={cn(
              'px-3 py-2 text-[12px] font-semibold border-b-2 -mb-px transition-colors',
              !ongletApercu ? 'border-primary text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-secondary',
            )}
          >
            {fr ? 'Modifier' : 'Edit'}
          </button>
          <button
            type="button"
            onClick={() => setOngletApercu(true)}
            className={cn(
              'px-3 py-2 text-[12px] font-semibold border-b-2 -mb-px transition-colors',
              ongletApercu ? 'border-primary text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-secondary',
            )}
          >
            {fr ? 'Aperçu réel' : 'Real preview'}
          </button>
        </div>

        {/* Quelle version on regarde, et laquelle part. */}
        {modeRegle && lecture.pret && (lecture.aAnglais || lecture.langueBureau === 'en') && (
          <div className="shrink-0 border-b border-outline/40 px-3 py-2 sm:px-5">
            {lecture.aAnglais && (
              <div role="group" aria-label={fr ? 'Version du courriel' : 'Email version'} className="flex flex-wrap items-center gap-1.5">
                {(['fr', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={langue === l}
                    onClick={() => { setLangue(l); setActif(null); setCibleObjet(false); }}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                      langue === l
                        ? 'border-primary bg-primary/10 text-text-primary'
                        : 'border-outline/50 text-text-tertiary hover:text-text-secondary',
                    )}
                  >
                    {l === 'fr' ? (fr ? 'Version française' : 'French version') : (fr ? 'Version anglaise' : 'English version')}
                    {langueQuiPart === l && (
                      <span className="font-normal"> — {fr ? 'celle qui part' : 'the one sent'}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <p className={cn('text-[11px] leading-relaxed text-text-tertiary', lecture.aAnglais && 'mt-1')}>
              {!lecture.aAnglais
                ? (fr
                  ? 'La langue des messages du bureau est l’anglais, mais ce courriel n’a pas de version anglaise : c’est ce texte français qui part.'
                  : 'The office message language is English, but this email has no English version: this French text is the one sent.')
                : lecture.langueBureau === null
                  ? (fr
                    ? 'Impossible de lire la langue des messages du bureau pour le moment : vérifiez les deux versions.'
                    : 'The office message language cannot be read right now: check both versions.')
                  : langueQuiPart === 'en'
                    ? (fr
                      ? 'Vos clients reçoivent la version anglaise : la langue des messages du bureau est l’anglais. Vide = le texte français part à tout le monde.'
                      : 'Your clients receive the English version: the office message language is English. Empty = the French text goes to everyone.')
                    : (fr
                      ? 'Vos clients reçoivent la version française. La version anglaise part à la place du texte français quand la langue du bureau est l’anglais.'
                      : 'Your clients receive the French version. The English version is sent instead of the French text when the office language is English.')}
            </p>
          </div>
        )}

        {!lecture.pret ? (
          <div className="flex-1 overflow-y-auto p-3 sm:p-5">
            <p role="status" className="flex items-center justify-center gap-2 py-10 text-[12px] text-text-tertiary">
              <Loader2 size={13} className="animate-spin" aria-hidden="true" />
              {fr ? 'Chargement du courriel…' : 'Loading the email…'}
            </p>
          </div>
        ) : ongletApercu ? (
          <div className="flex-1 overflow-y-auto bg-surface-secondary p-3 sm:p-5">
            {chargementApercu ? (
              <p className="flex items-center justify-center gap-2 py-10 text-[12px] text-text-tertiary">
                <Loader2 size={13} className="animate-spin" />
                {fr ? 'Rendu du courriel…' : 'Rendering…'}
              </p>
            ) : htmlReel ? (
              <iframe
                title={fr ? 'Aperçu du courriel' : 'Email preview'}
                srcDoc={htmlReel}
                sandbox=""
                className="mx-auto block w-full max-w-[600px] rounded-lg border border-outline/40 bg-white"
                style={{ height: 620 }}
              />
            ) : (
              <p className="py-10 text-center text-[12px] text-text-tertiary">
                {fr
                  ? 'Aperçu indisponible pour le moment. Votre texte est intact — revenez à « Modifier ».'
                  : 'Preview unavailable right now. Your text is safe — go back to “Edit”.'}
              </p>
            )}
            {/* « M'envoyer un essai » vit dans le pied de la fenêtre : sous un
                cadre de 620 px, il fallait défiler pour le trouver. */}
            <p className="mx-auto mt-2 max-w-[600px] text-center text-[10px] leading-relaxed text-text-tertiary">
              {fr
                ? 'Rendu par le serveur, avec le même gabarit qu’à l’envoi. Le montant et le bouton sont des exemples ; les valeurs entre crochets seront remplacées par les vraies données du client.'
                : 'Rendered by the server, with the same template used when sending. The amount and button are samples; bracketed values are replaced with the client’s real data.'}
            </p>
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto p-3 sm:p-5" style={{ background: '#f4f5f7' }}>
          <div className="mx-auto max-w-[600px] rounded-lg bg-white shadow-sm overflow-hidden">
            {/* Objet — ce que le client voit dans sa boîte */}
            <div className="px-5 py-3 border-b border-outline/40 bg-surface-secondary/40">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary mb-1">
                {fr ? 'Objet' : 'Subject'}
              </p>
              <input
                value={objet}
                onChange={(e) => setObjet(e.target.value)}
                onFocus={(e) => { setActif(null); setCibleObjet(true); champActif.current = e.currentTarget; }}
                placeholder={fr ? 'Objet du courriel' : 'Email subject'}
                aria-label={fr ? 'Objet du courriel' : 'Email subject'}
                className="w-full bg-transparent border border-transparent rounded px-2 py-1 text-[13px] font-semibold text-text-primary hover:border-outline/40 focus:border-primary/60 focus:bg-surface focus:outline-none transition-colors"
              />
            </div>

            {/* En-tête ajouté par le serveur — non modifiable ici, il vient
                des réglages de l'entreprise. Le logo se pose sur le ciel sans
                cadre blanc : son fond est retiré au téléversement. */}
            <div className="px-5 py-5 text-center" style={{ background: '#f4f5f7' }}>
              {entreprise.company_logo_url ? (
                <img
                  src={entreprise.company_logo_url}
                  alt={entreprise.company_name ?? ''}
                  className="mx-auto max-h-14 object-contain"
                />
              ) : (
                <span className="text-[18px] font-bold" style={{ color: '#101828' }}>
                  {entreprise.company_name || 'Lume'}
                </span>
              )}
            </div>

            {/* Corps */}
            <div className="px-5 py-4 space-y-0.5">
              {blocs.map((bloc) => (
                <div key={bloc.id} className="group relative flex items-start gap-1">
                  {bloc.type === 'puce' && (
                    <span className="text-text-tertiary text-[13px] pt-1.5 select-none">•</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <ChampBloc
                      bloc={bloc}
                      fr={fr}
                      onChange={(t) => majBloc(bloc.id, t)}
                      onFocus={(champ) => { setActif(bloc.id); setCibleObjet(false); champActif.current = champ; }}
                    />
                  </div>
                  <button
                    onClick={() => supprimerBloc(bloc.id)}
                    title={fr ? 'Supprimer cette ligne' : 'Remove this line'}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-text-tertiary hover:text-red-500 shrink-0 mt-1"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}

              {blocs.length === 0 && (
                <p className="text-[12px] text-text-tertiary italic py-3">
                  {fr ? 'Courriel vide — ajoutez une ligne ci-dessous.' : 'Empty email — add a line below.'}
                </p>
              )}

              <div className="flex items-center gap-1.5 pt-2">
                <button
                  onClick={() => ajouterBloc('paragraphe')}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-surface-tertiary text-text-secondary hover:bg-surface-tertiary/70 transition-colors"
                >
                  <Type size={11} /> {fr ? 'Paragraphe' : 'Paragraph'}
                </button>
                <button
                  onClick={() => ajouterBloc('puce')}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-surface-tertiary text-text-secondary hover:bg-surface-tertiary/70 transition-colors"
                >
                  <List size={11} /> {fr ? 'Puce' : 'Bullet'}
                </button>
              </div>
            </div>

            {/* Pied de page ajouté par le serveur. Le montrer évite de
                répéter « Merci, [company_name] » en fin de message : la
                signature y est déjà. */}
            {/* Le pied, tel que le gabarit serveur le rend : le téléphone et
                le courriel de l'entreprise d'abord, puis « Envoyé avec Lume »
                en petit. Il affichait « Envoyé via LUME pour {entreprise} » —
                formule retirée du serveur le 2026-09-17 parce qu'elle vole la
                marque du client. L'aperçu la montrait encore. */}
            <div className="px-5 py-3 border-t text-center" style={{ borderColor: '#d3e3f7' }}>
              {(entreprise.company_phone || entreprise.company_email) && (
                <p className="text-[11px]" style={{ color: '#0b5cad' }}>
                  <span className="font-semibold">{entreprise.company_phone}</span>
                  {entreprise.company_phone && entreprise.company_email ? (
                    <span style={{ color: '#9fb3c8' }}> · </span>
                  ) : null}
                  <span className="font-semibold">{entreprise.company_email}</span>
                </p>
              )}
              {entreprise.company_name && (
                <p className="text-[10px] mt-0.5" style={{ color: '#5b6b7f' }}>{entreprise.company_name}</p>
              )}
              <p className="text-[10px] mt-1.5" style={{ color: '#8fa3ba' }}>
                {fr ? 'Envoyé avec' : 'Sent with'}{' '}
                <span className="font-bold" style={{ color: '#0b5cad' }}>Lume</span>
              </p>
            </div>
          </div>

          {/* Un SEUL aperçu : le courriel ci-dessus EST le rendu final.
              Un second bloc « ce que le client lira » répétait la même chose
              et ajoutait du bruit sans rien apprendre. */}
          <p className="mx-auto max-w-[600px] mt-2 text-[10px] text-text-tertiary text-center leading-relaxed">
            {fr
              ? 'L’en-tête et le pied de page viennent de vos réglages d’entreprise. Les valeurs entre crochets seront remplacées par les vraies données du client.'
              : 'Header and footer come from your company settings. Bracketed values are replaced with the client’s real data.'}
          </p>
        </div>
        )}

        {/* L'avertissement, juste au-dessus du bouton Enregistrer : c'est le
            dernier moment où quelqu'un peut corriger avant que son client
            reçoive un trou. On ne bloque PAS l'enregistrement — une entreprise
            peut avoir une raison d'écrire un crochet, et l'empêcher
            d'enregistrer son travail pour un avertissement serait pire que le
            défaut qu'on signale. */}
        {inconnues.length > 0 && (
          <div className="shrink-0 border-t border-amber-500/30 bg-amber-500/10 px-5 py-2.5">
            <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
              <span className="font-semibold">
                {fr
                  ? `${inconnues.length > 1 ? 'Ces variables n’existent pas' : 'Cette variable n’existe pas'} : `
                  : `${inconnues.length > 1 ? 'These variables don’t exist' : 'This variable doesn’t exist'}: `}
              </span>
              {inconnues.map((c) => `[${c}]`).join(', ')}
              {' — '}
              {fr
                ? 'votre client verra un blanc, ou le crochet tel quel. Utilisez les boutons « Insérer » ci-dessous.'
                : 'your client will see a blank, or the bracket as-is. Use the “Insert” buttons below.'}
            </p>
          </div>
        )}

        {/* Le français a changé, pas l'anglais : mêmes mots que le panneau
            d'étape de l'éditeur (PanneauEtape). */}
        {anglaisARevoir && (
          <div className="shrink-0 border-t border-amber-500/30 bg-amber-500/10 px-5 py-2.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
            <p>
              {fr
                ? 'Le texte français a changé, pas sa version anglaise. Mettez-la à jour — ou videz-la pour que le français parte à tout le monde.'
                : 'The French text changed, not its English version. Update it — or empty it so the French goes to everyone.'}
            </p>
            <label htmlFor={idAnglaisConfirme} className="mt-1.5 flex cursor-pointer items-center gap-2">
              <input
                id={idAnglaisConfirme}
                type="checkbox"
                checked={anglaisConfirme}
                onChange={(e) => setAnglaisConfirme(e.target.checked)}
                className="h-4 w-4 rounded border-outline text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              />
              <span>{fr ? 'La version anglaise reste valable telle quelle' : 'The English version still holds as is'}</span>
            </label>
          </div>
        )}

        {/* Pied : variables + enregistrement */}
        <div className="border-t border-outline/50 px-5 py-3 shrink-0 bg-surface-secondary">
          {/* La palette a une hauteur BORNÉE. Pour une automatisation, elle
              porte les champs de base de cinq objets — plus de 120 boutons —
              et occupait à elle seule plus de la moitié de l'écran : le
              courriel qu'on écrit ne tenait plus que sur quelques lignes
              (audit du 2026-10-01). Elle défile, et se filtre en tapant. */}
          {/* Sur « Aperçu réel », pas de palette : « Insérer » y modifiait un
              texte qu'on ne voit pas — le pied passait à « Modifications non
              enregistrées » sans qu'on ait rien tapé (04-courriel:560). */}
          {!ongletApercu && variables.length > SEUIL_RECHERCHE_VARIABLES && (
            <input
              type="search"
              value={filtreVariable}
              onChange={(e) => setFiltreVariable(e.target.value)}
              aria-label={fr ? 'Chercher une variable à insérer' : 'Search a variable to insert'}
              placeholder={fr ? 'Chercher une variable…' : 'Search a variable…'}
              className="mb-1.5 w-full max-w-[260px] rounded border border-outline/50 bg-surface px-2 py-1 text-[11px] text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            />
          )}
          {!ongletApercu && (
          <div
            data-testid="palette-variables"
            className="flex flex-wrap items-center gap-1 mb-2.5 max-h-[72px] overflow-y-auto"
          >
            <span className="text-[10px] text-text-tertiary mr-1">
              {fr ? 'Insérer :' : 'Insert:'}
            </span>
            {variablesAffichees.length === 0 && (
              <span className="text-[10px] text-text-tertiary italic">
                {fr ? 'Aucune variable à ce nom.' : 'No variable by that name.'}
              </span>
            )}
            {variablesAffichees.map((v) => (
              <button
                key={v.cle}
                title={v.jeton ?? `[${v.cle}]`}
                onClick={() => insererVariable(v.cle, v.jeton)}
                className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-surface-tertiary text-text-secondary hover:bg-surface-tertiary/70 transition-colors"
              >
                <Plus size={9} /> {fr ? v.fr : v.en}
              </button>
            ))}
          </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-text-tertiary">
              {modifie
                ? (fr ? 'Modifications non enregistrées' : 'Unsaved changes')
                : (fr ? 'Aucune modification' : 'No changes')}
            </p>
            <div className="flex items-center gap-2">
              {/* Les deux actions rares, reléguées ici : elles occupaient un
                  bouton-icône muet par ligne dans la liste, dont un
                  destructeur. On défait un texte en le regardant. */}
              {revenirAuDefaut ? (
                <button
                  onClick={() => void revenirAuDefaut()}
                  className="px-3 py-1.5 rounded-md text-[11px] text-text-tertiary underline underline-offset-2 hover:text-text-secondary transition-colors"
                >
                  {fr ? 'Revenir au texte d’origine' : 'Restore original'}
                </button>
              ) : null}
              {/* Toujours sous la main quand on regarde l'aperçu (04-courriel:588). */}
              {ongletApercu && lecture.pret && (
                <button
                  type="button"
                  onClick={() => void envoyerEssai()}
                  disabled={essaiEnCours}
                  className="rounded-md border border-outline/60 bg-surface px-3 py-1.5 text-[11px] font-semibold text-text-secondary hover:bg-surface-secondary disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  {essaiEnCours
                    ? (fr ? 'Envoi…' : 'Sending…')
                    : (fr ? 'M’envoyer un essai' : 'Send me a test')}
                </button>
              )}
              <button
                onClick={fermer}
                className="px-3 py-1.5 rounded-md text-[11px] text-text-secondary hover:bg-surface-tertiary transition-colors"
              >
                {fr ? 'Fermer' : 'Close'}
              </button>
              <button
                onClick={enregistrer}
                disabled={!modifie || enregistrement || anglaisPerime}
                className={cn(
                  'px-4 py-1.5 rounded-md text-[11px] font-semibold transition-colors flex items-center gap-1.5',
                  modifie && !enregistrement && !anglaisPerime
                    ? 'bg-primary text-white hover:bg-primary/90'
                    : 'bg-surface-tertiary text-text-tertiary cursor-not-allowed',
                )}
              >
                {enregistrement && <Loader2 size={11} className="animate-spin" />}
                {enregistre && !enregistrement && <Check size={11} />}
                {fr ? 'Enregistrer' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
