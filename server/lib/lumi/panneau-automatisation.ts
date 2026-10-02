/**
 * Ce que le panneau « Construire avec Lumi » de l'éditeur fait AUTOUR de la génération.
 * ─────────────────────────────────────────────────────────────────────────
 * La génération (`generer-parcours.ts`) propose un parcours ; elle n'écrit rien. Deux
 * choses manquaient au panneau (mission finale, constats A-14, A-17, C01) :
 *
 *  1. le JOURNAL : ce que Lumi change dans l'éditeur n'apparaissait nulle part
 *     (`agent_actions` vide après une conversation entière) — « qu'est-ce que tu as
 *     fait récemment ? » ne le savait pas ;
 *  2. PUBLIER et METTRE EN PAUSE : « active-la » ne pouvait même pas s'envoyer, et
 *     le panneau ne savait pas le faire. Ici : un récapitulatif écrit par du code
 *     (déclencheur, chaque message mot pour mot, la portée), puis un OUI explicite ;
 *     la publication passe par le MÊME chemin que le bouton « Publier »
 *     (`changerPublication` : mêmes contrôles, même preuve de droit).
 *
 * La route `POST /automations/rules/generer` n'en garde que les APPELS (elle
 * appartient à l'éditeur) : `demandeTropCourte`, `ouvrirPanneau`,
 * `reponseSansChangement`, `journaliserProposition`. Toute la logique vit ici.
 */
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { changerPublication } from '../automations-publication';
import { COLONNES_REGLE_LUE, declencheurEnClair, etapesDeLaRegle, regleAtteintLeClient, resumeDeLaRegle, type RegleLue } from '../automations-etapes';
import { textesDExemple } from '../../../src/lib/publicationAutomatisation';
import { messageCorbeille } from '../automations-corbeille';
import { logger } from '../logger';
import type { ParcoursPropose } from './generer-parcours';

type Langue = 'fr' | 'en';

/**
 * Une ligne dans le journal d'actions de l'agent (`agent_actions`), lisible par
 * `get_recent_agent_actions`. L'empreinte porte l'instant : ce n'est pas un
 * anti-doublon, c'est un journal — deux demandes identiques sont deux lignes.
 * Ne lève jamais : un journal qui saute ne doit pas faire échouer la demande.
 */
export async function journaliserActionPanneau(admin: SupabaseClient, a: {
  orgId: string; userId: string; outil: string; ruleId: string; resultat: Record<string, unknown>;
}): Promise<void> {
  try {
    const args_hash = crypto.createHash('sha256').update(`${a.userId}:${a.ruleId}:${Date.now()}:${Math.random()}`).digest('hex');
    const { error } = await admin.from('agent_actions').insert({ org_id: a.orgId, user_id: a.userId, outil: a.outil, args_hash, resultat: { ...a.resultat, canal: 'editeur' } });
    if (error) logger.error('[lumi/panneau] action non journalisée', { outil: a.outil, message: error.message });
  } catch (e: unknown) {
    logger.error('[lumi/panneau] action non journalisée', { outil: a.outil, message: e instanceof Error ? e.message : String(e) });
  }
}

/** La phrase qui demande le OUI : c'est à elle qu'on reconnaît, au tour suivant, une confirmation. */
const DEMANDE_OUI = { fr: 'Réponds « oui » pour la publier.', en: 'Reply “yes” to publish it.' } as const;

/** Le dernier message de Lumi demandait-il la confirmation d'une publication ? */
export function attendUnOui(dernierMessageDeLumi: string | null | undefined): boolean {
  const t = String(dernierMessageDeLumi ?? '');
  return t.includes(DEMANDE_OUI.fr) || t.includes(DEMANDE_OUI.en);
}

/**
 * Combien de fois le déclencheur est arrivé dans les 14 derniers jours — l'ordre
 * de grandeur de ce que l'automatisation touchera. Rôle de service (le journal
 * des événements n'est pas lisible par une session), borné à l'entreprise.
 */
