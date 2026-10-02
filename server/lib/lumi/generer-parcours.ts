/* ═══════════════════════════════════════════════════════════════
   Lumi construit un parcours à partir d'une phrase.

   « Après l'envoi d'une soumission, attends 3 jours puis envoie un texto de
   suivi si le client n'a pas répondu » → un graphe d'étapes prêt à dessiner.

   ── Pourquoi un appel direct, pas l'orchestrateur ──────────────
   L'orchestrateur porte 240 outils, un routeur, un cache de prompt système.
   C'est ce qu'il faut pour une conversation ; ici on veut UNE sortie
   structurée, en un aller-retour. Un appel ciblé coûte une fraction du prix
   et répond en deux secondes au lieu de dix.

   ── Ce que Lumi N'A PAS le droit de faire ──────────────────────
   · inventer un déclencheur ou une action hors catalogue — la liste lui est
     donnée, et la validation Zod refuse le reste à l'enregistrement ;
   · choisir un destinataire — il n'y a pas de champ pour ça ;
   · enregistrer quoi que ce soit. Il PROPOSE un parcours, l'utilisateur le
     voit dans le canevas et décide. C'est la règle Lumi du projet : une
     écriture n'est jamais exécutée par l'orchestrateur.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { clientAnthropic, isLumiConfigured } from './llm';
import { reserverBudget, reglerBudget, journaliserUsage, estimationCoutAppel, etatCredits, messagePause, messagePausePlateforme } from './budget';
import { coutEnCents, type UsageTokens } from './tarifs';
import { logger } from '../logger';
import { DECLENCHEURS, ACTIONS, trouverAction, trouverDeclencheur } from '../../../src/lib/automationCatalogue';
import { VARIABLES_CONNUES, variablesInconnues, htmlVersTexte, texteVersHtml } from '../../../src/lib/emailBodyText';
import { TEXTES_ACTION_PROVISOIRE } from '../../../src/lib/sequenceTypes';
import { segmentsSms } from '../../../src/lib/smsSegments';
import { verifierPlafond, ajouterDepense, compterRefus } from './plafond-journalier';
import { journaliserTrace, ajouterUsage, usageVide, ETAGE, type UsageAgrege } from './traces';
import { contexteLumi, noterAppelImbrique } from './contexte-appel';
import { avisSegments } from '../automations-etapes';
import { sequenceEtapes } from '../validation';

/**
 * Sonnet, pas Haiku (2026-09-30).
 *
 * Haiku avait été choisi pour le prix (2× moins cher au tarif actuel, pas
 * 5×). Le cas réel est arrivé : un client demande « plus court, plus
 * intéressant », puis « trop long », puis « tu l'as même pas changé » —
 * Haiku écrit des textes plats (« Vous avez reçu votre soumission. Des
 * questions? »), retire « Bonjour [client_first_name] » au 3e tour et
 * répète la même phrase trois fois. Rejoué sur Sonnet : le lien du devis
 * est ajouté, l'ouverture gardée, chaque tour répond à ce qui est dit.
 * ≈ 1,2 ¢ la demande au lieu de 0,6 ¢, au budget Lumi du client.
 */
const MODELE = 'claude-sonnet-5';

/**
 * Plafond de sortie.
 *
 * 1 500 suffisait à Haiku. Sonnet écrit du JSON INDENTÉ et des courriels
 * plus riches : mesuré le 2026-09-30, 2 réponses sur 3 à « rends juste le
 * texto plus chaleureux » s'arrêtaient à 1 500 tokens (`max_tokens`) — JSON
 * coupé, illisible, et l'utilisateur lisait « Lumi n'a pas compris ». On
 * laisse de la marge ; on ne paie que ce qui est écrit, la réservation est
 * réglée au coût réel. PAS de « JSON compact » : essayé, Sonnet y ajoutait
 * une accolade de trop 2 fois sur 10 (JSON illisible) ; indenté, 0.
 */
/*
 * 8 000 (était 4 000, mission finale F-03) : réécrire le parcours de 23 étapes
 * du pack de base demande environ 4 600 tokens — la réponse était coupée, et
 * la modification de ces deux automatisations (publiées d'office à la création
 * de chaque entreprise) échouait à tous les coups, débitée quand même. 30
 * étapes, le maximum accepté, en demandent environ 6 100. On ne paie que ce qui
 * est écrit ; une question ou un refus ne réécrit plus rien (`"steps": null`).
 */
const MAX_TOKENS = 8_000;

/** Version de CE prompt (celui du clavardage général a la sienne, `version.ts`) : elle voyage dans la trace. */
export const VERSION_PROMPT_PARCOURS = 'parcours-2026-10-02.1';

/**
 * Effort de réflexion de l'appel, écrit en toutes lettres (c'est aussi le défaut
 * de Sonnet 5 quand on ne dit rien). Baisser l'effort était proposé (F-05 : la
 * même demande coûtait de 1,07 ¢ à 2,79 ¢ et prenait de 8 à 21 s) ; MESURÉ sur
 * la batterie `npm run qa:construire-lumi` le 2026-10-01, même code, même prompt :
 *   · effort « high » : 122/123 contrôles, 25,57 ¢ ;
 *   · effort « low »  : 118/123 contrôles, 21,24 ¢ — une modification « pas
 *     comprise », un texte non cité, une question non posée.
 * 17 % d'économie pour quatre fautes de plus : NON RETENU. Le niveau reste
 * « high ». `LUMI_PARCOURS_EFFORT` sert à remesurer, pas à régler la prod.
 */
const EFFORT: 'low' | 'medium' | 'high' = (['low', 'medium', 'high'] as const).find((e) => e === process.env.LUMI_PARCOURS_EFFORT) ?? 'high';

export interface ParcoursPropose {
  /** Le nom suggéré — l'utilisateur peut le changer. */
  nom: string;
  trigger_event: string;
  steps: Array<Record<string, unknown>>;
  /** Ce que Lumi a compris, en une phrase, affiché au-dessus du canevas. */
  resume: string;
  /**
   * Le parcours a-t-il changé ? `false` pour une question, un refus ou une
   * demande incomprise : `steps` est alors le parcours REÇU, rendu tel quel
   * (le modèle ne l'a pas réécrit).
   */
  modifie?: boolean;
  /** L'utilisateur a demandé de RENOMMER l'automatisation : `nom` est le nouveau nom. Sinon `nom` reste celui d'avant. */
  renomme?: boolean;
  /** L'utilisateur demande de publier ou de mettre en pause l'automatisation elle-même — jamais exécuté ici. */
  intention?: 'activer' | 'desactiver' | null;
  /**
   * Les étapes telles qu'elles étaient AVANT cette modification (seulement celles
   * qui ont changé ou disparu). Gardées avec la conversation : c'est ce qui permet
   * « annule ça », « remets le texte d'avant » au tour suivant — Lumi répondait
   * « je n'ai pas l'ancien texte, recolle-le ».
   */
  remplacees?: Array<Record<string, unknown>>;
  /**
   * Une DEUXIÈME automatisation, sur un autre déclencheur.
   *
   * Un parcours n'a qu'un déclencheur. « Quand le client répond, envoie mon
   * lien Calendly » en est un autre (`client.replied`) : faute de pouvoir le
   * dire, Lumi inventait une étape « démarrer l'automatisation
   * calendly_reply » qui pointait vers rien (constaté en prod le 2026-09-28).
   * L'éditeur la crée à part, en brouillon.
   */
  autre?: {
    nom: string;
    trigger_event: string;
    resume: string;
    steps: Array<Record<string, unknown>>;
    /** Une fois par client tous les N jours (voir settings.delai_entre_passages_jours). */
    une_fois_par_client_jours?: number;
    /** Ce qui manque au modèle pour l'écrire (ex. « le lien Calendly ») — jamais créée alors. */
    manque?: string | null;
  } | null;
}

/**
 * Actions que Lumi ne propose JAMAIS : elles désignent une autre automatisation
 * par son identifiant, qu'il ne connaît pas — il en inventait un.
 */
const ACTIONS_HORS_LUMI = new Set([
  'demarrer_automatisation', 'arreter_automatisation',
  // Les actions pas encore disponibles (voir `indisponible` au catalogue).
  ...ACTIONS.filter((a) => a.indisponible).map((a) => a.cle),
]);

/**
 * Un TROU que le modèle a laissé à la place d'une donnée qu'il n'a pas :
 * `[CALENDLY_LINK]`, `[lien_calendly]`, `[URL]`. Les vraies variables sont en
 * minuscules et ne désignent jamais un lien à fournir. Un trou part VIDE au
 * client (une variable inconnue devient une chaîne vide) : « Réserve ton
 * créneau ici : » sans rien après. Constaté sur le vrai modèle le 2026-09-28,
 * malgré la consigne — c'est donc le code qui tranche.
 */
