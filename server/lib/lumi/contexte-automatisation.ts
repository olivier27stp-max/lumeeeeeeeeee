/**
 * Lumi sait de QUELLE automatisation on parle (mission finale, P1-3 ; constats A-15, F-12, F-13).
 * ─────────────────────────────────────────────────────────────────────────
 * Avant : le clavardage ne recevait que le message. « change le message de
 * l'automatisation » → deux questions d'un coup ; « change le message de la
 * relance » → Lumi lisait les relances de PAIEMENT ; une automatisation nommée
 * était dite introuvable sans qu'aucun outil ait cherché ; et au 3e tour d'une
 * conversation sur une automatisation, le routeur hésitait, le jeu d'outils
 * changeait et Lumi répondait « il faut refaire la règle au complet ».
 *
 * Trois sources, toutes lues par du code (aucun appel au modèle), et toutes
 * ajoutées au CONTEXTE DU TOUR — après le point de cache, jamais dans le
 * préfixe en cache, jamais sauvegardées dans l'historique :
 *
 *  1. la PAGE ouverte : quand l'utilisateur arrive de l'éditeur d'une
 *     automatisation, le navigateur envoie son identifiant ; le serveur y joint
 *     le résumé compact de ce qui est ENREGISTRÉ (`resumeDeLaRegle`) ;
 *  2. le NOM cité : une automatisation dont le nom figure dans le message est
 *     retrouvée et donnée au modèle, avec sa référence — plus de lecture de
 *     toute la liste pour retrouver un nom (0,45 ¢ par modification, F-12) ;
 *  3. la SUITE de la conversation : « non, plus court », « active-la », « celle
 *     des devis » gardent le sujet du tour précédent.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import { masquerIds } from '../agent/refs';
import { COLONNES_REGLE_LUE, declencheurEnClair, obstaclesAPublication, resumeDeLaRegle, texteDuResume, type RegleLue } from '../automations-etapes';
import { estPrereglageRetire } from '../../../src/lib/automationCatalogue';
import { localizeAutomationName } from '../../../src/lib/automationNames';
import { topicDeLOutil, type IdTopic } from './topics';
import { numerosCites } from './reperage';
import { logger } from '../logger';

type Langue = 'fr' | 'en';

/** Ce que le navigateur dit de la page d'où l'on parle à Lumi. */
export interface ContextePageAutomatisation {
  rule_id: string;
  /** L'éditeur a des modifications que l'enregistrement automatique n'a pas encore écrites. */
  non_enregistre?: boolean;
}

interface Options {
  /** Le client de l'UTILISATEUR : la RLS borne à son bureau et à son rôle. */
  client: SupabaseClient;
  orgId: string;
  /** Même espace que l'orchestrateur : la référence donnée ici est celle que le modèle renverra aux outils. */
  espaceRefs: string;
  langue: Langue;
}

/** Texte en minuscules, sans accents ni guillemets. */
function plat(s: string): string {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'«»"“”]/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Le bloc « page ouverte » : l'automatisation à l'écran, telle qu'ENREGISTRÉE.
 * Null si la règle n'existe pas pour cette personne (autre bureau, supprimée
 * définitivement) : un identifiant venu du navigateur n'ouvre rien de plus que
 * ce que la RLS permet.
 */