async function rythme(admin: SupabaseClient, orgId: string, declencheur: string): Promise<number | null> {
  try {
    const { count, error } = await admin
      .from('domain_events').select('id', { count: 'exact', head: true })
      .eq('org_id', orgId).eq('type', declencheur).gte('created_at', new Date(Date.now() - 14 * 86_400_000).toISOString());
    return error || typeof count !== 'number' ? null : count;
  } catch { return null; }
}

/** Ce que l'activation change pour les clients — décision de la mission (point 10) : rien n'est rattrapé. */
export async function porteeALActivation(admin: SupabaseClient, orgId: string, regle: RegleLue, langue: Langue): Promise<string> {
  const fr = langue === 'fr';
  const quoi = declencheurEnClair(regle.trigger_event, fr);
  const n = await rythme(admin, orgId, String(regle.trigger_event ?? ''));
  const filtres = !!regle.conditions && Object.keys(regle.conditions).length > 0;
  const ordre = n === null ? '' : fr
    ? ` Pour donner un ordre de grandeur : « ${quoi} » est arrivé ${n} fois dans les 14 derniers jours${filtres ? ' (avant les filtres)' : ''}.`
    : ` For scale: “${quoi}” happened ${n} time${n === 1 ? '' : 's'} in the last 14 days${filtres ? ' (before filters)' : ''}.`;
  return (fr
    ? `À l’activation, 0 client ne reçoit quoi que ce soit : rien n’est rattrapé, seuls les événements « ${quoi} » qui arrivent APRÈS déclenchent l’automatisation.`
    : `On activation, 0 clients receive anything: nothing is caught up, only “${quoi}” events that happen AFTER it trigger the automation.`) + ordre;
}

/**
 * CE QUI PARTIRA, écrit par du code avant toute publication : le déclencheur dans
 * les mots de l'écran, chaque étape dans l'ordre avec le texte exact des messages,
 * et la portée. Le même texte dans le panneau de l'éditeur et au-dessus de la
 * carte d'activation du clavardage : personne ne publie sans l'avoir lu.
 */
export async function recapAvantPublication(admin: SupabaseClient, orgId: string, regle: RegleLue, langue: Langue): Promise<string> {
  const fr = langue === 'fr';
  const r = resumeDeLaRegle(regle, langue, { maxMessage: 600 });
  const lignes = [
    fr ? `Avant de publier « ${r.nom} », voici exactement ce qui partira :` : `Before publishing “${r.nom}”, here is exactly what will run:`,
    `${fr ? 'Déclencheur' : 'Trigger'} : ${r.declencheur}${r.filtres.length ? ` (${fr ? 'seulement si' : 'only if'} ${r.filtres.join(' ; ')})` : ''}`,
    ...r.etapes,
    ...(regleAtteintLeClient(regle) ? [await porteeALActivation(admin, orgId, regle, langue)] : []),
  ];
  return lignes.join('\n');
}

export interface ReponseIntention {
  /** Ce que Lumi répond dans le panneau. */
  resume: string;
  /** L'état de publication APRÈS la demande, relu en base (absent si rien n'a été lu). */
  publiee?: boolean;
}

/**
 * « active-la », « mets-la en pause », puis « oui » — dans le panneau de l'éditeur.
 *
 * `etapesALEcran` : le parcours tel que l'éditeur l'affiche. S'il diffère de ce
 * qui est ENREGISTRÉ, rien n'est publié : on ne publie jamais autre chose que ce
 * que l'utilisateur a sous les yeux.
 */