export function contientTrou(etapes: unknown): boolean {
  const texte = JSON.stringify(etapes ?? '');
  for (const m of texte.matchAll(/\[([^\]\[]{1,60})\]/g)) {
    const nom = m[1];
    // Des MOTS entiers : « client » contient « lien », et [client_first_name]
    // est une vraie variable.
    const mots = nom.toLowerCase().split(/[_\s-]+/);
    if (/[A-Z]/.test(nom) || mots.some((m) => ['lien', 'link', 'url', 'calendly', 'site', 'http', 'https'].includes(m))) return true;
  }
  /*
   * Deuxième forme, vue sur le vrai modèle : il écrit sa QUESTION à
   * l'utilisateur DANS le texto au client (« Quel est ton lien Calendly ? Je
   * crée la réponse automatique… »). Un message qui parle d'un lien à
   * suivre sans contenir d'adresse ne peut être qu'un trou.
   */
  return textesDesMessages(etapes).some((corps) =>
    /calendly|\blien\b|\blink\b|réserv|book/i.test(corps) && !/https?:\/\//i.test(corps));
}

/** Les textes (objet, corps) de tous les messages d'un parcours. */
function textesDesMessages(valeur: unknown): string[] {
  if (Array.isArray(valeur)) return valeur.flatMap(textesDesMessages);
  if (!valeur || typeof valeur !== 'object') return [];
  return Object.entries(valeur as Record<string, unknown>).flatMap(([cle, v]) =>
    ((cle === 'body' || cle === 'subject') && typeof v === 'string' ? [v] : textesDesMessages(v)));
}

const sansEspaces = (t: string): string => t.replace(/\s+/g, ' ').trim();

/**
 * Les TEXTES D'EXEMPLE que l'éditeur pose quand on ajoute une étape à la main
 * (« Bonjour [client_name], c’est [company_name]. Merci ! ») ou à la création
 * (« À compléter »). L'utilisateur ne les a pas écrits.
 *
 * Vrai cas de prod (2026-10-01) : une étape « Envoyer un texto » fraîchement
 * ajoutée, puis « fais un message pour notifier le rep qui a envoyé le
 * devis ». Lumi a ajouté la notification… et gardé le texto d'exemple, sans
 * un mot : publié, chaque client qui ouvre son devis recevait « Bonjour X,
 * c’est Y. Merci ! ».
 */
const TEXTES_EXEMPLE: ReadonlySet<string> = new Set(
  [
    ...TEXTES_ACTION_PROVISOIRE,
    ...ACTIONS.flatMap((a) => a.champs)
      .filter((c) => c.type === 'zone' || c.type === 'texte')
      .flatMap((c) => [c.defaut_fr, c.defaut_en]),
  ].filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map(sansEspaces),
);

interface MessageDuParcours {
  /** Identifiant de l'étape. */
  id: string;
  type: string;
  objet: string;
  corps: string;
  /** Le texte est encore l'exemple posé par l'éditeur. */
  exemple: boolean;
  /** Le message part au client (texto, courriel) — pas une note interne. */
  versClient: boolean;
  /** À qui va une notification interne (« responsable », « proprietaire »…). */
  pour: string;
}

/**
 * Les messages d'un parcours, par étape : texto (corps), courriel (objet +
 * corps en texte), notification interne (titre + détail), tâche (titre).
 */
function messagesDuParcours(steps: unknown): MessageDuParcours[] {
  const res: MessageDuParcours[] = [];
  for (const e of Array.isArray(steps) ? steps : []) {
    const etape = e as { id?: unknown; action?: { type?: unknown; config?: Record<string, unknown> } };
    const type = String(etape?.action?.type ?? '');
    if (!['send_sms', 'send_email', 'create_notification', 'create_task'].includes(type)) continue;
    const config = etape.action?.config ?? {};
    const interne = type === 'create_notification' || type === 'create_task';
    const objet = sansEspaces(String((interne ? config.title : config.subject) ?? ''));
    const corps = sansEspaces(type === 'send_email' ? htmlVersTexte(String(config.body ?? '')) : String(config.body ?? ''));
    res.push({
      id: String(etape.id ?? res.length),
      type,
      objet,
      corps,
      exemple: TEXTES_EXEMPLE.has(interne ? objet : corps),
      versClient: !interne,
      pour: String(config.destinataire ?? ''),
    });
  }
  return res;
}

/**
 * Les étapes dont le texte est encore l'exemple de l'éditeur : à réécrire ou
 * à retirer, jamais à garder telles quelles.
 */
export function etapesNonRedigees(steps: unknown): string[] {
  return messagesDuParcours(steps).filter((m) => m.exemple).map((m) => m.id);
}

const POUR_QUI: Record<string, { fr: string; en: string }> = {
  proprietaire: { fr: 'au propriétaire', en: 'to the owner' },
  responsable: { fr: 'au responsable du client', en: 'to the client owner' },
  equipe_du_deal: { fr: 'au rep assigné, aux propriétaires et aux admins', en: 'to the assigned rep, owners and admins' },
  membre: { fr: 'à un membre précis', en: 'to a specific member' },
};

/** Une ligne lisible pour un message : ce qui part, à qui, mot pour mot. */
function ligneMessage(m: MessageDuParcours, fr: boolean): string {
  const court = (t: string) => (t.length > 280 ? `${t.slice(0, 277)}…` : t);
  if (m.type === 'send_sms') return `• ${fr ? 'Texto' : 'Text'} : « ${court(m.corps)} »`;
  if (m.type === 'send_email') return `• ${fr ? 'Courriel' : 'Email'} — ${fr ? 'objet' : 'subject'} « ${m.objet} » : « ${court(m.corps)} »`;
  if (m.type === 'create_task') return `• ${fr ? 'Tâche' : 'Task'} : « ${court(m.objet)} »`;
  const pour = POUR_QUI[m.pour]?.[fr ? 'fr' : 'en'] ?? (fr ? 'à toute l’équipe' : 'to the whole team');
  const texte = m.corps ? `${m.objet} — ${m.corps}` : m.objet;
  return `• ${fr ? `Notification dans Lume, ${pour}` : `Notification in Lume, ${pour}`} : « ${court(texte)} »`;
}

/**
 * CE QUI A CHANGÉ, écrit par le serveur sous la phrase de Lumi.
 *
 * Mesuré en prod le 2026-09-30 : « plus court, plus intéressant » → « trop
 * long » → « tu l'as même pas changé le message ». Les textes changeaient à
 * chaque tour, mais Lumi répondait trois fois la MÊME phrase, qui décrivait
 * le parcours sans jamais citer un mot envoyé au client. Rejoué sur un
 * meilleur modèle, il finissait par « avouer » à tort que rien n'avait
 * changé : il ne voit pas l'écran. On ne s'en remet donc pas au modèle —
 * on compare avant/après et on montre le nouveau texte, ou on dit
 * franchement que rien n'a bougé.
 *
 * Depuis le 2026-10-01 : les notifications internes et les tâches sont
 * citées aussi (« fais un message pour notifier le rep » ne montrait pas le
 * message), une étape RETIRÉE est dite, et un texte d'exemple encore présent
 * et destiné au client est signalé — rien de ce qui part ne reste caché.
 */
export function ceQuiAChange(
  avant: unknown, apres: unknown, fr: boolean, voulaitModifier = true,
  /** Autre chose que les étapes a changé (le déclencheur, le nom) : « je n'ai rien changé » serait faux (A-16). */
  autreChangement = false,
): string {
  const a = messagesDuParcours(avant);
  const b = messagesDuParcours(apres);
  const signature = (m: MessageDuParcours) => `${m.type}|${m.objet}|${m.corps}|${m.pour}`;
  const resteAvant = new Set(a);
  const nouveaux: MessageDuParcours[] = [];
  const sansPaire: MessageDuParcours[] = [];
  // 1. La même étape (même id, même type) : inchangée ou réécrite.
  for (const m of b) {
    const meme = [...resteAvant].find((x) => x.id === m.id && x.type === m.type);
    if (!meme) { sansPaire.push(m); continue; }
    resteAvant.delete(meme);
    if (signature(meme) !== signature(m)) nouveaux.push(m);
  }
  // 2. Une étape renumérotée par le modèle : même texte = inchangée.
  for (const m of sansPaire) {
    const jumeau = [...resteAvant].find((x) => signature(x) === signature(m));
    if (jumeau) resteAvant.delete(jumeau);
    else nouveaux.push(m);
  }
  // 3. Ce qui reste de l'ancien parcours a été retiré.
  const retires = [...resteAvant];

  const blocs: string[] = [];
  if (nouveaux.length) {
    const ordre = b.filter((m) => nouveaux.includes(m));
    blocs.push(`${fr ? 'Nouveau texte :' : 'New wording:'}\n${ordre.map((m) => ligneMessage(m, fr)).join('\n')}`);
  }
  if (retires.length) {
    blocs.push(`${fr ? 'Retiré du parcours :' : 'Removed from the journey:'}\n${retires.map((m) => ligneMessage(m, fr)).join('\n')}`);
  }
  // Un texte d'exemple qui partirait AU CLIENT : jamais en silence.
  const exemples = b.filter((m) => m.exemple && m.versClient);
  if (exemples.length) {
    blocs.push(fr
      ? `Attention : ${exemples.length > 1 ? 'ces étapes portent' : 'cette étape porte'} encore le texte d’exemple de l’éditeur, qui partirait tel quel au client :\n${exemples.map((m) => ligneMessage(m, fr)).join('\n')}\nDis-moi quoi écrire à la place, ou demande-moi de retirer l’étape.`
      : `Careful: ${exemples.length > 1 ? 'these steps still carry' : 'this step still carries'} the editor’s sample text, which would go to the client as is:\n${exemples.map((m) => ligneMessage(m, fr)).join('\n')}\nTell me what to write instead, or ask me to remove the step.`);
  }
  // Un texto NOUVEAU ou réécrit qui dépasse un SMS : son coût est dit (A-18).
  const longs = b.filter((m) => nouveaux.includes(m) && m.type === 'send_sms' && segmentsSms(m.corps).segments > 1);
  if (longs.length) {
    // La même phrase que les outils du clavardage (`avisSegments`) : le compte, et pourquoi (un émoji, un accent spécial).
    blocs.push(longs.map((m) => `${avisSegments(m.corps, fr)} ${fr ? 'Dis « plus court » pour le ramener à un seul.' : 'Say “shorter” to bring it down to one.'}`).join('\n'));
  }
  if (blocs.length) return `\n\n${blocs.join('\n\n')}`;
  const avaitUnParcours = Array.isArray(avant) && avant.length > 0;
  // Une question ou un refus ne change rien EXPRÈS (`modifie: false`) : la
  // phrase de Lumi suffit, « je n'ai rien changé » y sonnerait faux. Pareil
  // quand le déclencheur ou le nom a changé : Lumi disait « j'ai changé le
  // déclencheur… je n'ai rien changé au parcours » dans la même bulle (A-16).
  if (voulaitModifier && !autreChangement && avaitUnParcours && JSON.stringify(avant) === JSON.stringify(apres)) {
    return fr
      ? '\n\nJe n’ai rien changé au parcours. Dis-moi quel message modifier (le texto ou le courriel) et comment.'
      : '\n\nI did not change anything. Tell me which message to change (the text or the email) and how.';
  }
  return '';
}

/** Le prompt système : le catalogue, la forme, et les interdits. */
export function consignes(fr: boolean): string {
  const declencheurs = DECLENCHEURS
    .map((d) => `- ${d.cle} : ${fr ? d.aide_fr : d.aide_en}`)
    .join('\n');
  const actions = ACTIONS
    .filter((a) => !ACTIONS_HORS_LUMI.has(a.cle))
    .map((a) => {
      // Le TYPE et les valeurs permises, pas seulement le nom : sans eux, le
      // modèle écrivait `echeance_jours: 1` (nombre) et `priorite: "normal"`,
      // refusés par la validation — « Créer une tâche » échouait à tous les
      // coups, y compris sur la phrase d'exemple de l'app (audit V2, L-2).
      const champs = a.champs.map((c) => {
        const valeurs = c.type === 'choix' && c.options?.length ? `=${c.options.map((o) => o.cle).join('|')}` : '';
        const nombre = c.type === 'nombre' ? ' (nombre écrit en texte, ex. "3")' : '';
        return `${c.cle}${c.obligatoire ? '' : '?'}${valeurs}${nombre}`;
      }).join(', ');
      return `- ${a.cle} (${champs}) : ${fr ? a.aide_fr : a.aide_en}`;
    })
    .join('\n');

  return `Tu construis une automatisation pour un CRM d'entreprise de services au Québec.

DÉCLENCHEURS DISPONIBLES (choisis-en UN, exactement comme écrit) :
${declencheurs}

ACTIONS DISPONIBLES (rien d'autre n'existe) :
${actions}

FORME DE LA RÉPONSE — un objet JSON, rien autour :
{
  "nom": "nom court de l'automatisation",
  "trigger_event": "une clé de la liste ci-dessus",
  "resume": "${fr ? 'une phrase, au tutoiement, qui dit CE QUE TU AS FAIT à cette demande' : 'one sentence IN ENGLISH saying WHAT YOU DID for this request'}",
  "modifie": true,
  "renomme": false,
  "intention": null,
  "steps": [
    { "id": "e1", "type": "action", "action": { "type": "send_sms", "config": { "body": "..." } }, "suivant": "e2" },
    { "id": "e2", "type": "attendre", "delai_secondes": 259200, "suivant": "e3" },
    { "id": "e3", "type": "si", "conditions": { "status": { "eq": "sent" } }, "alors": "e4", "sinon": null },
    { "id": "e4", "type": "action", "action": { "type": "send_email", "config": { "subject": "...", "body": "..." } } }
  ],
  "autre": null
}

UNE DEUXIÈME AUTOMATISATION ("autre") :
- Un parcours a UN SEUL déclencheur. Si la demande ajoute une réaction à un
  AUTRE événement — typiquement « quand le client répond, envoie-lui mon lien
  Calendly » (déclencheur "client.replied") —, ne la mets PAS dans "steps" :
  garde le parcours actuel tel quel et décris la nouvelle réaction dans
  "autre" : { "nom", "trigger_event", "resume", "steps", "une_fois_par_client_jours", "manque" }.
  Sinon, "autre" vaut null.
- "manque" : null, ou ce qui te manque pour l'écrire (ex. "le lien Calendly").
  Les messages de "steps" partent au CLIENT : n'y écris JAMAIS une question
  à l'utilisateur. Si une information manque, mets "manque" et pose la
  question dans le "resume" PRINCIPAL.
- Pour "client.replied", mets TOUJOURS "une_fois_par_client_jours": 7 : ce
  déclencheur part à CHAQUE texto du client, et sans limite le même message
  repartirait à chaque réponse. Dis-le dans le "resume" de "autre".
- On ne peut PAS filtrer sur le contenu de la réponse (« s'il dit qu'il
  n'est pas dispo ») : n'invente aucune condition, la réaction vaut pour
  toute réponse. Dis-le simplement dans "resume".
- Un lien que l'utilisateur n'a pas donné (Calendly, site, formulaire) ne
  s'invente pas et ne se remplace pas par un crochet. S'il manque, mets
  "autre": null et demande-le dans "resume" : « Quel est ton lien Calendly ?
  Je crée la réponse automatique dès que je l'ai. »
- "demarrer_automatisation" et "arreter_automatisation" n'existent pas pour
  toi : n'y fais jamais référence.

RÈGLES ABSOLUES :
- Les identifiants d'étape sont e1, e2, e3… et ne contiennent ni ":" ni espace.
- Le parcours NE REVIENT JAMAIS en arrière : "suivant", "alors" et "sinon"
  pointent toujours vers une étape PLUS LOIN dans la liste. Une boucle serait
  refusée et enverrait des messages à l'infini.
- Une étape "attendre" n'est jamais la dernière : elle attendrait pour rien.
- Les délais sont en SECONDES (1 jour = 86400).
- RAPPEL DE RENDEZ-VOUS (« la veille », « 2 jours avant », « 2 h avant ») :
  le déclencheur "appointment.created" part à la RÉSERVATION, qui peut avoir
  lieu des semaines avant la visite. Un envoi direct partirait donc tout de
  suite, et « attendre 1 jour » le lendemain de la réservation. Il FAUT une
  attente jusqu'à un moment AVANT le rendez-vous, placée avant l'envoi :
  { "id": "e1", "type": "attendre", "mode": "avant_date", "secondes_avant": 86400, "delai_secondes": 0, "suivant": "e2" }
  (86400 = la veille, 172800 = 2 jours avant, 7200 = 2 h avant). Si le
  moment est déjà passé, le rappel est sauté. Uniquement avec un
  déclencheur de rendez-vous.
- « S'IL NE RÉPOND PAS », « sans réponse du client » : attends SA RÉPONSE,
  au plus le délai demandé, avec une attente "mode": "reponse" :
  { "id": "e2", "type": "attendre", "mode": "reponse", "delai_secondes": 172800, "si_reponse": null, "suivant": "e3" }
  S'il répond, le parcours suit "si_reponse" (null = il s'arrête) ; sinon, à
  l'échéance, il continue vers "suivant". Une attente ordinaire enverrait la
  suite même à un client qui a déjà répondu.
- Conditions possibles dans une étape "si" (rien d'autre n'existe) :
  · "status" avec "eq" : "sent" (toujours sans réponse), "approved"
    (accepté), "paid" (payé), "unpaid" (impayé) ;
  · "montant" (en DOLLARS, montant du devis ou de la facture) avec "gt",
    "gte", "lt" ou "lte" : « une facture de plus de 5 000 $ » →
    { "montant": { "gt": 5000 } } ;
  · "client_a_etiquette" ou "client_sans_etiquette", avec le NOM de
    l'étiquette en valeur directe — pour N'IMPORTE QUEL déclencheur, jugé sur
    les étiquettes réelles du client : « seulement les clients qui ont
    l'étiquette VIP » → { "client_a_etiquette": "VIP" } ; « sauf ceux marqués
    Ne pas relancer » → { "client_sans_etiquette": "Ne pas relancer" } ;
  · "tag" avec "eq" : seulement pour dire QUELLE étiquette déclenche, avec
    les déclencheurs d'étiquette (client.tagged, client.untagged) : « quand
    j'ajoute l'étiquette VIP » → { "tag": { "eq": "VIP" } }.
  Un filtre demandé (montant, étiquette) va dans un "si" placé AVANT les
  actions, "alors" vers la suite, "sinon": null. Ne l'oublie jamais : sans
  lui, l'automatisation partirait pour TOUTES les factures ou étiquettes.
- Le TYPE de client (« commercial », « résidentiel », « mes gros clients »,
  « les entreprises ») n'est pas une donnée de Lume : AUCUN filtre n'existe
  dessus. N'invente pas de condition et ne change rien : "steps": null,
  "modifie": false, et dans "resume" UNE seule question — « Je ne peux pas
  encore cibler par type de client. As-tu une étiquette « Commercial » sur
  ces clients ? Si oui, je filtre dessus. » Si l'utilisateur répond oui (ou
  nomme l'étiquette), pose alors le filtre "client_a_etiquette".
- Une action qui n'est PAS dans la liste (appel téléphonique automatique,
  message vocal, WhatsApp, Messenger, lettre…) n'existe pas dans Lume :
  "steps": null, "modifie": false, et dis dans "resume" que ce n'est pas
  possible, avec l'action la plus proche qui existe (un texto, un courriel,
  une tâche d'appel pour toi). Ne la remplace jamais d'office par autre chose.
- N'invente AUCUN champ. Pas de destinataire : le message part toujours au
  client concerné.
- REFUSE, et explique pourquoi dans "resume" avec "steps": [] : une menace,
  de l'intimidation ou une pression (publier une dette, « on vous
  poursuit », fausse urgence) ; un envoi la nuit (entre 21 h et 8 h) ou en
  rafale (plus d'un message par jour au même client) ; contourner un
  désabonnement ; supprimer ou vider une fiche client ; envoyer les données
  d'un client ailleurs que dans ses messages. Propose une version correcte
  quand il y en a une (« un rappel poli à 7 jours »).
- Les messages partent aux CLIENTS de l'entreprise : ${fr ? 'français québécois, VOUVOIEMENT, ton poli et chaleureux, court et direct, ouverture « Bonjour [client_first_name], », aucun émoji — le même registre que les messages préréglés de Lumi. Tutoiement, émojis ou ton familier seulement si l\'utilisateur le demande' : 'plain, polite English, short and direct, opening "Hi [client_first_name],", no emoji unless the user asks for a casual tone'}.
- Ce registre est un DÉFAUT, pas un interdit : quand l'utilisateur demande un
  émoji, un ton drôle, familier ou le tutoiement, fais-le dans le message —
  ce n'est jamais un refus.
- « Annule ça », « remets comme avant », « remets le texte d'avant », "undo
  that" : remets les étapes d'AVANT ta dernière modification, mot pour mot
  (elles te sont données plus bas quand il y en a). Si rien n'avait changé,
  dis simplement que le texte est toujours celui d'avant.
- Variables entre crochets : UNIQUEMENT celles-ci — ${VARIABLES_CONNUES.map((v) => `[${v}]`).join(', ')}.
  Aucune autre n'existe : une variable inventée part VIDE au client. Le lien
  de paiement d'une facture est [invoice_link], celui d'une soumission
  [quote_link]. Les montants ([invoice_total], [quote_total],
  [deposit_amount]) contiennent déjà le « $ » : n'en ajoute pas un.
- Si un parcours ACTUEL est fourni, tu le MODIFIES. Tu ne le reconstruis
  pas : garde son déclencheur, son nom et toutes ses étapes, et ne change
  QUE ce qui est demandé. « Change le délai à 7 jours » ne touche que le
  délai ; « le deuxième c'est 2 jours » ne touche que la deuxième attente.
- LE NOM ne change JAMAIS de lui-même : "nom" reprend le nom ACTUEL mot pour
  mot, "renomme": false — même s'il te semble maladroit ou ne décrit plus le
  parcours. Seule une demande explicite (« renomme-la en X », « appelle-la
  X », "rename it to X") le change : "nom": "X", "renomme": true, et rien
  d'autre ne bouge.
- Le corps d'un courriel s'écrit en TEXTE simple, un paragraphe par ligne,
  sans balise : le serveur le met en forme.
- PUBLIER ou METTRE EN PAUSE l'automatisation elle-même (« active-la »,
  « publie-la », « mets-la en marche », "turn it on", « mets-la en pause »,
  « désactive-la ») : tu ne le fais pas toi-même et tu ne dis pas que c'est
  fait. "steps": null, "modifie": false, "intention": "activer" (ou
  "desactiver"), et "resume" : une phrase courte, sans rien affirmer — le
  serveur écrit le récapitulatif exact et s'en occupe. Un « oui », « ok »,
  « vas-y », "yes, go ahead" qui répond à une demande de confirmation
  d'activation : "intention": "activer" aussi. Partout ailleurs,
  "intention": null.
- "resume" répond à la DERNIÈRE demande : ce que tu viens de changer (« J'ai
  raccourci le texto et le courriel, avec le lien du devis. »), jamais une
  redescription du parcours. Ne recopie pas le texte des messages : il est
  affiché automatiquement sous ta phrase. Parle à l'utilisateur au
  tutoiement ; ce sont les MESSAGES AU CLIENT qui sont au vouvoiement.
- « Trop long », « plus court », « plus punché », « change le message »,
  « t'as rien changé » visent les MESSAGES envoyés au client, pas ta phrase.
  Réécris-les vraiment et visiblement : un texto court tient en une ou deux
  phrases, garde l'ouverture ${fr ? '« Bonjour [client_first_name], »' : '"Hi [client_first_name],"'}
  et la signature [company_name], et ajoute le lien utile ([quote_link],
  [invoice_link]) quand il y en a un. Ne prétends jamais avoir changé ce que
  tu n'as pas changé, et n'invente pas que rien n'avait changé : si
  l'utilisateur dit « t'as rien changé » alors que le texte a changé (il est
  cité dans ta réponse précédente), ne t'excuse pas — écris une version
  NETTEMENT différente et dis-le simplement (« Voici une autre version. »).
- Un texto tient TOUJOURS en 160 caractères au plus, variables comprises :
  au-delà il est facturé double.
- "modifie" : false quand tu n'as RIEN changé au parcours (question,
  refus, demande incomprise), true sinon.
- Une QUESTION sur le parcours (« explique-moi ce que ça fait », « ça part
  quand ? », « c'est quoi le déclencheur ? ») : "steps": null, "modifie":
  false — ne réécris PAS le parcours, le serveur le garde tel quel — et
  réponds dans "resume" en deux ou trois phrases simples, dans l'ordre des
  étapes, avec les délais (« 3 jours ») et les mots de l'écran : le
  déclencheur se dit par sa description (« quand une facture est en
  retard »), jamais par sa clé (invoice.overdue). Ne décris que ce qui est
  dans le parcours : une attente simple n'est pas une condition.
- Un REFUS sur un parcours qui existe : "steps": null, "modifie": false, et
  explique le refus dans "resume".
- [quote_valid_until] est VIDE quand la soumission n'a pas de date limite
  (« valide jusqu'au . ») : ne l'utilise que si l'utilisateur parle
  d'échéance.
- Si tu ne comprends pas la demande : "steps": null, "modifie": false, et
  dis-le dans "resume". Ne reste jamais silencieux : l'utilisateur croirait
  que sa correction a été prise en compte.
- Si la demande est VAGUE (« relance mes clients », sans dire quoi ni quand),
  construis la version la plus courante ET pose UNE seule question dans
  "resume" pour la préciser. Exemple : « J'ai fait une relance de soumission
  à 3 jours. Tu veux plutôt viser les factures impayées ? ». Une question,
  pas trois — et jamais un questionnaire avant de construire.

${fr ? '' : `LANGUE : l'entreprise travaille en ANGLAIS. "resume" ET chaque message au
client sont en anglais (ouverture "Hi [client_first_name],"), même si le
parcours actuel est en français — traduis-le quand tu le modifies.

`}Réponds UNIQUEMENT par le JSON.`;
}

/**
 * Extrait le JSON d'une réponse, même si le modèle l'a entouré de texte.
 *
 * On demande « uniquement le JSON », mais un modèle ajoute parfois une
 * phrase ou des balises de code. Échouer là-dessus serait absurde.
 */
export function extraireJson(texte: string): unknown {
  const nettoye = texte.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(nettoye);
  } catch {
    const debut = nettoye.indexOf('{');
    const fin = nettoye.lastIndexOf('}');
    if (debut >= 0 && fin > debut) {
      return JSON.parse(nettoye.slice(debut, fin + 1));
    }
    throw new Error('réponse illisible');
  }
}