export async function contexteDeLaPage(page: ContextePageAutomatisation, o: Options): Promise<string | null> {
  try {
    const { data, error } = await o.client
      .from('automation_rules').select(COLONNES_REGLE_LUE)
      .eq('id', page.rule_id).eq('org_id', o.orgId).is('purged_at', null)
      .maybeSingle();
    if (error || !data) return null;
    const regle = data as unknown as RegleLue;
    const fr = o.langue === 'fr';
    const ref = String(masquerIds(o.espaceRefs, page.rule_id));
    const resume = resumeCompact(regle, o.langue);
    const lignes = fr
      ? [
        `PAGE OUVERTE — l'utilisateur vient de l'éditeur de cette automatisation (rule_id « ${ref} »). « l'automatisation », « elle », « la », « le message », « le texto », « le courriel » désignent CELLE-CI : ne demande pas laquelle, ne la cherche pas dans la liste.`,
        resume,
        ...(page.non_enregistre ? ['Attention : l’éditeur a des modifications PAS ENCORE ENREGISTRÉES. Ce résumé est la dernière version enregistrée ; dis-le avant de modifier ou d’activer.'] : []),
      ]
      : [
        `OPEN PAGE — the user comes from the editor of this automation (rule_id “${ref}”). “the automation”, “it”, “the message”, “the text”, “the email” mean THIS one: do not ask which, do not look it up in the list.`,
        resume,
        ...(page.non_enregistre ? ['Careful: the editor has changes NOT YET SAVED. This summary is the last saved version; say so before changing or enabling it.'] : []),
      ];
    return lignes.join('\n');
  } catch (e: unknown) {
    logger.warn('[lumi] contexte de page illisible', { message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** Mots qui disent qu'on veut agir sur une automatisation ou son contenu (et pas, par exemple, envoyer un rappel à quelqu'un). */
const INDICE = /\b(messages?|textes?|textos?|sms|courriels?|emails?|objet|delais?|delay|etapes?|steps?|declencheurs?|triggers?|active\w*|desactive\w*|publie\w*|pause|explique\w*|explain\w*|change\w*|modifie\w*|reecris\w*|rewrite|raccourci\w*|shorter|renomme\w*|rename|supprime\w*|delete|duplique\w*|duplicate|ajoute\w*|add|retire\w*|remove|enable|disable|turn (?:on|off))\b/;
const MOTS_VIDES: ReadonlySet<string> = new Set(['de', 'des', 'du', 'la', 'le', 'les', 'un', 'une', 'en', 'et', 'a', 'au', 'aux', 'pour', 'par', 'the', 'of', 'for', 'to', 'and', 'on', 'in', 'd', 'l']);
// Les chiffres comptent (« Rappel — 1 jour » n'est pas « Rappel — 7 jours ») ; un pluriel ne compte pas.
const mots = (s: string): string[] => plat(s).split(/[^a-z0-9]+/).filter((m) => (m.length > 1 || /\d/.test(m)) && !MOTS_VIDES.has(m)).map((m) => (m.length > 3 ? m.replace(/(s|x)$/, '') : m));

/**
 * Le contenu ENREGISTRÉ, en compact : les textos en entier (c'est ce qu'on cite),
 * un courriel borné — `get_automation` rend le texte complet. Et ce qui empêche
 * de l'activer telle quelle, pour que Lumi le DISE au lieu de proposer.
 */
function resumeCompact(regle: RegleLue, langue: Langue): string {
  const fr = langue === 'fr';
  const obstacles = obstaclesAPublication(regle, fr);
  return [
    texteDuResume(resumeDeLaRegle(regle, langue, { maxMessage: 400 }), langue),
    ...(obstacles.length
      ? [fr
        ? `NE PEUT PAS être activée telle quelle : ${obstacles.join(' · ')} Si on te demande de l’activer, dis-le clairement et propose de corriger d’abord — ne propose pas l’activation.`
        : `CANNOT be enabled as is: ${obstacles.join(' · ')} If asked to enable it, say so plainly and offer to fix it first — do not propose enabling.`]
      : []),
  ].join('\n');
}

type Ligne = { id: string; name: string; trigger_event: string; is_active: boolean; preset_key: string | null };
// Sous son nom rangé, ou sous le nom que l'écran affiche (un préréglage est rangé en anglais).
const nomsDe = (r: Ligne): string[] => [r.name, localizeAutomationName(r.name, 'fr'), localizeAutomationName(r.name, 'en')];

/** Les automatisations dont le nom figure dans la phrase (voir `automatisationsCitees`). */
async function trouverParNom(message: string, o: Options): Promise<Ligne[]> {
  const e = plat(message);
  if (e.length < 8 || e.length > 600 || numerosCites(message).length > 0) return [];
  const dansLeMessage = new Set(mots(message));
  if (dansLeMessage.size === 0) return [];
  const indice = INDICE.test(e);
  const { data, error } = await o.client
    .from('automation_rules').select('id, name, trigger_event, is_active, preset_key')
    .eq('org_id', o.orgId).is('deleted_at', null).order('name', { ascending: true }).limit(200);
  if (error || !data) return [];
  const toutes = (data as Ligne[]).filter((r) => !estPrereglageRetire(r));
  // 1. Un nom cité ENTRE GUILLEMETS l'emporte : « Relance facture en retard » ne désigne pas
  //    aussi « Rappel de facture — 7 jours » parce que la phrase contient « rappel » et « 7 jours ».
  const entreGuillemets = [...message.matchAll(/«\s*([^»]{2,120}?)\s*»|"([^"]{2,120})"|“([^”]{2,120})”/g)].map((m) => plat(m[1] ?? m[2] ?? m[3] ?? ''));
  let trouvees = entreGuillemets.length ? toutes.filter((r) => nomsDe(r).some((nom) => entreGuillemets.includes(plat(nom)))) : [];
  // 2. Sinon le nom écrit tel quel dans la phrase.
  if (!trouvees.length) {
    trouvees = toutes.filter((r) => nomsDe(r).some((nom) => {
      const n = plat(nom);
      return n.length >= 5 && ` ${e} `.includes(` ${n} `) && (n.includes(' ') || indice);
    }));
  }
  // 3. Sinon tous les mots utiles du nom, dans le désordre (« ma relance de factures en retard »).
  if (!trouvees.length) {
    trouvees = toutes.filter((r) => nomsDe(r).some((nom) => {
      const m = [...new Set(mots(nom))];
      if (!m.length || !m.every((x) => dansLeMessage.has(x))) return false;
      return m.length >= 2 || indice;
    }));
  }
  return trouvees;
}

/** Le dernier message écrit par l'utilisateur dans l'historique (texte seulement). */
function dernierMessageUtilisateur(historique: Anthropic.Messages.MessageParam[]): string | null {
  for (let i = historique.length - 1; i >= 0; i--) {
    const m = historique[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    const texte = m.content.filter((b): b is Anthropic.Messages.TextBlockParam => b.type === 'text').map((b) => b.text).join(' ').trim();
    if (texte) return texte;
  }
  return null;
}

export interface AutomatisationsCitees {
  /** Le bloc à donner au modèle, ou null. */
  contexte: string | null;
  /** Combien d'automatisations portent le nom cité (0, 1, ou plusieurs homonymes). */
  nombre: number;
}

/**
 * Les automatisations dont le NOM figure dans le message. Un nom d'au moins deux
 * mots utiles suffit (« relance facture retard ») ; un nom d'un seul mot
 * (« Relance ») ne compte que si la phrase porte sur un message, un délai, une
 * activation… — « relance mes retards » reste une relance de paiement. Jamais
 * quand la phrase cite un numéro de devis, de facture ou de job : elle parle de
 * cette fiche-là.
 *
 * UNE seule trouvée : son contenu enregistré est joint (les textos en entier) —
 * Lumi n'a plus à payer un appel pour la retrouver, puis un autre pour la lire
 * (F-12), et il a le texte actuel sous les yeux pour le réécrire.
 *
 * `historique` : quand le message ne cite rien mais RÉPOND à une question
 * « laquelle ? » (« celle des factures »), on reprend les homonymes du message
 * précédent et on garde celle que la réponse désigne, par son déclencheur ou son
 * nom. Sans ça, Lumi relisait la liste, relisait la règle, puis redemandait une
 * confirmation au lieu de proposer (C08).
 *
 * Ne lève jamais.
 */
export async function automatisationsCitees(message: string, o: Options, historique: Anthropic.Messages.MessageParam[] = []): Promise<AutomatisationsCitees> {
  const rien: AutomatisationsCitees = { contexte: null, nombre: 0 };
  try {
    const fr = o.langue === 'fr';
    let trouvees = await trouverParNom(message, o);
    let designee = false;
    if (!trouvees.length && historique.length > 0 && estUneSuite(message)) {
      const precedent = dernierMessageUtilisateur(historique);
      const candidates = precedent ? await trouverParNom(precedent, o) : [];
      if (candidates.length > 1) {
        const dit = new Set(mots(message));
        const gardees = candidates.filter((r) => [declencheurEnClair(r.trigger_event, true), declencheurEnClair(r.trigger_event, false)]
          .some((libelle) => mots(libelle).some((m) => dit.has(m))));
        // Les mots communs à TOUTES les candidates (leur nom) ne départagent rien : seul le déclencheur le fait.
        if (gardees.length === 1) { trouvees = gardees; designee = true; }
      }
    }
    if (!trouvees.length) return rien;
    const ligne = (r: Ligne): string => `- « ${localizeAutomationName(r.name, o.langue)} » → rule_id « ${String(masquerIds(o.espaceRefs, r.id))} » · ${fr ? 'déclencheur' : 'trigger'} : ${declencheurEnClair(r.trigger_event, fr)} · ${r.is_active ? (fr ? 'publiée' : 'published') : (fr ? 'en brouillon' : 'draft')}`;
    if (trouvees.length > 1) {
      const tete = fr
        ? `${trouvees.length} automatisations portent le nom cité : ne choisis pas à la place de l'utilisateur. Demande LAQUELLE en UNE question, en les distinguant par leur déclencheur, sans rien modifier :`
        : `${trouvees.length} automations carry the name mentioned: do not pick for the user. Ask WHICH ONE in ONE question, telling them apart by their trigger, without changing anything:`;
      return { contexte: `${tete}\n${trouvees.slice(0, 6).map(ligne).join('\n')}`, nombre: trouvees.length };
    }
    const seule = trouvees[0];
    const { data: complete } = await o.client
      .from('automation_rules').select(COLONNES_REGLE_LUE)
      .eq('id', seule.id).eq('org_id', o.orgId).is('purged_at', null).maybeSingle();
    const contenu = complete ? resumeCompact(complete as unknown as RegleLue, o.langue) : null;
    const tete = designee
      ? (fr
        ? 'Automatisation que l’utilisateur vient de DÉSIGNER en répondant à ta question (c’est celle-ci : ne redemande pas, ne relis pas la liste — fais maintenant ce qu’il avait demandé au départ) :'
        : 'Automation the user just POINTED AT by answering your question (this is the one: do not ask again, do not read the list — now do what they first asked for):')
      : (fr
        ? 'Automatisation dont le nom est cité dans la demande (déjà trouvée : pas besoin de lire la liste) :'
        : 'Automation named in the request (already found: no need to read the list):');
    const suite = contenu
      ? `${fr ? 'Ce qui est ENREGISTRÉ (un courriel long est abrégé : get_automation rend le texte complet)' : 'What is SAVED (a long email is shortened: get_automation returns the full text)'} :\n${contenu}`
      : (fr ? 'Son contenu → get_automation.' : 'Its content → get_automation.');
    return { contexte: `${tete}\n${ligne(seule)}\n${suite}`, nombre: 1 };
  } catch (e: unknown) {
    logger.warn('[lumi] repérage des automatisations illisible', { message: e instanceof Error ? e.message : String(e) });
    return rien;
  }
}

/**
 * Le sujet dont on parlait : celui du DERNIER outil appelé (ou proposé) dans la
 * conversation. Null si aucun outil n'a encore servi.
 */
export function sujetDeLaConversation(historique: Anthropic.Messages.MessageParam[]): IdTopic | null {
  for (let i = historique.length - 1; i >= 0; i--) {
    const m = historique[i];
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (let j = m.content.length - 1; j >= 0; j--) {
      const b = m.content[j] as { type?: string; name?: unknown };
      if (b?.type !== 'tool_use') continue;
      const sujet = topicDeLOutil(String(b.name));
      if (sujet) return sujet;
    }
  }
  return null;
}

/**
 * Le message se rattache-t-il à ce qui précède ? Un pronom (« active-la », « celle
 * des devis », « remets-le »), ou une réponse brève (« oui », « non, plus court »).
 * Un tel message ne se classe pas sur son vocabulaire seul : « celle des devis »
 * ne parle pas de devis, mais d'une automatisation.
 */
export function estUneSuite(message: string): boolean {
  const e = plat(message);
  if (e.length <= 28) return true;
  return /(^|[\s-])(celle|celui|ceux|celles|laquelle|lequel|elle|la meme|le meme|l autre|that one|this one|the other one|the same)([\s,.?!-]|$)|-(la|le|les)([\s,.?!]|$)|\b(it|them)\b/.test(e) && e.length <= 160;
}