export async function repondreIntention(o: {
  /** Le client de l'UTILISATEUR (RLS : c'est lui qui prouve le droit). */
  client: SupabaseClient;
  /** Rôle de service : journal d'actions et rythme du déclencheur seulement. */
  admin: SupabaseClient;
  orgId: string; userId: string; ruleId: string;
  intention: 'activer' | 'desactiver';
  langue: Langue;
  etapesALEcran: unknown[] | undefined;
  /** Le dernier message de Lumi GARDÉ en base avec l'automatisation (jamais celui que le navigateur envoie). */
  dernierMessageDeLumi: string | null;
}): Promise<ReponseIntention> {
  const fr = o.langue === 'fr';
  const { data, error } = await o.client
    .from('automation_rules').select(COLONNES_REGLE_LUE)
    .eq('id', o.ruleId).eq('org_id', o.orgId).is('purged_at', null).maybeSingle();
  if (error || !data) return { resume: fr ? 'Je ne retrouve pas cette automatisation : enregistre-la d’abord, puis redemande-moi.' : 'I cannot find this automation: save it first, then ask me again.' };
  const regle = data as unknown as RegleLue;
  const nom = String(regle.name ?? '');
  const publiee = regle.is_active === true;
  if (regle.deleted_at) return { resume: messageCorbeille(fr), publiee: false };

  if (o.intention === 'desactiver') {
    if (!publiee) return { resume: fr ? `« ${nom} » est déjà en brouillon : rien ne part.` : `“${nom}” is already a draft: nothing is sent.`, publiee: false };
    const r = await changerPublication(o.client, o.orgId, o.ruleId, false, fr);
    if (!r.ok) return { resume: fr ? `Je n’ai PAS pu la mettre en pause : ${r.erreur}` : `I could NOT pause it: ${r.erreur}`, publiee: true };
    await journaliserActionPanneau(o.admin, { orgId: o.orgId, userId: o.userId, outil: 'toggle_automation_rule', ruleId: o.ruleId, resultat: { updated: true, rule_id: o.ruleId, name: r.name, is_active: false } });
    return { resume: fr ? `C’est fait : « ${r.name} » est en brouillon, plus rien ne part tant qu’elle n’est pas republiée.` : `Done: “${r.name}” is now a draft, nothing is sent until it is published again.`, publiee: false };
  }

  // ── Publier ──
  const r = resumeDeLaRegle(regle, o.langue, { maxMessage: 600 });
  const recap = [`${fr ? 'Déclencheur' : 'Trigger'} : ${r.declencheur}${r.filtres.length ? ` (${fr ? 'seulement si' : 'only if'} ${r.filtres.join(' ; ')})` : ''}`, ...r.etapes].join('\n');
  if (publiee) {
    return { resume: fr ? `« ${nom} » est déjà publiée. Voici ce qui part :\n${recap}` : `“${nom}” is already published. Here is what runs:\n${recap}`, publiee: true };
  }
  // Ce qui est à l'écran n'est pas (encore) ce qui est enregistré : on ne publie pas à l'aveugle.
  const enregistrees = etapesDeLaRegle(regle);
  if (Array.isArray(o.etapesALEcran) && JSON.stringify(o.etapesALEcran) !== JSON.stringify(enregistrees)) {
    return {
      resume: fr
        ? 'Tes dernières modifications ne sont pas encore enregistrées (attends « Enregistré », en haut de l’éditeur). Redemande-moi de l’activer juste après : je ne publie que ce qui est enregistré.'
        : 'Your latest changes are not saved yet (wait for “Saved” at the top of the editor). Ask me again right after: I only publish what is saved.',
      publiee: false,
    };
  }
  const exemples = textesDExemple({ ...regle, fr });
  if (exemples.length) {
    return {
      resume: fr
        ? `Je ne l’active pas : ${exemples.length > 1 ? 'des étapes portent' : 'une étape porte'} encore le texte d’exemple de l’éditeur, qui partirait tel quel aux clients. Dis-moi quoi écrire à la place, puis redemande l’activation.`
        : `I am not enabling it: ${exemples.length > 1 ? 'some steps still carry' : 'a step still carries'} the editor’s sample text, which would go to clients as is. Tell me what to write instead, then ask again.`,
      publiee: false,
    };
  }

  if (attendUnOui(o.dernierMessageDeLumi)) {
    const res = await changerPublication(o.client, o.orgId, o.ruleId, true, fr);
    if (!res.ok) return { resume: fr ? `Je n’ai PAS pu la publier. ${res.erreur}` : `I could NOT publish it. ${res.erreur}`, publiee: false };
    await journaliserActionPanneau(o.admin, { orgId: o.orgId, userId: o.userId, outil: 'toggle_automation_rule', ruleId: o.ruleId, resultat: { updated: true, rule_id: o.ruleId, name: res.name, is_active: true } });
    return {
      resume: fr
        ? `C’est fait : « ${res.name} » est publiée. Elle partira dès le prochain déclenchement (${r.declencheur}).`
        : `Done: “${res.name}” is published. It will run from the next trigger (${r.declencheur}).`,
      publiee: true,
    };
  }

  return {
    resume: `${await recapAvantPublication(o.admin, o.orgId, regle, o.langue)}\n${fr ? DEMANDE_OUI.fr : DEMANDE_OUI.en}`,
    publiee: false,
  };
}