export interface ResultatGeneration {
  parcours: ParcoursPropose | null;
  /** Message à afficher si rien n'a pu être généré. */
  erreur?: string;
  /**
   * Ce que cette génération a coûté, en cents. Le budget du mois était
   * visible dans le module Lumi, jamais le coût d'UNE génération — QA du
   * 2026-09-25 (P2-10).
   */
  coutCents?: number;
  /** Le forfait n'inclut pas Lumi : l'écran propose Autopilot au lieu d'une erreur. */
  sansLumi?: boolean;
}

const AVEC_BALISE = /<[a-z][^>]*>/i;

/** Le parcours à l'écran (ou en base), tel que la génération le reçoit. */
export interface ParcoursActuel {
  /** Le nom de l'automatisation : il ne change que si l'utilisateur le demande (A-04). */
  nom?: string | null;
  trigger_event?: string;
  steps?: unknown[];
  /** Les étapes d'avant la DERNIÈRE modification de Lumi (voir `ParcoursPropose.remplacees`) : pour « annule ça ». */
  avant?: unknown[] | null;
}

/** Les étapes d'un parcours avec leurs courriels dépliés en texte (ce que le modèle lit). */
function etapesEnTexte(steps: unknown[]): unknown[] {
  return steps.map((e) => {
    const etape = e as { type?: unknown; action?: { type?: unknown; config?: Record<string, unknown> } };
    const corps = etape?.action?.config?.body;
    if (etape?.type === 'action' && etape.action?.type === 'send_email' && typeof corps === 'string' && AVEC_BALISE.test(corps)) {
      return { ...etape, action: { ...etape.action, config: { ...etape.action.config, body: htmlVersTexte(corps) } } };
    }
    return e;
  });
}

/**
 * Le parcours actuel sous sa forme COMPACTE, pour le modèle (F-03).
 *
 * Avant : `JSON.stringify(parcours).slice(0, 6_000)`. Les deux gros parcours du
 * pack de base (17 et 23 étapes, 8 278 et 8 741 caractères) partaient COUPÉS
 * au milieu d'une étape : le modèle rendait un parcours bancal, refusé, débité.
 * Maintenant le parcours part ENTIER — jamais tronqué —, en JSON sans
 * indentation, et les corps de courriel y sont dépliés en texte : l'enveloppe
 * HTML (`<div style="font-family:…">`) n'apprend rien au modèle et pèse le
 * tiers du parcours. Au retour, un courriel dont le texte n'a pas bougé
 * reprend son HTML d'origine (`remettreCourriels`).
 */
export function parcoursPourLeModele(p: ParcoursActuel): string {
  const steps = etapesEnTexte(Array.isArray(p.steps) ? p.steps : []);
  return JSON.stringify({ ...(p.nom ? { nom: p.nom } : {}), trigger_event: p.trigger_event, steps });
}

/**
 * Les courriels du parcours rendu, au format ENREGISTRÉ (le HTML de l'éditeur).
 *
 *  · texte inchangé → le HTML d'origine, à l'octet près : une demande qui ne
 *    touche pas ce courriel ne le réécrit pas ;
 *  · texte nouveau → `texteVersHtml`, la conversion de l'éditeur de courriel
 *    (première ligne en titre, un paragraphe par ligne). Sans elle, un courriel
 *    écrit par Lumi partait en un seul bloc, sans paragraphes (A-21).
 */