/* ── Le panneau, vu de la route ───────────────────────────────── */

/**
 * Une PREMIÈRE demande décrit l'automatisation : dix caractères au moins. Dans une
 * conversation en cours, « oui », « non », « active-la » sont des réponses — Lumi
 * posait une question à laquelle on ne pouvait pas répondre (A-12).
 */
export function demandeTropCourte(demande: string, echanges: unknown): boolean {
  const enConversation = Array.isArray(echanges) && echanges.length > 0;
  return demande.trim().length < (enConversation ? 1 : 10);
}

type TourGarde = { role?: string; content?: string; avant?: unknown[] };

/** L'automatisation ouverte dans l'éditeur, telle qu'ENREGISTRÉE, et le fil gardé avec elle. */
export interface PanneauOuvert {
  /** Null : pas encore enregistrée (ou identifiant illisible). */
  id: string | null;
  /** Son nom en base — Lumi ne la rebaptise plus de lui-même (A-04). */
  nom: string | null;
  /** Les étapes d'avant la dernière modification de Lumi : pour « annule ça », « remets le texte d'avant ». */
  etapesDAvant: unknown[] | null;
  /** Le dernier message de Lumi GARDÉ en base (jamais celui que le navigateur envoie) : c'est lui qui prouve qu'un OUI a été demandé. */
  dernierMessageDeLumi: string | null;
  /** Garde l'échange AVEC l'automatisation (40 derniers tours) — un échec est journalisé, jamais fatal. */
  garderLeFil(demande: string, reponseDeLumi: string): Promise<void>;
}