export function remettreCourriels(steps: Array<Record<string, unknown>>, originaux: unknown[] | undefined): Array<Record<string, unknown>> {
  const plat = (t: string) => t.replace(/\s+/g, ' ').trim();
  const dOrigine = (Array.isArray(originaux) ? originaux : [])
    .map((e) => e as { id?: unknown; action?: { type?: unknown; config?: { body?: unknown } } })
    .filter((e) => e?.action?.type === 'send_email' && typeof e.action.config?.body === 'string')
    .map((e) => ({ id: String(e.id ?? ''), html: String(e.action!.config!.body), texte: plat(htmlVersTexte(String(e.action!.config!.body))) }));
  return steps.map((e) => {
    const action = e.action as { type?: unknown; config?: Record<string, unknown> } | undefined;
    if (e.type !== 'action' || action?.type !== 'send_email' || typeof action.config?.body !== 'string') return e;
    const rendu = action.config.body;
    if (AVEC_BALISE.test(rendu)) return e;
    const texte = plat(rendu);
    const meme = dOrigine.find((o) => o.id === String(e.id ?? '') && o.texte === texte) ?? dOrigine.find((o) => o.texte === texte);
    return { ...e, action: { ...action, config: { ...action.config, body: meme ? meme.html : texteVersHtml(rendu) } } };
  });
}

/**
 * Les messages envoyés au modèle : l'historique, le parcours courant,
 * puis la demande.
 *
 * L'ordre compte. Le parcours courant est collé juste avant la demande
 * pour que « change le délai à 7 jours » ait quelque chose à modifier
 * plutôt qu'une page blanche à remplir.
 */
export function construireMessages(
  demande: string,
  echanges?: Array<{ role: 'user' | 'assistant'; content: string }>,
  parcoursActuel?: ParcoursActuel | null,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  /*
   * On borne l'historique aux 6 derniers tours : au-delà, on paie des
   * tokens pour du contexte qui ne sert plus, et le modèle se met à
   * suivre une consigne périmée.
   */
  for (const e of (echanges ?? []).slice(-6)) {
    if (!e?.content) continue;
    messages.push({ role: e.role, content: String(e.content).slice(0, 2_000) });
  }

  if (parcoursActuel && Array.isArray(parcoursActuel.steps) && parcoursActuel.steps.length > 0) {
    /*
     * Les étapes NON RÉDIGÉES sont nommées. Sans ça, « ne le reconstruis pas
     * de zéro » faisait garder au modèle le texto d'exemple d'une étape tout
     * juste ajoutée : il partait au client sans que personne ne l'ait écrit.
     */
    const exemples = etapesNonRedigees(parcoursActuel.steps);
    const consigneExemples = exemples.length
      ? `

ÉTAPE${exemples.length > 1 ? 'S' : ''} NON RÉDIGÉE${exemples.length > 1 ? 'S' : ''} : ${exemples.join(', ')}. Son texte est l'EXEMPLE que l'éditeur pose quand on ajoute une étape ; l'utilisateur ne l'a pas écrit et ne veut pas l'envoyer. Ne garde JAMAIS une telle étape telle quelle : si la demande porte sur ce message, ou si elle dit « le message » sans préciser alors que c'est le seul, RÉÉCRIS-le selon la demande ; sinon RETIRE l'étape et dis-le dans "resume". Un texte d'exemple ne doit jamais partir à un client.`
      : '';
    if (Array.isArray(parcoursActuel.avant) && parcoursActuel.avant.length > 0) {
      messages.push({
        role: 'user',
        content: `AVANT ta dernière modification, ces étapes étaient ainsi (à remettre telles quelles si on te demande d'annuler ou de remettre comme avant) :
${JSON.stringify(etapesEnTexte(parcoursActuel.avant))}`,
      });
    }
    messages.push({
      role: 'user',
      // Rien entre l'annonce et le JSON, et le JSON ENTIER : jamais de coupe (F-03).
      content: `Voici le parcours ACTUEL, à modifier (ne le reconstruis pas de zéro) :
${parcoursPourLeModele(parcoursActuel)}${consigneExemples}`,
    });
  }

  messages.push({ role: 'user', content: demande.slice(0, 2_000) });
  return messages;
}

/**
 * La même demande, du même utilisateur, déjà EN VOL : on attend sa réponse au
 * lieu de payer un 2e appel. Deux clics dans le même instant envoyaient deux
 * générations facturées (audit V2, L-10). Clé = bureau + utilisateur +
 * contenu exact (demande, historique, parcours affiché).
 */
const enVol = new Map<string, Promise<ResultatGeneration>>();

export function genererParcours(params: Parameters<typeof genererParcoursUneFois>[0]): Promise<ResultatGeneration> {
  const cle = JSON.stringify([params.orgId, params.userId, params.langue, params.demande, params.echanges ?? [], params.parcoursActuel ?? null]);
  const deja = enVol.get(cle);
  if (deja) return deja;
  const p = genererParcoursUneFois(params).finally(() => enVol.delete(cle));
  enVol.set(cle, p);
  return p;
}

/**
 * Les valeurs de `config` telles que le moteur les exige : du TEXTE, et pour
 * un choix, une valeur de la liste. Le modèle écrit volontiers `1` ou
 * `"normal"` ; un champ facultatif invalide est retiré (sa valeur par défaut
 * s'applique) plutôt que de faire refuser tout le parcours.
 */
export function normaliserEtapes(etapes: unknown[]): Array<Record<string, unknown>> {
  return (etapes as Array<Record<string, unknown>>).map((e) => {
    const action = e?.type === 'action' ? (e.action as ({ type?: string; config?: unknown } & Record<string, unknown>) | undefined) : undefined;
    if (!action || typeof action !== 'object') return e;
    const modele = action.type ? trouverAction(action.type) : undefined;
    let source = action.config as Record<string, unknown> | undefined;
    let enveloppeOubliee = false;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      /*
       * L'ENVELOPPE `config` oubliée. Le modèle pose parfois les champs à plat
       * sur l'action (`{ type: 'create_task', title: '…' }`), ou n'écrit rien
       * pour une action sans champ obligatoire. La validation refusait alors
       * TOUT le parcours (« config : expected object, received undefined ») et
       * la personne lisait « Reformule ta demande » pour une demande claire —
       * vu sur la batterie I contre la prod le 2026-10-01 (I-018). On remet
       * dans `config` les champs CONNUS de cette action ; une action qui exige
       * un champ et n'en porte aucun reste refusée, comme avant.
       */
      if (!modele) return e;
      const aPlat: Record<string, unknown> = {};
      for (const c of modele.champs) {
        if (Object.prototype.hasOwnProperty.call(action, c.cle)) aPlat[c.cle] = action[c.cle];
      }
      if (!Object.keys(aPlat).length && modele.champs.some((c) => c.obligatoire)) return e;
      source = aPlat;
      enveloppeOubliee = true;
    }
    const config: Record<string, unknown> = {};
    for (const [cle, valeur] of Object.entries(source)) {
      let v = valeur;
      if (typeof v === 'number' || typeof v === 'boolean') v = String(v);
      const champ = modele?.champs.find((c) => c.cle === cle);
      if (champ?.type === 'choix' && champ.options?.length && typeof v === 'string'
        && !champ.options.some((o) => o.cle === v) && !champ.obligatoire) continue;
      config[cle] = v;
    }
    return { ...e, action: enveloppeOubliee ? { type: action.type, config } : { ...action, config } };
  });
}

async function genererParcoursUneFois(params: {
  admin: SupabaseClient;
  orgId: string;
  userId: string | null;
  demande: string;
  langue: 'fr' | 'en';
  /**
   * Les échanges précédents de cette conversation.
   *
   * Sans eux, Lumi recevait UNIQUEMENT la dernière phrase : « Change le
   * délai à 7 jours » reconstruisait tout le parcours depuis cette
   * seule phrase — déclencheur changé, deux SMS devenus un, nom
   * renommé. Reproduit deux fois au QA du 2026-09-25 (P1-6).
   */
  echanges?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /**
   * Le parcours actuellement à l'écran (ou en base, pour un outil de Lumi),
   * avec le NOM de l'automatisation.
   *
   * C'est ce qu'il faut MODIFIER. Sans lui, une correction du genre
   * « Non, le deuxième c'est 2 jours, pas 5 » n'avait rien à quoi se
   * rattacher : Lumi ne répondait rien et le parcours restait tel quel
   * (P1-7). Le silence est le pire comportement — l'utilisateur croit
   * que c'est corrigé.
   */
  parcoursActuel?: ParcoursActuel | null;
  /**
   * La conversation du clavardage d'où part la génération (outils de Lumi).
   * Absente : celle du tour en cours, s'il y en a un (`contexte-appel.ts`).
   * Sans elle, la dépense était journalisée hors conversation : invisible de
   * la trace du tour et du plafond par conversation (F-02).
   */
  conversationId?: string | null;
  /** Pour la trace : le panneau de l'éditeur, ou un outil du clavardage. */
  canal?: 'panneau' | 'clavardage';
  /** Pour la trace : l'automatisation ouverte ou modifiée. */
  ruleId?: string | null;
}): Promise<ResultatGeneration> {
  const { admin, orgId, userId, demande, langue, echanges, parcoursActuel } = params;
  const fr = langue === 'fr';
  const debut = Date.now();
  const appelLumi = contexteLumi();
  const conversationId = params.conversationId ?? appelLumi?.conversationId ?? null;
  const canal = params.canal ?? (appelLumi ? 'clavardage' : 'panneau');
  const etapesEnvoyees = Array.isArray(parcoursActuel?.steps) ? parcoursActuel.steps.length : 0;

  if (!isLumiConfigured()) {
    return { parcours: null, erreur: fr ? 'Lumi n’est pas configuré.' : 'Lumi is not configured.' };
  }

  /*
   * LA TRACE (F-01). Ce chemin n'écrivait que `ai_usage` : ni la durée, ni le
   * résultat, ni un échec n'étaient mesurables — deux refus 422 de la passe de
   * mesure n'ont laissé qu'une ligne dans les journaux du serveur. Une ligne
   * par génération, comme un tour du clavardage : ce qui a été demandé
   * (normalisé, sans coordonnées), ce que ça a coûté, combien de temps, et
   * pourquoi ça n'a pas abouti.
   */
  let usage: UsageAgrege = usageVide();
  let coutGeneration = 0;
  let modeleRepondu: string | null = null;
  let stopReason: string | null = null;
  let secondEssai = false;
  const tracer = (resultat: 'ok' | 'refus' | 'erreur', motif: string | null, etapesRendues = 0): void => {
    void journaliserTrace(admin, {
      orgId, userId, conversationId, canal: 'lumi', origine: canal === 'panneau' ? 'texte' : 'carte',
      enonce: demande, etage: ETAGE.agent, action: 'construire-parcours',
      params: {
        canal, ...(params.ruleId ? { rule_id: params.ruleId } : {}),
        etapes_envoyees: etapesEnvoyees, etapes_rendues: etapesRendues,
        ...(motif ? { motif: motif.slice(0, 200) } : {}),
        ...(stopReason ? { stop_reason: stopReason } : {}),
        ...(secondEssai ? { second_essai: true } : {}),
      },
      outils: [], resultat, model: modeleRepondu, promptVersion: VERSION_PROMPT_PARCOURS,
      usage, costCents: coutGeneration, dureeMs: Date.now() - debut,
    });
  };

  /*
   * LE PLAFOND JOURNALIER de la plateforme (F-06) : ce chemin n'entrait dans
   * aucun cran d'arrêt en dollars par jour — une boucle sur le panneau n'était
   * arrêtée que par le budget mensuel de CE client. Même compteur que le
   * clavardage (`lumi`) : c'est le même produit, la même clé.
   */
  const plafond = verifierPlafond('lumi');
  if (!plafond.autorise) {
    compterRefus('lumi');
    logger.error('[lumi/parcours] génération refusée par le plafond journalier de la plateforme', { org_id: orgId, depense_cents: plafond.depense_cents, plafond_cents: plafond.plafond_cents });
    tracer('refus', 'plafond_plateforme');
    return { parcours: null, erreur: messagePausePlateforme(langue) };
  }

  const systeme = consignes(fr);
  const aLaMain = fr
    ? 'Le parcours peut toujours être construit à la main avec le « + ».'
    : 'You can still build the path by hand with “+”.';

  /*
   * Les crédits, lus à la MÊME source que l'écran (F-08, F-10) : l'éditeur
   * disait « le budget du mois est atteint », sans date, là où le reste de
   * Lumi dit « tes crédits sont épuisés jusqu'au … ». Et un bureau à zéro
   * crédit ne génère plus, même si la réservation en base, seule garde avant,
   * disait encore oui. Illisible (panne, tests) : la réservation tranche.
   */
  let renouvellement: string | null = null;
  try {
    const credits = await etatCredits(admin, orgId);
    renouvellement = credits.renouvellement_le || null;
    if (credits.inclus && credits.palier === 'epuise') {
      tracer('refus', 'credits_epuises');
      return { parcours: null, erreur: `${messagePause(langue, renouvellement ?? new Date())} ${aLaMain}` };
    }
  } catch { /* la réservation ci-dessous reste la garde */ }

  /*
   * FACTURÉ au budget Lumi de l'entreprise (décision du 2026-09-28) :
   * « Construire avec Lumi » est une fonction de Lumi, donc d'Autopilot.
   * Un forfait sans Lumi (Minimum, Scale) reçoit `plan_sans_lumi` et bâtit
   * ses automatisations à la main avec le « + ».
   *
   * Réservé AVANT l'appel (on ne lance pas un appel qu'on ne peut pas payer),
   * puis réglé au coût réel — l'ancienne version ne réglait jamais sa
   * réservation, qui restait en vol jusqu'à son expiration.
   */
  // Tout ce qui PART au modèle : l'historique et le parcours affiché comptent
  // (audit V2, L-8 : 10 appels simultanés à contexte plein dépassaient le
  // plafond de 1,21 ¢, la réservation ne voyant que la dernière phrase).
  const messages = construireMessages(demande, echanges, parcoursActuel);
  const estimation = estimationCoutAppel(MODELE, systeme.length + JSON.stringify(messages).length, MAX_TOKENS, 0);
  const reservation = await reserverBudget(admin, orgId, estimation).catch((e: unknown) => {
    logger.error('[lumi/parcours] réservation impossible', { message: e instanceof Error ? e.message : String(e) });
    return { id: null, statut: 'indisponible' as const };
  });

  if (reservation.statut === 'plan_sans_lumi') {
    tracer('refus', 'plan_sans_lumi');
    return {
      parcours: null,
      sansLumi: true,
      erreur: fr
        ? 'Construire avec Lumi est inclus dans le forfait Autopilot. Tu peux bâtir ce parcours à la main avec le « + ».'
        : 'Building with Lumi is included in the Autopilot plan. You can build this path by hand with “+”.',
    };
  }
  // AVANT le cas « sans id » : un plafond atteint rend `reservation_id: null`,
  // et le test suivant l'annonçait « illisible, réessaie » — la bonne branche
  // ne s'exécutait jamais (audit V2, L-1).
  if (reservation.statut === 'capped') {
    tracer('refus', 'credits_epuises');
    return {
      parcours: null,
      // Les mêmes mots que le clavardage ; la date seulement quand on la CONNAÎT.
      erreur: renouvellement
        ? `${messagePause(langue, renouvellement)} ${aLaMain}`
        : `${fr ? 'Tes crédits Lumi sont épuisés.' : 'Your Lumi credits are used up.'} ${aLaMain}`,
    };
  }
  /*
   * Réservation IMPOSSIBLE (panne de la base, RPC en erreur) : on n'appelle
   * PAS le modèle (launch 2026-09-28). Le refus « plan_sans_lumi » n'existe
   * que dans cette RPC — laisser passer faisait tomber l'exclusivité
   * Autopilot et le plafond du mois à chaque panne.
   */
  if (reservation.statut === 'indisponible' || !reservation.id) {
    tracer('erreur', 'reservation_indisponible');
    return {
      parcours: null,
      erreur: fr
        ? 'Lumi est momentanément indisponible. Réessaie dans un instant, ou construis le parcours à la main avec le « + ».'
        : 'Lumi is temporarily unavailable. Try again shortly, or build the path by hand with “+”.',
    };
  }
  try {
    /** Un appel au modèle, journalisé (compté au budget du client, au plafond du jour et à la trace). */
    const appeler = async (msgs: typeof messages) => {
      const rep = await clientAnthropic().messages.create({
        model: MODELE,
        max_tokens: MAX_TOKENS,
        system: [{ type: 'text', text: systeme, cache_control: { type: 'ephemeral' } }],
        messages: msgs,
        // Réflexion adaptative, effort borné : voir EFFORT (F-05).
        thinking: { type: 'adaptive' },
        output_config: { effort: EFFORT },
      });
      const u = (rep.usage ?? { input_tokens: 0, output_tokens: 0 }) as UsageTokens;
      // `coutEnCents` prend l'usage BRUT de l'API : il sait lire un id daté et
      // distinguer les écritures de cache 5 min / 1 h.
      const modeleRendu = rep.model ?? MODELE;
      const cout = coutEnCents(modeleRendu, u);
      modeleRepondu = modeleRendu;
      stopReason = rep.stop_reason ?? null;
      usage = ajouterUsage(usage, u);
      ajouterDepense('lumi', cout);
      noterAppelImbrique(modeleRendu, u, cout);
      await journaliserUsage(admin, {
        orgId,
        userId,
        conversationId,
        model: modeleRendu,
        input_tokens: u?.input_tokens ?? 0,
        output_tokens: u?.output_tokens ?? 0,
        cache_creation_input_tokens: u?.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: u?.cache_read_input_tokens ?? 0,
        cost_cents: cout,
        // Source distincte pour mesurer ce poste, mais COMPTÉE dans le budget
        // du client (20260929230300).
        source: 'automatisations',
        requestId: rep.id ?? null,
      });
      return { rep, cout, texte: rep.content.map((b) => (b.type === 'text' ? b.text : '')).join('') };
    };
    const lisible = (t: string) => { try { extraireJson(t); return true; } catch { return false; } };

    let essai = await appeler(messages);
    coutGeneration = essai.cout;
    /*
     * UN deuxième essai quand la réponse, complète, n'est pas un JSON
     * lisible. Mesuré le 2026-09-30 sur la batterie `qa:construire-lumi` :
     * environ 1 tour sur 25 (une accolade de trop, ou du texte seul), que
     * l'utilisateur lisait « Lumi n'a pas compris cette modification ». Le
     * coût supplémentaire ne tombe que dans ce cas-là.
     */
    if (essai.rep.stop_reason !== 'max_tokens' && !lisible(essai.texte)) {
      logger.warn('[lumi/parcours] réponse illisible — second essai', { org_id: orgId });
      secondEssai = true;
      const relance = essai.texte.trim()
        ? [...messages, { role: 'assistant' as const, content: essai.texte.slice(0, 8_000) }, { role: 'user' as const, content: 'Ta réponse n’est pas un objet JSON valide. Renvoie UNIQUEMENT l’objet JSON demandé, complet, rien autour.' }]
        : messages;
      essai = await appeler(relance);
      coutGeneration += essai.cout;
    }
    /*
     * UN deuxième essai aussi quand le parcours rendu ne passerait pas la
     * validation du moteur (un renvoi vers une étape absente, un champ
     * obligatoire vide) : le motif exact est rendu au modèle, qui corrige.
     * Avant, la route répondait « Lumi a proposé un parcours que le moteur ne
     * saurait pas exécuter. Reformule » — pour une demande claire, débitée.
     */
    if (!secondEssai && essai.rep.stop_reason !== 'max_tokens' && lisible(essai.texte)) {
      const propose = extraireJson(essai.texte) as Partial<ParcoursPropose> | null;
      const etapes = Array.isArray(propose?.steps) && propose.steps.length ? normaliserEtapes(propose.steps) : null;
      const verdict = etapes ? sequenceEtapes.safeParse(etapes) : null;
      /*
       * Les LONGUEURS, comptées par le code : un modèle ne sait pas compter les
       * caractères. « Plus court » rendait parfois un texto plus long, et la
       * règle des 160 caractères n'était qu'une consigne (mesuré le 2026-10-02 :
       * 183 caractères pour « plus court » sur un texte de 160).
       */
      const smsAvant = new Map(messagesDuParcours(parcoursActuel?.steps).filter((m) => m.type === 'send_sms').map((m) => [m.id, m.corps]));
      const veutPlusCourt = /plus courts?|trop long|raccourci|shorter|too long|shorten/i.test(demande);
      const longueurs = etapes
        ? messagesDuParcours(etapes).filter((m) => m.type === 'send_sms').flatMap((m) => {
          const avant = smsAvant.get(m.id);
          // Seulement un texto que le modèle a RÉÉCRIT : « raccourcis le courriel, le texto est correct »
          // ne doit pas faire raccourcir le texto (recul mesuré par qa:construire-lumi, cas « seulement-courriel »).
          if (avant !== undefined && m.corps === avant) return [];
          if (veutPlusCourt && avant !== undefined && m.corps.length >= avant.length) return [`le texto ${m.id} fait ${m.corps.length} caractères alors que l'actuel en fait ${avant.length} : il doit être nettement PLUS COURT`];
          if (m.corps.length > 160 && (avant === undefined || avant.length <= 160)) return [`le texto ${m.id} fait ${m.corps.length} caractères : 160 au plus`];
          return [];
        })
        : [];
      if ((verdict && !verdict.success) || longueurs.length) {
        const motifs = [
          ...(verdict && !verdict.success ? verdict.error.issues.slice(0, 4).map((i) => `${i.path.join('.')} : ${i.message}`) : []),
          ...longueurs,
        ].join(' ; ');
        logger.warn('[lumi/parcours] parcours à corriger — second essai', { org_id: orgId, motifs });
        secondEssai = true;
        essai = await appeler([
          ...messages,
          { role: 'assistant' as const, content: essai.texte.slice(0, 24_000) },
          { role: 'user' as const, content: `Ce parcours est à corriger avant d’être proposé : ${motifs}. Corrige ces points, ne change rien d’autre, et renvoie UNIQUEMENT l’objet JSON complet.` },
        ]);
        coutGeneration += essai.cout;
      }
    }
    await reglerBudget(admin, reservation.id, coutGeneration);

    const reponse = essai.rep;
    const texte = essai.texte;

    // Réponse COUPÉE au plafond : le JSON est illisible. On le dit tel quel
    // (« réessaie ») et on le consigne — déguisé en « Lumi n'a pas compris »,
    // ce défaut est resté invisible (mesuré le 2026-09-30).
    if (reponse.stop_reason === 'max_tokens') {
      logger.error('[lumi/parcours] réponse coupée au plafond de sortie', { org_id: orgId, max_tokens: MAX_TOKENS });
      tracer('erreur', 'reponse_coupee');
      return {
        parcours: null,
        coutCents: coutGeneration,
        erreur: fr
          ? 'La réponse de Lumi a été coupée (parcours trop long). Réessaie, ou demande une modification plus ciblée.'
          : 'Lumi’s answer was cut off (path too long). Try again, or ask for a more targeted change.',
      };
    }

    /*
     * Le modèle peut répondre en TEXTE au lieu du JSON — typiquement quand
     * on lui demande de MODIFIER un parcours qu'il ne voit pas
     * (« Réécris le premier texto » sur un éditeur vide). `extraireJson`
     * levait, et le `catch` plus bas rendait « Lumi n'a pas pu répondre » :
     * une erreur générique, sans rien pour s'en sortir. QA du 2026-09-25
     * (P2-6).
     *
     * On ne recopie PAS la phrase du modèle : mesuré, il y parle de
     * « JSON » une fois sur deux — du jargon pour un plombier. On dit ce
     * qui manque, avec des mots fixes.
     */
    type Brut = Partial<ParcoursPropose> & { modifie?: unknown; renomme?: unknown; intention?: unknown };
    let brut: Brut;
    try {
      brut = extraireJson(texte) as Brut;
    } catch {
      const rienAModifier = !parcoursActuel?.steps?.length;
      tracer('erreur', 'reponse_illisible');
      return {
        parcours: null,
        coutCents: coutGeneration,
        erreur: rienAModifier
          ? (fr
            ? 'Il n’y a pas encore de parcours à modifier. Décris ce que l’automatisation doit faire (ex. : « relance la soumission après 3 jours par texto »), ou ajoute une étape avec le « + ».'
            : 'There is no path to change yet. Describe what the automation should do (e.g. “follow up on the quote after 3 days by text”), or add a step with “+”.')
          : (fr
            ? 'Lumi n’a pas compris cette modification. Précise quelle étape changer (ex. : « le premier texto », « la deuxième attente »), ou modifie-la directement en cliquant dessus.'
            : 'Lumi did not understand that change. Say which step to change (e.g. “the first text”), or edit it directly by clicking it.'),
      };
    }

    const etapesActuelles = Array.isArray(parcoursActuel?.steps) ? parcoursActuel.steps : [];
    const aUnParcoursActuel = etapesActuelles.length > 0;
    const nomActuel = typeof parcoursActuel?.nom === 'string' ? parcoursActuel.nom.trim() : '';
    const nomPropose = String(brut?.nom ?? '').trim().slice(0, 120);
    // Le nom ne change QUE sur demande (A-04) : Lumi rebaptisait « Mauvais payeurs —
    // Longueuil (Will) » en « Relance facture en retard » après « mets le texto plus court ».
    const renomme = aUnParcoursActuel && !!nomActuel && brut?.renomme === true && !!nomPropose && nomPropose !== nomActuel;
    const nomRendu = aUnParcoursActuel && nomActuel && !renomme ? nomActuel : (nomPropose || (fr ? 'Nouvelle automatisation' : 'New automation'));
    const intention = brut?.intention === 'activer' || brut?.intention === 'desactiver' ? brut.intention : null;

    /*
     * Filet : en MODIFIANT un parcours, le modèle omet parfois le
     * déclencheur, qu'il considère inchangé. On reprend celui du parcours
     * courant plutôt que de tout refuser.
     */
    if (brut && !brut.trigger_event && parcoursActuel?.trigger_event) {
      brut.trigger_event = parcoursActuel.trigger_event;
    }

    const explication = typeof brut?.resume === 'string' ? brut.resume.trim() : '';
    const sansEtapes = !Array.isArray(brut?.steps) || brut.steps.length === 0;

    /*
     * RIEN À RÉÉCRIRE (F-07, A-16) : une question, un refus, une demande
     * incomprise, « active-la ». Le modèle rend `"steps": null` et le parcours
     * reçu repart TEL QUEL — il le réécrivait en entier pour deux phrases
     * (trois tours sur six d'une conversation, 1,92 ¢ sur 3,56). Jamais un
     * parcours vide en retour : le canevas ne se vide pas sur une question.
     */
    if (sansEtapes && aUnParcoursActuel && (explication.length > 0 || intention || renomme)) {
      const declencheur = String(parcoursActuel?.trigger_event ?? brut.trigger_event ?? '');
      tracer('ok', renomme ? 'renomme' : intention ? `intention_${intention}` : 'sans_modification', etapesActuelles.length);
      return {
        parcours: {
          nom: nomRendu,
          trigger_event: declencheur,
          resume: explication.slice(0, 700),
          steps: etapesActuelles as Array<Record<string, unknown>>,
          autre: null,
          modifie: renomme,
          renomme,
          intention,
        },
        coutCents: coutGeneration,
      };
    }

    /*
     * Lumi a REFUSÉ (demande impossible ou dangereuse) : son explication est
     * dans « resume ». On la montre — « Reformule en une phrase » laissait
     * croire que c'était faisable (audit V2, L-5 : 5 refus sur 30, tous
     * justes, tous rendus illisibles).
     */
    if (sansEtapes && explication.length >= 15) {
      tracer('refus', 'refus_du_modele');
      return { parcours: null, erreur: explication.slice(0, 400), coutCents: coutGeneration };
    }

    if (!brut?.trigger_event || sansEtapes) {
      tracer('erreur', 'parcours_vide');
      return {
        parcours: null,
        coutCents: coutGeneration,
        erreur: fr
          ? 'Lumi n’a pas réussi à construire ce parcours. Reformule en une phrase, ou construis-le avec le « + ».'
          : 'Lumi could not build that path. Rephrase it in one sentence, or build it with “+”.',
      };
    }

    // Les courriels reprennent le format enregistré (HTML de l'éditeur) : voir `remettreCourriels`.
    brut.steps = remettreCourriels(normaliserEtapes(brut.steps as unknown[]), [...etapesActuelles, ...(Array.isArray(parcoursActuel?.avant) ? parcoursActuel.avant : [])]);
    if (brut.autre && Array.isArray(brut.autre.steps)) brut.autre.steps = remettreCourriels(normaliserEtapes(brut.autre.steps), undefined);

    /*
     * Variable INVENTÉE (`[payment_link]`) : elle partirait vide au client
     * (« payez en ligne : . »). On ne propose pas un message troué (audit V2,
     * L-4) — on dit laquelle, et par quoi la remplacer.
     */
    const inventees = variablesInconnues(textesDesMessages(brut.steps).join('\n'));
    if (inventees.length) {
      tracer('refus', `variables_inconnues:${inventees.join(',')}`);
      return {
        parcours: null,
        coutCents: coutGeneration,
        erreur: fr
          ? `Lumi a utilisé ${inventees.map((v) => `[${v}]`).join(', ')}, qui n’existe pas : le client recevrait un trou. Redemande en précisant (le lien de paiement d’une facture est [invoice_link]).`
          : `Lumi used ${inventees.map((v) => `[${v}]`).join(', ')}, which does not exist: the client would get a blank. Ask again (an invoice payment link is [invoice_link]).`,
      };
    }

    // Ce que le moteur refuserait, même après le second essai : dit ici, et TRACÉ.
    const verdictFinal = sequenceEtapes.safeParse(brut.steps);
    if (!verdictFinal.success) {
      const motifs = verdictFinal.error.issues.slice(0, 3).map((i) => i.message).join(' ; ');
      logger.error('[lumi/parcours] proposition invalide', { org_id: orgId, motifs });
      tracer('refus', `parcours_invalide:${motifs}`);
      return {
        parcours: null,
        coutCents: coutGeneration,
        erreur: fr
          ? 'Lumi a proposé un parcours que le moteur ne saurait pas exécuter. Reformule, ou construis-le avec le « + ».'
          : 'Lumi proposed a path the engine could not run. Rephrase, or build it with “+”.',
      };
    }

    const a = brut.autre;
    /*
     * Un lien manquant (trou) : on ne crée PAS la deuxième automatisation, et
     * on pose la question nous-mêmes — le modèle, lui, ne l'a pas posée.
     */
    const trou = !!a && (contientTrou(a.steps) || (typeof a.manque === 'string' && a.manque.trim().length > 0));
    if (trou) {
      brut.resume = `${String(brut.resume ?? '').trim()} ${fr
        ? 'Quel lien veux-tu envoyer (ton lien Calendly, par exemple) ? Je crée la réponse automatique dès que je l’ai.'
        : 'Which link should I send (your Calendly link, for instance)? I will create the automatic reply as soon as I have it.'}`.trim();
    }
    const autre = !trou && a && typeof a === 'object' && typeof a.trigger_event === 'string'
      && Array.isArray(a.steps) && a.steps.length > 0
      ? {
        nom: String(a.nom ?? (fr ? 'Automatisation liée' : 'Linked automation')).slice(0, 120),
        trigger_event: String(a.trigger_event),
        resume: String(a.resume ?? '').slice(0, 300),
        steps: a.steps as Array<Record<string, unknown>>,
        une_fois_par_client_jours: Number.isInteger(a.une_fois_par_client_jours)
          ? Math.min(365, Math.max(1, Number(a.une_fois_par_client_jours)))
          : (a.trigger_event === 'client.replied' ? 7 : undefined),
      }
      : null;

    /*
     * CE QUI A CHANGÉ, constaté par le serveur — pas déclaré par le modèle.
     * Le déclencheur et le nom comptent : « j'ai changé le déclencheur… je
     * n'ai rien changé au parcours » ne se lit plus dans la même bulle (A-16).
     */
    const declencheurChange = aUnParcoursActuel && !!parcoursActuel?.trigger_event && String(brut.trigger_event) !== parcoursActuel.trigger_event;
    const etapesChangees = JSON.stringify(etapesActuelles) !== JSON.stringify(brut.steps);
    const modifie = !aUnParcoursActuel || etapesChangees || declencheurChange || renomme;
    const declencheurDit = declencheurChange
      ? (() => {
        const d = trouverDeclencheur(String(brut.trigger_event));
        return d ? (fr ? `\n\nNouveau déclencheur : « ${d.fr} ».` : `\n\nNew trigger: “${d.en}”.`) : '';
      })()
      : '';

    // Les étapes d'AVANT qui ont changé ou disparu : gardées pour « annule ça ».
    const nouvelles = new Map((brut.steps as Array<Record<string, unknown>>).map((e) => [String(e.id), JSON.stringify(e)]));
    const remplacees = (etapesActuelles as Array<Record<string, unknown>>).filter((e) => nouvelles.get(String(e.id)) !== JSON.stringify(e)).slice(0, 12);
    /*
     * Lumi ANNONCE un changement que la comparaison ne retrouve pas (« j'ai
     * remis le texte d'avant » alors que rien n'a bougé) : sa phrase est
     * écartée, seule la constatation du serveur reste. Jamais « c'est fait »
     * sans que ce soit fait.
     */
    const annonceSansEffet = aUnParcoursActuel && !modifie && brut.modifie !== false;
    const constat = ceQuiAChange(parcoursActuel?.steps, brut.steps, fr, brut.modifie !== false, declencheurChange || renomme);

    tracer('ok', annonceSansEffet ? 'annonce_sans_effet' : null, (brut.steps as unknown[]).length);
    return {
      parcours: {
        nom: nomRendu,
        trigger_event: String(brut.trigger_event),
        // La phrase de Lumi, PUIS le nouveau texte (après la coupe : c'est la
        // partie que l'utilisateur doit voir en entier).
        resume: annonceSansEffet && constat.trim() ? constat.trim() : String(brut.resume ?? '').slice(0, 400)
          + declencheurDit
          + constat,
        ...(modifie && aUnParcoursActuel && remplacees.length ? { remplacees } : {}),
        steps: brut.steps as Array<Record<string, unknown>>,
        autre,
        modifie,
        renomme,
        intention,
      },
      coutCents: coutGeneration,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('[lumi/parcours] génération échouée', { message, org_id: orgId });
    // Appel raté : on libère la réservation (rien n'a été consommé, ou on
    // ne le sait pas — mieux vaut ne pas facturer).
    await reglerBudget(admin, reservation.id, 0).catch(() => {});
    tracer('erreur', message);
    return {
      parcours: null,
      erreur: fr
        ? 'Lumi n’a pas pu répondre. Réessaie, ou construis le parcours avec le « + ».'
        : 'Lumi could not answer. Try again, or build the path with “+”.',
    };
  }
}