/** Lit l'automatisation ouverte avec le client de l'UTILISATEUR : la RLS borne à son bureau. Ne lève jamais. */
export async function ouvrirPanneau(client: SupabaseClient, orgId: string, ruleIdEnvoye: string | null | undefined): Promise<PanneauOuvert> {
  const id = ruleIdEnvoye && /^[0-9a-f-]{36}$/i.test(ruleIdEnvoye) ? ruleIdEnvoye : null;
  let ligne: { name?: string | null; lumi_conversation?: unknown } | null = null;
  if (id) {
    try {
      const { data } = await client.from('automation_rules').select('name, lumi_conversation')
        .eq('id', id).eq('org_id', orgId).is('purged_at', null).maybeSingle();
      ligne = data ?? null;
    } catch (e: unknown) {
      logger.warn('[lumi/panneau] automatisation ouverte illisible', { rule_id: id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  const fil: TourGarde[] = Array.isArray(ligne?.lumi_conversation) ? ligne.lumi_conversation as TourGarde[] : [];
  const dernier = [...fil].reverse().find((t) => t?.role === 'assistant');
  return {
    id,
    nom: ligne?.name ?? null,
    etapesDAvant: [...fil].slice(-4).reverse().find((t) => t?.role === 'assistant' && Array.isArray(t.avant) && t.avant.length > 0)?.avant ?? null,
    dernierMessageDeLumi: typeof dernier?.content === 'string' ? dernier.content : null,
    garderLeFil: async (demande, reponseDeLumi) => {
      if (!id || !ligne) return;
      const conversation = [...fil, { role: 'user', content: demande.slice(0, 2000) }, { role: 'assistant', content: reponseDeLumi.slice(0, 2000) }].slice(-40);
      const { error } = await client.from('automation_rules').update({ lumi_conversation: conversation }).eq('id', id).eq('org_id', orgId);
      if (error) logger.error('[lumi/parcours] conversation non gardée', { rule_id: id, message: error.message });
    },
  };
}

/**
 * RIEN N'A CHANGÉ (F-07, A-16) : une question, un refus, « active-la ». Rend le
 * corps de la réponse — le parcours à l'écran repart TEL QUEL, pas réécrit par le
 * modèle, pas repassé à la validation (une étape en cours de saisie n'empêche pas
 * de poser une question) ; `modifie: false` : l'éditeur n'a rien à enregistrer.
 * Rend null quand le parcours a changé : la route continue comme avant.
 *
 * PUBLIER / METTRE EN PAUSE (A-14) ne passe jamais par le modèle : `repondreIntention`.
 */
export async function reponseSansChangement(o: {
  panneau: PanneauOuvert;
  parcours: ParcoursPropose;
  parcoursALEcran: { trigger_event?: string; steps?: unknown[] } | null | undefined;
  client: SupabaseClient; admin: SupabaseClient;
  orgId: string; userId: string; langue: Langue; demande: string;
}): Promise<Record<string, unknown> | null> {
  const etapesALEcran = Array.isArray(o.parcoursALEcran?.steps) ? o.parcoursALEcran.steps : [];
  if (o.parcours.modifie !== false || o.parcours.autre || etapesALEcran.length === 0) return null;
  let resume = o.parcours.resume;
  let publiee: boolean | undefined;
  if (o.parcours.intention && o.panneau.id) {
    const rep = await repondreIntention({
      client: o.client, admin: o.admin, orgId: o.orgId, userId: o.userId, ruleId: o.panneau.id,
      intention: o.parcours.intention, langue: o.langue, etapesALEcran,
      dernierMessageDeLumi: o.panneau.dernierMessageDeLumi,
    });
    resume = rep.resume;
    publiee = rep.publiee;
  }
  await o.panneau.garderLeFil(o.demande, resume || (o.langue === 'fr' ? 'Rien n’a changé.' : 'Nothing changed.'));
  return {
    nom: o.parcours.nom,
    trigger_event: o.parcoursALEcran?.trigger_event ?? o.parcours.trigger_event,
    resume,
    steps: etapesALEcran,
    autre: null,
    modifie: false,
    ...(publiee !== undefined ? { publiee } : {}),
  };
}

/** Le journal d'actions de Lumi (A-17) : ce qu'il PROPOSE dans l'éditeur n'apparaissait nulle part. Sans attente, ne lève jamais. */
export function journaliserProposition(admin: SupabaseClient, a: { orgId: string; userId: string; panneau: PanneauOuvert; parcours: ParcoursPropose }): void {
  if (!a.panneau.id || a.parcours.modifie === false) return;
  void journaliserActionPanneau(admin, {
    orgId: a.orgId, userId: a.userId, outil: 'construire_parcours_editeur', ruleId: a.panneau.id,
    resultat: { rule_id: a.panneau.id, name: a.parcours.nom, ce_qui_a_change: a.parcours.resume.slice(0, 400), note: 'Proposé dans l’éditeur ; c’est l’éditeur qui enregistre.' },
  });
}
